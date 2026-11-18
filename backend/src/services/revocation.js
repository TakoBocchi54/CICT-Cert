import { encodeFunctionData, keccak256, parseEventLogs } from "viem";
import abi from "../contracts/CICTCertificate.abi.json" with { type: "json" };
import { pool } from "../db/pool.js";
import { certificateContract, certificateIssuer, revokedTokenIds } from "./certificates.js";
import { IssuanceError, ensureIssuerWallet, finalizedReceipt, lockIssuer, signIssuerCall } from "./issuance.js";
import { smtRoot } from "../utils/merkle.js";
import { formatCertificateNo } from "../utils/certificateNumber.js";

const MAX_REASON_LENGTH = 500;
// shortcut: one revocation transaction takes at most 200 certificates (about 0.1M gas); raise it if a recall ever needs more.
const MAX_BATCH = 200;

// The confirmed mint supplies the token ID; the wallet is the recipient the token was minted to.
const CERTIFICATES = `
  SELECT c."certificateID", c."certificateNo", c."seminarID", c."studentID", r.attended, c."recipientName", c."seminarTitle",
         to_char(c."seminarDate", 'YYYY-MM-DD') AS "seminarDate", c."certificateHash", c.status, c."issuedAt", c."revokedAt",
         w."studentWalletAddress" AS "walletAddress", m."tokenID", m."contractAddress" AS "mintContract", m."transactionHash" AS "mintTransactionHash"
  FROM certificate c
  JOIN seminar_registration r ON r."seminarID" = c."seminarID" AND r."studentID" = c."studentID"
  LEFT JOIN student_wallet w ON w."studentWalletID" = c."studentWalletID"
  LEFT JOIN LATERAL (SELECT "tokenID", "contractAddress", "transactionHash" FROM blockchain_record
    WHERE "certificateID" = c."certificateID" AND "transactionType" = 'MINT' AND "transactionStatus" = 'CONFIRMED'
    ORDER BY "transactionID" DESC LIMIT 1) m ON true
  WHERE c."certificateNo" = ANY($1::int[]) ORDER BY c."certificateNo"`;

const latestRevocation = (db, certificateID) => db.query(`SELECT * FROM blockchain_record WHERE "certificateID" = $1
  AND "transactionType" = 'REVOKE' ORDER BY "transactionID" DESC LIMIT 1`, [certificateID]).then(r => r.rows[0]);

function result(certificate, attempt) {
  return { certificateNo: certificate.certificateNo, status: certificate.status, revokedAt: certificate.revokedAt ?? null,
    tokenID: certificate.tokenID ?? null, transactionStatus: attempt?.transactionStatus ?? null,
    transactionHash: attempt?.transactionHash ?? null, reason: attempt?.revocationReason ?? null };
}

// The registration's current non-revoked certificate, i.e. the replacement of a revoked one.
const activeCertificate = (db, certificate) => db.query(`SELECT "certificateNo", status, to_char("seminarDate", 'YYYY-MM-DD') AS "seminarDate" FROM certificate
  WHERE "seminarID" = $1 AND "studentID" = $2 AND status <> 'REVOKED'`, [certificate.seminarID, certificate.studentID]).then(r => r.rows[0]);

export async function findCertificate(certificateNo) {
  const certificate = (await pool.query(CERTIFICATES, [[certificateNo]])).rows[0];
  if (!certificate) return null;
  const { certificateID: _id, studentID: _student, mintContract: _contract, ...details } = certificate;
  return { ...details, revocation: result(certificate, await latestRevocation(pool, certificate.certificateID)),
    replacement: certificate.status === "REVOKED" ? (await activeCertificate(pool, certificate)) ?? null : null };
}

// One revocation batch = every REVOKE row sharing the transaction hash, in certificate-number order.
// Returns a warning string when the submission is uncertain.
async function reconcile(client, transactionHash, context) {
  const { rows } = await client.query(
    `SELECT b."transactionHash", b."signedTransaction", b."contractAddress", b."fromAddress", b."tokenID", c."certificateID"
     FROM blockchain_record b JOIN certificate c USING ("certificateID")
     WHERE b."transactionHash" = $1 AND b."transactionType" = 'REVOKE' ORDER BY c."certificateNo" FOR UPDATE OF c`, [transactionHash]);
  const ids = rows.map(row => row.certificateID), tokenIDs = rows.map(row => BigInt(row.tokenID));
  // The batch is still PENDING here, so `confirmed` is exactly the set its root was built on.
  const root = smtRoot([...(await revokedTokenIds(client, context.contractAddress)).confirmed, ...tokenIDs]);
  const { receipt, block, sendUncertain } = await finalizedReceipt(rows.find(row => row.signedTransaction) ?? rows[0], context,
    encodeFunctionData({ abi, functionName: "revokeBatch", args: [root, tokenIDs] }));
  if (sendUncertain) return "Submission could not be confirmed. Check this same transaction again; no new revocation was created.";
  if (!receipt) return;
  if (receipt.status === "reverted") {
    // The certificates stay ISSUED; a later request may retry with a new attempt.
    await client.query(`UPDATE blockchain_record SET "transactionStatus" = 'FAILED', "blockNum" = $2
      WHERE "transactionHash" = $1 AND "transactionType" = 'REVOKE'`, [transactionHash, receipt.blockNumber.toString()]);
    return;
  }
  const events = parseEventLogs({ abi, eventName: "RevocationRootUpdated", logs: receipt.logs.filter(log => log.address.toLowerCase() === context.contractAddress) });
  if (!events.some(event => event.args.newRoot === root && event.args.tokenIds.length === tokenIDs.length &&
      event.args.tokenIds.every((tokenID, i) => tokenID === tokenIDs[i]))) {
    throw new IssuanceError(409, "The receipt has no matching revocation event. Contact CICT.");
  }
  await client.query(`UPDATE blockchain_record SET "transactionStatus" = 'CONFIRMED', "blockNum" = $2
    WHERE "transactionHash" = $1 AND "transactionType" = 'REVOKE'`, [transactionHash, receipt.blockNumber.toString()]);
  // The contract keeps one root, not a time per certificate: the revoking block's time is the revocation time.
  await client.query(`UPDATE certificate SET status = 'REVOKED', "revokedAt" = $2 WHERE "certificateID" = ANY($1)`,
    [ids, new Date(Number(block.timestamp) * 1000)]);
}

// Revokes every listed certificate in one transaction that replaces the contract's sparse Merkle revocation root.
// allowNew = false only reconciles or rebroadcasts an existing attempt; it never signs a new transaction.
export async function revokeCertificates(certificateNos, faculty, reason, allowNew = true) {
  const numbers = [...new Set(certificateNos)];
  if (!numbers.length || numbers.length > MAX_BATCH) throw new IssuanceError(400, `Choose between 1 and ${MAX_BATCH} certificates to revoke.`);
  if (allowNew) {
    reason = typeof reason === "string" ? reason.trim() : "";
    if (!reason || reason.length > MAX_REASON_LENGTH) throw new IssuanceError(400, `Enter a revocation reason of up to ${MAX_REASON_LENGTH} characters.`);
  }
  let context;
  try { context = await certificateIssuer(); }
  catch { throw new IssuanceError(503, "Cannot read the configured Amoy issuer. Check blockchain configuration and try again."); }
  const client = await pool.connect();
  let warning;
  try {
    await client.query("BEGIN");
    // Same seminar row locks as attendance import and issuance, taken in ID order so two batches cannot deadlock.
    const found = await client.query(`SELECT "seminarID" FROM seminar WHERE "seminarID" IN (
      SELECT "seminarID" FROM certificate WHERE "certificateNo" = ANY($1::int[])) ORDER BY "seminarID" FOR UPDATE`, [numbers]);
    const load = async () => {
      const { rows } = await client.query(CERTIFICATES + ` FOR UPDATE OF c`, [numbers]);
      for (const row of rows) row.attempt = await latestRevocation(client, row.certificateID);
      return rows;
    };
    let certificates = found.rowCount ? await load() : [];
    if (certificates.length !== numbers.length) throw new IssuanceError(404, "Certificate not found.");
    const finish = async () => {
      await client.query("COMMIT");
      return { ...(warning && { warning }), certificates: certificates.map(certificate => result(certificate, certificate.attempt)) };
    };
    const pending = certificates.find(certificate => certificate.attempt?.transactionStatus === "PENDING" && certificate.status === "ISSUED");
    if (pending) {
      warning = await reconcile(client, pending.attempt.transactionHash, context);
      certificates = await load();
      return await finish();
    }
    const batch = certificates.filter(certificate => certificate.status !== "REVOKED");
    if (!allowNew || !batch.length) return await finish();
    for (const certificate of batch) {
      if (certificate.status !== "ISSUED") throw new IssuanceError(409, `Only issued certificates can be revoked (certificate ${formatCertificateNo(certificate.certificateNo, certificate.seminarDate)}).`);
      if (!certificate.tokenID || !certificate.walletAddress || certificate.mintContract?.toLowerCase() !== context.contractAddress) {
        throw new IssuanceError(409, `Certificate ${formatCertificateNo(certificate.certificateNo, certificate.seminarDate)} was not minted by the configured contract. Contact CICT to reconcile it.`);
      }
    }
    const account = await lockIssuer(client, context, faculty);
    const { confirmed } = await revokedTokenIds(client, context.contractAddress);
    const onchain = await certificateContract().client.readContract({ address: context.contractAddress, abi, functionName: "revocationRoot" });
    if (onchain !== smtRoot(confirmed)) {
      throw new IssuanceError(409, "Amoy's revocation root does not match the revocations saved here. Contact CICT to reconcile it.");
    }
    const tokenIDs = batch.map(certificate => BigInt(certificate.tokenID));
    const signedTransaction = await signIssuerCall(account, context, "revokeBatch", [smtRoot([...confirmed, ...tokenIDs]), tokenIDs], "revocation");
    await client.query(`INSERT INTO blockchain_record ("certificateID", "transactionType", "transactionHash", "signedTransaction",
      "requestedBy", "revocationReason", "tokenID", "contractAddress", "fromAddress", "toAddress", network, "transactionStatus")
      SELECT v.id, 'REVOKE', $4::text, CASE WHEN v.n = 1 THEN $5::text END, $6, $7, v.token, $8, $9, v.wallet, 'polygon-amoy', 'PENDING'
      FROM unnest($1::int[], $2::int[], $3::text[]) WITH ORDINALITY AS v(id, token, wallet, n)`,
      [batch.map(certificate => certificate.certificateID), batch.map(certificate => certificate.tokenID), batch.map(certificate => certificate.walletAddress),
        keccak256(signedTransaction), signedTransaction, faculty.facultyID, reason, context.contractAddress, context.issuerAddress]);
    await client.query("COMMIT");
    // Broadcasting only starts after the hash and signed payload are durable.
  } catch (err) { await client.query("ROLLBACK"); throw err; }
  finally { client.release(); }
  return revokeCertificates(numbers, faculty, null, false);
}

const text = value => typeof value === "string" ? value.trim() : "";
const validText = value => value && value.length <= 255 && !/[\u0000-\u001f\u007f]/.test(value);

function readFacts(body) {
  const facts = { recipientName: text(body?.recipientName), seminarTitle: text(body?.seminarTitle), seminarDate: text(body?.seminarDate) };
  if (!validText(facts.recipientName)) throw new IssuanceError(400, "Enter a recipient name containing 1–255 characters.");
  if (!validText(facts.seminarTitle)) throw new IssuanceError(400, "Enter a seminar title containing 1–255 characters.");
  const date = facts.seminarDate;
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new IssuanceError(400, "Enter a valid seminar date in YYYY-MM-DD format.");
  }
  return facts;
}

// Fixes the name on a certificate that has not been issued. Once a batch transaction is signed the name is
// frozen; after issuance the only correction is revoke and replace.
export async function correctRecipientName(seminarID, certificateID, body) {
  const recipientName = text(body?.recipientName);
  if (!validText(recipientName)) throw new IssuanceError(400, "Enter a recipient name containing 1–255 characters.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Same seminar row lock as issuance, so the name cannot change while a batch is being signed.
    await client.query(`SELECT "seminarID" FROM seminar WHERE "seminarID" = $1 FOR UPDATE`, [seminarID]);
    const { rows } = await client.query(
      `SELECT c.status, EXISTS (SELECT 1 FROM blockchain_record b WHERE b."certificateID" = c."certificateID"
         AND b."transactionStatus" = 'PENDING') AS "inTransaction"
       FROM certificate c WHERE c."certificateID" = $1 AND c."seminarID" = $2 FOR UPDATE OF c`, [certificateID, seminarID]);
    if (!rows.length) throw new IssuanceError(404, "Certificate not found in this seminar.");
    if (!["PENDING", "FAILED"].includes(rows[0].status)) throw new IssuanceError(409, "This certificate is already issued. Revoke it and prepare a replacement to correct the name.");
    if (rows[0].inTransaction) throw new IssuanceError(409, "This certificate is in a pending transaction. Check that transaction first.");
    // Clearing the hash is what the trigger requires before a hashed fact may change; issuance computes it again.
    const updated = await client.query(`UPDATE certificate SET "recipientName" = $2, "certificateHash" = NULL
      WHERE "certificateID" = $1 RETURNING "certificateID", "certificateNo", "recipientName"`, [certificateID, recipientName]);
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (err) { await client.query("ROLLBACK"); throw err; }
  finally { client.release(); }
}

// Creates a new PENDING certificate (new number) for a revoked certificate's registration, with corrected facts
// entered by faculty. It is issued in the seminar's next batch.
export async function prepareReplacement(certificateNo, faculty, body) {
  const facts = readFacts(body);
  let context;
  try { context = await certificateIssuer(); }
  catch { throw new IssuanceError(503, "Cannot read the configured Amoy issuer. Check blockchain configuration and try again."); }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(`SELECT "seminarID" FROM certificate WHERE "certificateNo" = $1`, [certificateNo]);
    if (!found.rowCount) throw new IssuanceError(404, "Certificate not found.");
    // Same seminar row lock as attendance import, preparation and issuance.
    await client.query(`SELECT "seminarID" FROM seminar WHERE "seminarID" = $1 FOR UPDATE`, [found.rows[0].seminarID]);
    const original = (await client.query(CERTIFICATES + ` FOR UPDATE OF c`, [[certificateNo]])).rows[0];
    if (original.status !== "REVOKED") throw new IssuanceError(409, "Only a revoked certificate can be replaced. Revoke it first.");
    const existing = await activeCertificate(client, original);
    if (existing) throw new IssuanceError(409, `A replacement already exists: certificate ${formatCertificateNo(existing.certificateNo, existing.seminarDate)}.`);
    if (!original.attended) throw new IssuanceError(409, "The recipient's attendance is no longer confirmed for this seminar.");
    const issuer = await ensureIssuerWallet(client, context);
    const { rows } = await client.query(
      `INSERT INTO certificate ("studentID", "seminarID", "studentWalletID", "authorizedBy", "issuerWalletID",
                                "recipientName", "seminarTitle", "seminarDate")
       SELECT $1, $2, (SELECT "studentWalletID" FROM student_wallet WHERE "studentID" = $1), $3, $4, $5, $6, $7
       RETURNING "certificateNo", status, "recipientName", "seminarTitle", to_char("seminarDate", 'YYYY-MM-DD') AS "seminarDate"`,
      [original.studentID, original.seminarID, faculty.facultyID, issuer.issuerWalletID, facts.recipientName, facts.seminarTitle, facts.seminarDate],
    );
    await client.query("COMMIT");
    return { ...rows[0], replaces: original.certificateNo };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
  finally { client.release(); }
}

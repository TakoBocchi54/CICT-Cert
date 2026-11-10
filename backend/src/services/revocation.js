import { encodeFunctionData, keccak256, parseEventLogs } from "viem";
import abi from "../contracts/CICTCertificate.abi.json" with { type: "json" };
import { pool } from "../db/pool.js";
import { certificateContract, certificateIssuer } from "./certificates.js";
import { IssuanceError, ensureIssuerWallet, finalizedReceipt, lockIssuer, signIssuerCall } from "./issuance.js";

const MAX_REASON_LENGTH = 500;

// The confirmed mint supplies the token ID; the wallet is the recipient that consented and was minted to.
const CERTIFICATE = `
  SELECT c."certificateID", c."certificateNo", c."seminarID", c."studentID", r.attended, c."recipientName", c."seminarTitle",
         to_char(c."seminarDate", 'YYYY-MM-DD') AS "seminarDate", c."certificateHash", c.status, c."issuedAt", c."revokedAt",
         w."studentWalletAddress" AS "walletAddress", m."tokenID", m."contractAddress" AS "mintContract", m."transactionHash" AS "mintTransactionHash"
  FROM certificate c
  JOIN seminar_registration r ON r."seminarID" = c."seminarID" AND r."studentID" = c."studentID"
  LEFT JOIN student_wallet w ON w."studentWalletID" = c."studentWalletID"
  LEFT JOIN LATERAL (SELECT "tokenID", "contractAddress", "transactionHash" FROM blockchain_record
    WHERE "certificateID" = c."certificateID" AND "transactionType" = 'MINT' AND "transactionStatus" = 'CONFIRMED'
    ORDER BY "transactionID" DESC LIMIT 1) m ON true
  WHERE c."certificateNo" = $1`;

const latestRevocation = (db, certificateID) => db.query(`SELECT * FROM blockchain_record WHERE "certificateID" = $1
  AND "transactionType" = 'REVOKE' ORDER BY "transactionID" DESC LIMIT 1`, [certificateID]).then(r => r.rows[0]);

function result(certificate, attempt) {
  return { certificateNo: certificate.certificateNo, status: certificate.status, revokedAt: certificate.revokedAt ?? null,
    tokenID: certificate.tokenID ?? null, transactionStatus: attempt?.transactionStatus ?? null,
    transactionHash: attempt?.transactionHash ?? null, reason: attempt?.revocationReason ?? null };
}

// The registration's current non-revoked certificate, i.e. the replacement of a revoked one.
const activeCertificate = (db, certificate) => db.query(`SELECT "certificateNo", status FROM certificate
  WHERE "seminarID" = $1 AND "studentID" = $2 AND status <> 'REVOKED'`, [certificate.seminarID, certificate.studentID]).then(r => r.rows[0]);

export async function findCertificate(certificateNo) {
  const certificate = (await pool.query(CERTIFICATE, [certificateNo])).rows[0];
  if (!certificate) return null;
  const { certificateID: _id, studentID: _student, mintContract: _contract, ...details } = certificate;
  return { ...details, revocation: result(certificate, await latestRevocation(pool, certificate.certificateID)),
    replacement: certificate.status === "REVOKED" ? (await activeCertificate(pool, certificate)) ?? null : null };
}

async function reconcile(client, certificate, attempt, context) {
  if (attempt.toAddress?.toLowerCase() !== certificate.walletAddress?.toLowerCase() || attempt.tokenID !== certificate.tokenID) {
    throw new IssuanceError(409, "The saved revocation does not match this certificate. Contact CICT to reconcile it.");
  }
  const tokenID = BigInt(certificate.tokenID);
  const { receipt, sendUncertain } = await finalizedReceipt(attempt, context, encodeFunctionData({ abi, functionName: "revoke", args: [tokenID] }));
  if (sendUncertain) return { ...result(certificate, attempt), warning: "Submission could not be confirmed. Check this same transaction again; no new revocation was created." };
  if (!receipt) return result(certificate, attempt);
  if (receipt.status === "reverted") {
    // The certificate stays ISSUED; a later request may retry with a new attempt.
    await client.query(`UPDATE blockchain_record SET "transactionStatus" = 'FAILED', "blockNum" = $2 WHERE "transactionID" = $1`,
      [attempt.transactionID, receipt.blockNumber.toString()]);
    return { ...result(certificate, attempt), transactionStatus: "FAILED" };
  }
  const events = parseEventLogs({ abi, eventName: "Revoked", logs: receipt.logs.filter(log => log.address.toLowerCase() === context.contractAddress) });
  if (!events.some(event => event.args.tokenId === tokenID && event.args.certHash === certificate.certificateHash &&
      event.args.recipient.toLowerCase() === certificate.walletAddress.toLowerCase())) {
    throw new IssuanceError(409, "The receipt has no matching revocation event. Contact CICT.");
  }
  const [status, onchainToken, , , revokedAt] = await certificateContract().client.readContract({ address: context.contractAddress, abi,
    functionName: "verify", args: [certificate.certificateHash], blockNumber: receipt.blockNumber });
  if (status !== 2 || onchainToken !== tokenID || revokedAt === 0n) throw new IssuanceError(409, "The on-chain certificate does not show this revocation. Contact CICT.");
  const revokedDate = new Date(Number(revokedAt) * 1000);
  await client.query(`UPDATE blockchain_record SET "transactionStatus" = 'CONFIRMED', "blockNum" = $2 WHERE "transactionID" = $1`,
    [attempt.transactionID, receipt.blockNumber.toString()]);
  await client.query(`UPDATE certificate SET status = 'REVOKED', "revokedAt" = $2 WHERE "certificateID" = $1`, [certificate.certificateID, revokedDate]);
  return { ...result(certificate, attempt), status: "REVOKED", revokedAt: revokedDate, transactionStatus: "CONFIRMED" };
}

// allowNew = false only reconciles or rebroadcasts an existing attempt; it never signs a new transaction.
export async function revokeCertificate(certificateNo, faculty, reason, allowNew = true) {
  if (allowNew) {
    reason = typeof reason === "string" ? reason.trim() : "";
    if (!reason || reason.length > MAX_REASON_LENGTH) throw new IssuanceError(400, `Enter a revocation reason of up to ${MAX_REASON_LENGTH} characters.`);
  }
  let context;
  try { context = await certificateIssuer(); }
  catch { throw new IssuanceError(503, "Cannot read the configured Amoy issuer. Check blockchain configuration and try again."); }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(`SELECT "seminarID" FROM certificate WHERE "certificateNo" = $1`, [certificateNo]);
    if (!found.rowCount) throw new IssuanceError(404, "Certificate not found.");
    // Same seminar row lock as attendance import and issuance.
    await client.query(`SELECT "seminarID" FROM seminar WHERE "seminarID" = $1 FOR UPDATE`, [found.rows[0].seminarID]);
    const certificate = (await client.query(CERTIFICATE + ` FOR UPDATE OF c`, [certificateNo])).rows[0];
    let attempt = await latestRevocation(client, certificate.certificateID);
    if (certificate.status === "REVOKED") { await client.query("COMMIT"); return result(certificate, attempt); }
    if (certificate.status !== "ISSUED") throw new IssuanceError(409, "Only issued certificates can be revoked.");
    if (!certificate.tokenID || !certificate.walletAddress || certificate.mintContract?.toLowerCase() !== context.contractAddress) {
      throw new IssuanceError(409, "This certificate was not minted by the configured contract. Contact CICT to reconcile it.");
    }
    if (attempt?.transactionStatus === "PENDING") {
      const checked = await reconcile(client, certificate, attempt, context);
      await client.query("COMMIT"); return checked;
    }
    if (!allowNew) { await client.query("COMMIT"); return result(certificate, attempt); }
    const account = await lockIssuer(client, context, faculty);
    const tokenID = BigInt(certificate.tokenID);
    const onchain = await certificateContract().client.readContract({ address: context.contractAddress, abi, functionName: "verify", args: [certificate.certificateHash] });
    if (onchain[0] !== 1 || onchain[1] !== tokenID) {
      throw new IssuanceError(409, "Amoy does not show this certificate as valid under its token without a matching local attempt. Contact CICT to reconcile it.");
    }
    const signedTransaction = await signIssuerCall(account, context, "revoke", [tokenID], "revocation");
    await client.query(`INSERT INTO blockchain_record ("certificateID", "transactionType", "transactionHash", "signedTransaction",
      "requestedBy", "revocationReason", "tokenID", "contractAddress", "fromAddress", "toAddress", network, "transactionStatus")
      VALUES ($1, 'REVOKE', $2, $3, $4, $5, $6, $7, $8, $9, 'polygon-amoy', 'PENDING') RETURNING *`,
      [certificate.certificateID, keccak256(signedTransaction), signedTransaction, faculty.facultyID, reason, certificate.tokenID,
        context.contractAddress, context.issuerAddress, certificate.walletAddress]);
    await client.query("COMMIT");
    // Broadcasting only starts after the hash and signed payload are durable.
  } catch (err) { await client.query("ROLLBACK"); throw err; }
  finally { client.release(); }
  return revokeCertificate(certificateNo, faculty, null, false);
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

// Creates a new PENDING certificate (new number) for a revoked certificate's registration, with corrected facts
// entered by faculty. The student must approve it again; it is then issued through the normal issuance flow.
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
    const original = (await client.query(CERTIFICATE + ` FOR UPDATE OF c`, [certificateNo])).rows[0];
    if (original.status !== "REVOKED") throw new IssuanceError(409, "Only a revoked certificate can be replaced. Revoke it first.");
    const existing = await activeCertificate(client, original);
    if (existing) throw new IssuanceError(409, `A replacement already exists: certificate No. ${existing.certificateNo}.`);
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

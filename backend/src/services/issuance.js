import { createWalletClient, encodeFunctionData, http, keccak256, parseEventLogs, parseTransaction,
  recoverTransactionAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygonAmoy } from "viem/chains";
import abi from "../contracts/CICTCertificate.abi.json" with { type: "json" };
import { pool } from "../db/pool.js";
import { certificateContract, certificateIssuer } from "./certificates.js";
import { certificateHash } from "../utils/certificateConsent.js";
import { merkleRoot } from "../utils/merkle.js";
import { HttpError } from "../utils/http.js";

// Records the contract's issuer in issuer_wallet (if new) and returns its row for new certificates.
export async function ensureIssuerWallet(client, context) {
  const { rows } = await client.query(
    `INSERT INTO issuer_wallet ("issuerWalletAddress", label, network) VALUES ($1, 'CICT', 'polygon-amoy')
     ON CONFLICT (lower("issuerWalletAddress")) DO UPDATE SET "issuerWalletAddress" = issuer_wallet."issuerWalletAddress"
     RETURNING "issuerWalletID", "isActive", network`, [context.issuerAddress],
  );
  if (!rows[0].isActive || rows[0].network !== "polygon-amoy") {
    throw new HttpError(409, "The configured issuer wallet is inactive or belongs to a different network.");
  }
  return rows[0];
}

// Shared by mint and revoke attempts. Returns { receipt, block } only once the receipt is finalized on the
// canonical chain; otherwise rebroadcasts the saved payload and returns {} or { sendUncertain: true }.
export async function finalizedReceipt(attempt, context, expectedData) {
  const rpc = certificateContract().client;
  if (attempt.contractAddress?.toLowerCase() !== context.contractAddress || attempt.fromAddress?.toLowerCase() !== context.issuerAddress ||
      !attempt.transactionHash) {
    throw new HttpError(409, "The saved transaction does not match this certificate. Contact CICT to reconcile it.");
  }
  let receipt;
  try { receipt = await rpc.getTransactionReceipt({ hash: attempt.transactionHash }); }
  catch (err) { if (err.name !== "TransactionReceiptNotFoundError") throw err; }
  if (!receipt) {
    if (!attempt.signedTransaction) throw new HttpError(409, "This pending transaction has no saved signed payload. Contact CICT; do not send another transaction.");
    const signed = parseTransaction(attempt.signedTransaction);
    if (keccak256(attempt.signedTransaction) !== attempt.transactionHash || signed.chainId !== polygonAmoy.id ||
        signed.to?.toLowerCase() !== context.contractAddress || (signed.value ?? 0n) !== 0n || signed.data !== expectedData ||
        (await recoverTransactionAddress({ serializedTransaction: attempt.signedTransaction })).toLowerCase() !== context.issuerAddress) {
      throw new HttpError(409, "The saved signed transaction is invalid. Contact CICT.");
    }
    // A send error can mean the RPC accepted the transaction before the connection failed.
    try { await rpc.sendRawTransaction({ serializedTransaction: attempt.signedTransaction }); }
    catch { return { sendUncertain: true }; }
    return {};
  }
  if (!["success", "reverted"].includes(receipt.status) || receipt.transactionHash !== attempt.transactionHash ||
      receipt.from?.toLowerCase() !== context.issuerAddress || receipt.to?.toLowerCase() !== context.contractAddress) {
    throw new HttpError(409, "The receipt does not match the saved issuer transaction. Contact CICT.");
  }
  const finalized = await rpc.getBlock({ blockTag: "finalized" });
  if (finalized.number === null || finalized.number <= receipt.blockNumber) return {};
  const block = await rpc.getBlock({ blockNumber: receipt.blockNumber });
  if (block.hash !== receipt.blockHash) return {};
  return { receipt, block };
}

// Must run inside the caller's transaction. Serializes issuer nonce allocation across requests,
// seminars, mint/revoke and backend processes, then returns the issuer signing account.
export async function lockIssuer(client, context, faculty) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`amoy:${context.issuerAddress}`]);
  const outstanding = await client.query(`SELECT "transactionID" FROM blockchain_record WHERE lower("fromAddress") = $1
    AND network = 'polygon-amoy' AND "transactionStatus" = 'PENDING' LIMIT 1`, [context.issuerAddress]);
  if (outstanding.rowCount) throw new HttpError(409, "Another issuer transaction is pending. Check its status before sending another.");
  const permission = await client.query(`SELECT "canIssue" FROM cict_faculty WHERE "facultyID" = $1 AND "userID" = $2 FOR SHARE`,
    [faculty.facultyID, faculty.userID]);
  if (!permission.rows[0]?.canIssue) throw new HttpError(403, "You are not authorized to issue certificates.");
  try {
    const privateKey = process.env.ISSUER_PRIVATE_KEY?.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey || "")) throw new Error("Missing key");
    const account = privateKeyToAccount(privateKey);
    if (account.address.toLowerCase() !== context.issuerAddress) throw new Error("Wrong issuer");
    return account;
  } catch { throw new HttpError(503, "Configure ISSUER_PRIVATE_KEY in the backend for the contract's issuer wallet."); }
}

export async function signIssuerCall(account, context, functionName, args, label) {
  const { client: rpc } = certificateContract();
  const wallet = createWalletClient({ account, chain: polygonAmoy, transport: http(process.env.AMOY_RPC_URL.trim(), { timeout: 10_000, retryCount: 0 }) });
  try {
    await rpc.simulateContract({ address: context.contractAddress, abi, functionName, args, account });
    const request = await wallet.prepareTransactionRequest({ to: context.contractAddress, data: encodeFunctionData({ abi, functionName, args }) });
    const balance = await rpc.getBalance({ address: account.address });
    if (balance < request.gas * (request.maxFeePerGas ?? request.gasPrice)) throw new Error("Insufficient balance");
    return await wallet.signTransaction(request);
  } catch { throw new HttpError(503, `Could not prepare the ${label}. Check the issuer's Amoy POL balance and RPC connection.`); }
}

// Certificates minted per issuing transaction. Measured at about 75k gas each (smart_contract/test/GasBenchmark.ts):
// 100 is about 7.5M gas, under half of the 16.7M per-transaction gas cap; 200 is the most that fits under it.
function batchSize() {
  const size = Number(process.env.ISSUE_BATCH_SIZE);
  return Number.isInteger(size) && size >= 1 && size <= 200 ? size : 100;
}

// The seminar's certificates that are not issued and not in a pending batch, in certificate-number order,
// each with the reason it cannot be issued yet (null when it can).
async function candidates(client, seminarID, context) {
  const { rows } = await client.query(
    `SELECT c."certificateID", c."certificateNo", c."recipientName", c."seminarTitle", to_char(c."seminarDate", 'YYYY-MM-DD') AS "seminarDate",
            r.attended, w."studentWalletAddress" AS "walletAddress", i."issuerWalletAddress" AS "issuerAddress", i."isActive", i.network
     FROM certificate c JOIN seminar_registration r USING ("seminarID", "studentID")
     JOIN issuer_wallet i USING ("issuerWalletID") LEFT JOIN student_wallet w ON w."studentID" = c."studentID"
     WHERE c."seminarID" = $1 AND c.status IN ('PENDING', 'FAILED') AND NOT EXISTS (
       SELECT 1 FROM blockchain_record b WHERE b."certificateID" = c."certificateID" AND b."transactionStatus" = 'PENDING')
     ORDER BY c."certificateNo" FOR UPDATE OF c`, [seminarID]);
  for (const row of rows) {
    row.reason = !row.attended ? "Attendance is not confirmed."
      : !row.walletAddress ? "No wallet linked yet."
      : !row.isActive || row.network !== "polygon-amoy" || row.issuerAddress.toLowerCase() !== context.issuerAddress
        ? "Prepared for a different issuer wallet. Contact CICT."
      : null;
  }
  return rows;
}

function summary(rows, batch) {
  return { transactionStatus: null, transactionHash: null, issued: 0, ...batch, remaining: rows.filter(row => !row.reason).length,
    skipped: rows.filter(row => row.reason).map(({ certificateNo, seminarDate, recipientName, reason }) => ({ certificateNo, seminarDate, recipientName, reason })) };
}

// One batch = every MINT row sharing the transaction hash. Batch position (and so token order) is certificate-number order.
async function reconcile(client, seminarID, transactionHash, context) {
  const { rows } = await client.query(
    `SELECT b."transactionHash", b."signedTransaction", b."contractAddress", b."fromAddress", b."toAddress",
            c."certificateID", c."certificateNo", c."recipientName", c."seminarTitle", to_char(c."seminarDate", 'YYYY-MM-DD') AS "seminarDate",
            c."certificateHash", w."studentWalletAddress" AS "walletAddress"
     FROM blockchain_record b JOIN certificate c USING ("certificateID") JOIN student_wallet w ON w."studentWalletID" = c."studentWalletID"
     WHERE b."transactionHash" = $1 AND b."transactionType" = 'MINT' AND c."seminarID" = $2
     ORDER BY c."certificateNo" FOR UPDATE OF c`, [transactionHash, seminarID]);
  if (rows.some(row => row.toAddress?.toLowerCase() !== row.walletAddress.toLowerCase() || certificateHash(row, context) !== row.certificateHash)) {
    throw new HttpError(409, "The saved transaction does not match its certificates. Contact CICT to reconcile it.");
  }
  const ids = rows.map(row => row.certificateID), hashes = rows.map(row => row.certificateHash), root = merkleRoot(hashes);
  // The signed payload is saved on one row of the batch only.
  const { receipt, block, sendUncertain } = await finalizedReceipt(rows.find(row => row.signedTransaction) ?? rows[0], context,
    encodeFunctionData({ abi, functionName: "issueBatch", args: [BigInt(seminarID), root, rows.map(row => row.walletAddress), hashes] }));
  const pending = { transactionStatus: "PENDING", transactionHash };
  if (sendUncertain) return { ...pending, warning: "Submission could not be confirmed. Check this same transaction again; no new mint was created." };
  if (!receipt) return pending;
  if (receipt.status === "reverted") {
    await client.query(`UPDATE blockchain_record SET "transactionStatus" = 'FAILED', "blockNum" = $2
      WHERE "transactionHash" = $1 AND "transactionType" = 'MINT'`, [transactionHash, receipt.blockNumber.toString()]);
    await client.query(`UPDATE certificate SET status = 'FAILED' WHERE "certificateID" = ANY($1)`, [ids]);
    return { ...pending, transactionStatus: "FAILED" };
  }
  const logs = receipt.logs.filter(log => log.address.toLowerCase() === context.contractAddress);
  const [batch] = parseEventLogs({ abi, eventName: "BatchIssued", logs });
  const minted = new Map(parseEventLogs({ abi, eventName: "Issued", logs }).map(event => [event.args.tokenId, event.args.to.toLowerCase()]));
  const first = batch?.args.firstTokenId;
  // Token ID = first token + batch position; each must have been minted to that certificate's wallet.
  if (!batch || batch.args.seminarId !== BigInt(seminarID) || batch.args.root !== root || first < 1n ||
      first + BigInt(rows.length) > 2147483647n || batch.args.certHashes.length !== rows.length ||
      rows.some((row, i) => batch.args.certHashes[i] !== row.certificateHash || minted.get(first + BigInt(i)) !== row.walletAddress.toLowerCase())) {
    throw new HttpError(409, "The receipt has no matching batch issuance event. Contact CICT.");
  }
  await client.query(`UPDATE blockchain_record b SET "transactionStatus" = 'CONFIRMED', "blockNum" = $2, "tokenID" = v.token
    FROM unnest($3::int[], $4::int[]) AS v(id, token)
    WHERE b."transactionHash" = $1 AND b."transactionType" = 'MINT' AND b."certificateID" = v.id`,
    [transactionHash, receipt.blockNumber.toString(), ids, rows.map((_, i) => (first + BigInt(i)).toString())]);
  await client.query(`UPDATE certificate SET status = 'ISSUED', "issuedAt" = $2 WHERE "certificateID" = ANY($1)`,
    [ids, new Date(Number(block.timestamp) * 1000)]);
  return { transactionStatus: "CONFIRMED", transactionHash, issued: rows.length, batchId: batch.args.batchId.toString() };
}

// Issues the seminar's next batch of eligible certificates in one transaction: a Merkle root plus one token each.
// allowNew = false only reconciles or rebroadcasts the seminar's pending batch; it never signs a new transaction.
export async function issueSeminarBatch(seminarID, faculty, allowNew = true) {
  let context;
  try { context = await certificateIssuer(); }
  catch { throw new HttpError(503, "Cannot read the configured Amoy issuer. Check blockchain configuration and try again."); }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const seminar = await client.query(`SELECT "seminarID" FROM seminar WHERE "seminarID" = $1 FOR UPDATE`, [seminarID]);
    if (!seminar.rowCount) throw new HttpError(404, "Seminar not found.");
    const pending = (await client.query(`SELECT b."transactionHash" FROM blockchain_record b JOIN certificate c USING ("certificateID")
      WHERE c."seminarID" = $1 AND b."transactionType" = 'MINT' AND b."transactionStatus" = 'PENDING' LIMIT 1`, [seminarID])).rows[0];
    if (pending || !allowNew) {
      const batch = pending ? await reconcile(client, seminarID, pending.transactionHash, context) : {};
      const result = summary(await candidates(client, seminarID, context), batch);
      await client.query("COMMIT"); return result;
    }
    const batch = (await candidates(client, seminarID, context)).filter(row => !row.reason).slice(0, batchSize());
    if (!batch.length) throw new HttpError(409, "No certificate is ready to issue. Each one needs confirmed attendance and a linked wallet.");
    const account = await lockIssuer(client, context, faculty);
    const ids = batch.map(row => row.certificateID), wallets = batch.map(row => row.walletAddress);
    const hashes = batch.map(row => certificateHash(row, context));
    const signedTransaction = await signIssuerCall(account, context, "issueBatch", [BigInt(seminarID), merkleRoot(hashes), wallets, hashes], "mint");
    // A hash left by a failed attempt is cleared before it is replaced: the trigger freezes hashed facts while one is set.
    await client.query(`UPDATE certificate c SET "certificateHash" = NULL FROM unnest($1::int[], $2::text[]) AS v(id, hash)
      WHERE c."certificateID" = v.id AND c."certificateHash" IS NOT NULL AND c."certificateHash" <> v.hash`, [ids, hashes]);
    await client.query(`UPDATE certificate c SET "studentWalletID" = w."studentWalletID", "certificateHash" = v.hash, "authorizedBy" = $3, status = 'PENDING'
      FROM unnest($1::int[], $2::text[]) AS v(id, hash), student_wallet w
      WHERE c."certificateID" = v.id AND w."studentID" = c."studentID"`, [ids, hashes, faculty.facultyID]);
    await client.query(`INSERT INTO blockchain_record ("certificateID", "transactionType", "transactionHash", "signedTransaction",
      "requestedBy", "contractAddress", "fromAddress", "toAddress", network, "transactionStatus")
      SELECT v.id, 'MINT', $3::text, CASE WHEN v.n = 1 THEN $4::text END, $5, $6, $7, v.wallet, 'polygon-amoy', 'PENDING'
      FROM unnest($1::int[], $2::text[]) WITH ORDINALITY AS v(id, wallet, n)`,
      [ids, wallets, keccak256(signedTransaction), signedTransaction, faculty.facultyID, context.contractAddress, context.issuerAddress]);
    await client.query("COMMIT");
    // Broadcasting only starts after the hash and signed payload are durable.
  } catch (err) { await client.query("ROLLBACK"); throw err; }
  finally { client.release(); }
  return issueSeminarBatch(seminarID, faculty, false);
}


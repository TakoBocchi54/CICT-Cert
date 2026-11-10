import { createWalletClient, encodeFunctionData, http, keccak256, parseEventLogs, parseTransaction,
  recoverTransactionAddress, verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygonAmoy } from "viem/chains";
import abi from "../contracts/CICTCertificate.abi.json" with { type: "json" };
import { pool } from "../db/pool.js";
import { certificateContract, certificateIssuer } from "./certificates.js";
import { certificateHash, certificateConsentMessage } from "../utils/certificateConsent.js";

export class IssuanceError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function result(certificate, attempt) {
  return { certificateID: certificate.certificateID, status: certificate.status,
    transactionStatus: attempt?.transactionStatus ?? null, transactionHash: attempt?.transactionHash ?? null,
    tokenID: attempt?.tokenID ?? null };
}

async function validateApproval(certificate, context) {
  if (!certificate.attended || !certificate.walletAddress || certificate.studentWalletID !== certificate.linkedWalletID ||
      !certificate.isActive || certificate.network !== "polygon-amoy" || certificate.issuerAddress.toLowerCase() !== context.issuerAddress ||
      !certificate.consentedAt || !certificate.consentMessage || !certificate.consentSignature ||
      certificateHash(certificate, context) !== certificate.certificateHash) {
    throw new IssuanceError(409, "Attendance, wallet, issuer and student approval must match the prepared certificate.");
  }
  const nonce = certificate.consentMessage.match(/\nRequest nonce: ([0-9a-f]{32})\nRequested at: ([^\n]+)$/);
  if (!nonce || certificateConsentMessage(certificate, context, certificate.certificateHash, nonce[1], nonce[2]) !== certificate.consentMessage ||
      !await verifyMessage({ address: certificate.walletAddress, message: certificate.consentMessage, signature: certificate.consentSignature }).catch(() => false)) {
    throw new IssuanceError(409, "The saved student approval is invalid. A valid certificate-specific approval is required.");
  }
}

// Records the contract's issuer in issuer_wallet (if new) and returns its row for new certificates.
export async function ensureIssuerWallet(client, context) {
  const { rows } = await client.query(
    `INSERT INTO issuer_wallet ("issuerWalletAddress", label, network) VALUES ($1, 'CICT', 'polygon-amoy')
     ON CONFLICT (lower("issuerWalletAddress")) DO UPDATE SET "issuerWalletAddress" = issuer_wallet."issuerWalletAddress"
     RETURNING "issuerWalletID", "isActive", network`, [context.issuerAddress],
  );
  if (!rows[0].isActive || rows[0].network !== "polygon-amoy") {
    throw new IssuanceError(409, "The configured issuer wallet is inactive or belongs to a different network.");
  }
  return rows[0];
}

// Shared by mint and revoke attempts. Returns { receipt } only once the receipt is finalized on the
// canonical chain; otherwise rebroadcasts the saved payload and returns {} or { sendUncertain: true }.
export async function finalizedReceipt(attempt, context, expectedData) {
  const rpc = certificateContract().client;
  if (attempt.contractAddress?.toLowerCase() !== context.contractAddress || attempt.fromAddress?.toLowerCase() !== context.issuerAddress ||
      !attempt.transactionHash) {
    throw new IssuanceError(409, "The saved transaction does not match this certificate. Contact CICT to reconcile it.");
  }
  let receipt;
  try { receipt = await rpc.getTransactionReceipt({ hash: attempt.transactionHash }); }
  catch (err) { if (err.name !== "TransactionReceiptNotFoundError") throw err; }
  if (!receipt) {
    if (!attempt.signedTransaction) throw new IssuanceError(409, "This pending transaction has no saved signed payload. Contact CICT; do not send another transaction.");
    const signed = parseTransaction(attempt.signedTransaction);
    if (keccak256(attempt.signedTransaction) !== attempt.transactionHash || signed.chainId !== polygonAmoy.id ||
        signed.to?.toLowerCase() !== context.contractAddress || (signed.value ?? 0n) !== 0n || signed.data !== expectedData ||
        (await recoverTransactionAddress({ serializedTransaction: attempt.signedTransaction })).toLowerCase() !== context.issuerAddress) {
      throw new IssuanceError(409, "The saved signed transaction is invalid. Contact CICT.");
    }
    // A send error can mean the RPC accepted the transaction before the connection failed.
    try { await rpc.sendRawTransaction({ serializedTransaction: attempt.signedTransaction }); }
    catch { return { sendUncertain: true }; }
    return {};
  }
  if (!["success", "reverted"].includes(receipt.status) || receipt.transactionHash !== attempt.transactionHash ||
      receipt.from?.toLowerCase() !== context.issuerAddress || receipt.to?.toLowerCase() !== context.contractAddress) {
    throw new IssuanceError(409, "The receipt does not match the saved issuer transaction. Contact CICT.");
  }
  const finalized = await rpc.getBlock({ blockTag: "finalized" });
  if (finalized.number === null || finalized.number <= receipt.blockNumber) return {};
  const block = await rpc.getBlock({ blockNumber: receipt.blockNumber });
  if (block.hash !== receipt.blockHash) return {};
  return { receipt };
}

// Must run inside the caller's transaction. Serializes issuer nonce allocation across requests,
// seminars, mint/revoke and backend processes, then returns the issuer signing account.
export async function lockIssuer(client, context, faculty) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`amoy:${context.issuerAddress}`]);
  const outstanding = await client.query(`SELECT "transactionID" FROM blockchain_record WHERE lower("fromAddress") = $1
    AND network = 'polygon-amoy' AND "transactionStatus" = 'PENDING' LIMIT 1`, [context.issuerAddress]);
  if (outstanding.rowCount) throw new IssuanceError(409, "Another issuer transaction is pending. Check its status before sending another.");
  const permission = await client.query(`SELECT "canIssue" FROM cict_faculty WHERE "facultyID" = $1 AND "userID" = $2 FOR SHARE`,
    [faculty.facultyID, faculty.userID]);
  if (!permission.rows[0]?.canIssue) throw new IssuanceError(403, "You are not authorized to issue certificates.");
  try {
    const privateKey = process.env.ISSUER_PRIVATE_KEY?.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey || "")) throw new Error("Missing key");
    const account = privateKeyToAccount(privateKey);
    if (account.address.toLowerCase() !== context.issuerAddress) throw new Error("Wrong issuer");
    return account;
  } catch { throw new IssuanceError(503, "Configure ISSUER_PRIVATE_KEY in the backend for the contract's issuer wallet."); }
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
  } catch { throw new IssuanceError(503, `Could not prepare the ${label}. Check the issuer's Amoy POL balance and RPC connection.`); }
}

async function reconcile(client, certificate, attempt, context) {
  if (attempt.toAddress?.toLowerCase() !== certificate.walletAddress.toLowerCase()) {
    throw new IssuanceError(409, "The saved transaction does not match this certificate. Contact CICT to reconcile it.");
  }
  const rpc = certificateContract().client;
  const { receipt, sendUncertain } = await finalizedReceipt(attempt, context,
    encodeFunctionData({ abi, functionName: "issue", args: [certificate.walletAddress, certificate.certificateHash] }));
  if (sendUncertain) return { ...result(certificate, attempt), warning: "Submission could not be confirmed. Check this same transaction again; no new mint was created." };
  if (!receipt) return result(certificate, attempt);
  if (receipt.status === "reverted") {
    await client.query(`UPDATE blockchain_record SET "transactionStatus" = 'FAILED', "blockNum" = $2 WHERE "transactionID" = $1`,
      [attempt.transactionID, receipt.blockNumber.toString()]);
    await client.query(`UPDATE certificate SET status = 'FAILED' WHERE "certificateID" = $1`, [certificate.certificateID]);
    return { ...result(certificate, attempt), status: "FAILED", transactionStatus: "FAILED" };
  }
  const events = parseEventLogs({ abi, eventName: "Issued", logs: receipt.logs.filter(log => log.address.toLowerCase() === context.contractAddress) });
  const issued = events.find(event => event.args.from.toLowerCase() === context.issuerAddress &&
    event.args.to.toLowerCase() === certificate.walletAddress.toLowerCase() && event.args.burnAuth === 0);
  if (!issued || issued.args.tokenId < 1n || issued.args.tokenId > 9223372036854775807n) throw new IssuanceError(409, "The receipt has no matching certificate issuance event. Contact CICT.");
  const [status, tokenID, recipient, issuedAt] = await rpc.readContract({ address: context.contractAddress, abi,
    functionName: "verify", args: [certificate.certificateHash], blockNumber: receipt.blockNumber });
  if (status !== 1 || tokenID !== issued.args.tokenId || recipient.toLowerCase() !== certificate.walletAddress.toLowerCase()) {
    throw new IssuanceError(409, "The on-chain certificate does not match the mint receipt. Contact CICT.");
  }
  await client.query(`UPDATE blockchain_record SET "transactionStatus" = 'CONFIRMED', "blockNum" = $2, "tokenID" = $3
    WHERE "transactionID" = $1`, [attempt.transactionID, receipt.blockNumber.toString(), tokenID.toString()]);
  await client.query(`UPDATE certificate SET status = 'ISSUED', "issuedAt" = $2 WHERE "certificateID" = $1`,
    [certificate.certificateID, new Date(Number(issuedAt) * 1000)]);
  return { ...result(certificate, attempt), status: "ISSUED", transactionStatus: "CONFIRMED", tokenID: tokenID.toString() };
}

export async function issueCertificate(seminarID, certificateID, faculty, allowNew = true) {
  let context;
  try { context = await certificateIssuer(); }
  catch { throw new IssuanceError(503, "Cannot read the configured Amoy issuer. Check blockchain configuration and try again."); }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const seminar = await client.query(`SELECT "seminarID" FROM seminar WHERE "seminarID" = $1 FOR UPDATE`, [seminarID]);
    if (!seminar.rowCount) throw new IssuanceError(404, "Seminar not found.");
    const { rows } = await client.query(
      `SELECT c.*, to_char(c."seminarDate", 'YYYY-MM-DD') AS "seminarDate", r.attended,
              w."studentWalletID" AS "linkedWalletID", w."studentWalletAddress" AS "walletAddress",
              i."issuerWalletAddress" AS "issuerAddress", i."isActive", i.network
       FROM certificate c JOIN seminar_registration r USING ("seminarID", "studentID")
       JOIN issuer_wallet i USING ("issuerWalletID") LEFT JOIN student_wallet w ON w."studentID" = c."studentID"
       WHERE c."certificateID" = $1 AND c."seminarID" = $2 FOR UPDATE OF c`, [certificateID, seminarID],
    );
    const certificate = rows[0];
    if (!certificate) throw new IssuanceError(404, "Certificate not found in this seminar.");
    let attempt = (await client.query(`SELECT * FROM blockchain_record WHERE "certificateID" = $1 AND "transactionType" = 'MINT'
      ORDER BY "transactionID" DESC LIMIT 1`, [certificateID])).rows[0];
    if (["ISSUED", "REVOKED"].includes(certificate.status)) {
      await client.query("COMMIT"); return result(certificate, attempt);
    }
    await validateApproval(certificate, context);
    if (attempt && ["PENDING", "CONFIRMED"].includes(attempt.transactionStatus)) {
      const checked = await reconcile(client, certificate, attempt, context);
      await client.query("COMMIT"); return checked;
    }
    if (!allowNew) { await client.query("COMMIT"); return result(certificate, attempt); }
    const account = await lockIssuer(client, context, faculty);
    const { client: rpc } = certificateContract();
    const onchain = await rpc.readContract({ address: context.contractAddress, abi, functionName: "verify", args: [certificate.certificateHash] });
    if (onchain[0] !== 0) throw new IssuanceError(409, "This hash already exists on Amoy without a matching local attempt. Contact CICT to reconcile it.");
    const signedTransaction = await signIssuerCall(account, context, "issue", [certificate.walletAddress, certificate.certificateHash], "mint");
    attempt = (await client.query(`INSERT INTO blockchain_record ("certificateID", "transactionType", "transactionHash", "signedTransaction",
      "requestedBy", "contractAddress", "fromAddress", "toAddress", network, "transactionStatus")
      VALUES ($1, 'MINT', $2, $3, $4, $5, $6, $7, 'polygon-amoy', 'PENDING') RETURNING *`,
      [certificateID, keccak256(signedTransaction), signedTransaction, faculty.facultyID, context.contractAddress, context.issuerAddress, certificate.walletAddress])).rows[0];
    await client.query(`UPDATE certificate SET "authorizedBy" = $2, status = 'PENDING' WHERE "certificateID" = $1`, [certificateID, faculty.facultyID]);
    await client.query("COMMIT");
    // Broadcasting only starts after the hash and signed payload are durable.
  } catch (err) { await client.query("ROLLBACK"); throw err; }
  finally { client.release(); }
  return issueCertificate(seminarID, certificateID, faculty, false);
}

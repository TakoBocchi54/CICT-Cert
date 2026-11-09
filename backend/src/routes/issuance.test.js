import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import pg from "pg";
import { SignJWT } from "jose";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, keccak256, parseTransaction } from "viem";
import abi from "../contracts/CICTCertificate.abi.json" with { type: "json" };
import { certificateHash, certificateConsentMessage } from "../utils/certificateConsent.js";

const local = process.env.DATABASE_URL && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname);
process.env.SESSION_SECRET = "issuance-route-test-secret-only";
const { default: router } = await import("./seminars.js");
const { default: studentRouter } = await import("./certificateApprovals.js");
const { pool } = await import("../db/pool.js");

test("faculty issuance with PostgreSQL and a local Amoy RPC fixture", { skip: !local && "Requires local PostgreSQL; never runs against production" }, async t => {
  const schema = "cict_issuance_test_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL }); await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: "-c search_path=" + schema });
  const originalQuery = pool.query, originalConnect = pool.connect;
  pool.query = db.query.bind(db); pool.connect = db.connect.bind(db);
  const previousEnv = { rpc: process.env.AMOY_RPC_URL, contract: process.env.CONTRACT_ADDRESS, key: process.env.ISSUER_PRIVATE_KEY };
  const issuerKey = generatePrivateKey(), issuer = privateKeyToAccount(issuerKey), student = privateKeyToAccount(generatePrivateKey());
  const context = { chainId: 80002, contractAddress: "0x2222222222222222222222222222222222222222", issuerAddress: issuer.address.toLowerCase() };
  let server, rpc, chainId = "0x13882", balance = "0xde0b6b3a7640000", sendFails = false, sendCount = 0, nonce = 0;
  let finalized = 12n, blockMatches = true, persistedBeforeSend = true;
  const rawTransactions = new Map(), receipts = new Map(), records = new Map();
  const blockHash = "0x" + "a".repeat(64);
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (rpc) await new Promise(resolve => rpc.close(resolve));
    pool.query = originalQuery; pool.connect = originalConnect;
    for (const [key, value] of [["AMOY_RPC_URL", previousEnv.rpc], ["CONTRACT_ADDRESS", previousEnv.contract], ["ISSUER_PRIVATE_KEY", previousEnv.key]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await db.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); await pool.end();
  });
  await db.query(await readFile(new URL("../../sql/schema.sql", import.meta.url), "utf8"));
  await db.query(`INSERT INTO users (email,role,"passwordHash") VALUES ('faculty@example.test','FACULTY','test'),('assistant@example.test','FACULTY','test'),('student@example.test','STUDENT',NULL);
    INSERT INTO cict_faculty ("userID","firstName","lastName","canIssue") VALUES (1,'A','B',true),(2,'C','D',false);
    INSERT INTO student ("userID","fullName",program) VALUES (3,'Juan Dela Cruz','BSCS');`);
  await db.query(`INSERT INTO student_wallet ("studentID","studentWalletAddress") VALUES (1,$1);
    `, [student.address]);
  await db.query(`INSERT INTO issuer_wallet ("issuerWalletAddress",label,network) VALUES ($1,'CICT','polygon-amoy')`, [issuer.address]);
  rpc = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const call = JSON.parse(body); let value, error;
    try {
      switch (call.method) {
        case "eth_chainId": value = chainId; break;
        case "eth_getBalance": value = balance; break;
        case "eth_getTransactionCount": value = "0x" + nonce.toString(16); break;
        case "eth_estimateGas": value = "0x249f0"; break;
        case "eth_maxPriorityFeePerGas": value = "0x3b9aca00"; break;
        case "eth_getBlockByNumber": value = { number: "0x" + (call.params[0] === "finalized" ? finalized : 10n).toString(16),
          hash: blockMatches ? blockHash : "0x" + "b".repeat(64), timestamp: "0x" + Math.ceil(Date.now() / 1000).toString(16),
          baseFeePerGas: "0x3b9aca00", transactions: [], gasLimit: "0x1c9c380", gasUsed: "0x249f0" }; break;
        case "eth_call": {
          const decoded = decodeFunctionData({ abi, data: call.params[0].data });
          value = encodeFunctionResult({ abi, functionName: decoded.functionName, result: decoded.functionName === "issuer" ? issuer.address :
            decoded.functionName === "verify" ? records.get(decoded.args[0]) || [0, 0n, "0x" + "0".repeat(40), 0n, 0n] : 1n }); break;
        }
        case "eth_getTransactionReceipt": value = receipts.get(call.params[0]) || null; break;
        case "eth_sendRawTransaction": {
          sendCount++; const raw = call.params[0], hash = keccak256(raw);
          const saved = (await db.query(`SELECT "signedTransaction" FROM blockchain_record WHERE "transactionHash" = $1`, [hash])).rows[0];
          persistedBeforeSend &&= saved?.signedTransaction === raw;
          rawTransactions.set(hash, raw);
          if (sendFails) throw new Error("Connection lost after acceptance");
          value = hash; break;
        }
        default: error = { code: -32601, message: "Method not found" };
      }
    } catch { error = { code: -32000, message: "Test RPC error" }; }
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, ...(error ? { error } : { result: value }) }));
  }).listen(0, "127.0.0.1"); await new Promise(resolve => rpc.once("listening", resolve));
  process.env.AMOY_RPC_URL = "http://127.0.0.1:" + rpc.address().port; process.env.CONTRACT_ADDRESS = context.contractAddress;
  process.env.ISSUER_PRIVATE_KEY = issuerKey;
  const app = express(); app.use(express.json(), cookieParser()); app.use("/api", router, studentRouter);
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/api";
  const key = new TextEncoder().encode(process.env.SESSION_SECRET);
  async function cookie(role = "FACULTY", userID = "1", id = "1") {
    return "cict_session=" + await new SignJWT({ role, userID, [role === "FACULTY" ? "facultyID" : "studentID"]: id })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m").sign(key);
  }
  const faculty = await cookie(), assistant = await cookie("FACULTY", "2", "2"), studentCookie = await cookie("STUDENT", "3", "1");
  async function createCertificate({ consent = true, attended = true } = {}) {
    const seminar = (await db.query(`INSERT INTO seminar ("seminarTitle","seminarDate","createdBy") VALUES ('Web Security','2026-11-09',1) RETURNING "seminarID"`)).rows[0];
    await db.query(`INSERT INTO seminar_registration ("seminarID","studentID",attended) VALUES ($1,1,$2)`, [seminar.seminarID, attended]);
    const certificate = (await db.query(`INSERT INTO certificate ("studentID","seminarID","studentWalletID","issuerWalletID","authorizedBy","recipientName","seminarTitle","seminarDate")
      VALUES (1,$1,1,1,1,'Juan Dela Cruz','Web Security','2026-11-09') RETURNING *, to_char("seminarDate",'YYYY-MM-DD') AS "seminarDate"`, [seminar.seminarID])).rows[0];
    if (consent) {
      const hash = certificateHash({ ...certificate, walletAddress: student.address }, context);
      const message = certificateConsentMessage({ ...certificate, walletAddress: student.address }, context, hash, "a".repeat(32), new Date().toISOString());
      const signature = await student.signMessage({ message });
      await db.query(`UPDATE certificate SET "certificateHash"=$2,"consentMessage"=$3,"consentSignature"=$4,"consentedAt"=CURRENT_TIMESTAMP WHERE "certificateID"=$1`,
        [certificate.certificateID, hash, message, signature]);
    }
    return { seminarID: seminar.seminarID, certificateID: certificate.certificateID };
  }
  async function post(certificate, session = faculty, checking = false) {
    const response = await fetch(`${base}/faculty/seminars/${certificate.seminarID}/certificates/${certificate.certificateID}/${checking ? "issuance/check" : "issue"}`,
      { method: "POST", headers: { Cookie: session, "Content-Type": "application/json" }, body: "{}" });
    return { status: response.status, data: await response.json() };
  }
  function mine(hash, reverted = false, validEvent = true) {
    const transaction = parseTransaction(rawTransactions.get(hash));
    const decoded = decodeFunctionData({ abi, data: transaction.data });
    const tokenID = BigInt(nonce + 1), issuedAt = BigInt(Math.ceil(Date.now() / 1000) + 1);
    if (!reverted) records.set(decoded.args[1], [1, tokenID, decoded.args[0], issuedAt, 0n]);
    const log = { address: context.contractAddress, blockHash, blockNumber: "0xa", transactionHash: hash, transactionIndex: "0x0", logIndex: "0x0", removed: false,
      topics: encodeEventTopics({ abi, eventName: "Issued", args: { from: issuer.address, to: decoded.args[0], tokenId: tokenID } }),
      data: encodeAbiParameters([{ type: "uint8" }], [0]) };
    receipts.set(hash, { transactionHash: hash, blockHash, blockNumber: "0xa", from: issuer.address, to: context.contractAddress,
      status: reverted ? "0x0" : "0x1", logs: !reverted && validEvent ? [log] : [], transactionIndex: "0x0", gasUsed: "0x249f0", cumulativeGasUsed: "0x249f0", effectiveGasPrice: "0x3b9aca00", type: "0x2" });
    nonce++;
  }
  await t.test("requires a live authorized faculty account, valid IDs and matching seminar", async () => {
    const certificate = await createCertificate();
    for (const session of ["", studentCookie, await cookie("FACULTY", "999", "999")]) assert.equal((await post(certificate, session)).status, 401);
    assert.equal((await post(certificate, assistant)).status, 403);
    assert.equal((await post({ ...certificate, certificateID: "0" })).status, 400);
    assert.equal((await post({ ...certificate, certificateID: "9999" })).status, 404);
    assert.equal(sendCount, 0);
  });
  await t.test("missing approval, attendance and tampered consent never submit a mint", async () => {
    for (const options of [{ consent: false }, { attended: false }]) assert.equal((await post(await createCertificate(options))).status, 409);
    const certificate = await createCertificate();
    await db.query(`UPDATE certificate SET "consentMessage"='tampered' WHERE "certificateID"=$1`, [certificate.certificateID]);
    assert.equal((await post(certificate)).status, 409); assert.equal(sendCount, 0);
    const wrongSignature = await createCertificate();
    const message = (await db.query(`SELECT "consentMessage" FROM certificate WHERE "certificateID"=$1`, [wrongSignature.certificateID])).rows[0].consentMessage;
    await db.query(`UPDATE certificate SET "consentSignature"=$2 WHERE "certificateID"=$1`, [wrongSignature.certificateID, await issuer.signMessage({ message })]);
    assert.equal((await post(wrongSignature)).status, 409); assert.equal(sendCount, 0);
  });
  await t.test("check-only requests cannot create or sign a new transaction", async () => {
    const certificate = await createCertificate(); assert.equal((await post(certificate, faculty, true)).status, 200);
    assert.equal((await db.query("SELECT count(*) FROM blockchain_record")).rows[0].count, "0"); assert.equal(sendCount, 0);
  });
  await t.test("wrong key, wrong chain and insufficient POL leave no transaction attempt", async () => {
    const certificate = await createCertificate();
    delete process.env.ISSUER_PRIVATE_KEY; assert.equal((await post(certificate)).status, 503);
    process.env.ISSUER_PRIVATE_KEY = generatePrivateKey(); assert.equal((await post(certificate)).status, 503);
    process.env.ISSUER_PRIVATE_KEY = issuerKey; chainId = "0x89"; assert.equal((await post(certificate)).status, 503); chainId = "0x13882";
    balance = "0x0"; const noFunds = await post(certificate); assert.equal(noFunds.status, 503, JSON.stringify(noFunds)); balance = "0xde0b6b3a7640000";
    assert.equal((await db.query("SELECT count(*) FROM blockchain_record")).rows[0].count, "0");
  });
  let pending, pendingHash;
  await t.test("persists the signed transaction before broadcasting and tolerates an uncertain RPC response", async () => {
    pending = await createCertificate(); sendFails = true;
    const response = await post(pending); sendFails = false;
    assert.equal(response.status, 200, JSON.stringify(response)); assert.equal(response.data.transactionStatus, "PENDING");
    assert.match(response.data.warning, /no new mint/); pendingHash = response.data.transactionHash;
    assert.equal(persistedBeforeSend, true);
    assert.equal((await db.query(`SELECT status,"issuedAt" FROM certificate WHERE "certificateID"=$1`, [pending.certificateID])).rows[0].issuedAt, null);
  });
  await t.test("concurrent retries reuse the exact signed payload and block another seminar's nonce", async () => {
    const before = rawTransactions.get(pendingHash);
    const retried = await Promise.all([post(pending), post(pending)]);
    assert.ok(retried.every(response => response.status === 200 && response.data.transactionHash === pendingHash), JSON.stringify(retried));
    assert.equal(rawTransactions.get(pendingHash), before);
    assert.equal((await db.query("SELECT count(*) FROM blockchain_record")).rows[0].count, "1");
    assert.equal((await post(await createCertificate())).status, 409);
  });
  await t.test("waits for finality, verifies the receipt and atomically records token and issuance time", async t => {
    mine(pendingHash); finalized = 10n;
    assert.equal((await post(pending, faculty, true)).data.status, "PENDING"); finalized = 12n; blockMatches = false;
    assert.equal((await post(pending, faculty, true)).data.status, "PENDING"); blockMatches = true;
    t.mock.method(console, "error", () => {});
    await db.query(`CREATE FUNCTION reject_test_issuance() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status = 'ISSUED' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER reject_test_issuance BEFORE UPDATE ON certificate FOR EACH ROW EXECUTE FUNCTION reject_test_issuance();`);
    try {
      assert.equal((await post(pending, faculty, true)).status, 500);
      assert.equal((await db.query(`SELECT "transactionStatus" FROM blockchain_record WHERE "certificateID"=$1`, [pending.certificateID])).rows[0].transactionStatus, "PENDING");
      assert.equal((await db.query(`SELECT status FROM certificate WHERE "certificateID"=$1`, [pending.certificateID])).rows[0].status, "PENDING");
    } finally { await db.query(`DROP TRIGGER reject_test_issuance ON certificate; DROP FUNCTION reject_test_issuance()`); }
    const confirmed = await post(pending, faculty, true);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed)); assert.equal(confirmed.data.status, "ISSUED"); assert.equal(confirmed.data.tokenID, "1");
    const stored = (await db.query(`SELECT c.status,c."issuedAt",b."transactionStatus",b."blockNum",b."tokenID",b."requestedBy" FROM certificate c JOIN blockchain_record b USING ("certificateID") WHERE c."certificateID"=$1`, [pending.certificateID])).rows[0];
    assert.equal(stored.status, "ISSUED"); assert.ok(stored.issuedAt); assert.equal(stored.transactionStatus, "CONFIRMED"); assert.equal(stored.tokenID, "1"); assert.equal(stored.blockNum, "10"); assert.equal(stored.requestedBy, "1");
    const sends = sendCount; assert.equal((await post(pending)).data.status, "ISSUED"); assert.equal(sendCount, sends);
    const listResponse = await fetch(base + "/student/certificates", { headers: { Cookie: studentCookie } });
    const visible = (await listResponse.json()).find(row => row.certificateID === pending.certificateID);
    assert.equal(visible.tokenID, "1"); assert.equal(visible.transactionHash, pendingHash); assert.equal(visible.status, "ISSUED"); assert.equal("signedTransaction" in visible, false);
  });
  await t.test("a finalized revert is retryable with the same certificate number and approval", async () => {
    const certificate = await createCertificate(); const first = await post(certificate); assert.equal(first.status, 200, JSON.stringify(first));
    mine(first.data.transactionHash, true); const failed = await post(certificate, faculty, true);
    assert.equal(failed.data.status, "FAILED");
    const retry = await post(certificate); assert.equal(retry.data.transactionStatus, "PENDING"); assert.notEqual(retry.data.transactionHash, first.data.transactionHash);
    mine(retry.data.transactionHash); assert.equal((await post(certificate, faculty, true)).data.status, "ISSUED");
    assert.equal((await db.query(`SELECT count(*) FROM blockchain_record WHERE "certificateID"=$1`, [certificate.certificateID])).rows[0].count, "2");
  });
  await t.test("unmatched receipts stay pending and cannot falsely mark a certificate issued", async () => {
    const certificate = await createCertificate(), response = await post(certificate);
    mine(response.data.transactionHash, false, false);
    const checked = await post(certificate, faculty, true); assert.equal(checked.status, 409);
    assert.equal((await db.query(`SELECT status FROM certificate WHERE "certificateID"=$1`, [certificate.certificateID])).rows[0].status, "PENDING");
  });
});

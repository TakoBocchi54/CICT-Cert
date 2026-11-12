import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import pg from "pg";
import { SignJWT } from "jose";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, keccak256, parseTransaction } from "viem";
import abi from "../contracts/CICTCertificate.abi.json" with { type: "json" };

const local = process.env.DATABASE_URL && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname);
process.env.SESSION_SECRET = "revocation-route-test-secret-only";
const { default: router } = await import("./revocations.js");
const { pool } = await import("../db/pool.js");

test("faculty revocation with PostgreSQL and a local Amoy RPC fixture", { skip: !local && "Requires local PostgreSQL; never runs against production" }, async t => {
  const schema = "cict_revocation_test_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL }); await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: "-c search_path=" + schema });
  const originalQuery = pool.query, originalConnect = pool.connect;
  pool.query = db.query.bind(db); pool.connect = db.connect.bind(db);
  const previousEnv = { rpc: process.env.AMOY_RPC_URL, contract: process.env.CONTRACT_ADDRESS, key: process.env.ISSUER_PRIVATE_KEY };
  const issuerKey = generatePrivateKey(), issuer = privateKeyToAccount(issuerKey), student = privateKeyToAccount(generatePrivateKey());
  const contractAddress = "0x2222222222222222222222222222222222222222";
  let server, rpc, persistedBeforeSend = true, sendFails = false, sendCount = 0, nonce = 0, finalized = 12n, nextToken = 1n;
  const rawTransactions = new Map(), receipts = new Map(), records = new Map(), tokens = new Map();
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
  await db.query(`INSERT INTO student_wallet ("studentID","studentWalletAddress") VALUES (1,$1)`, [student.address]);
  await db.query(`INSERT INTO issuer_wallet ("issuerWalletAddress",label,network) VALUES ($1,'CICT','polygon-amoy')`, [issuer.address]);
  rpc = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const call = JSON.parse(body); let value, error;
    try {
      switch (call.method) {
        case "eth_chainId": value = "0x13882"; break;
        case "eth_getBalance": value = "0xde0b6b3a7640000"; break;
        case "eth_getTransactionCount": value = "0x" + nonce.toString(16); break;
        case "eth_estimateGas": value = "0x249f0"; break;
        case "eth_maxPriorityFeePerGas": value = "0x3b9aca00"; break;
        case "eth_getBlockByNumber": value = { number: "0x" + (call.params[0] === "finalized" ? finalized : 10n).toString(16),
          hash: blockHash, timestamp: "0x" + Math.ceil(Date.now() / 1000).toString(16),
          baseFeePerGas: "0x3b9aca00", transactions: [], gasLimit: "0x1c9c380", gasUsed: "0x249f0" }; break;
        case "eth_call": {
          const decoded = decodeFunctionData({ abi, data: call.params[0].data });
          value = encodeFunctionResult({ abi, functionName: decoded.functionName, result: decoded.functionName === "issuer" ? issuer.address :
            decoded.functionName === "verify" ? records.get(decoded.args[0]) || [0, 0n, "0x" + "0".repeat(40), 0n, 0n] : undefined }); break;
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
  process.env.AMOY_RPC_URL = "http://127.0.0.1:" + rpc.address().port; process.env.CONTRACT_ADDRESS = contractAddress;
  process.env.ISSUER_PRIVATE_KEY = issuerKey;
  const app = express(); app.use(express.json(), cookieParser()); app.use("/api", router);
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/api/faculty/certificates/";
  const key = new TextEncoder().encode(process.env.SESSION_SECRET);
  async function cookie(role = "FACULTY", userID = "1", id = "1") {
    return "cict_session=" + await new SignJWT({ role, userID, [role === "FACULTY" ? "facultyID" : "studentID"]: id })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m").sign(key);
  }
  const faculty = await cookie(), assistant = await cookie("FACULTY", "2", "2"), studentCookie = await cookie("STUDENT", "3", "1");

  // An issued certificate with a confirmed mint, as left by the issuance flow.
  async function issuedCertificate({ status = "ISSUED", onchain = true } = {}) {
    const seminar = (await db.query(`INSERT INTO seminar ("seminarTitle","seminarDate","createdBy") VALUES ('Web Security','2026-11-09',1) RETURNING "seminarID"`)).rows[0];
    await db.query(`INSERT INTO seminar_registration ("seminarID","studentID",attended) VALUES ($1,1,true)`, [seminar.seminarID]);
    const hash = "0x" + randomBytes(32).toString("hex"), tokenID = nextToken++;
    const issued = status === "ISSUED";
    const certificate = (await db.query(`INSERT INTO certificate ("studentID","seminarID","studentWalletID","issuerWalletID","authorizedBy","recipientName","seminarTitle","seminarDate",
        "certificateHash","consentMessage","consentSignature","consentedAt",status,"issuedAt")
      VALUES (1,$1,1,1,1,'Juan Dela Cruz','Web Security','2026-11-09',$2,'consent','0xsig',now() - interval '1 hour',$3,$4) RETURNING "certificateID","certificateNo"`,
      [seminar.seminarID, hash, status, issued ? new Date(Date.now() - 60_000) : null])).rows[0];
    if (issued) {
      await db.query(`INSERT INTO blockchain_record ("certificateID","transactionType","transactionHash","requestedBy","tokenID","contractAddress","fromAddress","toAddress",network,"blockNum","transactionStatus")
        VALUES ($1,'MINT',$2,1,$3,$4,$5,$6,'polygon-amoy',5,'CONFIRMED')`,
        [certificate.certificateID, "0x" + randomBytes(32).toString("hex"), tokenID.toString(), contractAddress, issuer.address.toLowerCase(), student.address]);
      if (onchain) records.set(hash, [1, tokenID, student.address, BigInt(Math.floor(Date.now() / 1000) - 60), 0n]);
      tokens.set(tokenID, hash);
    }
    return { no: certificate.certificateNo, id: certificate.certificateID, hash, tokenID };
  }
  async function request(path, { session = faculty, body } = {}) {
    const response = await fetch(base + path, body === undefined ? { headers: { Cookie: session } }
      : { method: "POST", headers: { Cookie: session, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  const revoke = (certificate, reason = "Name misspelled", session) => request(`${certificate.no}/revoke`, { session, body: { reason } });
  const check = (certificate, session) => request(`${certificate.no}/revocation/check`, { session, body: {} });
  function mine(hash, { reverted = false, validEvent = true } = {}) {
    const tokenID = decodeFunctionData({ abi, data: parseTransaction(rawTransactions.get(hash)).data }).args[0];
    const certHash = tokens.get(tokenID), revokedAt = BigInt(Math.ceil(Date.now() / 1000));
    if (!reverted) records.set(certHash, [2, tokenID, student.address, records.get(certHash)[3], revokedAt]);
    const log = { address: contractAddress, blockHash, blockNumber: "0xa", transactionHash: hash, transactionIndex: "0x0", logIndex: "0x0", removed: false,
      topics: encodeEventTopics({ abi, eventName: "Revoked", args: { tokenId: tokenID, certHash, recipient: student.address } }),
      data: encodeAbiParameters([{ type: "uint64" }], [revokedAt]) };
    receipts.set(hash, { transactionHash: hash, blockHash, blockNumber: "0xa", from: issuer.address, to: contractAddress,
      status: reverted ? "0x0" : "0x1", logs: !reverted && validEvent ? [log] : [], transactionIndex: "0x0", gasUsed: "0x249f0",
      cumulativeGasUsed: "0x249f0", effectiveGasPrice: "0x3b9aca00", type: "0x2" });
    nonce++;
  }
  const certificateRow = id => db.query(`SELECT status,"revokedAt" FROM certificate WHERE "certificateID"=$1`, [id]).then(r => r.rows[0]);
  const revokeRecords = id => db.query(`SELECT * FROM blockchain_record WHERE "certificateID"=$1 AND "transactionType"='REVOKE' ORDER BY "transactionID"`, [id]).then(r => r.rows);

  await t.test("lookup and revocation require a live faculty account; revoking requires canIssue", async () => {
    const certificate = await issuedCertificate();
    for (const session of ["", studentCookie, await cookie("FACULTY", "999", "999")]) {
      assert.equal((await request(String(certificate.no), { session })).status, 401);
      assert.equal((await revoke(certificate, "x", session)).status, 401);
    }
    const lookup = await request(String(certificate.no), { session: assistant });
    assert.equal(lookup.status, 200);
    assert.equal(lookup.data.tokenID, certificate.tokenID.toString()); assert.equal(lookup.data.status, "ISSUED");
    assert.equal(lookup.data.recipientName, "Juan Dela Cruz"); assert.equal(lookup.data.revocation.transactionStatus, null);
    assert.equal("certificateID" in lookup.data, false);
    assert.equal((await revoke(certificate, "x", assistant)).status, 403);
    assert.equal((await check(certificate, assistant)).status, 403);
    assert.equal((await request("0")).status, 400); assert.equal((await request("abc")).status, 400);
    assert.equal((await request("999999")).status, 404); assert.equal((await revoke({ no: 999999 })).status, 404);
    assert.equal(sendCount, 0);
  });

  await t.test("requires a reason and an issued certificate that is still valid on chain", async () => {
    const certificate = await issuedCertificate();
    for (const reason of [null, "", "   ", "x".repeat(501), 42]) assert.equal((await revoke(certificate, reason)).status, 400);
    assert.equal((await revoke(await issuedCertificate({ status: "PENDING" }))).status, 409);
    assert.equal((await revoke(await issuedCertificate({ onchain: false }))).status, 409);
    assert.equal((await db.query(`SELECT count(*) FROM blockchain_record WHERE "transactionType"='REVOKE'`)).rows[0].count, "0");
    assert.equal(sendCount, 0);
  });

  let pending;
  await t.test("stores the signed revocation before broadcast and tolerates an uncertain RPC response", async () => {
    pending = await issuedCertificate(); sendFails = true;
    const response = await revoke(pending, "  Wrong seminar date  "); sendFails = false;
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(response.data.transactionStatus, "PENDING"); assert.match(response.data.warning, /no new revocation/);
    const [record] = await revokeRecords(pending.id);
    assert.equal(record.revocationReason, "Wrong seminar date"); assert.equal(record.requestedBy, "1");
    assert.equal(record.tokenID, pending.tokenID.toString()); assert.equal(record.toAddress, student.address);
    assert.equal((await certificateRow(pending.id)).status, "ISSUED");
    assert.equal(persistedBeforeSend, true);
  });

  await t.test("retries reuse the same signed payload and block other issuer transactions", async () => {
    const before = [...rawTransactions.values()].at(-1), sends = sendCount;
    const retried = await Promise.all([revoke(pending, "Another reason"), check(pending)]);
    assert.ok(retried.every(r => r.status === 200 && r.data.transactionStatus === "PENDING" && r.data.reason === "Wrong seminar date"), JSON.stringify(retried));
    assert.equal([...rawTransactions.values()].at(-1), before); assert.equal(sendCount, sends + 2);
    assert.equal((await revokeRecords(pending.id)).length, 1);
    assert.equal((await revoke(await issuedCertificate())).status, 409);
  });

  await t.test("waits for finality and marks the certificate revoked only from the confirmed chain record", async () => {
    const [record] = await revokeRecords(pending.id);
    mine(record.transactionHash); finalized = 10n;
    assert.equal((await check(pending)).data.status, "ISSUED"); finalized = 12n;
    const confirmed = await check(pending);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed));
    assert.equal(confirmed.data.status, "REVOKED"); assert.equal(confirmed.data.transactionStatus, "CONFIRMED");
    const stored = await certificateRow(pending.id);
    assert.equal(stored.status, "REVOKED"); assert.ok(stored.revokedAt);
    const [saved] = await revokeRecords(pending.id);
    assert.equal(saved.transactionStatus, "CONFIRMED"); assert.equal(saved.blockNum, "10");
    const sends = sendCount;
    assert.equal((await revoke(pending)).data.status, "REVOKED"); assert.equal(sendCount, sends);
    assert.equal((await request(String(pending.no))).data.revocation.reason, "Wrong seminar date");
  });

  await t.test("a finalized revert leaves the certificate issued and can be retried", async () => {
    const certificate = await issuedCertificate();
    const first = await revoke(certificate); assert.equal(first.status, 200, JSON.stringify(first));
    mine(first.data.transactionHash, { reverted: true });
    const failed = await check(certificate);
    assert.equal(failed.data.transactionStatus, "FAILED"); assert.equal((await certificateRow(certificate.id)).status, "ISSUED");
    const retry = await revoke(certificate); assert.equal(retry.data.transactionStatus, "PENDING");
    assert.notEqual(retry.data.transactionHash, first.data.transactionHash);
    mine(retry.data.transactionHash); assert.equal((await check(certificate)).data.status, "REVOKED");
    assert.equal((await revokeRecords(certificate.id)).length, 2);
  });

  await t.test("a receipt without the expected event stays pending and never marks the certificate revoked", async () => {
    const certificate = await issuedCertificate(), response = await revoke(certificate);
    mine(response.data.transactionHash, { validEvent: false });
    assert.equal((await check(certificate)).status, 409);
    assert.equal((await certificateRow(certificate.id)).status, "ISSUED");
    assert.equal((await revokeRecords(certificate.id))[0].transactionStatus, "PENDING");
    assert.equal(persistedBeforeSend, true);
  });
  await t.test("a revoked certificate gets one explicit replacement with corrected facts and a new number", async () => {
    const original = await issuedCertificate();
    await db.query(`UPDATE certificate SET status='REVOKED',"revokedAt"=now() WHERE "certificateID"=$1`, [original.id]);
    const facts = { recipientName: "  Juan P. Dela Cruz ", seminarTitle: "Web Security Fundamentals", seminarDate: "2026-11-08" };
    const replace = (certificate, body = facts, session) => request(`${certificate.no}/replacement`, { session, body });
    assert.equal((await request(String(original.no))).data.replacement, null);
    assert.equal((await replace(original, facts, assistant)).status, 403);
    for (const body of [{ ...facts, recipientName: " " }, { ...facts, seminarTitle: "x".repeat(256) }, { ...facts, seminarTitle: "a\u0007b" },
      { ...facts, seminarDate: "2026-02-30" }, { ...facts, seminarDate: "11/08/2026" }, {}]) {
      assert.equal((await replace(original, body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await replace(await issuedCertificate())).status, 409);
    const sends = sendCount;
    const created = await replace(original);
    assert.equal(created.status, 201, JSON.stringify(created));
    assert.equal(created.data.status, "PENDING"); assert.equal(created.data.replaces, original.no);
    assert.ok(BigInt(created.data.certificateNo) > BigInt(original.no));
    assert.equal(created.data.recipientName, "Juan P. Dela Cruz"); assert.equal(created.data.seminarDate, "2026-11-08");
    const row = (await db.query(`SELECT "seminarID","studentID","studentWalletID","authorizedBy","consentedAt","certificateHash" FROM certificate WHERE "certificateNo"=$1`,
      [created.data.certificateNo])).rows[0];
    assert.deepEqual({ ...row }, { ...(await db.query(`SELECT "seminarID","studentID" FROM certificate WHERE "certificateID"=$1`, [original.id])).rows[0],
      studentWalletID: "1", authorizedBy: "1", consentedAt: null, certificateHash: null });
    assert.equal(sendCount, sends, "preparing a replacement sends no transaction");
    assert.deepEqual((await request(String(original.no))).data.replacement, { certificateNo: created.data.certificateNo, status: "PENDING" });
    assert.match((await replace(original)).data.error, new RegExp(`No\. ${created.data.certificateNo}`));
    const absent = await issuedCertificate();
    await db.query(`UPDATE certificate SET status='REVOKED',"revokedAt"=now() WHERE "certificateID"=$1;`, [absent.id]);
    await db.query(`UPDATE seminar_registration SET attended=false WHERE ("seminarID","studentID") = (SELECT "seminarID","studentID" FROM certificate WHERE "certificateID"=$1)`, [absent.id]);
    assert.equal((await replace(absent)).status, 409);
  });

  await t.test("dashboard summary needs a live faculty account and reports real counts and recent rows", async () => {
    for (const session of ["", studentCookie]) assert.equal((await request("summary", { session })).status, 401);
    const { status, data } = await request("summary");
    const [issued, revoked] = ["ISSUED", "REVOKED"].map(async s => Number((await db.query(`SELECT count(*) FROM certificate WHERE status=$1`, [s])).rows[0].count));
    assert.equal(status, 200); assert.equal(data.issuedCount, await issued); assert.equal(data.revokedCount, await revoked);
    assert.ok(data.recentIssued.length <= 4 && data.recentRevoked.length <= 3 && data.recentRevoked.length > 0);
    assert.deepEqual(Object.keys(data.recentRevoked[0]).sort(), ["at", "certificateNo", "recipientName", "seminarTitle"]);
  });

  await t.test("registry lists only on-chain certificates, newest first, with status filter and search", async () => {
    for (const session of ["", studentCookie]) assert.equal((await request("", { session })).status, 401);
    const pending = await issuedCertificate({ status: "PENDING" });
    const all = await request("");
    assert.equal(all.status, 200);
    assert.ok(all.data.length > 0 && all.data.every(row => ["ISSUED", "REVOKED"].includes(row.status)));
    assert.ok(!all.data.some(row => row.certificateNo === pending.no));
    assert.ok(all.data.some(row => row.status === "REVOKED") && all.data.some(row => row.status === "ISSUED"));
    const times = all.data.map(row => Date.parse(row.issuedAt));
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
    assert.deepEqual(Object.keys(all.data[0]).sort(), ["certificateHash", "certificateNo", "email", "issuedAt", "recipientName", "revokedAt", "seminarDate", "seminarTitle", "status"]);
    const revoked = await request("?status=REVOKED");
    assert.ok(revoked.data.length > 0 && revoked.data.every(row => row.status === "REVOKED"));
    const target = all.data.at(-1);
    for (const q of [target.certificateNo, "#" + target.certificateNo]) {
      assert.deepEqual((await request("?q=" + encodeURIComponent(q))).data.map(row => row.certificateNo), [target.certificateNo]);
    }
    assert.equal((await request("?q=juan%20dela")).data.length, all.data.length);
    assert.equal((await request("?q=" + encodeURIComponent(all.data[0].email.toUpperCase()))).data.length, all.data.length);
    assert.deepEqual((await request("?q=%25")).data, []);
  });
});

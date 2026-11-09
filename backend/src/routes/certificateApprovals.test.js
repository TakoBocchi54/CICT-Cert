import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import pg from "pg";
import { SignJWT, decodeJwt } from "jose";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { toFunctionSelector } from "viem";
import { certificateHash } from "../utils/certificateConsent.js";

const local = process.env.DATABASE_URL && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname);
process.env.SESSION_SECRET = "certificate-approval-test-secret-only";
const { default: facultyRoutes } = await import("./seminars.js");
const { default: studentRoutes } = await import("./certificateApprovals.js");
const { pool } = await import("../db/pool.js");

test("certificate preparation and consent HTTP endpoints", { skip: !local && "Requires local PostgreSQL; never runs against production" }, async t => {
  const schema = "cict_consent_test_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: "-c search_path=" + schema });
  const originalQuery = pool.query, originalConnect = pool.connect;
  pool.query = db.query.bind(db); pool.connect = db.connect.bind(db);
  const account = privateKeyToAccount(generatePrivateKey());
  const second = privateKeyToAccount(generatePrivateKey());
  const issuer = "0x1111111111111111111111111111111111111111";
  const contract = "0x2222222222222222222222222222222222222222";
  let server, rpc, chainId = "0x13882";
  const rpcMethods = [];
  const originalRpc = process.env.AMOY_RPC_URL, originalContract = process.env.CONTRACT_ADDRESS;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (rpc) await new Promise(resolve => rpc.close(resolve));
    pool.query = originalQuery; pool.connect = originalConnect;
    process.env.AMOY_RPC_URL = originalRpc; process.env.CONTRACT_ADDRESS = originalContract;
    await db.end();
    // Only the generated, isolated test schema is deleted.
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end(); await pool.end();
  });
  await db.query(await readFile(new URL("../../sql/schema.sql", import.meta.url), "utf8"));
  await db.query(`
    INSERT INTO users (email, role, "passwordHash") VALUES ('issuer@example.test','FACULTY','test'),
      ('assistant@example.test','FACULTY','test'), ('one@example.test','STUDENT',NULL),
      ('two@example.test','STUDENT',NULL), ('absent@example.test','STUDENT',NULL);
    INSERT INTO cict_faculty ("userID","firstName","lastName","canIssue") VALUES (1,'A','B',true),(2,'C','D',false);
    INSERT INTO student ("userID","fullName",program) VALUES (3,'Juan Dela Cruz','BSCS'),(4,'Ana Reyes','BSIT'),(5,'Absent Student','BSCS');
    INSERT INTO seminar ("seminarTitle","seminarDate","createdBy") VALUES ('Web Security','2026-11-09',1),('No Attendance','2026-11-10',1);
    INSERT INTO seminar_registration ("seminarID","studentID",attended) VALUES (1,1,true),(1,2,true),(1,3,false);
  `);
  await db.query(`INSERT INTO student_wallet ("studentID","studentWalletAddress") VALUES (1,$1),(3,$2)`, [account.address, second.address]);
  rpc = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const call = JSON.parse(body); rpcMethods.push(call.method);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id,
      ...(call.method === "eth_chainId" ? { result: chainId } : call.method === "eth_call" && call.params[0].data === toFunctionSelector("issuer()") ?
        { result: "0x" + "0".repeat(24) + issuer.slice(2) } : { error: { code: -32601, message: "Read-only test RPC" } }) }));
  }).listen(0, "127.0.0.1");
  await new Promise(resolve => rpc.once("listening", resolve));
  process.env.AMOY_RPC_URL = "http://127.0.0.1:" + rpc.address().port;
  process.env.CONTRACT_ADDRESS = contract;
  const app = express(); app.use(express.json(), cookieParser()); app.use("/api", facultyRoutes, studentRoutes);
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/api";
  const key = new TextEncoder().encode(process.env.SESSION_SECRET);
  async function cookie(role, userID, id) {
    const token = await new SignJWT({ role, userID, [role === "FACULTY" ? "facultyID" : "studentID"]: id })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m").sign(key);
    return "cict_session=" + token;
  }
  const faculty = await cookie("FACULTY", "1", "1"), assistant = await cookie("FACULTY", "2", "2");
  const student = await cookie("STUDENT", "3", "1"), student2 = await cookie("STUDENT", "4", "2");
  async function request(path, session = student, body) {
    const response = await fetch(base + path, { method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...(session ? { Cookie: session } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  const prepare = (session = faculty, id = "1") => request(`/faculty/seminars/${id}/certificates/prepare`, session, {});
  let id, id2, approved, alternate;
  const review = (certificateID = id, session = student) => request(`/student/certificates/${certificateID}/consent-request`, session, {});
  const submit = (body, session = student, certificateID = id) => request(`/student/certificates/${certificateID}/consent`, session, body);

  await t.test("requires live role-specific accounts and issuance permission", async () => {
    for (const session of ["", student, await cookie("FACULTY", "999", "999")]) assert.equal((await prepare(session)).status, 401);
    assert.equal((await prepare(assistant)).status, 403);
    for (const session of ["", faculty, await cookie("STUDENT", "999", "999")]) assert.equal((await request("/student/certificates", session)).status, 401);
  });
  await t.test("rejects wrong network, missing seminar and missing attendance without writes", async () => {
    chainId = "0x89"; assert.equal((await prepare()).status, 503); chainId = "0x13882";
    assert.equal((await prepare(faculty, "999")).status, 404);
    assert.equal((await prepare(faculty, "2")).status, 409);
    assert.equal((await db.query("SELECT count(*) FROM issuer_wallet")).rows[0].count, "0");
  });
  await t.test("concurrent preparation creates one numbered snapshot per attendee, including missing wallets", async () => {
    const results = await Promise.all([prepare(), prepare()]);
    assert.ok(results.every(result => result.status === 200), JSON.stringify(results));
    assert.equal(results.reduce((sum, result) => sum + result.data.prepared, 0), 2);
    assert.ok(results.every(result => result.data.awaitingWallet === 1));
    const { rows } = await db.query(`SELECT * FROM certificate ORDER BY "studentID"`);
    assert.equal(rows.length, 2); [id, id2] = rows.map(row => row.certificateID);
    assert.equal(rows[0].recipientName, "Juan Dela Cruz"); assert.equal(rows[0].seminarTitle, "Web Security");
    assert.equal(rows[0].authorizedBy, "1"); assert.equal(rows[1].studentWalletID, null);
    assert.notEqual(rows[0].certificateNo, rows[1].certificateNo);
    assert.ok(rows.every(row => row.status === "PENDING" && !row.issuedAt && !row.consentedAt));
  });
  await t.test("lists only the student's own pending certificates without signatures", async () => {
    const mine = await request("/student/certificates");
    assert.equal(mine.headers.get("cache-control"), "no-store");
    assert.equal(mine.data.length, 1); assert.equal(mine.data[0].certificateID, id);
    assert.equal(mine.data[0].seminarDate, "2026-11-09");
    assert.equal("consentSignature" in mine.data[0], false);
    assert.equal((await review(id, student2)).status, 404);
    assert.equal((await review(id2, student2)).status, 409);
    for (const value of ["0", "abc", "9223372036854775808"]) assert.equal((await review(value)).status, 400);
    const list = await request("/faculty/seminars/1/certificates", assistant);
    assert.equal(list.data.length, 2); assert.equal(list.data[0].consentedAt, null);
  });
  await t.test("presents exact immutable facts, domain and issuer-only burn authorization with a fresh nonce", async () => {
    const first = await review(), next = await review();
    assert.equal(first.status, 200, JSON.stringify(first.data)); approved = first.data; alternate = next.data;
    assert.match(approved.message, /Only the issuer may revoke \(burn\)/);
    assert.match(approved.message, /Juan Dela Cruz/); assert.match(approved.message, /Web Security/);
    assert.match(approved.message, /2026-11-09/); assert.match(approved.message, /Polygon Amoy \(80002\)/);
    assert.match(approved.message, /does not send a blockchain transaction or authorize spending/);
    assert.notEqual(approved.message, alternate.message);
    assert.equal(decodeJwt(approved.challenge).hash, certificateHash(approved.certificate, approved.context));
  });
  await t.test("rejects another wallet, another student, tampering, expiry and wallet-link tokens", async () => {
    const signature = await second.signMessage({ message: approved.message });
    assert.equal((await submit({ challenge: approved.challenge, signature })).status, 400);
    const valid = await account.signMessage({ message: approved.message });
    assert.equal((await submit({ challenge: approved.challenge, signature: valid }, student2)).status, 400);
    assert.equal((await submit({ challenge: "invalid." + approved.challenge, signature: valid })).status, 400);
    const payload = decodeJwt(approved.challenge);
    const expired = await new SignJWT({ ...payload, exp: Math.floor(Date.now() / 1000) - 1 }).setProtectedHeader({ alg: "HS256" }).sign(key);
    assert.equal((await submit({ challenge: expired, signature: valid })).status, 400);
    const wrongPurpose = await new SignJWT({ ...payload, purpose: "wallet-link" }).setProtectedHeader({ alg: "HS256" }).sign(key);
    assert.equal((await submit({ challenge: wrongPurpose, signature: valid })).status, 400);
    assert.equal((await db.query(`SELECT "consentedAt" FROM certificate WHERE "certificateID" = $1`, [id])).rows[0].consentedAt, null);
  });
  await t.test("rechecks attendance, issuer availability and contract configuration at submission", async () => {
    const body = { challenge: approved.challenge, signature: await account.signMessage({ message: approved.message }) };
    await db.query(`UPDATE seminar_registration SET attended = false WHERE "seminarID" = 1 AND "studentID" = 1`);
    assert.equal((await submit(body)).status, 409);
    await db.query(`UPDATE seminar_registration SET attended = true WHERE "seminarID" = 1 AND "studentID" = 1`);
    await db.query(`UPDATE issuer_wallet SET "isActive" = false`);
    assert.equal((await submit(body)).status, 409); assert.equal((await review()).status, 409);
    assert.equal((await prepare()).status, 409);
    await db.query(`UPDATE issuer_wallet SET "isActive" = true`);
    process.env.CONTRACT_ADDRESS = "0x3333333333333333333333333333333333333333";
    assert.equal((await submit(body)).status, 409); process.env.CONTRACT_ADDRESS = contract;
    const changedWallet = privateKeyToAccount(generatePrivateKey());
    await db.query(`UPDATE student_wallet SET "studentWalletAddress" = $1 WHERE "studentID" = 1`, [changedWallet.address]);
    assert.equal((await submit(body)).status, 409);
    await db.query(`UPDATE student_wallet SET "studentWalletAddress" = $1 WHERE "studentID" = 1`, [account.address]);
  });
  await t.test("changed certificate facts invalidate an outstanding approval", async () => {
    await db.query(`UPDATE certificate SET "recipientName" = 'Corrected Name' WHERE "certificateID" = $1`, [id]);
    assert.equal((await submit({ challenge: approved.challenge, signature: await account.signMessage({ message: approved.message }) })).status, 409);
    await db.query(`UPDATE certificate SET "recipientName" = 'Juan Dela Cruz' WHERE "certificateID" = $1`, [id]);
    approved = (await review()).data; alternate = (await review()).data;
  });
  await t.test("a database failure cannot leave a partial approval", async t => {
    t.mock.method(console, "error", () => {});
    await db.query(`CREATE FUNCTION reject_test_approval() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."consentedAt" IS NOT NULL THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER reject_test_approval BEFORE UPDATE ON certificate FOR EACH ROW EXECUTE FUNCTION reject_test_approval();`);
    try {
      assert.equal((await submit({ challenge: approved.challenge, signature: await account.signMessage({ message: approved.message }) })).status, 500);
      const row = (await db.query(`SELECT "consentMessage", "consentSignature", "consentedAt" FROM certificate WHERE "certificateID" = $1`, [id])).rows[0];
      assert.deepEqual(row, { consentMessage: null, consentSignature: null, consentedAt: null });
    } finally { await db.query(`DROP TRIGGER reject_test_approval ON certificate; DROP FUNCTION reject_test_approval()`); }
  });
  await t.test("saves verified consent atomically, supports retries and never mints", async () => {
    const signature = await account.signMessage({ message: approved.message });
    const body = { challenge: approved.challenge, signature, message: "untrusted client message", certificateHash: "untrusted" };
    const results = await Promise.all([submit(body), submit(body)]);
    assert.ok(results.every(result => result.status === 200), JSON.stringify(results));
    const certificate = (await db.query(`SELECT * FROM certificate WHERE "certificateID" = $1`, [id])).rows[0];
    assert.equal(certificate.consentMessage, approved.message); assert.equal(certificate.consentSignature, signature);
    assert.ok(certificate.consentedAt); assert.equal(certificate.status, "PENDING"); assert.equal(certificate.issuedAt, null);
    assert.equal(certificate.certificateHash, decodeJwt(approved.challenge).hash);
    assert.equal((await review()).status, 409);
    assert.equal((await submit({ challenge: alternate.challenge, signature: await account.signMessage({ message: alternate.message }) })).status, 409);
    assert.equal((await db.query("SELECT count(*) FROM blockchain_record")).rows[0].count, "0");
    assert.ok(rpcMethods.every(method => ["eth_call", "eth_chainId"].includes(method)));
  });
  await t.test("students can link a wallet later and approve the existing certificate number", async () => {
    const late = privateKeyToAccount(generatePrivateKey());
    const number = (await db.query(`SELECT "certificateNo" FROM certificate WHERE "certificateID" = $1`, [id2])).rows[0].certificateNo;
    await db.query(`INSERT INTO student_wallet ("studentID","studentWalletAddress") VALUES (2,$1)`, [late.address]);
    const pending = (await review(id2, student2)).data;
    assert.equal(pending.certificate.certificateNo, number);
    assert.equal((await submit({ challenge: pending.challenge, signature: await late.signMessage({ message: pending.message }) }, student2, id2)).status, 200);
  });
  await t.test("repreparing preserves signed snapshots and does not automatically replace revoked certificates", async () => {
    await db.query(`UPDATE student SET "fullName" = 'New Profile Name' WHERE "studentID" = 1;
      UPDATE seminar SET "seminarTitle" = 'Edited Seminar' WHERE "seminarID" = 1;`);
    assert.equal((await prepare()).data.prepared, 0);
    const snapshot = (await db.query(`SELECT "recipientName", "seminarTitle" FROM certificate WHERE "certificateID" = $1`, [id])).rows[0];
    assert.deepEqual(snapshot, { recipientName: "Juan Dela Cruz", seminarTitle: "Web Security" });
    await db.query(`UPDATE certificate SET status = 'ISSUED', "issuedAt" = CURRENT_TIMESTAMP WHERE "certificateID" = $1`, [id]);
    await db.query(`UPDATE certificate SET status = 'REVOKED', "revokedAt" = CURRENT_TIMESTAMP WHERE "certificateID" = $1`, [id]);
    assert.equal((await prepare()).data.prepared, 0);
    assert.equal((await db.query("SELECT count(*) FROM certificate")).rows[0].count, "2");
  });
});

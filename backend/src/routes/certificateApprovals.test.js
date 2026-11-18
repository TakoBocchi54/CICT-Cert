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
import { toFunctionSelector } from "viem";

const local = process.env.DATABASE_URL && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname);
process.env.SESSION_SECRET = "certificate-approval-test-secret-only";
const { default: facultyRoutes } = await import("./seminars.js");
const { default: studentRoutes } = await import("./certificateApprovals.js");
const { pool } = await import("../db/pool.js");

test("certificate preparation and student certificate list HTTP endpoints", { skip: !local && "Requires local PostgreSQL; never runs against production" }, async t => {
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
  await db.query(`INSERT INTO student_wallet ("studentID","studentWalletAddress","consentMessage","consentSignature") VALUES (1,$1,'consent','0xsig'),(3,$2,'consent','0xsig')`, [account.address, second.address]);
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
  let id;

  await t.test("requires live role-specific accounts and issuance permission", async () => {
    for (const session of ["", student, await cookie("FACULTY", "999", "999")]) assert.equal((await prepare(session)).status, 401);
    assert.equal((await prepare(assistant)).status, 403);
    for (const session of ["", faculty, await cookie("STUDENT", "999", "999")]) assert.equal((await request("/student/certificates", session)).status, 401);
    // The other role's cookie means a sign-in in another tab replaced this one, not an expired session.
    assert.match((await prepare(student)).data.error, /signed in as a student/);
    assert.match((await request("/student/certificates", faculty)).data.error, /signed in as faculty/);
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
    assert.equal(rows.length, 2); [id] = rows.map(row => row.certificateID);
    assert.equal(rows[0].recipientName, "Juan Dela Cruz"); assert.equal(rows[0].seminarTitle, "Web Security");
    assert.equal(rows[0].authorizedBy, 1); assert.equal(rows[1].studentWalletID, null);
    assert.notEqual(rows[0].certificateNo, rows[1].certificateNo);
    assert.ok(rows.every(row => row.status === "PENDING" && !row.issuedAt && !row.certificateHash));
  });
  await t.test("students see no certificate before it is issued, while faculty may still correct the name", async () => {
    const mine = await request("/student/certificates");
    assert.equal(mine.headers.get("cache-control"), "no-store");
    assert.deepEqual(mine.data, [], "prepared (PENDING) certificates stay hidden");
    assert.deepEqual((await request("/student/certificates", student2)).data, []);
    for (const value of ["0", "abc", "2147483648"]) assert.equal((await request(`/student/certificates/${value}/proof`)).status, 400);
    assert.equal((await request(`/student/certificates/${id}/proof`)).status, 404, "nothing to prove before issuance");
    const list = await request("/faculty/seminars/1/certificates", assistant);
    assert.equal(list.data.length, 2); assert.equal("consentedAt" in list.data[0], false);
    assert.deepEqual(list.data.map(row => row.walletConnected), [true, false]);
    assert.ok(!rpcMethods.includes("eth_sendRawTransaction"));
  });
});

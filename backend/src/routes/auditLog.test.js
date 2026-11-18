import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import express from "express";
import cookieParser from "cookie-parser";
import pg from "pg";
import { SignJWT } from "jose";

const local = process.env.DATABASE_URL && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname);
process.env.SESSION_SECRET = "audit-log-test-secret-only";
const { default: studentRouter } = await import("./students.js");
const { default: auditRouter } = await import("./auditLog.js");
const { auditLog } = await import("../middleware/auditLog.js");
const { requireFaculty } = await import("../middleware/requireFaculty.js");
const { pool } = await import("../db/pool.js");

test("audit log with PostgreSQL", { skip: !local && "Requires local PostgreSQL; never runs against production" }, async t => {
  const schema = "cict_audit_test_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: "-c search_path=" + schema });
  const originalQuery = pool.query, originalConnect = pool.connect;
  pool.query = db.query.bind(db); pool.connect = db.connect.bind(db);
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    pool.query = originalQuery; pool.connect = originalConnect;
    await db.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`); // the generated test schema is the only deletion target
    await admin.end(); await pool.end();
  });
  await db.query(await readFile(new URL("../../sql/schema.sql", import.meta.url), "utf8"));
  await db.query(`
    INSERT INTO users ("email", "role", "passwordHash") VALUES
      ('issuer@example.test', 'FACULTY', 'x'), ('assistant@example.test', 'FACULTY', 'x'), ('maria@gmail.com', 'STUDENT', NULL);
    INSERT INTO cict_faculty ("userID", "firstName", "lastName", "canIssue") VALUES (1, 'Ana', 'Reyes', true), (2, 'Pedro', 'Cruz', false);
    INSERT INTO student ("userID", "fullName", "program", "contactNumber") VALUES (3, 'Maria Santos', 'BSIT', '09171234567');`);
  const app = express();
  app.use(express.json({ limit: "2mb" }), cookieParser(), auditLog);
  // Stand-ins for routes that need a blockchain: a slow change, a status check and a batch revoke.
  const stub = (path, delay = 0) => app.post("/api" + path, requireFaculty, async (_req, res) => {
    await new Promise(resolve => setTimeout(resolve, delay));
    res.json({});
  });
  stub("/faculty/seminars/1/certificates/issue", 300);
  stub("/faculty/seminars/1/certificates/issuance/check");
  stub("/faculty/certificates/revoke");
  app.use("/api", studentRouter, auditRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/api";
  const key = new TextEncoder().encode(process.env.SESSION_SECRET);
  const cookie = async (role, userID, facultyID) => "cict_session=" + await new SignJWT({ role, userID, facultyID })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m").sign(key);
  const issuer = await cookie("FACULTY", "1", "1"), assistant = await cookie("FACULTY", "2", "2"), student = await cookie("STUDENT", "3", "1");
  const request = async (method, path, body, session = issuer) => {
    const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(session ? { Cookie: session } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  };
  // The entry is written just after the response, so wait for it.
  const entries = async (expected = 0) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const { rows } = await db.query(`SELECT * FROM audit_log ORDER BY "auditID"`);
      if (rows.length >= expected) return rows;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return (await db.query(`SELECT * FROM audit_log ORDER BY "auditID"`)).rows;
  };

  await t.test("a successful faculty change is recorded with the actor, route, ids and only safe fields", async () => {
    const created = await request("POST", "/faculty/students", { students: [{ fullName: "Juan Cruz", program: "BSCS", googleAccount: "juan@gmail.com", contactNumber: "09171234567" }], reason: "approved by dean" });
    assert.equal(created.status, 201);
    const [row] = await entries(1);
    assert.deepEqual([row.actorFacultyID, row.actorName, row.actorEmail, row.action], [1, "Ana Reyes", "issuer@example.test", "POST /faculty/students"]);
    assert.deepEqual(row.details, {}, "contact numbers and fields this action doesn't use are not stored");
    const removed = await request("DELETE", "/faculty/students/" + (await db.query(`SELECT "studentID" FROM student WHERE "fullName" = 'Juan Cruz'`)).rows[0].studentID);
    assert.equal(removed.status, 204);
    const rows = await entries(2);
    assert.equal(rows[1].action, "DELETE /faculty/students/:id");
    assert.equal(rows[1].ids.length, 1);
  });

  await t.test("failed requests and reads are not recorded", async () => {
    const before = (await entries()).length;
    assert.equal((await request("DELETE", "/faculty/students/999999")).status, 404);
    assert.equal((await request("DELETE", "/faculty/students/1", undefined, assistant)).status, 403);
    assert.equal((await request("POST", "/faculty/students", { students: [] })).status, 400);
    assert.equal((await request("GET", "/faculty/students")).status, 200);
    assert.equal((await request("GET", "/faculty/students", undefined, "")).status, 401);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal((await entries()).length, before);
  });

  await t.test("the log cannot be edited or deleted", async () => {
    await assert.rejects(db.query(`UPDATE audit_log SET "action" = 'x'`), /append-only/);
    await assert.rejects(db.query(`DELETE FROM audit_log`), /append-only/);
  });

  await t.test("only faculty with issuance permission can read it, newest first, with paging and search", async () => {
    assert.equal((await request("GET", "/faculty/audit-log", undefined, "")).status, 401);
    assert.equal((await request("GET", "/faculty/audit-log", undefined, student)).status, 401);
    assert.equal((await request("GET", "/faculty/audit-log", undefined, assistant)).status, 403);
    const all = await request("GET", "/faculty/audit-log");
    assert.equal(all.status, 200);
    assert.deepEqual(all.data.map(row => row.action), ["DELETE /faculty/students/:id", "POST /faculty/students"]);
    const older = await request("GET", `/faculty/audit-log?limit=1&before=${all.data[0].auditID}`);
    assert.deepEqual(older.data.map(row => row.action), ["POST /faculty/students"]);
    assert.equal((await request("GET", "/faculty/audit-log?before=abc")).status, 400);
    assert.equal((await request("GET", "/faculty/audit-log?q=delete")).data.length, 1);
    assert.equal((await request("GET", "/faculty/audit-log?q=%25")).data.length, 0, "% is matched literally");
    assert.equal((await request("GET", "/faculty/audit-log?kind=students")).data.length, 2);
    assert.equal((await request("GET", "/faculty/audit-log?kind=certificates")).data.length, 0);
    assert.equal((await request("GET", "/faculty/audit-log?kind=nope")).status, 400);
  });

  await t.test("a change is recorded even when the browser leaves before the response", async () => {
    const before = (await entries()).length;
    const leaving = new AbortController();
    const pending = fetch(base + "/faculty/seminars/1/certificates/issue", { method: "POST", headers: { Cookie: issuer }, signal: leaving.signal });
    setTimeout(() => leaving.abort(), 50);
    await assert.rejects(pending);
    const rows = await entries(before + 1);
    assert.equal(rows.at(-1).action, "POST /faculty/seminars/:id/certificates/issue");
  });

  await t.test("polled status checks are not recorded", async () => {
    const before = (await entries()).length;
    assert.equal((await request("POST", "/faculty/seminars/1/certificates/issuance/check")).status, 200);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal((await entries()).length, before);
  });

  await t.test("details keep only the fields the action uses, shortened", async () => {
    const before = (await entries()).length;
    await request("POST", "/faculty/certificates/revoke", { certificateNos: [3, "4"], reason: "x".repeat(500), recipientName: "Planted", contactNumber: "09171234567" });
    const rows = await entries(before + 1);
    assert.deepEqual(rows.at(-1).details, { certificateNos: [3, "4"], reason: "x".repeat(300) });
  });
});

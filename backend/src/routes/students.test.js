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
process.env.SESSION_SECRET = "student-route-test-secret-only";
const { default: router } = await import("./students.js");
const { pool } = await import("../db/pool.js");

test("student account endpoints with PostgreSQL", { skip: !local && "Requires local PostgreSQL; never runs against production" }, async t => {
  const schema = "cict_student_test_" + randomUUID().replaceAll("-", "");
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
      ('faculty@example.test', 'FACULTY', 'x'), ('assistant@example.test', 'FACULTY', 'x'), ('existing@gmail.com', 'STUDENT', NULL);
    INSERT INTO cict_faculty ("userID", "firstName", "lastName", "canIssue") VALUES (1, 'Ana', 'Reyes', true), (2, 'Pedro', 'Cruz', false);
    INSERT INTO student ("userID", "fullName", "program") VALUES (3, 'Existing Student', 'BSCS');
    INSERT INTO student_wallet ("studentID", "studentWalletAddress") VALUES (1, '0x1111111111111111111111111111111111111111');`);
  const app = express();
  app.use(express.json({ limit: "2mb" }), cookieParser());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/api/faculty/students";
  const key = new TextEncoder().encode(process.env.SESSION_SECRET);
  const cookie = async (role = "FACULTY", userID = "2", facultyID = "2") => "cict_session=" + await new SignJWT({ role, userID, facultyID })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m").sign(key);
  const assistant = await cookie(), issuer = await cookie("FACULTY", "1", "1");
  async function request(method, suffix = "", body, session = assistant) {
    const response = await fetch(base + suffix, { method, headers: { "Content-Type": "application/json", ...(session ? { Cookie: session } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  }
  const count = async table => Number((await db.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
  const csv = 'full_name,section,program,google_account\nCSV Name,CS 3-1,BSIT,EXISTING@gmail.com\n"Reyes, Ana",IT 2-1,BSIT,ana@gmail.com\n"Reyes, Ana",IT 2-2,BSIT,ANA@GMAIL.COM';

  await t.test("rejects anonymous, student and deleted faculty sessions", async () => {
    for (const session of ["", await cookie("STUDENT", "3", "1"), await cookie("FACULTY", "999", "999")]) {
      for (const [method, suffix, body] of [["GET"], ["POST", "/import", { csv }], ["POST", "", { students: [] }], ["DELETE", "/1"]]) {
        assert.equal((await request(method, suffix, body, session)).status, 401, `${method} ${suffix}`);
      }
    }
  });

  await t.test("invalid CSV or rows create no accounts", async () => {
    const before = await count("users");
    for (const bad of ["", "full_name,program\nJuan,BSCS", "full_name,program,google_account\nJuan,BSCS,bad-email"]) {
      assert.equal((await request("POST", "/import", { csv: bad })).status, 400);
    }
    for (const students of [undefined, [], Array(501).fill({ fullName: "A", program: "B", googleAccount: "a@gmail.com" }),
      [{ fullName: " ", program: "BSCS", googleAccount: "x@gmail.com" }], [{ fullName: "A", program: "B", googleAccount: 42 }],
      [{ fullName: "A", program: "B", googleAccount: "same@gmail.com" }, { fullName: "Other", program: "B", googleAccount: "same@gmail.com" }]]) {
      assert.equal((await request("POST", "", { students })).status, 400, JSON.stringify(students)?.slice(0, 80));
    }
    assert.equal(await count("users"), before);
  });

  await t.test("bulk import creates new accounts, reuses existing ones unchanged and skips duplicates", async () => {
    const result = await request("POST", "/import", { csv });
    assert.equal(result.status, 201);
    assert.equal(result.data.created, 1); assert.equal(result.data.existing, 1); assert.equal(result.data.duplicatesSkipped, 1);
    assert.deepEqual(result.data.students.map(row => row.email).sort(), ["ana@gmail.com", "existing@gmail.com"]);
    const existing = (await db.query(`SELECT "fullName", program FROM student WHERE "studentID" = 1`)).rows[0];
    assert.deepEqual(existing, { fullName: "Existing Student", program: "BSCS" });
    assert.deepEqual((await db.query(`SELECT role, "passwordHash" FROM users WHERE email = 'ana@gmail.com'`)).rows[0], { role: "STUDENT", passwordHash: null });
    const repeat = await request("POST", "/import", { csv });
    assert.equal(repeat.data.created, 0); assert.equal(repeat.data.existing, 2);
  });

  await t.test("single and multiple JSON rows use the same rules", async () => {
    const one = await request("POST", "", { students: [{ fullName: " Juan Dela Cruz ", program: "BSCS", googleAccount: " Juan.DelaCruz@Gmail.com " }] });
    assert.equal(one.status, 201); assert.equal(one.data.created, 1);
    assert.equal((await db.query(`SELECT "fullName" FROM student s JOIN users u USING ("userID") WHERE email = 'juan.delacruz@gmail.com'`)).rows[0].fullName, "Juan Dela Cruz");
  });

  await t.test("a faculty email rejects the whole batch", async () => {
    const before = await count("users");
    const result = await request("POST", "", { students: [{ fullName: "New", program: "BSIT", googleAccount: "new@gmail.com" },
      { fullName: "Faculty", program: "BSIT", googleAccount: "faculty@example.test" }] });
    assert.equal(result.status, 409);
    assert.equal(await count("users"), before);
  });

  await t.test("an incomplete student account rejects the whole batch", async () => {
    await db.query(`INSERT INTO users (email, role) VALUES ('incomplete@gmail.com', 'STUDENT')`);
    const before = await count("users");
    const result = await request("POST", "/import", { csv: "full_name,program,google_account\nNew,BSCS,another@gmail.com\nIncomplete,BSCS,incomplete@gmail.com" });
    assert.equal(result.status, 409);
    assert.equal(await count("users"), before);
    await db.query(`DELETE FROM users WHERE email = 'incomplete@gmail.com'`);
  });

  await t.test("concurrent imports do not duplicate accounts", async () => {
    const csv = "full_name,program,google_account\nOne,BSCS,one@gmail.com\nTwo,BSCS,two@gmail.com";
    const results = await Promise.all([request("POST", "/import", { csv }), request("POST", "/import", { csv })]);
    assert.deepEqual(results.map(result => result.status), [201, 201]);
    assert.deepEqual(results.map(result => result.data.created).sort(), [0, 2]);
  });

  await t.test("database failures roll back account creation without exposing SQL errors", async subtest => {
    subtest.mock.method(console, "error", () => {});
    const before = await count("users");
    await db.query(`ALTER TABLE student ADD CONSTRAINT test_import_failure CHECK ("fullName" <> 'Reject import')`);
    try {
      const result = await request("POST", "/import", { csv: "full_name,program,google_account\nReject import,BSCS,reject@gmail.com" });
      assert.equal(result.status, 500);
      assert.doesNotMatch(result.data.error, /test_import_failure|INSERT|constraint/);
      assert.equal(await count("users"), before);
    } finally { await db.query("ALTER TABLE student DROP CONSTRAINT test_import_failure"); }
  });

  await t.test("imports more than 100 students without a cap", async () => {
    const csv = "full_name,program,google_account\n" + Array.from({ length: 101 }, (_, index) => `Student ${index},BSCS,bulk${index}@gmail.com`).join("\n");
    const result = await request("POST", "/import", { csv });
    assert.equal(result.status, 201);
    assert.equal(result.data.created, 101);
    await db.query(`DELETE FROM student WHERE "fullName" LIKE 'Student %'; DELETE FROM users WHERE email LIKE 'bulk%'`);
    await db.query(`DELETE FROM student WHERE "fullName" IN ('One', 'Two'); DELETE FROM users WHERE email IN ('one@gmail.com', 'two@gmail.com')`);
  });

  await t.test("search by name or email, with literal wildcards and removable flags", async () => {
    const all = await request("GET");
    assert.equal(all.status, 200); assert.equal(all.data.length, 3);
    assert.deepEqual((await request("GET", "?q=reyes")).data.map(row => row.email), ["ana@gmail.com"]);
    assert.deepEqual((await request("GET", "?q=DELACRUZ@")).data.map(row => row.fullName), ["Juan Dela Cruz"]);
    assert.equal((await request("GET", "?q=%25")).data.length, 0, "% is matched literally");
    const existing = all.data.find(row => row.email === "existing@gmail.com");
    assert.equal(existing.walletConnected, true); assert.equal(existing.removable, false);
    assert.equal(all.data.find(row => row.email === "ana@gmail.com").removable, true);
  });

  await t.test("removal needs canIssue and is blocked for students with a wallet or a certificate", async () => {
    const ana = (await request("GET", "?q=ana@")).data[0];
    assert.equal((await request("DELETE", "/" + ana.studentID)).status, 403);
    assert.equal((await request("DELETE", "/abc", undefined, issuer)).status, 400);
    assert.equal((await request("DELETE", "/999999", undefined, issuer)).status, 404);
    assert.equal((await request("DELETE", "/1", undefined, issuer)).status, 409, "linked wallet");
    const juan = (await request("GET", "?q=juan")).data[0];
    await db.query(`INSERT INTO seminar ("seminarTitle","seminarDate","createdBy") VALUES ('S','2026-11-09',1);
      INSERT INTO issuer_wallet ("issuerWalletAddress",label,network) VALUES ('0x2222222222222222222222222222222222222222','CICT','polygon-amoy');`);
    await db.query(`INSERT INTO seminar_registration ("seminarID","studentID",attended) VALUES (1,$1,true),(1,$2,true)`, [juan.studentID, ana.studentID]);
    await db.query(`INSERT INTO certificate ("studentID","seminarID","issuerWalletID","authorizedBy","recipientName","seminarTitle","seminarDate")
      VALUES ($1,1,1,1,'Juan','S','2026-11-09')`, [juan.studentID]);
    assert.equal((await request("DELETE", "/" + juan.studentID, undefined, issuer)).status, 409, "has a certificate");
    assert.equal((await request("DELETE", "/" + ana.studentID, undefined, issuer)).status, 204);
    assert.equal(Number((await db.query(`SELECT count(*) FROM users WHERE email = 'ana@gmail.com'`)).rows[0].count), 0);
    assert.equal(Number((await db.query(`SELECT count(*) FROM seminar_registration WHERE "studentID" = $1`, [ana.studentID])).rows[0].count), 0);
    assert.equal((await request("DELETE", "/" + ana.studentID, undefined, issuer)).status, 404);
  });
});

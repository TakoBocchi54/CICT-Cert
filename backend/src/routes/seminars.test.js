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
process.env.SESSION_SECRET = "seminar-route-test-secret-only";
const { default: router } = await import("./seminars.js");
const { pool } = await import("../db/pool.js");

test("seminar and registration HTTP endpoints with PostgreSQL", { skip: !local && "Requires local PostgreSQL; never runs against production" }, async t => {
  const schema = "cict_seminar_test_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: "-c search_path=" + schema });
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  pool.query = db.query.bind(db);
  pool.connect = db.connect.bind(db);
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await db.end();
    // This generated test schema is the only deletion target.
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    await pool.end();
  });
  const client = await db.connect();
  try {
    await client.query(await readFile(new URL("../../sql/schema.sql", import.meta.url), "utf8"));
  } finally { client.release(); }
  await db.query(`
    INSERT INTO users ("email", "role", "passwordHash") VALUES
      ('faculty@example.test', 'FACULTY', 'test-only'), ('assistant@example.test', 'FACULTY', 'test-only'), ('existing@gmail.com', 'STUDENT', NULL);
    INSERT INTO cict_faculty ("userID", "firstName", "lastName", "canIssue") VALUES (1, 'Ana', 'Reyes', true), (2, 'Pedro', 'Cruz', false);
    INSERT INTO student ("userID", "fullName", "program") VALUES (3, 'Existing Student', 'BSCS');
    INSERT INTO student_wallet ("studentID", "studentWalletAddress") VALUES (1, '0x1111111111111111111111111111111111111111');
  `);
  const app = express();
  app.use(express.json({ limit: "2mb" }), cookieParser());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/api/faculty/seminars";
  const key = new TextEncoder().encode(process.env.SESSION_SECRET);
  async function cookie(role = "FACULTY", userID = "2", facultyID = "2") {
    const token = await new SignJWT({ role, userID, facultyID }).setProtectedHeader({ alg: "HS256" })
      .setIssuedAt().setExpirationTime("5m").sign(key);
    return "cict_session=" + token;
  }
  const facultyCookie = await cookie();
  async function request(method = "GET", suffix = "", body, session = facultyCookie) {
    const response = await fetch(base + suffix, { method,
      headers: { "Content-Type": "application/json", ...(session ? { Cookie: session } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  const csv = 'full_name,section,program,google_account\nCSV Name,CS 3-1,BSIT,EXISTING@gmail.com\n"Reyes, Ana",IT 2-1,BSIT,ana@gmail.com\n"Reyes, Ana",IT 2-2,BSIT,ANA@GMAIL.COM';
  let seminarID;
  await t.test("rejects anonymous, student, and deleted faculty sessions", async () => {
    for (const session of ["", await cookie("STUDENT", "3", "1"), await cookie("FACULTY", "999", "999")]) {
      for (const [method, suffix, body] of [["GET", ""], ["POST", "", {}], ["GET", "/1/registrations"], ["POST", "/1/registrations/import", { csv }],
        ["POST", "/1/attendance/preview", { csv }], ["POST", "/1/attendance/import", { csv, previewHash: "a".repeat(64) }]]) {
        assert.equal((await request(method, suffix, body, session)).status, 401);
      }
    }
  });
  await t.test("validates titles and real calendar dates", async () => {
    for (const body of [{ seminarTitle: " ", seminarDate: "2026-11-08" }, { seminarTitle: "x".repeat(256), seminarDate: "2026-11-08" },
      ...["2026-02-30", "2026-02-29", "0000-01-01", "not-a-date", 42].map(seminarDate => ({ seminarTitle: "Seminar", seminarDate }))]) {
      assert.equal((await request("POST", "", body)).status, 400);
    }
  });
  await t.test("faculty can create a seminar without issuance permission; creator comes from the session", async () => {
    const result = await request("POST", "", { seminarTitle: "  Web Security  ", seminarDate: "2028-02-29", createdBy: "1" });
    assert.equal(result.status, 201);
    assert.equal(result.data.createdBy, "2");
    assert.equal(result.data.seminarTitle, "Web Security");
    assert.equal(result.data.seminarDate, "2028-02-29");
    seminarID = result.data.seminarID;
    const list = await request();
    assert.equal(list.headers.get("cache-control"), "no-store");
    assert.equal(list.data[0].registrationCount, 0);
  });
  await t.test("bad CSV and invalid seminar IDs create no accounts", async () => {
    const before = (await db.query("SELECT count(*) FROM users")).rows;
    for (const bad of ["", "full_name,program\nJuan,BSCS", "full_name,program,google_account\nJuan,BSCS,bad-email"]) {
      assert.equal((await request("POST", "/" + seminarID + "/registrations/import", { csv: bad })).status, 400);
    }
    for (const id of ["0", "abc", "9223372036854775808"]) {
      assert.equal((await request("GET", "/" + id + "/registrations")).status, 400);
    }
    assert.equal((await request("GET", "/999999/registrations")).status, 404);
    assert.equal((await request("POST", "/999999/registrations/import", { csv })).status, 404);
    assert.deepEqual((await db.query("SELECT count(*) FROM users")).rows, before);
  });
  await t.test("imports new students, preserves existing profiles and wallets, and skips duplicate emails", async () => {
    const result = await request("POST", "/" + seminarID + "/registrations/import", { csv });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { imported: 2, alreadyRegistered: 0, newStudents: 1, duplicatesSkipped: 1 });
    const registrations = await request("GET", "/" + seminarID + "/registrations");
    assert.equal(registrations.data.length, 2);
    const existing = registrations.data.find(row => row.email === "existing@gmail.com");
    assert.equal(existing.fullName, "Existing Student");
    assert.equal(existing.program, "BSCS");
    assert.equal(existing.walletConnected, true);
    assert.ok(registrations.data.every(row => row.attended === false));
    const added = registrations.data.find(row => row.email === "ana@gmail.com");
    assert.equal(added.walletConnected, false);
    const account = (await db.query(`SELECT "role", "passwordHash" FROM users WHERE email = 'ana@gmail.com'`)).rows[0];
    assert.deepEqual(account, { role: "STUDENT", passwordHash: null });
    const list = await request();
    assert.equal(list.data[0].registrationCount, 2);
    assert.equal(list.data[0].walletCount, 1);
  });
  await t.test("reimports are idempotent and accounts are reused across seminars", async () => {
    await db.query(`UPDATE seminar_registration SET attended = true WHERE "seminarID" = $1 AND "studentID" = 1`, [seminarID]);
    const repeat = await request("POST", "/" + seminarID + "/registrations/import", { csv });
    assert.deepEqual(repeat.data, { imported: 0, alreadyRegistered: 2, newStudents: 0, duplicatesSkipped: 1 });
    assert.equal((await db.query(`SELECT attended FROM seminar_registration WHERE "seminarID" = $1 AND "studentID" = 1`, [seminarID])).rows[0].attended, true);
    const second = await request("POST", "", { seminarTitle: "Second seminar", seminarDate: "2026-11-09" });
    const result = await request("POST", "/" + second.data.seminarID + "/registrations/import", { csv });
    assert.equal(result.data.imported, 2);
    assert.equal(result.data.newStudents, 0);
  });
  await t.test("concurrent imports do not duplicate accounts or seminar registrations", async () => {
    const concurrentCSV = "full_name,program,google_account\nOne,BSCS,one@gmail.com\nTwo,BSCS,two@gmail.com";
    const results = await Promise.all([request("POST", "/" + seminarID + "/registrations/import", { csv: concurrentCSV }), request("POST", "/" + seminarID + "/registrations/import", { csv: concurrentCSV })]);
    assert.ok(results.every(result => result.status === 200));
    assert.deepEqual(results.map(result => result.data.imported).sort(), [0, 2]);
    assert.deepEqual(results.map(result => result.data.newStudents).sort(), [0, 2]);
  });
  await t.test("faculty email conflicts roll back the entire import, including newly created accounts", async () => {
    const before = (await db.query("SELECT count(*) FROM users")).rows;
    const conflict = "full_name,program,google_account\nNew Student,BSCS,rollback@gmail.com\nFaculty,BSCS,faculty@example.test";
    const result = await request("POST", "/" + seminarID + "/registrations/import", { csv: conflict });
    assert.equal(result.status, 409);
    assert.deepEqual((await db.query("SELECT count(*) FROM users")).rows, before);
  });
  await t.test("incomplete existing student accounts require review without creating partial registrations", async () => {
    await db.query(`INSERT INTO users (email, role) VALUES ('incomplete@gmail.com', 'STUDENT')`);
    const before = (await db.query("SELECT count(*) FROM users")).rows;
    const result = await request("POST", "/" + seminarID + "/registrations/import", {
      csv: "full_name,program,google_account\nNew,BSCS,another@gmail.com\nIncomplete,BSCS,incomplete@gmail.com",
    });
    assert.equal(result.status, 409);
    assert.deepEqual((await db.query("SELECT count(*) FROM users")).rows, before);
  });
  await t.test("database failures roll back account creation without exposing SQL errors", async subtest => {
    subtest.mock.method(console, "error", () => {});
    const before = (await db.query("SELECT count(*) FROM users")).rows;
    await db.query(`ALTER TABLE student ADD CONSTRAINT test_import_failure CHECK ("fullName" <> 'Reject import')`);
    try {
      const result = await request("POST", "/" + seminarID + "/registrations/import", { csv: "full_name,program,google_account\nReject import,BSCS,reject@gmail.com" });
      assert.equal(result.status, 500);
      assert.match(result.data.error, /Please try again/);
      assert.doesNotMatch(result.data.error, /test_import_failure|INSERT|constraint/);
      assert.deepEqual((await db.query("SELECT count(*) FROM users")).rows, before);
    } finally { await db.query("ALTER TABLE student DROP CONSTRAINT test_import_failure"); }
  });
  await t.test("imports more than 100 participants without a participant cap", async () => {
    const csv = "full_name,program,google_account\n" + Array.from({ length: 101 }, (_, index) => `Student ${index},BSCS,bulk${index}@gmail.com`).join("\n");
    const result = await request("POST", "/" + seminarID + "/registrations/import", { csv });
    assert.equal(result.status, 200);
    assert.equal(result.data.imported, 101);
    assert.equal(result.data.newStudents, 101);
  });

  const attendanceSeminar = await request("POST", "", { seminarTitle: "Attendance test", seminarDate: "2026-11-15" });
  const attendanceID = attendanceSeminar.data.seminarID;
  await request("POST", "/" + attendanceID + "/registrations/import", { csv });
  const attendanceCSV = 'full_name,section,program,student_id,google_account\nWrong Name,Other,Other,999,EXISTING@gmail.com\nAnother,Other,Other,888,ana@gmail.com\nDuplicate,Other,Other,777,ANA@gmail.com';
  const previewAttendance = csv => request("POST", "/" + attendanceID + "/attendance/preview", { csv });
  const saveAttendance = (csv, previewHash) => request("POST", "/" + attendanceID + "/attendance/import", { csv, previewHash });
  const savedAttendance = async () => (await db.query(`SELECT "studentID", "attended" FROM seminar_registration WHERE "seminarID" = $1 ORDER BY "studentID"`, [attendanceID])).rows;

  await t.test("attendance preview matches Google emails without changing profiles, accounts, or attendance", async () => {
    const before = await savedAttendance();
    const preview = await previewAttendance(attendanceCSV);
    assert.equal(preview.status, 200);
    assert.equal(preview.data.matched.length, 2);
    assert.equal(preview.data.matched.find(row => row.email === "existing@gmail.com").fullName, "Existing Student");
    assert.deepEqual(preview.data.unmatched, []);
    assert.equal(preview.data.duplicatesSkipped, 1);
    assert.equal(preview.data.awaitingWallet, 1);
    assert.equal(preview.data.newlyAttended, 2);
    assert.equal(preview.data.canSave, true);
    assert.deepEqual(await savedAttendance(), before);
    assert.match(preview.data.previewHash, /^[0-9a-f]{64}$/);
  });
  await t.test("attendance requires a reviewed file and rejects empty or malformed lists", async () => {
    assert.equal((await saveAttendance(attendanceCSV)).status, 400);
    assert.equal((await saveAttendance(attendanceCSV, {})).status, 400);
    for (const csv of ["google_account", "student_id\n1234", "google_account\nnot-an-email"]) {
      assert.equal((await previewAttendance(csv)).status, 400);
    }
    assert.equal((await request("POST", "/999999/attendance/preview", { csv: attendanceCSV })).status, 404);
    assert.equal((await request("POST", "/0/attendance/preview", { csv: attendanceCSV })).status, 400);
  });
  await t.test("confirmed attendance includes registered students without wallets and leaves other seminars unchanged", async () => {
    const otherSeminars = (await db.query(`SELECT "seminarID", "studentID", "attended" FROM seminar_registration WHERE "seminarID" <> $1 ORDER BY "seminarID", "studentID"`, [attendanceID])).rows;
    const preview = await previewAttendance(attendanceCSV);
    const result = await saveAttendance(attendanceCSV, preview.data.previewHash);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { attended: 2, markedAttended: 2, markedAbsent: 0, awaitingWallet: 1, duplicatesSkipped: 1 });
    assert.ok((await savedAttendance()).every(row => row.attended));
    assert.deepEqual((await db.query(`SELECT "seminarID", "studentID", "attended" FROM seminar_registration WHERE "seminarID" <> $1 ORDER BY "seminarID", "studentID"`, [attendanceID])).rows, otherSeminars);
    const list = await request();
    assert.equal(list.data.find(row => row.seminarID === attendanceID).attendanceCount, 2);
  });
  await t.test("unmatched emails block the entire save and never create accounts or registrations", async () => {
    const before = await savedAttendance();
    const accounts = (await db.query("SELECT count(*) FROM users")).rows;
    // one@gmail.com exists in the system, but is registered only for another seminar.
    const csv = "google_account\nexisting@gmail.com\nmissing@gmail.com\none@gmail.com";
    const preview = await previewAttendance(csv);
    assert.deepEqual(preview.data.unmatched, ["missing@gmail.com", "one@gmail.com"]);
    assert.equal(preview.data.canSave, false);
    const result = await saveAttendance(csv, preview.data.previewHash);
    assert.equal(result.status, 409);
    assert.deepEqual(await savedAttendance(), before);
    assert.deepEqual((await db.query("SELECT count(*) FROM users")).rows, accounts);
  });
  await t.test("a corrected final list clears omitted attendance, and repeated review/save is idempotent", async () => {
    const csv = "google_account\nexisting@gmail.com";
    const preview = await previewAttendance(csv);
    assert.equal(preview.data.removed.length, 1);
    assert.equal(preview.data.removed[0].email, "ana@gmail.com");
    const result = await saveAttendance(csv, preview.data.previewHash);
    assert.equal(result.status, 200);
    assert.equal(result.data.attended, 1);
    assert.equal(result.data.markedAbsent, 1);
    const repeat = await previewAttendance(csv);
    const saved = await saveAttendance(csv, repeat.data.previewHash);
    assert.equal(saved.data.markedAttended, 0);
    assert.equal(saved.data.markedAbsent, 0);
  });
  await t.test("a changed CSV or intervening registration makes the old review stale", async () => {
    const csv = "google_account\nexisting@gmail.com";
    const preview = await previewAttendance(csv);
    const before = await savedAttendance();
    assert.equal((await saveAttendance("google_account\nana@gmail.com", preview.data.previewHash)).status, 409);
    assert.deepEqual(await savedAttendance(), before);
    await request("POST", "/" + attendanceID + "/registrations/import", { csv: "full_name,program,google_account\nOne,BSCS,one@gmail.com" });
    assert.equal((await saveAttendance(csv, preview.data.previewHash)).status, 409);
    assert.equal((await savedAttendance()).filter(row => row.attended).length, 1);
  });
  await t.test("concurrent confirmations of different lists cannot silently overwrite each other", async () => {
    const first = "google_account\nana@gmail.com";
    const second = "google_account\none@gmail.com";
    const previews = await Promise.all([previewAttendance(first), previewAttendance(second)]);
    const results = await Promise.all([saveAttendance(first, previews[0].data.previewHash), saveAttendance(second, previews[1].data.previewHash)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  });
  await t.test("a database failure rolls back the entire attendance change", async subtest => {
    subtest.mock.method(console, "error", () => {});
    const csv = "google_account\nexisting@gmail.com";
    const before = await savedAttendance();
    // Existing Student is currently absent after either concurrent winner above.
    await db.query(`ALTER TABLE seminar_registration ADD CONSTRAINT test_attendance_failure CHECK (NOT ("seminarID" = ${attendanceID} AND "studentID" = 1 AND "attended"))`);
    try {
      const preview = await previewAttendance(csv);
      assert.equal((await saveAttendance(csv, preview.data.previewHash)).status, 500);
      assert.deepEqual(await savedAttendance(), before);
    } finally { await db.query("ALTER TABLE seminar_registration DROP CONSTRAINT test_attendance_failure"); }
  });
  await t.test("issued certificates and unresolved mint attempts prevent clearing attendance", async () => {
    const all = await previewAttendance(attendanceCSV);
    assert.equal((await saveAttendance(attendanceCSV, all.data.previewHash)).status, 200);
    await db.query(`INSERT INTO issuer_wallet ("issuerWalletAddress", label, network) VALUES ('0x3333333333333333333333333333333333333333', 'CICT', 'polygon-amoy')`);
    const { rows: [issued] } = await db.query(`INSERT INTO certificate ("studentID", "seminarID", "studentWalletID", "authorizedBy", "issuerWalletID", "recipientName", "seminarTitle", "seminarDate", "certificateHash", "consentMessage", "consentSignature", "consentedAt", "issuedAt", status)
      VALUES (1, $1, 1, 1, 1, 'Existing Student', 'Attendance test', '2026-11-15', $2, 'Test certificate approval', 'test-only signature evidence', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'ISSUED') RETURNING "certificateID"`, [attendanceID, "0x" + "a".repeat(64)]);
    const withoutIssued = "google_account\nana@gmail.com";
    const preview = await previewAttendance(withoutIssued);
    assert.equal(preview.data.blocked[0].email, "existing@gmail.com");
    assert.equal(preview.data.canSave, false);
    assert.equal((await saveAttendance(withoutIssued, preview.data.previewHash)).status, 409);
    await db.query(`UPDATE certificate SET status = 'REVOKED', "revokedAt" = CURRENT_TIMESTAMP WHERE "certificateID" = $1`, [issued.certificateID]);
    const { rows: [pending] } = await db.query(`INSERT INTO certificate ("studentID", "seminarID", "issuerWalletID", "recipientName", "seminarTitle", "seminarDate") VALUES (1, $1, 1, 'Existing Student', 'Attendance test', '2026-11-15') RETURNING "certificateID"`, [attendanceID]);
    await db.query(`INSERT INTO blockchain_record ("certificateID", "transactionType", "requestedBy", network, "transactionStatus") VALUES ($1, 'MINT', 1, 'polygon-amoy', 'PENDING')`, [pending.certificateID]);
    const inFlight = await previewAttendance(withoutIssued);
    assert.equal(inFlight.data.blocked.length, 1);
    assert.equal((await saveAttendance(withoutIssued, inFlight.data.previewHash)).status, 409);
    await db.query(`UPDATE blockchain_record SET "transactionStatus" = 'CONFIRMED', "transactionHash" = $1, "tokenID" = 1, "blockNum" = 123 WHERE "certificateID" = $2`, ["0x" + "b".repeat(64), pending.certificateID]);
    const unreconciled = await previewAttendance(withoutIssued);
    assert.equal(unreconciled.data.canSave, false);
    assert.equal((await saveAttendance(withoutIssued, unreconciled.data.previewHash)).status, 409);
    assert.equal((await savedAttendance()).filter(row => row.attended).length, 2);
  });
});

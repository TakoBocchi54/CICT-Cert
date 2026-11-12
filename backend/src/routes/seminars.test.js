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

test("seminar and attendance HTTP endpoints with PostgreSQL", { skip: !local && "Requires local PostgreSQL; never runs against production" }, async t => {
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
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null, headers: response.headers };
  }
  // Student accounts exist independently of seminars (registered in the Students tab).
  await db.query(`
    INSERT INTO users ("email", "role") VALUES ('ana@gmail.com', 'STUDENT'), ('one@gmail.com', 'STUDENT'), ('juan.delacruz@gmail.com', 'STUDENT'), ('incomplete@gmail.com', 'STUDENT');
    INSERT INTO student ("userID", "fullName", "program") VALUES (4, 'Reyes, Ana', 'BSIT'), (5, 'One', 'BSCS'), (6, 'Juan  Dela Cruz', 'BSCS');`);
  let seminarID;
  await t.test("rejects anonymous, student, and deleted faculty sessions", async () => {
    const csv = "google_account\nana@gmail.com";
    for (const session of ["", await cookie("STUDENT", "3", "1"), await cookie("FACULTY", "999", "999")]) {
      for (const [method, suffix, body] of [["GET", ""], ["POST", "", {}], ["GET", "/1/registrations"],
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
  await t.test("invalid or unknown seminar IDs are rejected", async () => {
    for (const id of ["0", "abc", "9223372036854775808"]) {
      assert.equal((await request("GET", "/" + id + "/registrations")).status, 400);
    }
    assert.equal((await request("GET", "/999999/registrations")).status, 404);
    assert.equal((await request("GET", "/" + seminarID + "/registrations")).data.length, 0);
  });
  await t.test("a mistaken seminar can be corrected by any faculty and deleted with issuance permission before certificates exist", async () => {
    const issuerCookie = await cookie("FACULTY", "1", "1");
    assert.equal((await request("PATCH", "/" + seminarID, { seminarTitle: "Fixed", seminarDate: "2026-11-08" }, "")).status, 401);
    for (const body of [{ seminarTitle: " ", seminarDate: "2026-11-08" }, { seminarTitle: "Fixed", seminarDate: "2026-02-30" }]) {
      assert.equal((await request("PATCH", "/" + seminarID, body)).status, 400);
    }
    assert.equal((await request("PATCH", "/999999", { seminarTitle: "Fixed", seminarDate: "2026-11-08" })).status, 404);
    const edited = await request("PATCH", "/" + seminarID, { seminarTitle: "  Web Security 101 ", seminarDate: "2026-11-09" });
    assert.equal(edited.status, 200);
    assert.deepEqual([edited.data.seminarTitle, edited.data.seminarDate], ["Web Security 101", "2026-11-09"]);
    const listed = (await request()).data.find(row => row.seminarID === seminarID);
    assert.deepEqual([listed.seminarTitle, listed.certificateCount], ["Web Security 101", 0]);

    const mistake = (await request("POST", "", { seminarTitle: "Wrong seminar", seminarDate: "2026-11-10" })).data.seminarID;
    await db.query(`INSERT INTO seminar_registration ("seminarID", "studentID", attended) VALUES ($1, 2, true)`, [mistake]);
    const students = (await db.query("SELECT count(*) FROM student")).rows[0].count;
    assert.equal((await request("DELETE", "/" + mistake)).status, 403);
    assert.equal((await request("DELETE", "/" + mistake, undefined, issuerCookie)).status, 204);
    assert.equal((await db.query(`SELECT count(*) FROM seminar_registration WHERE "seminarID" = $1`, [mistake])).rows[0].count, "0");
    assert.equal((await db.query("SELECT count(*) FROM student")).rows[0].count, students);
    assert.equal((await request("DELETE", "/" + mistake, undefined, issuerCookie)).status, 404);
  });
  await t.test("a seminar can choose a certificate template; edits keep it unless templateID is sent", async () => {
    const templateID = (await db.query(`INSERT INTO certificate_template ("name", "image", "imageType", "imageWidth", "imageHeight", "fields", "createdBy")
      VALUES ('Gold', decode('00', 'hex'), 'image/png', 1754, 1240, '{}', 1) RETURNING "templateID"::text`)).rows[0].templateID;
    for (const bad of [42, "abc", "0"]) {
      assert.equal((await request("POST", "", { seminarTitle: "Designed", seminarDate: "2026-11-12", templateID: bad })).status, 400);
    }
    assert.match((await request("POST", "", { seminarTitle: "Designed", seminarDate: "2026-11-12", templateID: "999" })).data.error, /no longer exists/);
    const created = await request("POST", "", { seminarTitle: "Designed", seminarDate: "2026-11-12", templateID });
    assert.equal(created.status, 201);
    assert.equal(created.data.templateID, templateID);
    const id = created.data.seminarID;
    assert.equal((await request("PATCH", "/" + id, { seminarTitle: "Designed 2", seminarDate: "2026-11-12" })).data.templateID, templateID);
    assert.equal((await request("PATCH", "/" + id, { seminarTitle: "Designed 2", seminarDate: "2026-11-12", templateID: "999" })).status, 400);
    const listed = (await request()).data.find(row => row.seminarID === id);
    assert.deepEqual([listed.templateID, listed.templateName], [templateID, "Gold"]);
    assert.equal((await request("PATCH", "/" + id, { seminarTitle: "Designed 2", seminarDate: "2026-11-12", templateID: null })).data.templateID, null);
    assert.equal((await request("POST", "", { seminarTitle: "Plain", seminarDate: "2026-11-12" })).data.templateID, null);
  });

  const attendanceSeminar = await request("POST", "", { seminarTitle: "Attendance test", seminarDate: "2026-11-15" });
  const attendanceID = attendanceSeminar.data.seminarID;
  const attendanceCSV = 'full_name,section,program,student_id,google_account\nWrong Name,Other,Other,999,EXISTING@gmail.com\nAnother,Other,Other,888,ana@gmail.com\nDuplicate,Other,Other,777,ANA@gmail.com';
  const previewAttendance = (csv, aliases) => request("POST", "/" + attendanceID + "/attendance/preview", { csv, aliases });
  const saveAttendance = (csv, previewHash, aliases) => request("POST", "/" + attendanceID + "/attendance/import", { csv, previewHash, aliases });
  const savedAttendance = async () => (await db.query(`SELECT "studentID", "attended" FROM seminar_registration WHERE "seminarID" = $1 ORDER BY "studentID"`, [attendanceID])).rows;
  const userCount = async () => (await db.query("SELECT count(*) FROM users")).rows[0].count;

  await t.test("attendance preview matches any student account without changing profiles, accounts, or attendance", async () => {
    const preview = await previewAttendance(attendanceCSV);
    assert.equal(preview.status, 200);
    assert.equal(preview.data.matched.length, 2);
    assert.equal(preview.data.matched.find(row => row.email === "existing@gmail.com").fullName, "Existing Student");
    assert.deepEqual(preview.data.unregistered, []);
    assert.deepEqual(preview.data.facultyEmails, []);
    assert.equal(preview.data.duplicatesSkipped, 1);
    assert.equal(preview.data.awaitingWallet, 1);
    assert.equal(preview.data.newlyAttended, 2);
    assert.equal(preview.data.canSave, true);
    assert.deepEqual(await savedAttendance(), [], "preview creates no seminar rows");
    assert.match(preview.data.previewHash, /^[0-9a-f]{64}$/);
  });
  await t.test("attendance requires a reviewed file and rejects empty or malformed lists and aliases", async () => {
    assert.equal((await saveAttendance(attendanceCSV)).status, 400);
    assert.equal((await saveAttendance(attendanceCSV, {})).status, 400);
    for (const csv of ["google_account", "student_id\n1234", "google_account\nnot-an-email"]) {
      assert.equal((await previewAttendance(csv)).status, 400);
    }
    for (const aliases of [["ana@gmail.com"], "x", { "notlisted@gmail.com": "ana@gmail.com" }, { "ana@gmail.com": "not-an-email" }]) {
      assert.equal((await previewAttendance(attendanceCSV, aliases)).status, 400, JSON.stringify(aliases));
    }
    assert.equal((await request("POST", "/999999/attendance/preview", { csv: attendanceCSV })).status, 404);
    assert.equal((await request("POST", "/0/attendance/preview", { csv: attendanceCSV })).status, 400);
  });
  await t.test("confirming creates attended rows for accounts never linked to the seminar and leaves other seminars unchanged", async () => {
    await db.query(`INSERT INTO seminar_registration ("seminarID", "studentID", "attended") VALUES ($1, 1, true), ($1, 2, false)`, [seminarID]);
    const otherSeminars = (await db.query(`SELECT "seminarID", "studentID", "attended" FROM seminar_registration WHERE "seminarID" <> $1 ORDER BY "seminarID", "studentID"`, [attendanceID])).rows;
    const preview = await previewAttendance(attendanceCSV);
    const result = await saveAttendance(attendanceCSV, preview.data.previewHash);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { attended: 2, markedAttended: 2, markedAbsent: 0, awaitingWallet: 1, duplicatesSkipped: 1 });
    assert.deepEqual(await savedAttendance(), [{ studentID: "1", attended: true }, { studentID: "2", attended: true }]);
    assert.deepEqual((await db.query(`SELECT "seminarID", "studentID", "attended" FROM seminar_registration WHERE "seminarID" <> $1 ORDER BY "seminarID", "studentID"`, [attendanceID])).rows, otherSeminars);
    const list = await request();
    assert.equal(list.data.find(row => row.seminarID === attendanceID).attendanceCount, 2);
    assert.equal((await request("GET", "/" + attendanceID + "/registrations")).data.length, 2);
  });
  await t.test("unregistered and faculty emails are split out, with hints and suggestions, and block the save", async () => {
    const before = await savedAttendance(), accounts = await userCount();
    const csv = "full_name,program,google_account\nNew Person,BSIT,new@gmail.com\nX,Y,juan.delacruz@gmial.com\n juan dela  CRUZ ,BSCS,jdc@yahoo.com\nZ,Y,faculty@example.test\nI,Y,incomplete@gmail.com\nE,Y,existing@gmail.com";
    const preview = await previewAttendance(csv);
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.data.facultyEmails, ["faculty@example.test"]);
    const byEmail = Object.fromEntries(preview.data.unregistered.map(row => [row.email, row]));
    assert.deepEqual(Object.keys(byEmail).sort(), ["incomplete@gmail.com", "jdc@yahoo.com", "juan.delacruz@gmial.com", "new@gmail.com"]);
    assert.deepEqual([byEmail["new@gmail.com"].fullName, byEmail["new@gmail.com"].program, byEmail["new@gmail.com"].suggestions], ["New Person", "BSIT", []]);
    assert.deepEqual(byEmail["juan.delacruz@gmial.com"].suggestions.map(row => row.email), ["juan.delacruz@gmail.com"], "domain typo");
    assert.deepEqual(byEmail["jdc@yahoo.com"].suggestions.map(row => row.email), ["juan.delacruz@gmail.com"], "same name");
    assert.equal(preview.data.unregistered.length + preview.data.facultyEmails.length, 5);
    assert.equal(preview.data.canSave, false);
    const result = await saveAttendance(csv, preview.data.previewHash);
    assert.equal(result.status, 409);
    assert.deepEqual(await savedAttendance(), before);
    assert.equal(await userCount(), accounts);
  });
  await t.test("aliases map a listed email to an existing account and are validated on every request", async () => {
    const csv = "google_account\nexisting@gmail.com\nana@gmail.com\njuan.delacruz@gmial.com";
    const aliases = { "JUAN.DELACRUZ@gmial.com": "juan.delacruz@gmail.com" };
    const preview = await previewAttendance(csv, aliases);
    assert.equal(preview.data.canSave, true);
    const juan = preview.data.matched.find(row => row.email === "juan.delacruz@gmail.com");
    assert.equal(juan.listedAs, "juan.delacruz@gmial.com");
    assert.equal((await saveAttendance(csv, preview.data.previewHash)).status, 409, "the hash covers aliases");
    assert.equal((await saveAttendance(csv, preview.data.previewHash, aliases)).status, 200);
    assert.equal((await savedAttendance()).filter(row => row.attended).length, 3);
    assert.equal((await previewAttendance(csv, { "juan.delacruz@gmial.com": "faculty@example.test" })).status, 409, "alias to a non-student");
    assert.equal((await previewAttendance(csv, { "ana@gmail.com": "one@gmail.com" })).status, 409, "listed email already has an account");
  });
  await t.test("registering a listed student after the review makes the old review stale", async () => {
    const csv = "full_name,program,google_account\nLate,BSIT,late@gmail.com\nE,Y,existing@gmail.com";
    const preview = await previewAttendance(csv);
    assert.equal(preview.data.canSave, false);
    await db.query(`WITH u AS (INSERT INTO users (email, role) VALUES ('late@gmail.com', 'STUDENT') RETURNING "userID")
      INSERT INTO student ("userID", "fullName", "program") SELECT "userID", 'Late', 'BSIT' FROM u`);
    const stale = await saveAttendance(csv, preview.data.previewHash);
    assert.equal(stale.status, 409);
    assert.match(stale.data.error, /changed since your review/);
    const fresh = await previewAttendance(csv);
    assert.equal(fresh.data.canSave, true);
  });
  await t.test("a corrected final list clears omitted attendance, and repeated review/save is idempotent", async () => {
    const csv = "google_account\nexisting@gmail.com";
    const preview = await previewAttendance(csv);
    assert.deepEqual(preview.data.removed.map(row => row.email).sort(), ["ana@gmail.com", "juan.delacruz@gmail.com"]);
    const result = await saveAttendance(csv, preview.data.previewHash);
    assert.equal(result.status, 200);
    assert.equal(result.data.attended, 1);
    assert.equal(result.data.markedAbsent, 2);
    const repeat = await previewAttendance(csv);
    const saved = await saveAttendance(csv, repeat.data.previewHash);
    assert.equal(saved.data.markedAttended, 0);
    assert.equal(saved.data.markedAbsent, 0);
  });
  await t.test("a changed CSV makes the old review stale", async () => {
    const preview = await previewAttendance("google_account\nexisting@gmail.com");
    const before = await savedAttendance();
    assert.equal((await saveAttendance("google_account\nana@gmail.com", preview.data.previewHash)).status, 409);
    assert.deepEqual(await savedAttendance(), before);
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
      const result = await saveAttendance(csv, preview.data.previewHash);
      assert.equal(result.status, 500);
      assert.doesNotMatch(result.data.error, /test_attendance_failure|constraint/);
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
  await t.test("a seminar with certificates can no longer be edited or deleted", async () => {
    const issuerCookie = await cookie("FACULTY", "1", "1");
    assert.equal((await request("PATCH", "/" + attendanceID, { seminarTitle: "Renamed", seminarDate: "2026-11-15" })).status, 409);
    assert.equal((await request("DELETE", "/" + attendanceID, undefined, issuerCookie)).status, 409);
    const listed = (await request()).data.find(row => row.seminarID === attendanceID);
    assert.equal(listed.seminarTitle, "Attendance test");
    assert.ok(listed.certificateCount >= 2);
  });
});

import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import express from "express";
import cookieParser from "cookie-parser";
import pg from "pg";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";

const local = process.env.DATABASE_URL && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname);
process.env.SESSION_SECRET = "faculty-members-test-secret-only";
const { default: memberRouter, temporaryPassword } = await import("./facultyMembers.js");
const { default: authRouter } = await import("./facultyAuth.js");
const { default: accountRouter } = await import("./facultyAccount.js");
const { default: studentRouter } = await import("./students.js");
const { auditLog } = await import("../middleware/auditLog.js");
const { pool } = await import("../db/pool.js");

test("temporary passwords are long, grouped and avoid look-alike characters", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const password = temporaryPassword();
    assert.match(password, /^[A-HJ-NP-Za-km-z2-9]{4}(-[A-HJ-NP-Za-km-z2-9]{4}){3}$/);
    seen.add(password);
  }
  assert.equal(seen.size, 200);
});

test("faculty account management with PostgreSQL", { skip: !local && "Requires local PostgreSQL; never runs against production" }, async t => {
  const schema = "cict_members_test_" + randomUUID().replaceAll("-", "");
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
  const hash = await bcrypt.hash("admin-password-123", 4);
  await db.query(`
    INSERT INTO users ("email", "role", "passwordHash") VALUES ('ana@example.test', 'FACULTY', $1), ('ben@example.test', 'FACULTY', $1), ('maria@gmail.com', 'STUDENT', NULL);
    INSERT INTO cict_faculty ("userID", "firstName", "lastName", "canIssue") VALUES (1, 'Ana', 'Reyes', true), (2, 'Ben', 'Santos', true);`
    .replaceAll("$1", `'${hash}'`));
  const app = express();
  app.set("trust proxy", 1); // so a test can send each login from a different X-Forwarded-For address
  app.use(express.json(), cookieParser(), auditLog);
  app.use("/api", memberRouter, authRouter, accountRouter, studentRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/api";
  const key = new TextEncoder().encode(process.env.SESSION_SECRET);
  const cookie = async (userID, facultyID, role = "FACULTY") => "cict_session=" + await new SignJWT({ role, userID: String(userID), facultyID: String(facultyID) })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m").sign(key);
  const ana = await cookie(1, 1), ben = await cookie(2, 2);
  const request = async (method, path, body, session = ana) => {
    const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(session ? { Cookie: session } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json().catch(() => null), cookie: response.headers.get("set-cookie") };
  };
  const login = (email, password) => request("POST", "/auth/faculty/login", { email, password }, "");
  let helper;

  await t.test("adding an organizer returns a working temporary password, stored only as a hash", async () => {
    const added = await request("POST", "/faculty/members", { firstName: "  Juan ", lastName: "Dela  Cruz", email: " Juan@UB.edu.ph " });
    assert.equal(added.status, 201);
    helper = added.data.member;
    assert.deepEqual([helper.firstName, helper.lastName, helper.email, helper.canIssue, helper.temporaryPassword, helper.deactivatedAt],
      ["Juan", "Dela Cruz", "juan@ub.edu.ph", false, true, null], "helpers get no issuing permission unless asked");
    const stored = (await db.query(`SELECT "passwordHash" FROM users WHERE email = 'juan@ub.edu.ph'`)).rows[0].passwordHash;
    assert.notEqual(stored, added.data.temporaryPassword);
    assert.equal((await login("juan@ub.edu.ph", added.data.temporaryPassword)).status, 200);
    helper.password = added.data.temporaryPassword;
    helper.userID = (await db.query(`SELECT "userID" FROM users WHERE email = 'juan@ub.edu.ph'`)).rows[0].userID;
  });

  await t.test("bad input and duplicate emails (faculty or student) are refused", async () => {
    for (const body of [{ firstName: "", lastName: "X", email: "x@ub.edu.ph" }, { firstName: "A", lastName: "B", email: "not-an-email" },
      { firstName: "A", lastName: "B", email: "y@ub.edu.ph", canIssue: "yes" }]) {
      assert.equal((await request("POST", "/faculty/members", body)).status, 400);
    }
    assert.equal((await request("POST", "/faculty/members", { firstName: "A", lastName: "B", email: "ANA@example.test" })).status, 409);
    assert.equal((await request("POST", "/faculty/members", { firstName: "A", lastName: "B", email: "maria@gmail.com" })).status, 409);
  });

  await t.test("only active faculty with issuing permission can manage accounts", async () => {
    const helperCookie = await cookie(helper.userID, helper.facultyID);
    for (const session of ["", helperCookie, await cookie(3, 1, "STUDENT")]) {
      assert.ok([401, 403].includes((await request("GET", "/faculty/members", undefined, session)).status));
    }
    const list = await request("GET", "/faculty/members");
    assert.equal(list.status, 200);
    assert.deepEqual(list.data.map(row => row.email), ["juan@ub.edu.ph", "ana@example.test", "ben@example.test"]);
    assert.equal(list.data.some(row => "passwordHash" in row), false);
  });

  await t.test("nobody can demote or deactivate themselves", async () => {
    assert.equal((await request("PATCH", "/faculty/members/1", { canIssue: false })).status, 409);
    assert.equal((await request("PATCH", "/faculty/members/1", { active: false })).status, 409);
    assert.equal((await request("POST", "/faculty/members/1/reset-password")).status, 409);
    assert.equal((await request("PATCH", "/faculty/members/1", {})).status, 400);
    assert.equal((await request("PATCH", "/faculty/members/999", { active: false })).status, 404);
  });

  await t.test("two administrators demoting each other at once leave one in charge", async () => {
    const results = await Promise.all([request("PATCH", "/faculty/members/2", { canIssue: false }, ana), request("PATCH", "/faculty/members/1", { canIssue: false }, ben)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 403]);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM cict_faculty WHERE "canIssue" AND "deactivatedAt" IS NULL`);
    assert.equal(rows[0].n, 1);
    await db.query(`UPDATE cict_faculty SET "canIssue" = true WHERE "facultyID" IN (1, 2)`);
  });

  await t.test("deactivating blocks sign-in and an open session at once; reactivating restores it", async () => {
    const helperCookie = await cookie(helper.userID, helper.facultyID);
    assert.equal((await request("GET", "/faculty/students", undefined, helperCookie)).status, 200);
    const off = await request("PATCH", `/faculty/members/${helper.facultyID}`, { active: false });
    assert.equal(off.status, 200);
    assert.ok(off.data.deactivatedAt);
    assert.equal((await request("GET", "/faculty/students", undefined, helperCookie)).status, 401);
    assert.equal((await request("GET", "/faculty/account", undefined, helperCookie)).status, 401);
    assert.equal((await request("GET", "/auth/faculty/me", undefined, helperCookie)).status, 401);
    const refused = await login("juan@ub.edu.ph", helper.password);
    assert.deepEqual([refused.status, refused.data.error], [401, "Invalid email or password"], "same answer as a wrong password");
    assert.equal((await request("PATCH", `/faculty/members/${helper.facultyID}`, { active: true })).status, 200);
    assert.equal((await login("juan@ub.edu.ph", helper.password)).status, 200);
  });

  await t.test("a reset replaces the old password; the owner setting their own clears the temporary flag", async () => {
    const reset = await request("POST", `/faculty/members/${helper.facultyID}/reset-password`);
    assert.equal(reset.status, 200);
    assert.equal((await login("juan@ub.edu.ph", helper.password)).status, 401);
    assert.equal((await login("juan@ub.edu.ph", reset.data.temporaryPassword)).status, 200);
    const helperCookie = await cookie(helper.userID, helper.facultyID);
    assert.equal((await request("GET", "/faculty/account", undefined, helperCookie)).data.temporaryPassword, true);
    const own = "my-own-long-password";
    const changed = await request("POST", "/faculty/account/password",
      { currentPassword: reset.data.temporaryPassword, newPassword: own, confirmPassword: own }, helperCookie);
    assert.equal(changed.status, 200);
    assert.equal((await request("GET", "/faculty/account", undefined, helperCookie)).data.temporaryPassword, false);
    assert.equal((await request("POST", "/faculty/members/999/reset-password")).status, 404);
  });

  await t.test("the audit log records these changes but never a password", async () => {
    await new Promise(resolve => setTimeout(resolve, 150)); // entries are written just after each response
    const { rows } = await db.query(`SELECT "action", "details"::text AS details FROM audit_log ORDER BY "auditID"`);
    const actions = rows.map(row => row.action);
    assert.ok(actions.includes("POST /faculty/members"));
    assert.ok(actions.includes("PATCH /faculty/members/:id"));
    assert.ok(actions.includes("POST /faculty/members/:id/reset-password"));
    assert.ok(actions.includes("POST /faculty/account/password"));
    const everything = rows.map(row => row.details).join(" ");
    assert.doesNotMatch(everything, /password/i);
    assert.match(everything, /juan@ub\.edu\.ph/i, "the email as typed in the request");
  });

  await t.test("guessing one account's password from ever-new IPs stops after 20 failures; other accounts still sign in", async () => {
    let ip = 0;
    const loginFrom = (email, password) => fetch(base + "/auth/faculty/login", { method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": `198.51.100.${++ip}` }, body: JSON.stringify({ email, password }) });
    for (let i = 0; i < 20; i++) assert.equal((await loginFrom("ana@example.test", "wrong-guess-" + i)).status, 401);
    assert.equal((await loginFrom("ANA@example.test ", "wrong-guess")).status, 429, "the account is keyed by its normalized email");
    assert.equal((await loginFrom("ben@example.test", "admin-password-123")).status, 200);
  });
});

import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import express from "express";
import cookieParser from "cookie-parser";
import pg from "pg";
import { generateKeyPair, exportJWK, SignJWT } from "jose";

const local = process.env.DATABASE_URL && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname);

test("students register through the seminar link", { skip: !local && "Requires local PostgreSQL; never runs against production" }, async t => {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = { ...await exportJWK(publicKey), kid: "local-test", alg: "ES256" };
  const jwksServer = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ keys: [jwk] }));
  }).listen(0, "127.0.0.1");
  await new Promise(resolve => jwksServer.once("listening", resolve));
  process.env.SESSION_SECRET = "registration-route-test-secret-only";
  process.env.WEB3AUTH_CLIENT_ID = "local-test-client";
  process.env.WEB3AUTH_ISSUER = "https://identity.example.test";
  process.env.WEB3AUTH_JWKS_URL = `http://127.0.0.1:${jwksServer.address().port}/jwks`;
  const [{ default: registration }, { default: studentAuth }, { pool }] = await Promise.all([
    import("./registration.js"), import("./studentAuth.js"), import("../db/pool.js")]);

  const schema = "cict_registration_test_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: "-c search_path=" + schema });
  const originalQuery = pool.query, originalConnect = pool.connect;
  pool.query = db.query.bind(db);
  pool.connect = db.connect.bind(db);
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => jwksServer.close(resolve));
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
  const { rows: [open, closed, expired] } = await db.query(`
    WITH f AS (INSERT INTO users ("email", "role", "passwordHash") VALUES ('faculty@example.test', 'FACULTY', 'test-only') RETURNING "userID"),
         c AS (INSERT INTO cict_faculty ("userID", "firstName", "lastName") SELECT "userID", 'Ana', 'Reyes' FROM f RETURNING "facultyID")
    INSERT INTO seminar ("seminarTitle", "seminarDate", "createdBy", "venue", "registrationClosesAt")
    SELECT title, '2026-12-01', c."facultyID", venue, closes FROM c, (VALUES
      ('Open seminar', 'AVR', now() + interval '1 hour'), ('Never opened', NULL, NULL), ('Past deadline', NULL, now() - interval '1 minute')
    ) AS v(title, venue, closes) RETURNING "registrationToken"`);
  await db.query(`INSERT INTO users ("email", "role") VALUES ('existing@gmail.com', 'STUDENT');
    INSERT INTO student ("userID", "fullName", "program") SELECT "userID", 'Old Name', 'BSCS' FROM users WHERE "email" = 'existing@gmail.com';`);

  const app = express();
  app.use(express.json(), cookieParser());
  app.use("/api", registration, studentAuth);
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/api";
  const idToken = email => new SignJWT({ email }).setProtectedHeader({ alg: "ES256", kid: "local-test" })
    .setIssuer(process.env.WEB3AUTH_ISSUER).setAudience(process.env.WEB3AUTH_CLIENT_ID)
    .setIssuedAt().setExpirationTime("5m").sign(privateKey);
  async function call(method, token, email, body) {
    const response = await fetch(`${base}/register/${token}`, { method,
      headers: { "Content-Type": "application/json", ...(email ? { Authorization: "Bearer " + await idToken(email) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie") };
  }
  const login = async email => (await fetch(`${base}/auth/student/session`, { method: "POST",
    headers: { Authorization: "Bearer " + await idToken(email) } })).status;
  const profile = { fullName: "  Maria  Santos ", program: "BSIT", contactNumber: "+63 (917) 123-4567" };

  await t.test("shows seminar details; wrong links are not found", async () => {
    const page = await call("GET", open.registrationToken);
    assert.equal(page.status, 200);
    assert.deepEqual([page.data.seminarTitle, page.data.seminarDate, page.data.venue, page.data.open], ["Open seminar", "2026-12-01", "AVR", true]);
    assert.equal(page.data.seminarID, undefined);
    assert.equal(page.data.account, undefined);
    assert.equal((await call("GET", closed.registrationToken)).data.open, false);
    assert.equal((await call("GET", expired.registrationToken)).data.open, false);
    assert.equal((await call("GET", "not-a-token")).status, 404);
    assert.equal((await call("GET", randomUUID())).status, 404);
  });

  await t.test("rejects missing or invalid logins, bad profiles, closed seminars and faculty accounts", async () => {
    assert.equal((await call("POST", open.registrationToken, null, profile)).status, 401);
    const forged = await fetch(`${base}/register/${open.registrationToken}`, { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer not.a.jwt" }, body: JSON.stringify(profile) });
    assert.equal(forged.status, 401);
    assert.equal((await call("GET", open.registrationToken, "faculty@example.test")).status, 403);
    for (const body of [{}, { ...profile, fullName: " " }, { ...profile, fullName: "A\nB" }, { ...profile, program: "x".repeat(256) },
      { ...profile, contactNumber: undefined }, { ...profile, contactNumber: "12345" }, { ...profile, contactNumber: "0917-abc-4567" },
      { ...profile, contactNumber: "1".repeat(16) }]) {
      assert.equal((await call("POST", open.registrationToken, "new@gmail.com", body)).status, 400);
    }
    for (const token of [closed.registrationToken, expired.registrationToken]) {
      assert.equal((await call("POST", token, "new@gmail.com", profile)).status, 409);
    }
    assert.equal((await call("POST", open.registrationToken, "faculty@example.test", profile)).status, 403);
    assert.equal((await call("POST", randomUUID(), "new@gmail.com", profile)).status, 404);
    // Nothing above created an account, so the login page still refuses this Google account.
    assert.equal(await login("new@gmail.com"), 403);
    assert.equal((await db.query(`SELECT 1 FROM users WHERE "email" = 'new@gmail.com'`)).rowCount, 0);
  });

  await t.test("a new Google account gets an account, a registration and a session", async () => {
    assert.equal((await call("GET", open.registrationToken, " New@Gmail.com ")).data.account, null);
    const result = await call("POST", open.registrationToken, " New@Gmail.com ", profile);
    assert.equal(result.status, 201);
    assert.deepEqual([result.data.email, result.data.fullName, result.data.walletAddress, result.data.alreadyRegistered],
      ["new@gmail.com", "Maria Santos", null, false]);
    assert.match(result.cookie, /^cict_session=.+HttpOnly/);
    const page = (await call("GET", open.registrationToken, "new@gmail.com")).data;
    assert.deepEqual([page.registered, page.account], [true, { fullName: "Maria Santos", program: "BSIT", contactNumber: "+639171234567" }]);
    assert.equal(await login("new@gmail.com"), 200);
    const again = await call("POST", open.registrationToken, "new@gmail.com", profile);
    assert.deepEqual([again.status, again.data.alreadyRegistered], [200, true]);
  });

  await t.test("an existing student can correct their name, program and contact number while registering", async () => {
    assert.deepEqual((await call("GET", open.registrationToken, "existing@gmail.com")).data.account, { fullName: "Old Name", program: "BSCS", contactNumber: null });
    const result = await call("POST", open.registrationToken, "existing@gmail.com", { fullName: "New Name", program: "BSIT", contactNumber: "0917 123 4567" });
    assert.equal(result.status, 201);
    const { rows } = await db.query(`SELECT s."fullName", s."program", s."contactNumber", count(*)::int AS registrations FROM student s
      JOIN users u USING ("userID") JOIN seminar_registration r USING ("studentID") WHERE u."email" = 'existing@gmail.com' GROUP BY 1, 2, 3`);
    assert.deepEqual(rows, [{ fullName: "New Name", program: "BSIT", contactNumber: "09171234567", registrations: 1 }]);
    assert.equal((await db.query(`SELECT 1 FROM seminar_registration WHERE "attended"`)).rowCount, 0);
  });
});

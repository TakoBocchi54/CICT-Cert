import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

test("student login, session restoration and wallet linking keep the full CSV name", async (t) => {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = { ...await exportJWK(publicKey), kid: "local-test", alg: "ES256" };
  const jwksServer = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ keys: [jwk] }));
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => jwksServer.once("listening", resolve));
  t.after(() => new Promise((resolve) => jwksServer.close(resolve)));
  process.env.SESSION_SECRET = "student-route-test-secret-only";
  process.env.WEB3AUTH_CLIENT_ID = "local-test-client";
  process.env.WEB3AUTH_ISSUER = "https://identity.example.test";
  process.env.WEB3AUTH_JWKS_URL = `http://127.0.0.1:${jwksServer.address().port}/jwks`;
  const [{ default: studentAuth }, { default: authSession }, { default: wallet }, { pool }] = await Promise.all([
    import("./studentAuth.js"), import("./authSession.js"), import("./wallet.js"), import("../db/pool.js"),
  ]);
  const app = express();
  app.use(express.json(), cookieParser());
  app.use("/api", studentAuth, authSession, wallet);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const originalQuery = pool.query;
  const queries = [];
  pool.query = async (...args) => {
    const handler = queries.shift();
    assert.ok(handler, "Unexpected database query");
    return handler(...args);
  };
  t.after(async () => {
    pool.query = originalQuery;
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });
  const profile = { userID: "10", studentID: "20", fullName: "Juan Miguel Dela Cruz", email: "juan@example.test", walletAddress: null };
  const identity = await new SignJWT({ email: " Juan@Example.Test " })
    .setProtectedHeader({ alg: "ES256", kid: "local-test" })
    .setIssuer(process.env.WEB3AUTH_ISSUER).setAudience(process.env.WEB3AUTH_CLIENT_ID)
    .setIssuedAt().setExpirationTime("5m").sign(privateKey);
  queries.push((sql, params) => {
    assert.match(sql, /s\."fullName"/);
    assert.doesNotMatch(sql, /firstName|lastName/);
    assert.deepEqual(params, [profile.email]);
    return { rows: [profile] };
  });
  const login = await fetch(`${base}/auth/student/session`, { method: "POST", headers: { Authorization: `Bearer ${identity}` } });
  assert.equal(login.status, 200);
  const loginData = await login.json();
  assert.equal(loginData.fullName, profile.fullName);
  assert.equal(loginData.email, profile.email);
  assert.equal(loginData.firstName, undefined);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  queries.push((sql, params) => {
    assert.match(sql, /s\."fullName"/);
    assert.deepEqual(params, [profile.userID, profile.studentID]);
    return { rows: [profile] };
  });
  const me = await fetch(`${base}/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).name, profile.fullName);

  const account = privateKeyToAccount(generatePrivateKey());
  const nonceResponse = await fetch(`${base}/wallet/nonce`, { headers: { Cookie: cookie } });
  assert.equal(nonceResponse.status, 200);
  const { message, challenge } = await nonceResponse.json();
  const signature = await account.signMessage({ message });
  queries.push((sql, params) => {
    assert.match(sql, /INSERT INTO student_wallet/);
    assert.deepEqual(params, [profile.studentID, account.address]);
    return { rowCount: 1 };
  }, (sql, params) => {
    assert.match(sql, /s\."fullName"/);
    assert.match(sql, /u\."email"/);
    assert.deepEqual(params, [profile.studentID]);
    return { rows: [profile] };
  });
  const linked = await fetch(`${base}/wallet/link`, {
    method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ address: account.address, signature, challenge }),
  });
  assert.equal(linked.status, 200);
  const linkedData = await linked.json();
  assert.equal(linkedData.fullName, profile.fullName);
  assert.equal(linkedData.email, profile.email);
  assert.equal(linkedData.walletAddress, account.address);
  assert.equal(queries.length, 0);
});

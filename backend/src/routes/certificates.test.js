import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { decodeFunctionData, encodeFunctionResult, zeroAddress, zeroHash } from "viem";
import abi from "../contracts/CICTCertificate.abi.json" with { type: "json" };
import { certificateHash } from "../utils/certificateConsent.js";
import router from "./certificates.js";
import { pool } from "../db/pool.js";

test("public verification publishes only certificate details matching the on-chain hash", async t => {
  const context = { chainId: 80002, contractAddress: "0x2222222222222222222222222222222222222222",
    issuerAddress: "0x1111111111111111111111111111111111111111" };
  const saved = { certificateNo: "9007199254740993", recipientName: "Juan Dela Cruz", seminarTitle: "Web Security",
    seminarDate: "2026-11-09", walletAddress: "0x3333333333333333333333333333333333333333" };
  const hash = certificateHash(saved, context);
  const originalQuery = pool.query, originalRpc = process.env.AMOY_RPC_URL, originalContract = process.env.CONTRACT_ADDRESS;
  let rows = [saved], dbFailure = false, rpcFailure = false, queryCount = 0, chainId = "0x13882", issuer = context.issuerAddress;
  let record = [1, 9007199254740993n, saved.walletAddress, 1794182400n, 0n];
  pool.query = async (sql, params) => {
    queryCount++;
    assert.deepEqual(params, [hash]);
    assert.match(sql, /c\."recipientName"/);
    assert.doesNotMatch(sql, /SELECT\s+\*|"email"|"consentSignature"|"consentMessage"|"signedTransaction"/);
    if (dbFailure) throw Object.assign(new Error("private database connection details"), { code: "ECONNREFUSED" });
    return { rows };
  };
  const rpc = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const call = JSON.parse(body);
    let result;
    if (call.method === "eth_chainId") result = chainId;
    else {
      const decoded = decodeFunctionData({ abi, data: call.params[0].data });
      result = encodeFunctionResult({ abi, functionName: decoded.functionName, result: decoded.functionName === "issuer" ? issuer : record });
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, ...(rpcFailure ? { error: { code: -32000, message: "private RPC details" } } : { result }) }));
  }).listen(0, "127.0.0.1");
  await new Promise(resolve => rpc.once("listening", resolve));
  process.env.AMOY_RPC_URL = "http://127.0.0.1:" + rpc.address().port;
  process.env.CONTRACT_ADDRESS = context.contractAddress;
  const app = express(); app.use("/api", router);
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve)); await new Promise(resolve => rpc.close(resolve));
    pool.query = originalQuery;
    for (const [name, value] of [["AMOY_RPC_URL", originalRpc], ["CONTRACT_ADDRESS", originalContract]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await pool.end();
  });
  async function verify(value = hash) {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/certificates/verify/" + value);
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  const publicDetails = { certificateNo: saved.certificateNo, recipientName: saved.recipientName,
    seminarTitle: saved.seminarTitle, seminarDate: saved.seminarDate };

  await t.test("rejects malformed hashes before reading the chain or database", async () => {
    for (const value of ["not-a-hash", "0x1234", "0x" + "z".repeat(64)]) assert.equal((await verify(value)).status, 400);
    assert.equal(queryCount, 0);
  });
  await t.test("an unknown on-chain hash cannot expose a prepared certificate's details", async () => {
    record = [0, 0n, zeroAddress, 0n, 0n];
    const response = await verify(zeroHash);
    assert.equal(response.status, 200); assert.equal(response.data.status, "NotFound");
    assert.equal(response.data.tokenId, "0"); assert.equal(response.data.certificate, null);
    assert.equal(response.data.detailsStatus, "NotFound"); assert.equal(queryCount, 0);
    record = [1, 9007199254740993n, saved.walletAddress, 1794182400n, 0n];
  });
  await t.test("works without login, preserves bigint numbers, and exposes only approved public fields", async () => {
    rows = [{ ...saved, email: "private@example.test", consentSignature: "private-signature", consentMessage: "private-message", signedTransaction: "private-transaction" }];
    const response = await verify();
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.data.status, "Valid"); assert.equal(response.data.tokenId, "9007199254740993");
    assert.equal(response.data.issuerAddress, context.issuerAddress);
    assert.equal(response.data.detailsStatus, "Verified"); assert.deepEqual(response.data.certificate, publicDetails);
    assert.ok(!JSON.stringify(response.data).includes("private")); rows = [saved];
  });
  await t.test("uppercase input finds the same lowercase stored hash", async () => {
    const response = await verify("0x" + hash.slice(2).toUpperCase());
    assert.equal(response.data.detailsStatus, "Verified"); assert.deepEqual(response.data.certificate, publicDetails);
  });
  await t.test("the chain's revoked status wins over database state while retaining matching historical details", async () => {
    record = [2, 9007199254740993n, saved.walletAddress, 1794182400n, 1794268800n];
    const response = await verify(); assert.equal(response.data.status, "Revoked");
    assert.equal(response.data.revokedAt, "1794268800"); assert.deepEqual(response.data.certificate, publicDetails);
    record = [1, 9007199254740993n, saved.walletAddress, 1794182400n, 0n];
  });
  await t.test("changing any public fact withholds all certificate details", async () => {
    for (const [field, value] of Object.entries({ certificateNo: "2", recipientName: "Changed Name", seminarTitle: "Changed Seminar", seminarDate: "2026-11-10" })) {
      rows = [{ ...saved, [field]: value }]; const response = await verify();
      assert.equal(response.data.status, "Valid"); assert.equal(response.data.detailsStatus, "Mismatch"); assert.equal(response.data.certificate, null);
    }
    rows = [saved];
  });
  await t.test("another wallet, issuer or contract cannot validate a snapshot from the original domain", async () => {
    rows = [{ ...saved, walletAddress: context.contractAddress }]; assert.equal((await verify()).data.detailsStatus, "Mismatch"); rows = [saved];
    issuer = "0x4444444444444444444444444444444444444444"; assert.equal((await verify()).data.detailsStatus, "Mismatch"); issuer = context.issuerAddress;
    process.env.CONTRACT_ADDRESS = "0x5555555555555555555555555555555555555555";
    assert.equal((await verify()).data.detailsStatus, "Mismatch"); process.env.CONTRACT_ADDRESS = context.contractAddress;
  });
  await t.test("missing details and database outages do not invent metadata or change blockchain status", async t => {
    rows = []; const missing = await verify(); assert.equal(missing.data.status, "Valid");
    assert.equal(missing.data.detailsStatus, "Missing"); assert.equal(missing.data.certificate, null); rows = [saved];
    t.mock.method(console, "error", () => {}); dbFailure = true;
    const unavailable = await verify(); dbFailure = false;
    assert.equal(unavailable.status, 200); assert.equal(unavailable.data.status, "Valid");
    assert.equal(unavailable.data.detailsStatus, "Unavailable"); assert.equal(unavailable.data.certificate, null);
    assert.ok(!JSON.stringify(unavailable.data).includes("private"));
  });
  await t.test("wrong-network and RPC errors never fall back to a valid database status", async t => {
    t.mock.method(console, "error", () => {}); chainId = "0x89";
    assert.equal((await verify()).status, 503); chainId = "0x13882"; rpcFailure = true;
    const response = await verify(); assert.equal(response.status, 503);
    assert.equal(response.data.status, undefined); assert.ok(!JSON.stringify(response.data).includes("private"));
  });
});

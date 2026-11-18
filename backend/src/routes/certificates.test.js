import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import { zeroHash } from "viem";
import { smtRoot } from "../utils/merkle.js";
import { isolatedDatabase, preparedSeminar, seedAccounts, sessionCookie, skip, startAmoy } from "./amoyFixture.js";

process.env.SESSION_SECRET = "verification-route-test-secret-only";
const { default: router } = await import("./certificates.js");
const { default: seminarRouter } = await import("./seminars.js");
const { default: revocationRouter } = await import("./revocations.js");
const { pool } = await import("../db/pool.js");

test("public verification proves inclusion and non-revocation on chain and publishes only matching details", { skip }, async t => {
  const { db, close } = await isolatedDatabase(pool, "verification");
  const amoy = await startAmoy(db), { chain } = amoy;
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await amoy.close(); await close();
  });
  const wallets = await seedAccounts(db, amoy.issuer.address, { withWallets: 3, withoutWallets: 0 });
  const app = express(); app.use(express.json(), cookieParser()); app.use("/api", router, seminarRouter, revocationRouter);
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/api";
  const faculty = await sessionCookie();
  const post = async (path, body = {}) => (await fetch(base + path, { method: "POST", headers: { Cookie: faculty, "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  async function verify(value) {
    const response = await fetch(base + "/certificates/verify/" + value); // no session cookie: the verifier is public
    return { status: response.status, data: await response.json(), headers: response.headers };
  }

  // A real batch of three, issued through the faculty route and mined on the fixture chain.
  const { seminarID, certificates } = await preparedSeminar(db, [1, 2, 3]);
  const issued = await post(`/faculty/seminars/${seminarID}/certificates/issue`);
  const prepared = (await db.query(`SELECT "certificateHash" FROM certificate WHERE "seminarID" = $1 ORDER BY "certificateNo"`, [seminarID])).rows.map(row => row.certificateHash);

  await t.test("rejects malformed hashes, and a hash that is signed but not final is not yet a certificate", async () => {
    for (const value of ["not-a-hash", "0x1234", "0x" + "z".repeat(64)]) assert.equal((await verify(value)).status, 400);
    const early = await verify(prepared[0]);
    assert.equal(early.status, 200); assert.equal(early.data.status, "NotFound"); assert.equal(early.data.certificate, null);
  });

  amoy.mine(issued.transactionHash);
  assert.equal((await post(`/faculty/seminars/${seminarID}/certificates/issuance/check`)).transactionStatus, "CONFIRMED");
  const publicDetails = i => ({ certificateNo: certificates[i].certificateNo, recipientName: `Student ${i + 1}`, seminarTitle: "Web Security", seminarDate: "2026-11-09", template: null });

  await t.test("an unknown hash exposes nothing", async () => {
    const response = await verify(zeroHash);
    assert.equal(response.status, 200); assert.equal(response.data.status, "NotFound");
    assert.equal(response.data.tokenId, "0"); assert.equal(response.data.certificate, null); assert.equal(response.data.detailsStatus, "NotFound");
  });

  await t.test("works without login for every certificate of the batch and exposes only public fields", async () => {
    for (let i = 0; i < 3; i++) {
      const response = await verify(prepared[i]);
      assert.equal(response.status, 200, JSON.stringify(response.data)); assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.data.status, "Valid"); assert.equal(response.data.tokenId, String(i + 1)); assert.equal(response.data.batchId, "1");
      assert.equal(response.data.recipient, wallets[i]); assert.equal(response.data.issuerAddress, amoy.context.issuerAddress);
      assert.ok(Number(response.data.issuedAt) > 0); assert.equal(response.data.revokedAt, "0");
      assert.equal(response.data.detailsStatus, "Verified"); assert.deepEqual(response.data.certificate, publicDetails(i));
      assert.equal(response.data.contractAddress, amoy.context.contractAddress); assert.equal(response.data.transactionHash, issued.transactionHash);
      assert.deepEqual(Object.keys(response.data).sort(), ["batchId", "certificate", "contractAddress", "detailsStatus", "issuedAt", "issuerAddress", "recipient", "revokedAt", "status", "tokenId", "transactionHash"]);
    }
  });

  await t.test("uppercase input finds the same lowercase stored hash", async () => {
    const response = await verify("0x" + prepared[1].slice(2).toUpperCase());
    assert.equal(response.data.detailsStatus, "Verified"); assert.deepEqual(response.data.certificate, publicDetails(1));
  });

  await t.test("a revocation counts from the moment the chain's root changes, before the database records it", async () => {
    const revoke = await post(`/faculty/certificates/${certificates[1].certificateNo}/revoke`, { reason: "Name misspelled" });
    assert.equal(revoke.transactionStatus, "PENDING");
    assert.equal((await verify(prepared[1])).data.status, "Valid", "signed but not mined: still valid on chain");
    amoy.mine(revoke.transactionHash); chain.finalized = 10n; // mined, not yet final: the database still says ISSUED
    const mined = await verify(prepared[1]);
    assert.equal(mined.data.status, "Revoked"); assert.equal(mined.data.revokedAt, "0"); assert.deepEqual(mined.data.certificate, publicDetails(1));
    assert.equal((await verify(prepared[0])).data.status, "Valid");
    chain.finalized = 12n;
    assert.equal((await post(`/faculty/certificates/${certificates[1].certificateNo}/revocation/check`)).status, "REVOKED");
    const final = await verify(prepared[1]);
    assert.equal(final.data.status, "Revoked"); assert.ok(Number(final.data.revokedAt) >= Number(final.data.issuedAt));
    assert.equal((await verify(prepared[2])).data.status, "Valid", "the rest of the batch is untouched");
  });

  await t.test("changing any public fact withholds all certificate details", async () => {
    // Issued rows are immutable, so the guard is lifted here only to imitate tampering with the database.
    await db.query(`ALTER TABLE certificate DISABLE TRIGGER certificate_history_guard`);
    try {
      for (const [column, value] of Object.entries({ recipientName: "Changed Name", seminarTitle: "Changed Seminar", seminarDate: "2026-11-10" })) {
        const { rows: [before] } = await db.query(`SELECT "${column}" AS value FROM certificate WHERE "certificateID" = $1`, [certificates[0].certificateID]);
        await db.query(`UPDATE certificate SET "${column}" = $2 WHERE "certificateID" = $1`, [certificates[0].certificateID, value]);
        const response = await verify(prepared[0]);
        await db.query(`UPDATE certificate SET "${column}" = $2 WHERE "certificateID" = $1`, [certificates[0].certificateID, before.value]);
        assert.equal(response.data.status, "Valid"); assert.equal(response.data.detailsStatus, "Mismatch"); assert.equal(response.data.certificate, null);
      }
    } finally { await db.query(`ALTER TABLE certificate ENABLE TRIGGER certificate_history_guard`); }
    assert.equal((await verify(prepared[0])).data.detailsStatus, "Verified");
  });

  await t.test("another contract cannot validate a certificate issued on this one", async () => {
    process.env.CONTRACT_ADDRESS = "0x5555555555555555555555555555555555555555";
    const response = await verify(prepared[0]); process.env.CONTRACT_ADDRESS = amoy.contractAddress;
    assert.equal(response.data.status, "NotFound"); assert.equal(response.data.certificate, null);
  });

  await t.test("a revocation root the database cannot explain, a wrong network and RPC errors never fall back to a valid status", async t => {
    t.mock.method(console, "error", () => {});
    const root = chain.revocationRoot; chain.revocationRoot = smtRoot([424242n]);
    assert.equal((await verify(prepared[0])).status, 503); chain.revocationRoot = root;
    // The issuer is read once per RPC URL and contract, so a wrong network shows on a configuration not read before.
    chain.chainId = "0x89"; process.env.CONTRACT_ADDRESS = "0x6666666666666666666666666666666666666666";
    assert.equal((await verify(prepared[0])).status, 503); chain.chainId = "0x13882"; process.env.CONTRACT_ADDRESS = amoy.contractAddress;
    chain.rpcFails = true; const response = await verify(prepared[0]); chain.rpcFails = false;
    assert.equal(response.status, 503); assert.equal(response.data.status, undefined);
    assert.equal((await verify(prepared[0])).data.status, "Valid");
  });
});

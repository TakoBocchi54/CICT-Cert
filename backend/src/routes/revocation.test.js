import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { formatCertificateNo } from "../utils/certificateNumber.js";
import express from "express";
import cookieParser from "cookie-parser";
import { smtRoot } from "../utils/merkle.js";
import { isolatedDatabase, seedAccounts, sessionCookie, skip, startAmoy } from "./amoyFixture.js";

process.env.SESSION_SECRET = "revocation-route-test-secret-only";
const { default: router } = await import("./revocations.js");
const { pool } = await import("../db/pool.js");

test("faculty revocation with PostgreSQL and a local Amoy RPC fixture", { skip }, async t => {
  const { db, close } = await isolatedDatabase(pool, "revocation");
  const amoy = await startAmoy(db), { chain, contractAddress } = amoy;
  let server, nextToken = 1n;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await amoy.close(); await close();
  });
  const [wallet] = await seedAccounts(db, amoy.issuer.address, { withWallets: 1, withoutWallets: 0 });
  const app = express(); app.use(express.json(), cookieParser()); app.use("/api", router);
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/api/faculty/certificates/";
  const faculty = await sessionCookie(), assistant = await sessionCookie("FACULTY", "2", "2"), studentCookie = await sessionCookie("STUDENT", "3", "1");

  // An issued certificate with a confirmed mint, as left by the issuance flow.
  async function issuedCertificate({ status = "ISSUED" } = {}) {
    const seminar = (await db.query(`INSERT INTO seminar ("seminarTitle","seminarDate","createdBy") VALUES ('Web Security','2026-11-09',1) RETURNING "seminarID"`)).rows[0];
    await db.query(`INSERT INTO seminar_registration ("seminarID","studentID",attended) VALUES ($1,1,true)`, [seminar.seminarID]);
    const hash = "0x" + randomBytes(32).toString("hex"), tokenID = nextToken++;
    const issued = status === "ISSUED";
    const certificate = (await db.query(`INSERT INTO certificate ("studentID","seminarID","studentWalletID","issuerWalletID","authorizedBy","recipientName","seminarTitle","seminarDate",
        "certificateHash",status,"issuedAt")
      VALUES (1,$1,1,1,1,'Juan Dela Cruz','Web Security','2026-11-09',$2,$3,$4) RETURNING "certificateID","certificateNo"`,
      [seminar.seminarID, hash, status, issued ? new Date(Date.now() - 60_000) : null])).rows[0];
    if (issued) {
      await db.query(`INSERT INTO blockchain_record ("certificateID","transactionType","transactionHash","requestedBy","tokenID","contractAddress","fromAddress","toAddress",network,"blockNum","transactionStatus")
        VALUES ($1,'MINT',$2,1,$3,$4,$5,$6,'polygon-amoy',5,'CONFIRMED')`,
        [certificate.certificateID, "0x" + randomBytes(32).toString("hex"), tokenID.toString(), contractAddress, amoy.issuer.address.toLowerCase(), wallet]);
    }
    return { no: certificate.certificateNo, id: certificate.certificateID, hash, tokenID };
  }
  async function request(path, { session = faculty, body } = {}) {
    const response = await fetch(base + path, body === undefined ? { headers: { Cookie: session } }
      : { method: "POST", headers: { Cookie: session, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  const revoke = (certificate, reason = "Name misspelled", session) => request(`${certificate.no}/revoke`, { session, body: { reason } });
  const check = (certificate, session) => request(`${certificate.no}/revocation/check`, { session, body: {} });
  const revokeMany = (certificateNos, reason = "Wrong seminar title", session) => request("revoke", { session, body: { certificateNos, reason } });
  const certificateRow = id => db.query(`SELECT status,"revokedAt" FROM certificate WHERE "certificateID"=$1`, [id]).then(r => r.rows[0]);
  const revokeRecords = id => db.query(`SELECT * FROM blockchain_record WHERE "certificateID"=$1 AND "transactionType"='REVOKE' ORDER BY "transactionID"`, [id]).then(r => r.rows);
  const revokedTokens = () => db.query(`SELECT "tokenID" FROM blockchain_record WHERE "transactionType"='REVOKE' AND "transactionStatus"='CONFIRMED'`).then(r => r.rows.map(row => row.tokenID));

  await t.test("lookup and revocation require a live faculty account; revoking requires canIssue", async () => {
    const certificate = await issuedCertificate();
    for (const session of ["", studentCookie, await sessionCookie("FACULTY", "999", "999")]) {
      assert.equal((await request(String(certificate.no), { session })).status, 401);
      assert.equal((await revoke(certificate, "x", session)).status, 401);
      assert.equal((await revokeMany([certificate.no], "x", session)).status, 401);
    }
    const lookup = await request(String(certificate.no), { session: assistant });
    assert.equal(lookup.status, 200);
    assert.equal(lookup.data.tokenID, Number(certificate.tokenID)); assert.equal(lookup.data.status, "ISSUED");
    assert.equal(lookup.data.recipientName, "Juan Dela Cruz"); assert.equal(lookup.data.revocation.transactionStatus, null);
    assert.equal("certificateID" in lookup.data, false);
    assert.equal((await revoke(certificate, "x", assistant)).status, 403);
    assert.equal((await check(certificate, assistant)).status, 403);
    assert.equal((await revokeMany([certificate.no], "x", assistant)).status, 403);
    assert.equal((await request("0")).status, 400); assert.equal((await request("abc")).status, 400);
    assert.equal((await request("999999")).status, 404); assert.equal((await revoke({ no: 999999 })).status, 404);
    assert.equal(chain.sendCount, 0);
  });

  await t.test("requires a reason, issued certificates and a revocation root that matches the database", async () => {
    const certificate = await issuedCertificate();
    for (const reason of [null, "", "   ", "x".repeat(501), 42]) assert.equal((await revoke(certificate, reason)).status, 400);
    for (const numbers of [[], "1", ["abc"], [0], Array.from({ length: 201 }, (_, i) => i + 1)]) assert.equal((await revokeMany(numbers)).status, 400, JSON.stringify(numbers).slice(0, 40));
    assert.equal((await revokeMany([certificate.no, 999999])).status, 404);
    assert.equal((await revoke(await issuedCertificate({ status: "PENDING" }))).status, 409);
    // Someone else changed the on-chain root: signing on top of it would silently drop their revocations.
    chain.revocationRoot = smtRoot([424242n]);
    const drift = await revoke(certificate); chain.revocationRoot = smtRoot([]);
    assert.equal(drift.status, 409); assert.match(drift.data.error, /revocation root/);
    assert.equal((await db.query(`SELECT count(*) FROM blockchain_record WHERE "transactionType"='REVOKE'`)).rows[0].count, "0");
    assert.equal(chain.sendCount, 0);
  });

  let pending;
  await t.test("stores the signed revocation before broadcast and tolerates an uncertain RPC response", async () => {
    pending = await issuedCertificate(); chain.sendFails = true;
    const response = await revoke(pending, "  Wrong seminar date  "); chain.sendFails = false;
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(response.data.transactionStatus, "PENDING"); assert.match(response.data.warning, /no new revocation/);
    const [record] = await revokeRecords(pending.id);
    assert.equal(record.revocationReason, "Wrong seminar date"); assert.equal(record.requestedBy, 1);
    assert.equal(record.tokenID, Number(pending.tokenID)); assert.equal(record.toAddress, wallet);
    assert.equal((await certificateRow(pending.id)).status, "ISSUED");
    assert.equal(chain.persistedBeforeSend, true);
  });

  await t.test("retries reuse the same signed payload and block other issuer transactions", async () => {
    const before = [...amoy.rawTransactions.values()].at(-1), sends = chain.sendCount;
    const retried = await Promise.all([revoke(pending, "Another reason"), check(pending)]);
    assert.ok(retried.every(r => r.status === 200 && r.data.transactionStatus === "PENDING" && r.data.reason === "Wrong seminar date"), JSON.stringify(retried));
    assert.equal([...amoy.rawTransactions.values()].at(-1), before); assert.equal(chain.sendCount, sends + 2);
    assert.equal((await revokeRecords(pending.id)).length, 1);
    assert.equal((await revoke(await issuedCertificate())).status, 409);
  });

  await t.test("waits for finality and marks the certificate revoked only from the confirmed root update", async () => {
    const [record] = await revokeRecords(pending.id);
    amoy.mine(record.transactionHash); chain.finalized = 10n;
    assert.equal((await check(pending)).data.status, "ISSUED"); chain.finalized = 12n;
    const confirmed = await check(pending);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed));
    assert.equal(confirmed.data.status, "REVOKED"); assert.equal(confirmed.data.transactionStatus, "CONFIRMED");
    const stored = await certificateRow(pending.id);
    assert.equal(stored.status, "REVOKED"); assert.ok(stored.revokedAt);
    const [saved] = await revokeRecords(pending.id);
    assert.equal(saved.transactionStatus, "CONFIRMED"); assert.equal(saved.blockNum, 10);
    assert.equal(chain.revocationRoot, smtRoot([pending.tokenID]));
    const sends = chain.sendCount;
    assert.equal((await revoke(pending)).data.status, "REVOKED"); assert.equal(chain.sendCount, sends);
    assert.equal((await request(String(pending.no))).data.revocation.reason, "Wrong seminar date");
  });

  await t.test("a finalized revert leaves the certificate issued and can be retried", async () => {
    const certificate = await issuedCertificate();
    const first = await revoke(certificate); assert.equal(first.status, 200, JSON.stringify(first));
    amoy.mine(first.data.transactionHash, { reverted: true });
    const failed = await check(certificate);
    assert.equal(failed.data.transactionStatus, "FAILED"); assert.equal((await certificateRow(certificate.id)).status, "ISSUED");
    const retry = await revoke(certificate); assert.equal(retry.data.transactionStatus, "PENDING");
    assert.notEqual(retry.data.transactionHash, first.data.transactionHash);
    amoy.mine(retry.data.transactionHash); assert.equal((await check(certificate)).data.status, "REVOKED");
    assert.equal((await revokeRecords(certificate.id)).length, 2);
    assert.equal(chain.revocationRoot, smtRoot(await revokedTokens()));
  });

  await t.test("a batch across seminars is one transaction that adds every token to the revocation root", async () => {
    const batch = [await issuedCertificate(), await issuedCertificate(), await issuedCertificate()];
    const sends = chain.sendCount, already = pending.no;
    // An already revoked certificate in the selection is reported, not revoked twice.
    const response = await revokeMany([...batch.map(certificate => certificate.no), already], "  Seminar was cancelled ");
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(chain.sendCount, sends + 1);
    const byNo = new Map(response.data.certificates.map(row => [row.certificateNo, row]));
    assert.equal(byNo.get(already).status, "REVOKED");
    const hashes = new Set(batch.map(certificate => byNo.get(certificate.no).transactionHash));
    assert.equal(hashes.size, 1); assert.ok(batch.every(certificate => byNo.get(certificate.no).transactionStatus === "PENDING"));
    const records = (await Promise.all(batch.map(certificate => revokeRecords(certificate.id)))).flat();
    assert.equal(records.length, 3); assert.equal(records.filter(record => record.signedTransaction).length, 1);
    assert.ok(records.every(record => record.revocationReason === "Seminar was cancelled"));
    const [hash] = hashes; amoy.mine(hash);
    // Checking any member, or the batch, settles all of them.
    assert.equal((await check(batch[1])).data.status, "REVOKED");
    const settled = await request("revocation/check", { body: { certificateNos: batch.map(certificate => certificate.no) } });
    assert.ok(settled.data.certificates.every(row => row.status === "REVOKED" && row.transactionStatus === "CONFIRMED" && row.revokedAt));
    assert.equal(chain.revocationRoot, smtRoot(await revokedTokens()));
    assert.equal((await revokedTokens()).length, 5);
  });

  await t.test("a receipt without the expected event stays pending and never marks the certificate revoked", async () => {
    const certificate = await issuedCertificate(), response = await revoke(certificate);
    amoy.mine(response.data.transactionHash, { validEvent: false });
    assert.equal((await check(certificate)).status, 409);
    assert.equal((await certificateRow(certificate.id)).status, "ISSUED");
    assert.equal((await revokeRecords(certificate.id))[0].transactionStatus, "PENDING");
    assert.equal(chain.persistedBeforeSend, true);
  });

  await t.test("a revoked certificate gets one explicit replacement with corrected facts and a new number", async () => {
    const original = await issuedCertificate();
    await db.query(`UPDATE certificate SET status='REVOKED',"revokedAt"=now() WHERE "certificateID"=$1`, [original.id]);
    const facts = { recipientName: "  Juan P. Dela Cruz ", seminarTitle: "Web Security Fundamentals", seminarDate: "2026-11-08" };
    const replace = (certificate, body = facts, session) => request(`${certificate.no}/replacement`, { session, body });
    assert.equal((await request(String(original.no))).data.replacement, null);
    const registryRow = async () => (await request("?q=" + original.no)).data.find(row => String(row.certificateNo) === String(original.no));
    assert.equal((await registryRow()).replaced, false);
    assert.equal((await replace(original, facts, assistant)).status, 403);
    for (const body of [{ ...facts, recipientName: " " }, { ...facts, seminarTitle: "x".repeat(256) }, { ...facts, seminarTitle: "a\u0007b" },
      { ...facts, seminarDate: "2026-02-30" }, { ...facts, seminarDate: "11/08/2026" }, {}]) {
      assert.equal((await replace(original, body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await replace(await issuedCertificate())).status, 409);
    const sends = chain.sendCount;
    const created = await replace(original);
    assert.equal(created.status, 201, JSON.stringify(created));
    assert.equal(created.data.status, "PENDING"); assert.equal(created.data.replaces, original.no);
    assert.ok(BigInt(created.data.certificateNo) > BigInt(original.no));
    assert.equal(created.data.recipientName, "Juan P. Dela Cruz"); assert.equal(created.data.seminarDate, "2026-11-08");
    const row = (await db.query(`SELECT "seminarID","studentID","studentWalletID","authorizedBy","certificateHash" FROM certificate WHERE "certificateNo"=$1`,
      [created.data.certificateNo])).rows[0];
    assert.deepEqual({ ...row }, { ...(await db.query(`SELECT "seminarID","studentID" FROM certificate WHERE "certificateID"=$1`, [original.id])).rows[0],
      studentWalletID: 1, authorizedBy: 1, certificateHash: null });
    assert.equal(chain.sendCount, sends, "preparing a replacement sends no transaction");
    assert.deepEqual((await request(String(original.no))).data.replacement, { certificateNo: created.data.certificateNo, status: "PENDING", seminarDate: created.data.seminarDate });
    assert.equal((await registryRow()).replaced, true, "the registry flags a revoked certificate that has a replacement");
    assert.match((await replace(original)).data.error, new RegExp(formatCertificateNo(created.data.certificateNo, created.data.seminarDate)));
    const absent = await issuedCertificate();
    await db.query(`UPDATE certificate SET status='REVOKED',"revokedAt"=now() WHERE "certificateID"=$1;`, [absent.id]);
    await db.query(`UPDATE seminar_registration SET attended=false WHERE ("seminarID","studentID") = (SELECT "seminarID","studentID" FROM certificate WHERE "certificateID"=$1)`, [absent.id]);
    assert.equal((await replace(absent)).status, 409);
  });

  await t.test("dashboard summary needs a live faculty account and reports real counts and recent rows", async () => {
    for (const session of ["", studentCookie]) assert.equal((await request("summary", { session })).status, 401);
    const { status, data } = await request("summary");
    const [issued, revoked] = ["ISSUED", "REVOKED"].map(async s => Number((await db.query(`SELECT count(*) FROM certificate WHERE status=$1`, [s])).rows[0].count));
    assert.equal(status, 200); assert.equal(data.issuedCount, await issued); assert.equal(data.revokedCount, await revoked);
    assert.ok(data.recentIssued.length <= 4 && data.recentRevoked.length <= 3 && data.recentRevoked.length > 0);
    assert.deepEqual(Object.keys(data.recentRevoked[0]).sort(), ["at", "certificateNo", "recipientName", "seminarDate", "seminarTitle"]);
  });

  await t.test("issuer wallet reports the contract issuer's POL balance, or 503 when the RPC is down", async () => {
    for (const session of ["", studentCookie]) assert.equal((await request("issuer-wallet", { session })).status, 401);
    assert.deepEqual(await request("issuer-wallet"), { status: 200, data: { address: amoy.issuer.address.toLowerCase(), balance: "1", threshold: "0.5", low: false } });
    chain.rpcFails = true;
    try { assert.equal((await request("issuer-wallet")).status, 503); } finally { chain.rpcFails = false; }
  });

  await t.test("registry lists only on-chain certificates, newest first, with status filter and search", async () => {
    for (const session of ["", studentCookie]) assert.equal((await request("", { session })).status, 401);
    const pending = await issuedCertificate({ status: "PENDING" });
    const all = await request("");
    assert.equal(all.status, 200);
    assert.ok(all.data.length > 0 && all.data.every(row => ["ISSUED", "REVOKED"].includes(row.status)));
    assert.ok(!all.data.some(row => row.certificateNo === pending.no));
    assert.ok(all.data.some(row => row.status === "REVOKED") && all.data.some(row => row.status === "ISSUED"));
    const times = all.data.map(row => Date.parse(row.issuedAt));
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
    assert.deepEqual(Object.keys(all.data[0]).sort(), ["certificateHash", "certificateNo", "email", "issuedAt", "recipientName", "replaced", "revokedAt", "seminarDate", "seminarTitle", "status"]);
    assert.ok(all.data.every(row => row.status === "REVOKED" || row.replaced === false));
    const revoked = await request("?status=REVOKED");
    assert.ok(revoked.data.length > 0 && revoked.data.every(row => row.status === "REVOKED"));
    const target = all.data.at(-1);
    for (const q of [target.certificateNo, "#" + target.certificateNo]) {
      assert.deepEqual((await request("?q=" + encodeURIComponent(q))).data.map(row => row.certificateNo), [target.certificateNo]);
    }
    assert.equal((await request("?q=juan%20dela")).data.length, all.data.length);
    assert.equal((await request("?q=" + encodeURIComponent(all.data[0].email.toUpperCase()))).data.length, all.data.length);
    assert.deepEqual((await request("?q=%25")).data, []);
  });
});

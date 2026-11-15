import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import { generatePrivateKey } from "viem/accounts";
import { keccak256, toBytes } from "viem";
import { verifyMerkleProof } from "../utils/merkle.js";
import { isolatedDatabase, preparedSeminar, seedAccounts, sessionCookie, skip, startAmoy } from "./amoyFixture.js";

process.env.SESSION_SECRET = "issuance-route-test-secret-only";
const { default: router } = await import("./seminars.js");
const { default: studentRouter } = await import("./certificateApprovals.js");
const { pool } = await import("../db/pool.js");

test("batch issuance with PostgreSQL and a local Amoy RPC fixture", { skip }, async t => {
  const { db, close } = await isolatedDatabase(pool, "issuance");
  const amoy = await startAmoy(db), { chain } = amoy;
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    delete process.env.ISSUE_BATCH_SIZE; await amoy.close(); await close();
  });
  // Students 1-4 have a linked wallet; student 5 does not.
  await seedAccounts(db, amoy.issuer.address, { withWallets: 4, withoutWallets: 1 });
  const app = express(); app.use(express.json(), cookieParser()); app.use("/api", router, studentRouter);
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/api";
  const faculty = await sessionCookie(), assistant = await sessionCookie("FACULTY", "2", "2"), student1 = await sessionCookie("STUDENT", "3", "1");

  async function send(method, path, session = faculty, body = {}) {
    const response = await fetch(base + path, { method, headers: { Cookie: session, "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  const issue = (seminarID, session) => send("POST", `/faculty/seminars/${seminarID}/certificates/issue`, session);
  const check = (seminarID, session) => send("POST", `/faculty/seminars/${seminarID}/certificates/issuance/check`, session);
  const rename = (seminarID, certificateID, recipientName, session) => send("PATCH", `/faculty/seminars/${seminarID}/certificates/${certificateID}`, session, { recipientName });
  // Each certificate of the seminar with its latest transaction row, in certificate-number order.
  const rowsOf = seminarID => db.query(`SELECT c."certificateID", c."certificateNo", c."recipientName", c.status, c."issuedAt", c."certificateHash", b."transactionStatus",
      b."tokenID", b."transactionHash", b."blockNum", b."requestedBy", b."signedTransaction" IS NOT NULL AS "hasPayload"
    FROM certificate c LEFT JOIN LATERAL (SELECT * FROM blockchain_record WHERE "certificateID" = c."certificateID" ORDER BY "transactionID" DESC LIMIT 1) b ON true
    WHERE c."seminarID" = $1 ORDER BY c."certificateNo"`, [seminarID]).then(r => r.rows);
  const attempts = () => db.query("SELECT count(*)::int AS n FROM blockchain_record").then(r => r.rows[0].n);

  await t.test("seminar list counts ready, awaiting-wallet and issued certificates", async () => {
    const counts = async seminarID => {
      const row = (await send("GET", "/faculty/seminars")).data.find(row => row.seminarID === seminarID);
      return [row.readyCount, row.awaitingCount, row.issuedCount];
    };
    assert.deepEqual(await counts((await preparedSeminar(db, [1, 2])).seminarID), [2, 0, 0]);
    assert.deepEqual(await counts((await preparedSeminar(db, [5])).seminarID), [0, 1, 0]);
    assert.deepEqual(await counts((await preparedSeminar(db, [1], { absent: [1] })).seminarID), [0, 0, 0]);
    const empty = (await db.query(`INSERT INTO seminar ("seminarTitle","seminarDate","createdBy") VALUES ('Empty','2026-11-09',1) RETURNING "seminarID"`)).rows[0];
    assert.deepEqual(await counts(empty.seminarID), [0, 0, 0]);
  });

  await t.test("requires a live authorized faculty account and an existing seminar", async () => {
    const { seminarID } = await preparedSeminar(db, [1]);
    for (const session of ["", student1, await sessionCookie("FACULTY", "999", "999")]) assert.equal((await issue(seminarID, session)).status, 401);
    assert.equal((await issue(seminarID, assistant)).status, 403);
    assert.equal((await check(seminarID, assistant)).status, 403);
    assert.equal((await issue("0")).status, 400);
    assert.equal((await issue("9999")).status, 404);
    assert.equal(chain.sendCount, 0);
  });

  await t.test("nothing eligible never submits a mint, and check-only requests never sign", async () => {
    assert.equal((await issue((await preparedSeminar(db, [5])).seminarID)).status, 409);
    assert.equal((await issue((await preparedSeminar(db, [1], { absent: [1] })).seminarID)).status, 409);
    const checked = await check((await preparedSeminar(db, [1, 2, 5])).seminarID);
    assert.equal(checked.status, 200, JSON.stringify(checked));
    assert.equal(checked.data.transactionStatus, null); assert.equal(checked.data.remaining, 2);
    assert.deepEqual(checked.data.skipped.map(row => row.reason), ["No wallet linked yet."]);
    assert.equal(await attempts(), 0); assert.equal(chain.sendCount, 0);
  });

  await t.test("wrong key, wrong chain and insufficient POL leave no transaction attempt", async () => {
    const { seminarID } = await preparedSeminar(db, [1]);
    delete process.env.ISSUER_PRIVATE_KEY; assert.equal((await issue(seminarID)).status, 503);
    process.env.ISSUER_PRIVATE_KEY = generatePrivateKey(); assert.equal((await issue(seminarID)).status, 503);
    process.env.ISSUER_PRIVATE_KEY = amoy.issuerKey; chain.chainId = "0x89"; assert.equal((await issue(seminarID)).status, 503); chain.chainId = "0x13882";
    chain.balance = "0x0"; const noFunds = await issue(seminarID); assert.equal(noFunds.status, 503, JSON.stringify(noFunds)); chain.balance = "0xde0b6b3a7640000";
    assert.equal(await attempts(), 0);
    assert.equal((await rowsOf(seminarID))[0].certificateHash, null, "a failed preparation does not freeze the certificate");
  });

  let pending, pendingHash;
  await t.test("one transaction covers every eligible certificate, is saved before broadcast and tolerates an uncertain RPC response", async () => {
    pending = await preparedSeminar(db, [1, 2, 3, 4, 5], { absent: [4] }); chain.sendFails = true;
    const response = await issue(pending.seminarID); chain.sendFails = false;
    assert.equal(response.status, 200, JSON.stringify(response)); assert.equal(response.data.transactionStatus, "PENDING");
    assert.match(response.data.warning, /no new mint/); assert.equal(response.data.remaining, 0);
    assert.deepEqual(response.data.skipped.map(row => row.reason), ["Attendance is not confirmed.", "No wallet linked yet."]);
    pendingHash = response.data.transactionHash;
    assert.equal(chain.persistedBeforeSend, true);
    const rows = await rowsOf(pending.seminarID);
    assert.deepEqual(rows.map(row => row.transactionHash), [pendingHash, pendingHash, pendingHash, null, null]);
    assert.equal(rows.filter(row => row.hasPayload).length, 1, "the signed payload is stored once per batch");
    assert.ok(rows.slice(0, 3).every(row => row.status === "PENDING" && row.issuedAt === null && /^0x[0-9a-f]{64}$/.test(row.certificateHash)));
    assert.equal(new Set(rows.slice(0, 3).map(row => row.certificateHash)).size, 3);
  });

  await t.test("concurrent retries reuse the exact signed payload and block another seminar's nonce", async () => {
    const before = amoy.rawTransactions.get(pendingHash);
    const retried = await Promise.all([issue(pending.seminarID), issue(pending.seminarID)]);
    assert.ok(retried.every(response => response.status === 200 && response.data.transactionHash === pendingHash), JSON.stringify(retried));
    assert.equal(amoy.rawTransactions.get(pendingHash), before);
    assert.equal(await attempts(), 3);
    assert.equal((await issue((await preparedSeminar(db, [1])).seminarID)).status, 409);
    assert.equal((await rename(pending.seminarID, pending.certificates[0].certificateID, "Changed Name")).status, 409, "a name in a signed batch is frozen");
  });

  await t.test("waits for finality, verifies the receipt and atomically records tokens and issuance time", async t => {
    amoy.mine(pendingHash); chain.finalized = 10n;
    assert.equal((await check(pending.seminarID)).data.transactionStatus, "PENDING"); chain.finalized = 12n; chain.blockMatches = false;
    assert.equal((await check(pending.seminarID)).data.transactionStatus, "PENDING"); chain.blockMatches = true;
    t.mock.method(console, "error", () => {});
    await db.query(`CREATE FUNCTION reject_test_issuance() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status = 'ISSUED' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER reject_test_issuance BEFORE UPDATE ON certificate FOR EACH ROW EXECUTE FUNCTION reject_test_issuance();`);
    try {
      assert.equal((await check(pending.seminarID)).status, 500);
      assert.ok((await rowsOf(pending.seminarID)).slice(0, 3).every(row => row.status === "PENDING" && row.transactionStatus === "PENDING"));
    } finally { await db.query(`DROP TRIGGER reject_test_issuance ON certificate; DROP FUNCTION reject_test_issuance()`); }
    const confirmed = await check(pending.seminarID);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed));
    assert.equal(confirmed.data.transactionStatus, "CONFIRMED"); assert.equal(confirmed.data.issued, 3); assert.equal(confirmed.data.batchId, "1");
    const rows = (await rowsOf(pending.seminarID)).slice(0, 3);
    assert.deepEqual(rows.map(row => row.tokenID), [1, 2, 3], "tokens follow certificate-number order");
    assert.ok(rows.every(row => row.status === "ISSUED" && row.issuedAt && row.transactionStatus === "CONFIRMED" && row.blockNum === 10 && row.requestedBy === 1));
    const sends = chain.sendCount;
    assert.equal((await issue(pending.seminarID)).status, 409); assert.equal(chain.sendCount, sends);
  });

  await t.test("students see their token and can download a Merkle inclusion proof that anyone can check", async () => {
    const visible = (await send("GET", "/student/certificates", student1)).data.find(row => row.certificateID === pending.certificates[0].certificateID);
    assert.equal(visible.tokenID, 1); assert.equal(visible.transactionHash, pendingHash); assert.equal(visible.status, "ISSUED");
    assert.equal("signedTransaction" in visible, false);
    const { status, data } = await send("GET", `/student/certificates/${visible.certificateID}/proof`, student1);
    assert.equal(status, 200, JSON.stringify(data));
    assert.equal(data.tokenId, "1"); assert.equal(data.index, 0); assert.equal(data.transactionHash, pendingHash);
    assert.equal(data.contractAddress, amoy.contractAddress); assert.equal(data.certificate.recipientName, "Student 1");
    assert.equal(keccak256(toBytes(JSON.stringify(data.certificate))), data.certificateHash, "the published facts reproduce the hash");
    assert.equal(data.merkleProof.length, 2);
    assert.equal(verifyMerkleProof(data.merkleRoot, data.index, data.certificateHash, data.merkleProof), true);
    assert.equal(verifyMerkleProof(data.merkleRoot, 1, data.certificateHash, data.merkleProof), false, "the proof is bound to the token's position");
    // Another student's certificate and a certificate that is not issued have no proof to give.
    assert.equal((await send("GET", `/student/certificates/${pending.certificates[1].certificateID}/proof`, student1)).status, 404);
    const unissued = await preparedSeminar(db, [1]);
    assert.equal((await send("GET", `/student/certificates/${unissued.certificates[0].certificateID}/proof`, student1)).status, 404);
    assert.equal((await send("GET", "/student/certificates/abc/proof", student1)).status, 400);
  });

  await t.test("a seminar larger than ISSUE_BATCH_SIZE is issued in consecutive batches", async () => {
    process.env.ISSUE_BATCH_SIZE = "2";
    const { seminarID } = await preparedSeminar(db, [1, 2, 3]);
    const first = await issue(seminarID);
    assert.equal(first.data.transactionStatus, "PENDING"); assert.equal(first.data.remaining, 1);
    amoy.mine(first.data.transactionHash);
    const firstDone = await check(seminarID);
    assert.equal(firstDone.data.transactionStatus, "CONFIRMED"); assert.equal(firstDone.data.issued, 2); assert.equal(firstDone.data.remaining, 1);
    const second = await issue(seminarID);
    assert.equal(second.data.remaining, 0); assert.notEqual(second.data.transactionHash, first.data.transactionHash);
    amoy.mine(second.data.transactionHash);
    assert.equal((await check(seminarID)).data.issued, 1);
    assert.deepEqual((await rowsOf(seminarID)).map(row => [row.status, row.tokenID]), [["ISSUED", 4], ["ISSUED", 5], ["ISSUED", 6]]);
    delete process.env.ISSUE_BATCH_SIZE;
  });

  await t.test("a finalized revert fails the whole batch and is retryable with the same certificate numbers", async () => {
    const { seminarID } = await preparedSeminar(db, [1, 2]); const first = await issue(seminarID); assert.equal(first.status, 200, JSON.stringify(first));
    amoy.mine(first.data.transactionHash, { reverted: true }); const failed = await check(seminarID);
    assert.equal(failed.data.transactionStatus, "FAILED"); assert.equal(failed.data.remaining, 2);
    assert.ok((await rowsOf(seminarID)).every(row => row.status === "FAILED" && row.transactionStatus === "FAILED"));
    const retry = await issue(seminarID); assert.equal(retry.data.transactionStatus, "PENDING"); assert.notEqual(retry.data.transactionHash, first.data.transactionHash);
    amoy.mine(retry.data.transactionHash); assert.equal((await check(seminarID)).data.issued, 2);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM blockchain_record b JOIN certificate c USING ("certificateID") WHERE c."seminarID" = $1`, [seminarID])).rows[0].n, 4);
  });

  await t.test("faculty can correct a recipient name until it is issued", async () => {
    const { seminarID, certificates: [certificate] } = await preparedSeminar(db, [1]);
    const id = certificate.certificateID;
    assert.equal((await rename(seminarID, id, "Juan P. Dela Cruz", assistant)).status, 403);
    for (const name of ["", "   ", "x".repeat(256), "a\u0007b", 42]) assert.equal((await rename(seminarID, id, name)).status, 400);
    assert.equal((await rename(seminarID, "9999", "Juan P. Dela Cruz")).status, 404);
    assert.equal((await rename(pending.seminarID, id, "Juan P. Dela Cruz")).status, 404, "the certificate must belong to the seminar");
    const renamed = await rename(seminarID, id, "  Juan P. Dela Cruz ");
    assert.equal(renamed.status, 200, JSON.stringify(renamed)); assert.equal(renamed.data.recipientName, "Juan P. Dela Cruz");
    // After a failed attempt the old hash is cleared with the old name, and the retry hashes the corrected one.
    const first = await issue(seminarID); amoy.mine(first.data.transactionHash, { reverted: true }); await check(seminarID);
    const failedHash = (await rowsOf(seminarID))[0].certificateHash;
    assert.equal((await rename(seminarID, id, "Juan Pablo Dela Cruz")).status, 200);
    assert.equal((await rowsOf(seminarID))[0].certificateHash, null);
    const retry = await issue(seminarID); amoy.mine(retry.data.transactionHash); assert.equal((await check(seminarID)).data.issued, 1);
    const [issued] = await rowsOf(seminarID);
    assert.equal(issued.recipientName, "Juan Pablo Dela Cruz"); assert.notEqual(issued.certificateHash, failedHash);
    assert.equal((await rename(seminarID, id, "Too Late")).status, 409);
  });

  await t.test("unmatched receipts stay pending and cannot falsely mark certificates issued", async () => {
    const { seminarID } = await preparedSeminar(db, [1, 2]), response = await issue(seminarID);
    amoy.mine(response.data.transactionHash, { validEvent: false });
    assert.equal((await check(seminarID)).status, 409);
    assert.ok((await rowsOf(seminarID)).every(row => row.status === "PENDING" && row.transactionStatus === "PENDING"));
  });
});

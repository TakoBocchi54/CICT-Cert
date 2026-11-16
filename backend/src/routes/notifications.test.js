import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import { isolatedDatabase, preparedSeminar, seedAccounts, sessionCookie, skip, startAmoy } from "./amoyFixture.js";

process.env.SESSION_SECRET = "notifications-route-test-secret-only";
const { default: router } = await import("./notifications.js");
const { pool } = await import("../db/pool.js");

test("notifications for students and faculty, with PostgreSQL and a local Amoy RPC fixture", { skip }, async t => {
  const { db, close } = await isolatedDatabase(pool, "notifications");
  const amoy = await startAmoy(db), { chain } = amoy;
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await amoy.close(); await close();
  });
  // Faculty 1 (user 1) can issue, faculty 2 (user 2) cannot; students 1–4 are users 3–6.
  await seedAccounts(db, amoy.issuer.address, { withWallets: 3, withoutWallets: 1 });
  const app = express(); app.use(express.json(), cookieParser()); app.use("/api", router);
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/api/notifications";
  const issuer = await sessionCookie("FACULTY", "1", "1"), assistant = await sessionCookie("FACULTY", "2", "2");
  const student = id => sessionCookie("STUDENT", String(id + 2), String(id));
  async function request(cookie, path = "", method = "GET") {
    const response = await fetch(base + path, { method, headers: cookie ? { Cookie: cookie } : {} });
    return { status: response.status, data: await response.json() };
  }
  const kinds = data => data.items.map(item => item.kind);

  // Seminar A: deadline passed, students 1 and 2 registered; student 1's certificate issued, student 2's revoked.
  const { rows: [a] } = await db.query(`INSERT INTO seminar ("seminarTitle","seminarDate","createdBy","venue","registrationClosesAt")
    VALUES ('Web Security','2026-11-09',1,'AVR',now() - interval '1 hour') RETURNING "seminarID"`);
  await db.query(`INSERT INTO seminar_registration ("seminarID","studentID",attended,"registeredAt") VALUES ($1,1,true,now() - interval '2 hours'),($1,2,true,now() - interval '2 hours')`, [a.seminarID]);
  const certificate = async (studentID, revoked) => (await db.query(`INSERT INTO certificate ("studentID","seminarID","studentWalletID","issuerWalletID","authorizedBy",
      "recipientName","seminarTitle","seminarDate","certificateHash",status,"issuedAt","revokedAt")
    VALUES ($1::int,$2,$1::int,1,1,'Student ' || $1::text,'Web Security','2026-11-09',$3,$4,now() - interval '3 hours',$5) RETURNING "certificateID","certificateNo"`,
    [studentID, a.seminarID, "0x" + randomBytes(32).toString("hex"), revoked ? "REVOKED" : "ISSUED", revoked ? new Date(Date.now() - 20 * 60_000) : null])).rows[0];
  const issued = await certificate(1, false), revoked = await certificate(2, true);
  await db.query(`INSERT INTO blockchain_record ("certificateID","transactionType","transactionHash","requestedBy","revocationReason",network,"transactionStatus","blockNum","tokenID")
    VALUES ($1,'REVOKE',$2,1,'Name misspelled','polygon-amoy','CONFIRMED',5,2)`, [revoked.certificateID, "0x" + randomBytes(32).toString("hex")]);
  // A failed mint still unresolved, and a mint pending for 20 minutes.
  const failed = await preparedSeminar(db, [3]), stuck = await preparedSeminar(db, [4]);
  for (const [seminar, status, age] of [[failed, "FAILED", "1 hour"], [stuck, "PENDING", "20 minutes"]]) {
    await db.query(`INSERT INTO blockchain_record ("certificateID","transactionType","transactionHash","requestedBy",network,"transactionStatus","createdAt")
      VALUES ($1,'MINT',$2,1,'polygon-amoy',$3,now() - $4::interval)`, [seminar.certificates[0].certificateID, "0x" + randomBytes(32).toString("hex"), status, age]);
  }

  await t.test("needs a session for an account that still exists", async () => {
    assert.equal((await request(null)).status, 401);
    assert.equal((await request(await sessionCookie("STUDENT", "99", "99"))).status, 401);
    assert.equal((await request(await sessionCookie("FACULTY", "3", "1"))).status, 401, "a student's user ID with a faculty role");
  });

  await t.test("students see only their own issued and revoked certificates", async () => {
    const one = (await request(await student(1))).data;
    assert.deepEqual(kinds(one), ["issued"]);
    assert.deepEqual([one.unread, one.items[0].link], [1, `/student/certificates/${issued.certificateNo}`]);
    const two = (await request(await student(2))).data;
    assert.deepEqual(kinds(two), ["revoked", "issued"]);
    assert.match(two.items[0].text, new RegExp(`No\\. ${revoked.certificateNo} for Web Security was revoked: Name misspelled`));
    assert.deepEqual(kinds((await request(await student(3))).data), []);
  });

  await t.test("faculty see registrations and closed deadlines; only issuers see transaction problems", async () => {
    const helper = (await request(assistant)).data;
    assert.ok(kinds(helper).includes("registrations") && kinds(helper).includes("closed"));
    assert.ok(!kinds(helper).some(kind => ["failed", "pending", "low-balance"].includes(kind)));
    const closed = helper.items.find(item => item.id === `closed:${a.seminarID}`);
    assert.deepEqual([closed.text, closed.link], ["Registration for Web Security closed with 2 registered.", `/faculty/issue?seminar=${a.seminarID}`]);
    assert.equal(helper.items.find(item => item.id === `registrations:${a.seminarID}`).text, "2 students registered for Web Security.");

    const lead = (await request(issuer)).data;
    const problem = kind => lead.items.find(item => item.kind === kind);
    assert.deepEqual([problem("failed").text, problem("failed").link],
      ["Issuing 1 certificate for Web Security failed on-chain. Issue them again.", `/faculty/issue?seminar=${failed.seminarID}`]);
    assert.equal(problem("pending").link, `/faculty/issue?seminar=${stuck.seminarID}`);
    assert.equal(problem("low-balance"), undefined, "1 POL is above the 0.5 POL threshold");
  });

  await t.test("marking as seen clears the count; new registrations are counted as new", async () => {
    assert.ok((await request(issuer)).data.unread > 0);
    assert.deepEqual(await request(issuer, "/seen", "POST"), { status: 200, data: { unread: 0 } });
    assert.equal((await request(issuer)).data.unread, 0);
    assert.ok((await request(assistant)).data.unread > 0, "read state is per account");
    await db.query(`INSERT INTO seminar_registration ("seminarID","studentID") VALUES ($1,3)`, [a.seminarID]);
    const after = (await request(issuer)).data;
    assert.equal(after.unread, 1);
    assert.equal(after.items[0].text, "1 new registration for Web Security (3 in total).");
  });

  await t.test("a low issuer balance shows to issuers until it is topped up", async () => {
    const lowSince = async () => (await db.query(`SELECT "lowBalanceSince" FROM issuer_wallet`)).rows[0].lowBalanceSince;
    chain.balance = "0x16345785d8a0000"; // 0.1 POL
    const low = (await request(issuer)).data.items.find(item => item.kind === "low-balance");
    assert.match(low.text, /has 0\.1 POL, below 0\.5 POL/);
    const since = await lowSince();
    assert.ok(since);
    assert.ok(!kinds((await request(assistant)).data).includes("low-balance"));
    await request(issuer);
    assert.deepEqual(await lowSince(), since, "the drop keeps its first time while the balance stays low");
    chain.balance = "0xde0b6b3a7640000"; // 1 POL
    assert.ok(!kinds((await request(issuer)).data).includes("low-balance"));
    assert.equal(await lowSince(), null);
    chain.balance = "0x16345785d8a0000";
    assert.ok(kinds((await request(issuer)).data).includes("low-balance"), "a new drop shows again");
    chain.rpcFails = true;
    try { assert.equal((await request(issuer)).status, 200, "an unreachable RPC only leaves the balance out"); } finally { chain.rpcFails = false; }
  });

});

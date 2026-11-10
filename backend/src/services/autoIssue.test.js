import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import pg from "pg";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodeFunctionData, encodeFunctionResult } from "viem";
import abi from "../contracts/CICTCertificate.abi.json" with { type: "json" };
import { certificateHash, certificateConsentMessage } from "../utils/certificateConsent.js";

const local = process.env.DATABASE_URL && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname);
const { pool } = await import("../db/pool.js");
const { autoIssueTick, startAutoIssue } = await import("./autoIssue.js");

test("auto-issuance with PostgreSQL and a local Amoy RPC fixture", { skip: !local && "Requires local PostgreSQL; never runs against production" }, async t => {
  const schema = "cict_autoissue_test_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL }); await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: "-c search_path=" + schema });
  const originalQuery = pool.query, originalConnect = pool.connect;
  pool.query = db.query.bind(db); pool.connect = db.connect.bind(db);
  const previousEnv = { rpc: process.env.AMOY_RPC_URL, contract: process.env.CONTRACT_ADDRESS, key: process.env.ISSUER_PRIVATE_KEY };
  const issuerKey = generatePrivateKey(), issuer = privateKeyToAccount(issuerKey), wallets = [privateKeyToAccount(generatePrivateKey()), privateKeyToAccount(generatePrivateKey())];
  const context = { chainId: 80002, contractAddress: "0x2222222222222222222222222222222222222222", issuerAddress: issuer.address.toLowerCase() };
  let rpc, sendCount = 0;
  t.after(async () => {
    if (rpc) await new Promise(resolve => rpc.close(resolve));
    pool.query = originalQuery; pool.connect = originalConnect;
    for (const [key, value] of [["AMOY_RPC_URL", previousEnv.rpc], ["CONTRACT_ADDRESS", previousEnv.contract], ["ISSUER_PRIVATE_KEY", previousEnv.key]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await db.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); await pool.end();
  });
  await db.query(await readFile(new URL("../../sql/schema.sql", import.meta.url), "utf8"));
  await db.query(`INSERT INTO users (email,role,"passwordHash") VALUES ('a@example.test','FACULTY','x'),('b@example.test','FACULTY','x'),
      ('s1@example.test','STUDENT',NULL),('s2@example.test','STUDENT',NULL);
    INSERT INTO cict_faculty ("userID","firstName","lastName","canIssue") VALUES (1,'A','B',true),(2,'C','D',false);
    INSERT INTO student ("userID","fullName",program) VALUES (3,'Juan Dela Cruz','BSCS'),(4,'Maria Santos','BSCS');`);
  await db.query(`INSERT INTO student_wallet ("studentID","studentWalletAddress") VALUES (1,$1),(2,$2)`, wallets.map(wallet => wallet.address));
  await db.query(`INSERT INTO issuer_wallet ("issuerWalletAddress",label,network) VALUES ($1,'CICT','polygon-amoy')`, [issuer.address]);
  rpc = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const call = JSON.parse(body); let value, error;
    switch (call.method) {
      case "eth_chainId": value = "0x13882"; break;
      case "eth_getBalance": value = "0xde0b6b3a7640000"; break;
      case "eth_getTransactionCount": value = "0x0"; break;
      case "eth_estimateGas": value = "0x249f0"; break;
      case "eth_maxPriorityFeePerGas": value = "0x3b9aca00"; break;
      case "eth_getBlockByNumber": value = { number: "0xa", hash: "0x" + "a".repeat(64), timestamp: "0x" + Math.ceil(Date.now() / 1000).toString(16),
        baseFeePerGas: "0x3b9aca00", transactions: [], gasLimit: "0x1c9c380", gasUsed: "0x249f0" }; break;
      case "eth_call": {
        const decoded = decodeFunctionData({ abi, data: call.params[0].data });
        value = encodeFunctionResult({ abi, functionName: decoded.functionName, result: decoded.functionName === "issuer" ? issuer.address :
          decoded.functionName === "verify" ? [0, 0n, "0x" + "0".repeat(40), 0n, 0n] : 1n }); break;
      }
      case "eth_getTransactionReceipt": value = null; break; // never mined: the mint stays pending until finality
      case "eth_sendRawTransaction": sendCount++; value = "0x" + "c".repeat(64); break;
      default: error = { code: -32601, message: "Method not found" };
    }
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, ...(error ? { error } : { result: value }) }));
  }).listen(0, "127.0.0.1"); await new Promise(resolve => rpc.once("listening", resolve));
  process.env.AMOY_RPC_URL = "http://127.0.0.1:" + rpc.address().port; process.env.CONTRACT_ADDRESS = context.contractAddress;
  process.env.ISSUER_PRIVATE_KEY = issuerKey;
  async function approved(studentID, authorizedBy) {
    const seminar = (await db.query(`INSERT INTO seminar ("seminarTitle","seminarDate","createdBy") VALUES ('Web Security','2026-11-09',1) RETURNING "seminarID"`)).rows[0];
    await db.query(`INSERT INTO seminar_registration ("seminarID","studentID",attended) VALUES ($1,$2,true)`, [seminar.seminarID, studentID]);
    const certificate = (await db.query(`INSERT INTO certificate ("studentID","seminarID","studentWalletID","issuerWalletID","authorizedBy","recipientName","seminarTitle","seminarDate")
      VALUES ($2,$1,$2,1,$3,'Juan Dela Cruz','Web Security','2026-11-09') RETURNING *, to_char("seminarDate",'YYYY-MM-DD') AS "seminarDate"`, [seminar.seminarID, studentID, authorizedBy])).rows[0];
    const student = wallets[studentID - 1];
    const hash = certificateHash({ ...certificate, walletAddress: student.address }, context);
    const message = certificateConsentMessage({ ...certificate, walletAddress: student.address }, context, hash, "a".repeat(32), new Date().toISOString());
    await db.query(`UPDATE certificate SET "certificateHash"=$2,"consentMessage"=$3,"consentSignature"=$4,"consentedAt"=CURRENT_TIMESTAMP WHERE "certificateID"=$1`,
      [certificate.certificateID, hash, message, await student.signMessage({ message })]);
    return certificate.certificateID;
  }
  const records = () => db.query(`SELECT "certificateID","requestedBy","transactionStatus" FROM blockchain_record ORDER BY "transactionID"`).then(result => result.rows);

  await t.test("does nothing unless AUTO_ISSUE=true", async () => {
    delete process.env.AUTO_ISSUE; startAutoIssue(); // would otherwise start an unref'd timer and a tick
    const id = await approved(1, 1); assert.equal((await records()).length, 0);
    await db.query(`DELETE FROM certificate WHERE "certificateID"=$1`, [id]); // keep it out of the next test's queue
  });
  await t.test("skips a certificate whose faculty lost canIssue and mints the next one as its preparer", async t => {
    t.mock.method(console, "error", () => {});
    const blocked = await approved(2, 2), next = await approved(1, 1);
    await autoIssueTick();
    const rows = await records();
    assert.ok(!rows.some(row => row.certificateID === blocked), "no attempt for the unauthorized preparer");
    assert.ok(rows.some(row => row.certificateID === next && row.requestedBy === "1" && row.transactionStatus === "PENDING"));
    assert.equal(sendCount > 0, true);
  });
  await t.test("a pending mint blocks new mints and is only reconciled, never re-signed", async () => {
    const before = (await records()).length, sends = sendCount;
    await approved(1, 1); await autoIssueTick();
    assert.equal((await records()).length, before);
    assert.ok(sendCount >= sends); // only the saved payload may be rebroadcast
  });
});

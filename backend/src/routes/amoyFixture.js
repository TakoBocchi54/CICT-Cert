// Test support only (not a test file): an isolated PostgreSQL schema and a local JSON-RPC server that
// behaves like CICTCertificate on Amoy. Shared by the issuance, revocation and verification route tests.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import pg from "pg";
import { SignJWT } from "jose";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, keccak256, parseTransaction, zeroAddress } from "viem";
import abi from "../contracts/CICTCertificate.abi.json" with { type: "json" };
import { smtRoot, verifyMerkleProof, verifySmtProof } from "../utils/merkle.js";

// These tests create and drop schemas, so they only ever run against a local database.
export const local = Boolean(process.env.DATABASE_URL) && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname);
export const skip = !local && "Requires local PostgreSQL; never runs against production";

// Points the app's pool at a fresh cict_<name>_test_<uuid> schema loaded from sql/schema.sql.
export async function isolatedDatabase(pool, name) {
  if (!local) throw new Error("Refusing to create a test schema on a non-local database");
  const schema = `cict_${name}_test_` + randomUUID().replaceAll("-", "");
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL }); await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: "-c search_path=" + schema });
  const original = { query: pool.query, connect: pool.connect };
  pool.query = db.query.bind(db); pool.connect = db.connect.bind(db);
  await db.query(await readFile(new URL("../../sql/schema.sql", import.meta.url), "utf8"));
  return { db, async close() {
    pool.query = original.query; pool.connect = original.connect;
    // Only the generated, isolated test schema is deleted.
    await db.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); await pool.end();
  } };
}

export async function sessionCookie(role = "FACULTY", userID = "1", id = "1") {
  return "cict_session=" + await new SignJWT({ role, userID, [role === "FACULTY" ? "facultyID" : "studentID"]: id })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode(process.env.SESSION_SECRET));
}

// Faculty 1 may issue, faculty 2 may not. Students 1..withWallets have a linked wallet; the rest do not.
export async function seedAccounts(db, issuerAddress, { withWallets = 3, withoutWallets = 1 } = {}) {
  const wallets = Array.from({ length: withWallets }, () => privateKeyToAccount(generatePrivateKey()).address);
  await db.query(`INSERT INTO users (email,role,"passwordHash") VALUES ('faculty@example.test','FACULTY','test'),('assistant@example.test','FACULTY','test');
    INSERT INTO cict_faculty ("userID","firstName","lastName","canIssue") VALUES (1,'A','B',true),(2,'C','D',false);`);
  for (let i = 1; i <= withWallets + withoutWallets; i++) {
    const { rows: [user] } = await db.query(`INSERT INTO users (email,role) VALUES ($1,'STUDENT') RETURNING "userID"`, [`student.${"abcdefghij"[i - 1]}@example.test`] /* no digits: registry search also matches certificate numbers */);
    await db.query(`INSERT INTO student ("userID","fullName",program) VALUES ($1,$2,'BSCS')`, [user.userID, `Student ${i}`]);
    if (i <= withWallets) await db.query(`INSERT INTO student_wallet ("studentID","studentWalletAddress","consentMessage","consentSignature") VALUES ($1,$2,'consent','0xsig')`, [i, wallets[i - 1]]);
  }
  await db.query(`INSERT INTO issuer_wallet ("issuerWalletAddress",label,network) VALUES ($1,'CICT','polygon-amoy')`, [issuerAddress]);
  return wallets;
}

// A seminar with prepared (PENDING) certificates for the given students, as the prepare step leaves them.
export async function preparedSeminar(db, studentIDs, { absent = [] } = {}) {
  const { rows: [seminar] } = await db.query(`INSERT INTO seminar ("seminarTitle","seminarDate","createdBy") VALUES ('Web Security','2026-11-09',1) RETURNING "seminarID"`);
  const certificates = [];
  for (const studentID of studentIDs) {
    await db.query(`INSERT INTO seminar_registration ("seminarID","studentID",attended) VALUES ($1,$2,$3)`, [seminar.seminarID, studentID, !absent.includes(studentID)]);
    certificates.push((await db.query(`INSERT INTO certificate ("studentID","seminarID","studentWalletID","issuerWalletID","authorizedBy","recipientName","seminarTitle","seminarDate")
      SELECT $1::bigint,$2,(SELECT "studentWalletID" FROM student_wallet WHERE "studentID"=$1::bigint),1,1,'Student ' || $1::text,'Web Security','2026-11-09'
      RETURNING "certificateID","certificateNo"`, [studentID, seminar.seminarID])).rows[0]);
  }
  return { seminarID: seminar.seminarID, certificates };
}

export async function startAmoy(db, contractAddress = "0x2222222222222222222222222222222222222222") {
  const issuerKey = generatePrivateKey(), issuer = privateKeyToAccount(issuerKey);
  // Tests flip these to simulate failures; the token/batch state below is the contract's storage.
  const chain = { chainId: "0x13882", balance: "0xde0b6b3a7640000", sendFails: false, rpcFails: false, sendCount: 0, nonce: 0, finalized: 12n, blockMatches: true,
    persistedBeforeSend: true, revocationRoot: smtRoot([]), lastBatchId: 0n, lastTokenId: 0n };
  const rawTransactions = new Map(), receipts = new Map(), batches = new Map(), tokens = new Map();
  const blockHash = "0x" + "a".repeat(64);
  const now = () => BigInt(Math.ceil(Date.now() / 1000));

  function call(data) {
    const { functionName, args } = decodeFunctionData({ abi, data });
    let result;
    if (functionName === "issuer") result = issuer.address;
    else if (functionName === "revocationRoot") result = chain.revocationRoot;
    else if (functionName === "issueBatch") result = chain.lastBatchId + 1n;
    else if (functionName === "revokeBatch") result = undefined;
    else if (functionName === "verify") {
      const [tokenId, certHash, proof, bitmap, siblings] = args, token = tokens.get(tokenId);
      if (!token) result = [0, zeroAddress, 0n, 0n, 0n];
      else {
        const batch = batches.get(token.batchId);
        const status = verifyMerkleProof(batch.root, Number(tokenId - batch.firstTokenId), certHash, proof) && verifySmtProof(chain.revocationRoot, tokenId, { bitmap, siblings });
        if (!status) throw new Error("A proof that does not fit reverts");
        result = [status === "Valid" ? 1 : 2, token.owner, token.batchId, batch.seminarId, batch.issuedAt];
      }
    } else throw new Error("Unsupported call");
    return encodeFunctionResult({ abi, functionName, result });
  }

  const rpc = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body); let value, error;
    try {
      if (chain.rpcFails) throw new Error("RPC down");
      switch (request.method) {
        case "eth_chainId": value = chain.chainId; break;
        case "eth_getBalance": value = chain.balance; break;
        case "eth_getTransactionCount": value = "0x" + chain.nonce.toString(16); break;
        case "eth_estimateGas": value = "0x249f0"; break;
        case "eth_maxPriorityFeePerGas": value = "0x3b9aca00"; break;
        case "eth_getBlockByNumber": value = { number: "0x" + (request.params[0] === "finalized" ? chain.finalized : 10n).toString(16),
          hash: chain.blockMatches ? blockHash : "0x" + "b".repeat(64), timestamp: "0x" + now().toString(16),
          baseFeePerGas: "0x3b9aca00", transactions: [], gasLimit: "0x1c9c380", gasUsed: "0x249f0" }; break;
        case "eth_call": value = call(request.params[0].data); break;
        case "eth_getTransactionReceipt": value = receipts.get(request.params[0]) || null; break;
        case "eth_sendRawTransaction": {
          chain.sendCount++; const raw = request.params[0], hash = keccak256(raw);
          const saved = (await db.query(`SELECT "signedTransaction" FROM blockchain_record WHERE "transactionHash" = $1 AND "signedTransaction" IS NOT NULL`, [hash])).rows;
          chain.persistedBeforeSend &&= saved.length === 1 && saved[0].signedTransaction === raw;
          rawTransactions.set(hash, raw);
          if (chain.sendFails) throw new Error("Connection lost after acceptance");
          value = hash; break;
        }
        default: error = { code: -32601, message: "Method not found" };
      }
    } catch { error = { code: -32000, message: "Test RPC error" }; }
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, ...(error ? { error } : { result: value }) }));
  }).listen(0, "127.0.0.1"); await new Promise(resolve => rpc.once("listening", resolve));

  const previous = Object.fromEntries(["AMOY_RPC_URL", "CONTRACT_ADDRESS", "ISSUER_PRIVATE_KEY"].map(name => [name, process.env[name]]));
  process.env.AMOY_RPC_URL = "http://127.0.0.1:" + rpc.address().port; process.env.CONTRACT_ADDRESS = contractAddress; process.env.ISSUER_PRIVATE_KEY = issuerKey;

  // Mines a broadcast transaction into block 10 and applies it to the contract state.
  function mine(hash, { reverted = false, validEvent = true } = {}) {
    const { functionName, args } = decodeFunctionData({ abi, data: parseTransaction(rawTransactions.get(hash)).data });
    const logs = [];
    const log = (eventName, indexed, types, values) => logs.push({ address: contractAddress, blockHash, blockNumber: "0xa", transactionHash: hash,
      transactionIndex: "0x0", logIndex: "0x" + logs.length.toString(16), removed: false,
      topics: encodeEventTopics({ abi, eventName, args: indexed }), data: encodeAbiParameters(types, values) });
    if (!reverted && functionName === "issueBatch") {
      const [seminarId, root, recipients, certHashes] = args, batchId = ++chain.lastBatchId, firstTokenId = chain.lastTokenId + 1n;
      batches.set(batchId, { root, seminarId, issuedAt: now(), firstTokenId });
      recipients.forEach((to, i) => {
        tokens.set(firstTokenId + BigInt(i), { batchId, owner: to });
        log("Issued", { from: issuer.address, to, tokenId: firstTokenId + BigInt(i) }, [{ type: "uint8" }], [3]);
      });
      chain.lastTokenId += BigInt(recipients.length);
      log("BatchIssued", { batchId, seminarId }, [{ type: "bytes32" }, { type: "uint64" }, { type: "bytes32[]" }], [root, firstTokenId, certHashes]);
    }
    if (!reverted && functionName === "revokeBatch") {
      log("RevocationRootUpdated", { previousRoot: chain.revocationRoot, newRoot: args[0] }, [{ type: "uint256[]" }], [args[1]]);
      chain.revocationRoot = args[0];
    }
    receipts.set(hash, { transactionHash: hash, blockHash, blockNumber: "0xa", from: issuer.address, to: contractAddress,
      status: reverted ? "0x0" : "0x1", logs: validEvent ? logs : [], transactionIndex: "0x0", gasUsed: "0x249f0",
      cumulativeGasUsed: "0x249f0", effectiveGasPrice: "0x3b9aca00", type: "0x2" });
    chain.nonce++;
  }

  return { chain, issuer, issuerKey, contractAddress, rawTransactions, mine,
    context: { chainId: 80002, contractAddress, issuerAddress: issuer.address.toLowerCase() },
    async close() {
      await new Promise(resolve => rpc.close(resolve));
      for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    } };
}

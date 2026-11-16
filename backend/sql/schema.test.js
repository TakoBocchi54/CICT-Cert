import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";

const local = process.env.DATABASE_URL && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname);
const sql = (name) => readFile(new URL(name, import.meta.url), "utf8");

async function isolatedSchema(run) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const schema = `cict_schema_test_${randomUUID().replaceAll("-", "")}`;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await run(client);
  } finally {
    await client.query("ROLLBACK");
    // The name is generated here, never taken from configuration or user input.
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}

async function seed(client, legacy = false) {
  await client.query(`
    INSERT INTO users ("email", "role", "passwordHash", "createdAt") VALUES
      ('faculty@example.test', 'FACULTY', 'test-only', '2026-01-01 08:00:00+08'),
      ('${legacy ? " Student@Example.Test " : "student@example.test"}', 'STUDENT', NULL, '2026-01-01 08:00:00+08'),
      ('other@example.test', 'STUDENT', NULL, '2026-01-01 08:00:00+08');
    INSERT INTO cict_faculty ("userID", "firstName", "lastName", "canIssue") VALUES (1, 'Ana', 'Reyes', true);
    ${legacy
      ? `INSERT INTO student ("userID", "firstName", "lastName", "program") VALUES (2, 'Juan', 'Dela Cruz', 'BSCS'), (3, 'Maria', 'Reyes', 'BSIT');`
      : `INSERT INTO student ("userID", "fullName", "program") VALUES (2, 'Juan Dela Cruz', 'BSCS'), (3, 'Maria Reyes', 'BSIT');`}
    ${legacy
      ? `INSERT INTO student_wallet ("studentID", "studentWalletAddress") VALUES (1, '0x1111111111111111111111111111111111111111'), (2, '0x2222222222222222222222222222222222222222');`
      : wallets}
    INSERT INTO issuer_wallet ("issuerWalletAddress", "label", "network") VALUES ('0x3333333333333333333333333333333333333333', 'CICT', 'polygon-amoy');
  `);
}

// Wallet links carry the signed consent message since migration 007.
const wallets = `INSERT INTO student_wallet ("studentID", "studentWalletAddress", "consentMessage", "consentSignature") VALUES
  (1, '0x1111111111111111111111111111111111111111', 'consent', '0xsig'), (2, '0x2222222222222222222222222222222222222222', 'consent', '0xsig');`;

async function rejectsSQL(client, statement, pattern) {
  await client.query("SAVEPOINT expected_failure");
  try {
    await assert.rejects(client.query(statement), pattern);
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT expected_failure");
    await client.query("RELEASE SAVEPOINT expected_failure");
  }
}

const draft = `( "studentID", "seminarID", "issuerWalletID", "recipientName", "seminarTitle", "seminarDate" )
    VALUES (1, 1, 1, 'Juan Dela Cruz', 'Web Security', '2026-11-08')`;

for (const migrated of [false, true]) {
  test(`${migrated ? "migrated" : "fresh"} schema protects seminar issuance`, { skip: !local && "Requires a local PostgreSQL DATABASE_URL; never tests against production" }, async () => {
    await isolatedSchema(async (client) => {
      await client.query(await sql(migrated ? "fixtures/legacy-schema.sql" : "schema.sql"));
      await seed(client, migrated);
      if (migrated) {
        await client.query("SELECT set_config('cict.legacy_timezone', 'Asia/Manila', false)");
        await client.query(await sql("migrations/001_seminar_issuance.sql"));
        await client.query(await sql("migrations/002_remove_replacement_link.sql"));
        await client.query(await sql("migrations/003_remove_failure_reason.sql"));
        await client.query(await sql("migrations/004_remove_certificate_created_at.sql"));
        await client.query(await sql("migrations/005_signed_transaction.sql"));
        await client.query(await sql("migrations/005_signed_transaction.sql"));
        const { rows: [profile] } = await client.query(`SELECT s."studentID", s."fullName", u."email", u."createdAt", w."studentWalletID"
          FROM student s JOIN users u USING ("userID") JOIN student_wallet w USING ("studentID") WHERE s."studentID" = 1`);
        assert.equal(profile.fullName, "Juan Dela Cruz");
        assert.equal(profile.email, "student@example.test");
        assert.equal(profile.createdAt.toISOString(), "2026-01-01T00:00:00.000Z");
        assert.equal(profile.studentWalletID, "1");
        const { rows: oldNames } = await client.query(`SELECT column_name FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'student' AND column_name IN ('firstName', 'lastName')`);
        assert.equal(oldNames.length, 0);
        // 007 refuses wallet links without saved consent; the documented step is the test-data reset.
        await assert.rejects(client.query(await sql("migrations/007_merkle_batches.sql")), /resetTestData/);
        await client.query("ROLLBACK");
        await client.query(`TRUNCATE student_wallet, certificate, blockchain_record RESTART IDENTITY`);
        await client.query(await sql("migrations/006_certificate_templates.sql"));
        await client.query(await sql("migrations/007_merkle_batches.sql"));
        await client.query(await sql("migrations/008_integer_ids.sql"));
        await client.query(await sql("migrations/009_seminar_registration_link.sql"));
        await client.query(wallets);
      }
      await client.query("BEGIN");
      assert.equal((await client.query(`SELECT "signedTransaction" FROM blockchain_record LIMIT 1`)).rowCount, 0);
      const { rows: [seminar] } = await client.query(`INSERT INTO seminar ("seminarTitle", "seminarDate", "createdBy") VALUES ('Web Security', '2026-11-08', 1) RETURNING *`);
      // Every seminar gets its own link token; registration stays closed until a deadline is set.
      assert.match(seminar.registrationToken, /^[0-9a-f-]{36}$/);
      assert.equal(seminar.registrationClosesAt, null);
      await rejectsSQL(client, `UPDATE seminar SET "venue" = ' ' WHERE "seminarID" = 1`, /venue/);
      await rejectsSQL(client, `INSERT INTO certificate ${draft}`, /fk_certificate_registration/);
      await client.query(`INSERT INTO seminar_registration ("seminarID", "studentID") VALUES (1, 1), (1, 2)`);
      await rejectsSQL(client, `INSERT INTO seminar_registration ("seminarID", "studentID") VALUES (1, 1)`, /seminar_registration_pkey/);
      const { rows: [pending] } = await client.query(`INSERT INTO certificate ${draft} RETURNING *`);
      assert.equal(pending.status, "PENDING");
      assert.equal(pending.studentWalletID, null);
      assert.equal(pending.certificateHash, null);
      assert.equal(pending.issuedAt, null);
      assert.equal(Object.hasOwn(pending, "createdAt"), false);
      assert.equal(Object.hasOwn(pending, "replacesCertificateID"), false);
      assert.equal(pending.certificateNo, 2); // Sequences also advance for rejected inserts.
      await rejectsSQL(client, `INSERT INTO certificate ${draft}`, /uq_certificate_active_registration/);
      const id = pending.certificateID;
      await rejectsSQL(client, `UPDATE certificate SET "studentWalletID" = 2 WHERE "certificateID" = ${id}`, /fk_certificate_student_wallet_match/);
      await rejectsSQL(client, `UPDATE certificate SET "certificateHash" = '0x${"a".repeat(64)}' WHERE "certificateID" = ${id}`, /chk_certificate_hash_wallet/);
      await rejectsSQL(client, `INSERT INTO student_wallet ("studentID", "studentWalletAddress", "consentMessage", "consentSignature")
        VALUES (3, '0x4444444444444444444444444444444444444444', ' ', '0xsig')`, /consentMessage/);
      assert.equal(Object.hasOwn(pending, "consentedAt"), false);
      await rejectsSQL(client, `UPDATE certificate SET "status" = 'ISSUED' WHERE "certificateID" = ${id}`, /chk_certificate_issuance/);
      await client.query(`UPDATE certificate SET "studentWalletID" = 1, "authorizedBy" = 1,
        "certificateHash" = '0x${"a".repeat(64)}' WHERE "certificateID" = ${id}`);
      // Once hashed (a batch is being signed) the facts are frozen; a name correction must clear the hash with it.
      await rejectsSQL(client, `UPDATE certificate SET "recipientName" = 'Changed name' WHERE "certificateID" = ${id}`, /Clear the certificate hash/);
      await client.query(`UPDATE certificate SET "recipientName" = 'Juan P. Dela Cruz', "certificateHash" = NULL WHERE "certificateID" = ${id}`);
      await client.query(`UPDATE certificate SET "certificateHash" = '0x${"a".repeat(64)}' WHERE "certificateID" = ${id}`);
      const { rows: [issued] } = await client.query(`UPDATE certificate SET "status" = 'ISSUED', "issuedAt" = CURRENT_TIMESTAMP WHERE "certificateID" = ${id} RETURNING "issuedAt"`);
      assert.ok(issued.issuedAt instanceof Date);
      await rejectsSQL(client, `UPDATE certificate SET "recipientName" = 'Changed name' WHERE "certificateID" = ${id}`, /immutable/);
      await rejectsSQL(client, `UPDATE certificate SET "status" = 'PENDING', "issuedAt" = NULL WHERE "certificateID" = ${id}`, /immutable/);
      await client.query(`UPDATE certificate SET "status" = 'REVOKED', "revokedAt" = CURRENT_TIMESTAMP WHERE "certificateID" = ${id}`);
      await rejectsSQL(client, `UPDATE certificate SET "status" = 'ISSUED', "revokedAt" = NULL WHERE "certificateID" = ${id}`, /immutable/);
      const { rows: [replacement] } = await client.query(`INSERT INTO certificate ${draft} RETURNING "certificateID", "certificateNo"`);
      assert.notEqual(replacement.certificateNo, pending.certificateNo);

      const attempt = `INSERT INTO blockchain_record ("certificateID", "transactionType", "requestedBy", "network", "transactionStatus")
        VALUES (${replacement.certificateID}, 'MINT', 1, 'polygon-amoy', 'PENDING') RETURNING *`;
      const { rows: [transaction] } = await client.query(attempt);
      assert.ok(transaction.createdAt instanceof Date);
      assert.equal(Object.hasOwn(transaction, "failureReason"), false);
      await rejectsSQL(client, attempt, /uq_blockchain_pending_certificate/);
      // The certificates of one batch share a transaction hash.
      await client.query(`INSERT INTO blockchain_record ("certificateID", "transactionType", "transactionHash", "requestedBy", "network", "transactionStatus")
        VALUES (${id}, 'MINT', '0x${"b".repeat(64)}', 1, 'polygon-amoy', 'FAILED'), (${replacement.certificateID}, 'MINT', '0x${"b".repeat(64)}', 1, 'polygon-amoy', 'FAILED')`);
      await rejectsSQL(client, `UPDATE blockchain_record SET "transactionStatus" = 'CONFIRMED'`, /chk_transaction_confirmation/);
      await client.query(`UPDATE blockchain_record SET "transactionStatus" = 'FAILED'`);
      await client.query(attempt);
      await rejectsSQL(client, `INSERT INTO blockchain_record ("certificateID", "transactionType", "requestedBy", "network", "transactionStatus")
        VALUES (${id}, 'REVOKE', 1, 'polygon-amoy', 'PENDING')`, /chk_transaction_revocation_reason/);
      await client.query("COMMIT");
    });
  });
}

test("migration rolls back when certificate history needs a backfill", { skip: !local && "Requires local PostgreSQL" }, async () => {
  await isolatedSchema(async (client) => {
    await client.query(await sql("fixtures/legacy-schema.sql"));
    await seed(client, true);
    await client.query(`INSERT INTO certificate ("certificateNo", "studentID", "studentWalletID", "authorizedBy", "issuerWalletID", "recipientName", "seminarTitle", "seminarDate", "certificateHash", "status")
      VALUES (100, 1, 1, 1, 1, 'Juan Dela Cruz', 'Earlier seminar', '2026-01-01', 'legacy-hash', 'ISSUED')`);
    await client.query("SELECT set_config('cict.legacy_timezone', 'Asia/Manila', false)");
    await assert.rejects(client.query(await sql("migrations/001_seminar_issuance.sql")), /reviewed seminar and consent backfill/);
    await client.query("ROLLBACK");
    const { rows: [row] } = await client.query(`SELECT "firstName", "lastName" FROM student WHERE "studentID" = 1`);
    assert.equal(row.lastName, "Dela Cruz");
    assert.equal((await client.query("SELECT * FROM certificate")).rowCount, 1);
    assert.equal((await client.query("SELECT * FROM users")).rowCount, 3);
  });
});

test("a late migration failure restores the old columns and account data", { skip: !local && "Requires local PostgreSQL" }, async () => {
  await isolatedSchema(async (client) => {
    await client.query(await sql("fixtures/legacy-schema.sql"));
    await seed(client, true);
    await client.query(`UPDATE student_wallet SET "studentWalletAddress" = 'invalid-legacy-address' WHERE "studentID" = 1`);
    await client.query("SELECT set_config('cict.legacy_timezone', 'Asia/Manila', false)");
    await assert.rejects(client.query(await sql("migrations/001_seminar_issuance.sql")), /chk_student_wallet_address/);
    await client.query("ROLLBACK");
    const { rows: [student] } = await client.query(`SELECT s."firstName", s."lastName", u."email"
      FROM student s JOIN users u USING ("userID") WHERE s."studentID" = 1`);
    assert.equal(student.lastName, "Dela Cruz");
    assert.equal(student.email, " Student@Example.Test ");
    assert.equal((await client.query("SELECT * FROM student_wallet")).rowCount, 2);
  });
});

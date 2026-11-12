import "dotenv/config";
import { readFile } from "node:fs/promises";
import { pool } from "../src/db/pool.js";

const [legacyTimezone] = process.argv.slice(2);
if (!legacyTimezone) {
  console.error('Usage: node scripts/migrateSeminarSchema.js "<original timestamp timezone>"');
  process.exitCode = 1;
} else {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('cict.legacy_timezone', $1, false)", [legacyTimezone]);
    for (const name of [
      "001_seminar_issuance.sql",
      "002_remove_replacement_link.sql",
      "003_remove_failure_reason.sql",
      "004_remove_certificate_created_at.sql",
      "005_signed_transaction.sql",
      "006_certificate_templates.sql",
    ]) {
      const sql = await readFile(new URL(`../sql/migrations/${name}`, import.meta.url), "utf8");
      await client.query(sql);
      console.log("Applied", name);
    }
    console.log("Seminar schema migration applied. Existing accounts and wallet links preserved.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Current migration rolled back; earlier completed migrations remain applied:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}
await pool.end();

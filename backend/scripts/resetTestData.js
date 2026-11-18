import "dotenv/config";
import { pool } from "../src/db/pool.js";
import { certificateContract } from "../src/services/certificates.js";
import abi from "../src/contracts/CICTCertificate.abi.json" with { type: "json" };

// Pre-deployment cleanup: removes ALL seminars, students, certificates and transaction records.
// Keeps faculty accounts and issuer_wallet. It cannot touch anything already minted on-chain, so it only runs
// against a freshly deployed CONTRACT_ADDRESS: on a used contract the chain's revocation root would no longer match
// the (now empty) database, and every verification and revocation would fail from then on.
const tables = ["blockchain_record", "certificate", "seminar_registration", "seminar", "student_wallet", "student"];
const counts = async client => {
  const result = {};
  for (const name of [...tables, "users WHERE role = 'STUDENT'"]) result[name] = (await client.query(`SELECT count(*)::int AS n FROM ${name}`)).rows[0].n;
  return result;
};

const client = await pool.connect();
try {
  console.log(`Database: ${new URL(process.env.DATABASE_URL).host}`);
  const { client: rpc, address } = certificateContract();
  const batches = await rpc.readContract({ address, abi, functionName: "lastBatchId" });
  if (batches !== 0n) {
    throw new Error(`CONTRACT_ADDRESS ${address} has already issued ${batches} batch(es). Deploy a new contract, set CONTRACT_ADDRESS to it, then reset.`);
  }
  console.log(`Contract: ${address} (fresh, nothing issued yet)`);
  console.log("Rows that will be deleted:", await counts(client));
  if (!process.argv.includes("--yes")) {
    console.log("Nothing deleted. Back up first, then re-run with --yes.");
  } else {
    await client.query("BEGIN");
    await client.query(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY`); // also restarts certificate_number_seq
    await client.query(`DELETE FROM users WHERE role = 'STUDENT'`);
    await client.query("COMMIT");
    console.log("Done. Remaining:", await counts(client));
  }
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Reset failed; nothing was changed:", err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

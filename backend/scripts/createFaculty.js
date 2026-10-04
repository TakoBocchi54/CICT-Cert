import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool } from "../src/db/pool.js";

const [email, password, firstName, lastName, canIssueArg = "true"] = process.argv.slice(2);

if (!email || !password || !firstName || !lastName) {
  console.error('Usage: node scripts/createFaculty.js <email> <password> <firstName> <lastName> [canIssue=true|false]');
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const canIssue = canIssueArg !== "false";
const client = await pool.connect();

try {
  const hash = await bcrypt.hash(password, 10);
  await client.query("BEGIN");

  const { rows } = await client.query(
    `INSERT INTO users ("email", "passwordHash", "role")
     VALUES ($1, $2, 'FACULTY') RETURNING "userID"`,
    [email.toLowerCase().trim(), hash]
  );

  await client.query(
    `INSERT INTO cict_faculty ("userID", "firstName", "lastName", "canIssue")
     VALUES ($1, $2, $3, $4)`,
    [rows[0].userID, firstName, lastName, canIssue]
  );

  await client.query("COMMIT");
  console.log(`Faculty account created for ${email} (canIssue: ${canIssue})`);
} catch (err) {
  await client.query("ROLLBACK");
  console.error(err.code === "23505" ? "That email is already registered." : err.message);
} finally {
  client.release();
  await pool.end();
}

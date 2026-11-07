import "dotenv/config";
import { pool } from "../src/db/pool.js";

const [email, fullName, program] = process.argv.slice(2);

if (!email?.trim() || !fullName?.trim() || fullName.trim().length > 255 ||
    !program?.trim() || program.trim().length > 255) {
  console.error('Usage: node scripts/createStudent.js <email> "<fullName>" "<program>" (name and program: 1–255 characters)');
  process.exit(1);
}

const client = await pool.connect();

try {
  await client.query("BEGIN");

  const { rows } = await client.query(
    `INSERT INTO users ("email", "role")
     VALUES ($1, 'STUDENT') RETURNING "userID"`,
    [email.toLowerCase().trim()]
  );

  await client.query(
    `INSERT INTO student ("userID", "fullName", "program")
     VALUES ($1, $2, $3)`,
    [rows[0].userID, fullName.trim(), program.trim()]
  );

  await client.query("COMMIT");
  console.log(`Student account created for ${email} (${program})`);
  console.log('Note: Wallet address will be linked when student signs in with Google.');
} catch (err) {
  await client.query("ROLLBACK");
  console.error(err.code === "23505" ? "That email is already registered." : err.message);
} finally {
  client.release();
  await pool.end();
}

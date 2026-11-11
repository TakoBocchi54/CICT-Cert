import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireFaculty, requireActiveFaculty, requireCanIssue } from "../middleware/requireFaculty.js";
import { registerStudents, StudentError } from "../services/students.js";
import { readRegistrationCsv, readStudentRows, CsvError } from "../utils/seminarCsv.js";

// Student accounts: registering a Google account here is what lets the student sign in.
const router = Router();
router.use("/faculty/students", requireFaculty, requireActiveFaculty);

const MAX_ROWS = 500;

router.get("/faculty/students", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 255) : "";
  // shortcut: first 200 matches only, no paging; add paging when a search routinely returns more.
  const { rows } = await pool.query(
    `SELECT s."studentID", s."fullName", s."program", u."email", u."createdAt",
            (w."studentWalletID" IS NOT NULL) AS "walletConnected",
            (SELECT count(*)::int FROM seminar_registration r WHERE r."studentID" = s."studentID" AND r."attended") AS "seminarsAttended",
            (SELECT count(*)::int FROM certificate c WHERE c."studentID" = s."studentID") AS "certificates"
     FROM student s JOIN users u ON u."userID" = s."userID"
     LEFT JOIN student_wallet w ON w."studentID" = s."studentID"
     WHERE $1 = '' OR s."fullName" ILIKE '%' || $1 || '%' OR u."email" ILIKE '%' || $1 || '%'
     ORDER BY s."fullName", s."studentID" LIMIT 200`, [q.replace(/[\\%_]/g, "\\$&")],
  );
  // Removable = safe to delete: the student never linked a wallet and has no certificate in any state.
  res.json(rows.map(row => ({ ...row, removable: !row.walletConnected && row.certificates === 0 })));
});

async function register(res, { students, duplicatesSkipped }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await registerStudents(client, students);
    await client.query("COMMIT");
    res.status(201).json({ created: result.created, existing: students.length - result.created, duplicatesSkipped, students: result.students });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally { client.release(); }
}

// Bulk: the same CSV format as before (full_name, program, google_account; extra columns ignored).
router.post("/faculty/students/import", async (req, res) => register(res, readRegistrationCsv(req.body?.csv)));

// One or more students as JSON, from the single-student form and the attendance preview.
router.post("/faculty/students", async (req, res) => {
  const rows = req.body?.students;
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) {
    return res.status(400).json({ error: `Send between 1 and ${MAX_ROWS} students.` });
  }
  await register(res, readStudentRows(rows.map(row => ({ full_name: row?.fullName, program: row?.program, google_account: row?.googleAccount })), "Row"));
});

// Undo for a mistaken registration. Only accounts that never linked a wallet (so never finished signing in) and have
// no certificate can be removed; their attendance rows go with them.
router.delete("/faculty/students/:studentID", requireCanIssue, async (req, res) => {
  const id = req.params.studentID;
  if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) return res.status(400).json({ error: "Invalid student ID." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Locking the student row blocks a concurrent wallet link or certificate insert until this commits.
    const student = (await client.query(`SELECT "userID" FROM student WHERE "studentID" = $1 FOR UPDATE`, [id])).rows[0];
    if (!student) throw new StudentError(404, "Student not found.");
    const used = await client.query(
      `SELECT EXISTS (SELECT 1 FROM student_wallet WHERE "studentID" = $1) OR EXISTS (SELECT 1 FROM certificate WHERE "studentID" = $1) AS used`, [id]);
    if (used.rows[0].used) throw new StudentError(409, "This student has a linked wallet or a certificate and cannot be removed.");
    await client.query(`DELETE FROM seminar_registration WHERE "studentID" = $1`, [id]);
    await client.query(`DELETE FROM student WHERE "studentID" = $1`, [id]);
    await client.query(`DELETE FROM users WHERE "userID" = $1 AND "role" = 'STUDENT'`, [student.userID]);
    await client.query("COMMIT");
    res.status(204).end();
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally { client.release(); }
});

router.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof CsvError) return res.status(400).json({ error: err.message });
  if (err instanceof StudentError) return res.status(err.status).json({ error: err.message });
  console.error("Student request failed:", { code: err.code || "REQUEST_FAILED" });
  res.status(500).json({ error: "Could not save or load student records. Please try again." });
});

export default router;

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../db/pool.js";
import { verifyIdToken } from "../services/web3auth.js";
import { startSession } from "../utils/session.js";

// Public seminar registration through the link faculty share. This is the only way a student account is created
// besides faculty; the login page still refuses Google accounts that never registered.
const router = Router();

const NOT_FOUND = "This registration link is wrong or the seminar no longer exists.";
const LOGIN_FAILED = "Could not verify your login";
const FACULTY = "This Google account belongs to a faculty member and can't register as a student.";

router.param("token", (req, res, next, value) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return res.status(404).json({ error: NOT_FOUND });
  next();
});

// The verified, normalized Google email of an optional `Authorization: Bearer <Web3Auth ID token>`, or null without
// one. Throws when a token is sent but fails verification or carries no email.
async function signedInEmail(req) {
  const idToken = req.headers.authorization?.replace(/^Bearer /, "");
  if (!idToken) return null;
  const email = (await verifyIdToken(idToken)).email?.toLowerCase().trim();
  if (!email) throw new Error("No email on the identity token");
  return email;
}

const SEMINAR = `SELECT "seminarID", "seminarTitle", to_char("seminarDate", 'YYYY-MM-DD') AS "seminarDate", "venue",
  "registrationClosesAt", coalesce("registrationClosesAt" > now(), false) AS "open" FROM seminar WHERE "registrationToken" = $1`;

// Seminar details for the page; when signed in, also the student's current profile and whether they're registered.
router.get("/register/:token", async (req, res) => {
  let email;
  try { email = await signedInEmail(req); } catch { return res.status(401).json({ error: LOGIN_FAILED }); }
  const { rows: [seminar] } = await pool.query(SEMINAR, [req.params.token]);
  if (!seminar) return res.status(404).json({ error: NOT_FOUND });
  const { seminarID, ...details } = seminar;
  if (!email) return res.json(details);
  const { rows: [account] } = await pool.query(
    `SELECT u."role", s."fullName", s."program", s."contactNumber",
            EXISTS (SELECT 1 FROM seminar_registration r WHERE r."seminarID" = $2 AND r."studentID" = s."studentID") AS "registered"
     FROM users u LEFT JOIN student s ON s."userID" = u."userID" WHERE u."email" = $1`, [email, seminarID]);
  if (account && account.role !== "STUDENT") return res.status(403).json({ error: FACULTY });
  res.json({ ...details, email, registered: !!account?.registered,
    account: account?.fullName ? { fullName: account.fullName, program: account.program, contactNumber: account.contactNumber } : null });
});

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // A whole class may register at once from one campus IP.
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again in a few minutes." },
});

const profileText = value => typeof value === "string" ? value.trim().replace(/ +/g, " ") : "";
// Spaces, dashes, dots and parentheses are dropped, so "0917 123 4567" and "+63 (917) 123-4567" are stored as digits.
const contactNumber = value => typeof value === "string" ? value.replace(/[\s().-]/g, "") : "";

// Creates the student account when missing (or saves the edited profile), registers them for the seminar
// and starts their session. Registering twice is not an error.
router.post("/register/:token", registerLimiter, async (req, res) => {
  let email;
  try { email = await signedInEmail(req); } catch { email = null; }
  if (!email) return res.status(401).json({ error: LOGIN_FAILED });
  const fullName = profileText(req.body?.fullName), program = profileText(req.body?.program);
  if ([fullName, program].some(value => !value || value.length > 255 || /[\u0000-\u001f\u007f]/.test(value))) {
    return res.status(400).json({ error: "Enter your full name and program, each 1–255 characters without line breaks." });
  }
  const contact = contactNumber(req.body?.contactNumber);
  if (!/^\+?\d{7,15}$/.test(contact)) {
    return res.status(400).json({ error: "Enter a contact number of 7–15 digits, for example 09171234567 or +639171234567." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // FOR SHARE: registrations run side by side but wait for closing, editing or preparing the seminar.
    const { rows: [seminar] } = await client.query(SEMINAR + " FOR SHARE", [req.params.token]);
    const refuse = async (status, error) => { await client.query("ROLLBACK"); res.status(status).json({ error }); };
    if (!seminar) return await refuse(404, NOT_FOUND);
    if (!seminar.open) return await refuse(409, "Registration for this seminar is closed.");
    await client.query(`INSERT INTO users ("email", "role") VALUES ($1, 'STUDENT') ON CONFLICT ("email") DO NOTHING`, [email]);
    const { rows: [user] } = await client.query(`SELECT "userID", "role" FROM users WHERE "email" = $1`, [email]);
    if (user.role !== "STUDENT") return await refuse(403, FACULTY);
    const { rows: [student] } = await client.query(
      `INSERT INTO student ("userID", "fullName", "program", "contactNumber") VALUES ($1, $2, $3, $4)
       ON CONFLICT ("userID") DO UPDATE SET "fullName" = EXCLUDED."fullName", "program" = EXCLUDED."program",
         "contactNumber" = EXCLUDED."contactNumber"
       RETURNING "studentID", "fullName"`, [user.userID, fullName, program, contact]);
    const registered = await client.query(
      `INSERT INTO seminar_registration ("seminarID", "studentID") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [seminar.seminarID, student.studentID]);
    const { rows: [wallet] } = await client.query(
      `SELECT "studentWalletAddress" FROM student_wallet WHERE "studentID" = $1`, [student.studentID]);
    await client.query("COMMIT");
    await startSession(res, { role: "STUDENT", userID: user.userID, studentID: student.studentID });
    res.status(registered.rowCount ? 201 : 200).json({ studentID: student.studentID, email, fullName: student.fullName,
      walletAddress: wallet?.studentWalletAddress ?? null, alreadyRegistered: !registered.rowCount });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally { client.release(); }
});

router.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  console.error("Seminar registration failed:", { code: err.code || "REQUEST_FAILED" });
  res.status(500).json({ error: "Could not complete your registration. Please try again." });
});

export default router;

import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { pool } from "../db/pool.js";
import { startSession } from "../utils/session.js";
import { requireFaculty } from "../middleware/requireFaculty.js";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again in a few minutes." },
});

// Compared against when the email doesn't exist, so response time doesn't reveal valid emails
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

router.post("/auth/faculty/login", loginLimiter, async (req, res) => {
  const email = String(req.body.email ?? "").toLowerCase().trim();
  const password = String(req.body.password ?? "");
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const { rows } = await pool.query(
    `SELECT u."userID", u."passwordHash",
            f."facultyID", f."firstName", f."lastName", f."canIssue"
     FROM users u
     JOIN cict_faculty f ON f."userID" = u."userID"
     WHERE LOWER(u."email") = $1 AND u."role" = 'FACULTY'`,
    [email]
  );

  const faculty = rows[0];
  const ok = await bcrypt.compare(password, faculty?.passwordHash ?? DUMMY_HASH);
  if (!faculty || !ok) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  await startSession(res, {
    role: "FACULTY",
    userID: faculty.userID,
    facultyID: faculty.facultyID,
  });

  res.json({
    facultyID: faculty.facultyID,
    firstName: faculty.firstName,
    lastName: faculty.lastName,
    canIssue: faculty.canIssue,
  });
});

router.get("/auth/faculty/me", requireFaculty, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT "facultyID", "firstName", "lastName", "canIssue"
     FROM cict_faculty WHERE "facultyID" = $1`,
    [req.faculty.facultyID]
  );
  if (rows.length === 0) return res.status(401).json({ error: "Account not found" });
  res.json(rows[0]);
});

export default router;

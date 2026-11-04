import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { pool } from "../db/pool.js";
import { requireFaculty } from "../middleware/requireFaculty.js";

export const router = Router();
router.use("/faculty/account", requireFaculty);
router.use("/faculty/account", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/faculty/account", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT f."facultyID", f."firstName", f."lastName", f."canIssue", u."email"
     FROM cict_faculty f JOIN users u ON u."userID" = f."userID"
     WHERE f."facultyID" = $1 AND u."userID" = $2 AND u."role" = 'FACULTY'`,
    [req.faculty.facultyID, req.faculty.userID]
  );
  if (!rows[0]) return res.status(401).json({ error: "Account not found" });
  res.json(rows[0]);
});

router.patch("/faculty/account", async (req, res) => {
  const firstName = typeof req.body?.firstName === "string" ? req.body.firstName.trim() : "";
  const lastName = typeof req.body?.lastName === "string" ? req.body.lastName.trim() : "";
  if (!firstName || !lastName || firstName.length > 255 || lastName.length > 255) {
    return res.status(400).json({ error: "First and last names must each contain 1?255 characters." });
  }
  const { rows } = await pool.query(
    `UPDATE cict_faculty f SET "firstName" = $1, "lastName" = $2
     FROM users u WHERE f."facultyID" = $3 AND f."userID" = $4
     AND u."userID" = f."userID" AND u."role" = 'FACULTY'
     RETURNING f."facultyID", f."firstName", f."lastName", f."canIssue", u."email"`,
    [firstName, lastName, req.faculty.facultyID, req.faculty.userID]
  );
  if (!rows[0]) return res.status(401).json({ error: "Account not found" });
  res.json(rows[0]);
});

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => String(req.faculty.userID),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many password change attempts. Try again in 15 minutes." },
});

router.post("/faculty/account/password", passwordLimiter, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body ?? {};
  if (typeof currentPassword !== "string" || !currentPassword ||
      typeof newPassword !== "string" || newPassword.length < 12 ||
      Buffer.byteLength(newPassword, "utf8") > 72 ||
      Buffer.byteLength(currentPassword, "utf8") > 72) {
    return res.status(400).json({ error: "Enter your current password and a new password of at least 12 characters (maximum 72 UTF-8 bytes)." });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: "New passwords do not match." });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: "Choose a password different from your current password." });
  }
  const { rows } = await pool.query(
    `SELECT u."passwordHash" FROM users u
     JOIN cict_faculty f ON f."userID" = u."userID"
     WHERE u."userID" = $1 AND f."facultyID" = $2 AND u."role" = 'FACULTY'`,
    [req.faculty.userID, req.faculty.facultyID]
  );
  if (!rows[0]) return res.status(401).json({ error: "Account not found" });
  if (!(await bcrypt.compare(currentPassword, rows[0].passwordHash))) {
    return res.status(400).json({ error: "Current password is incorrect." });
  }
  const hash = await bcrypt.hash(newPassword, 12);
  const result = await pool.query(
    `UPDATE users SET "passwordHash" = $1
     WHERE "userID" = $2 AND "passwordHash" = $3 AND "role" = 'FACULTY'`,
    [hash, req.faculty.userID, rows[0].passwordHash]
  );
  if (!result.rowCount) return res.status(409).json({ error: "Your password changed during this request. Try again with your current password." });
  res.json({ message: "Password updated successfully." });
});

router.use((err, _req, res, _next) => {
  console.error("Faculty account request failed:", err.message);
  res.status(500).json({ error: "Could not update or load your account. Please try again." });
});

export default router;

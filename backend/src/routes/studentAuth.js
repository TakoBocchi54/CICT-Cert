import { Router } from "express";
import { pool } from "../db/pool.js";
import { verifyIdToken } from "../services/web3auth.js";
import { startSession, COOKIE } from "../utils/session.js";

const router = Router();

router.post("/auth/student/session", async (req, res) => {
  const idToken = req.headers.authorization?.replace(/^Bearer /, "");
  if (!idToken) return res.status(401).json({ error: "Missing identity token" });

  let payload;
  try {
    payload = await verifyIdToken(idToken);
  } catch (err) {
    console.warn("Student token verification failed:", {
      code: err.code || "TOKEN_REJECTED",
      message: err.message,});
    return res.status(401).json({ error: "Could not verify your login" });
  }

  const email = payload.email?.toLowerCase().trim();
  if (!email) return res.status(400).json({ error: "No email found on this login" });

  const { rows } = await pool.query(
    `SELECT u."userID", s."studentID", s."firstName", s."lastName",
            w."studentWalletAddress" AS "walletAddress"
     FROM users u
     JOIN student s ON s."userID" = u."userID"
     LEFT JOIN student_wallet w ON w."studentID" = s."studentID"
     WHERE LOWER(u."email") = $1 AND u."role" = 'STUDENT'`,
    [email]
  );

  if (rows.length === 0) {
    return res.status(403).json({ error: "You're not registered. Please contact CICT." });
  }

  const s = rows[0];
  await startSession(res, { role: "STUDENT", userID: s.userID, studentID: s.studentID });
  res.json({
    studentID: s.studentID,
    firstName: s.firstName,
    lastName: s.lastName,
    walletAddress: s.walletAddress,
  });
});

router.post("/auth/logout", (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

export default router;

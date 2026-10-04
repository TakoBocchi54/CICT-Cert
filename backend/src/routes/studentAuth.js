import { Router } from "express";
import { pool } from "../db/pool.js";
import { verifyIdTokenDev } from "../services/web3auth-dev.js";
import { startSession, COOKIE } from "../utils/session.js";

const router = Router();

router.post("/auth/student/session", async (req, res) => {
  const idToken = req.headers.authorization?.replace(/^Bearer /, "");
  if (!idToken) return res.status(401).json({ error: "Missing identity token" });

  console.log("Received token (first 50 chars):", idToken.substring(0, 50) + "...");
  
  // Decode token without verification to see its structure
  try {
    const parts = idToken.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    console.log("Token payload (unverified):", JSON.stringify(payload, null, 2));
  } catch (e) {
    console.log("Could not decode token:", e.message);
  }

  let payload;
  try {
    payload = await verifyIdTokenDev(idToken);
    console.log("Token verified successfully. Payload:", payload);
  } catch (err) {
    console.error("ID token verification failed:", err.message);
    return res.status(401).json({ error: "Could not verify your login" });
  }

  const email = payload.email?.toLowerCase().trim();
  if (!email) return res.status(400).json({ error: "No email found on this login" });

  console.log("Looking up student with email:", email);

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

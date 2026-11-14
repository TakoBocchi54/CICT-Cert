import { Router } from "express";
import { randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getAddress, isAddress, verifyMessage } from "viem";
import { pool } from "../db/pool.js";
import { requireStudent } from "../middleware/requireStudent.js";
import { secret } from "../utils/session.js";
import { walletConsentMessage } from "../utils/certificateConsent.js";

const router = Router();

// Step 1: server creates the message the student must sign
router.get("/wallet/nonce", requireStudent, async (req, res) => {
  const { studentID } = req.student;
  const message = walletConsentMessage(studentID, randomBytes(16).toString("hex"), new Date().toISOString());

  const challenge = await new SignJWT({ purpose: "wallet-link", message })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(studentID))
    .setExpirationTime("5m")
    .sign(secret);

  res.json({ message, challenge });
});

// Step 2: student sends back the signature; server verifies and saves
router.post("/wallet/link", requireStudent, async (req, res) => {
  const { address, signature, challenge } = req.body;
  const { studentID } = req.student;

  if (!isAddress(address) || !signature || !challenge) {
    return res.status(400).json({ error: "Invalid request" });
  }

  let message;
  try {
    const { payload } = await jwtVerify(challenge, secret);
    if (payload.purpose !== "wallet-link" || payload.sub !== String(studentID)) {
      throw new Error("bad challenge");
    }
    message = payload.message; // taken from the server's token, not from the client
  } catch {
    return res.status(400).json({ error: "Challenge expired. Please try again." });
  }

  const valid = await verifyMessage({ address, message, signature });
  if (!valid) return res.status(400).json({ error: "Signature does not match this wallet" });

  const checksummed = getAddress(address);

  try {
    await pool.query(
      // The signed message is kept as evidence of the student's consent to receive certificates.
      `INSERT INTO student_wallet ("studentID", "studentWalletAddress", "consentMessage", "consentSignature") VALUES ($1, $2, $3, $4)`,
      [studentID, checksummed, message, signature]
    );
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "A wallet is already linked to this account or address." });
    }
    throw err;
  }

  const { rows } = await pool.query(
    `SELECT s."studentID", s."fullName", u."email"
     FROM student s JOIN users u ON u."userID" = s."userID"
     WHERE s."studentID" = $1`,
    [studentID]
  );
  res.json({ ...rows[0], walletAddress: checksummed });
});

export default router;

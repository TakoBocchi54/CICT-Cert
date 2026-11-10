import { Router } from "express";
import { randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { verifyMessage } from "viem";
import { polygonAmoy } from "viem/chains";
import { pool } from "../db/pool.js";
import { requireStudent } from "../middleware/requireStudent.js";
import { secret } from "../utils/session.js";
import { certificateContract, certificateIssuer } from "../services/certificates.js";
import { certificateHash, certificateConsentMessage } from "../utils/certificateConsent.js";
import { autoIssueTick } from "../services/autoIssue.js";

const router = Router();
const audience = "certificate-consent";

class ConsentError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

router.use("/student/certificates", requireStudent, async (req, res, next) => {
  res.set("Cache-Control", "no-store");
  const { rows } = await pool.query(
    `SELECT s."studentID" FROM student s JOIN users u USING ("userID")
     WHERE s."studentID" = $1 AND u."userID" = $2 AND u.role = 'STUDENT'`,
    [req.student.studentID, req.student.userID],
  );
  if (!rows.length) return res.status(401).json({ error: "Student account not found." });
  next();
});

router.param("certificateID", (_req, res, next, value) => {
  if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) {
    return res.status(400).json({ error: "Invalid certificate ID." });
  }
  next();
});

router.get("/student/certificates", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c."certificateID", c."certificateNo", c."recipientName", c."seminarTitle",
            to_char(c."seminarDate", 'YYYY-MM-DD') AS "seminarDate", c.status, c."consentedAt",
            r.attended, w."studentWalletAddress" AS "walletAddress", i."issuerWalletAddress" AS "issuerAddress",
            c."certificateHash", c."issuedAt", b."tokenID", b."transactionHash", b."blockNum"
     FROM certificate c JOIN seminar_registration r USING ("seminarID", "studentID")
     JOIN issuer_wallet i USING ("issuerWalletID") LEFT JOIN student_wallet w ON w."studentID" = c."studentID"
     LEFT JOIN LATERAL (SELECT "tokenID", "transactionHash", "blockNum" FROM blockchain_record
       WHERE "certificateID" = c."certificateID" AND "transactionType" = 'MINT' AND "transactionStatus" = 'CONFIRMED'
       ORDER BY "transactionID" DESC LIMIT 1) b ON true
     WHERE c."studentID" = $1 ORDER BY c."certificateNo" DESC`,
    [req.student.studentID],
  );
  res.json(rows);
});

async function lockCertificate(client, certificateID, studentID) {
  const lookup = await client.query(
    `SELECT "seminarID" FROM certificate WHERE "certificateID" = $1 AND "studentID" = $2`, [certificateID, studentID],
  );
  if (!lookup.rowCount) throw new ConsentError(404, "Certificate not found.");
  // Match attendance/preparation lock order so an attendance correction cannot race an approval.
  await client.query(`SELECT "seminarID" FROM seminar WHERE "seminarID" = $1 FOR UPDATE`, [lookup.rows[0].seminarID]);
  const { rows } = await client.query(
    `SELECT c.*, to_char(c."seminarDate", 'YYYY-MM-DD') AS "seminarDate", r.attended,
            w."studentWalletID" AS "linkedWalletID", w."studentWalletAddress" AS "walletAddress",
            i."issuerWalletAddress" AS "issuerAddress", i."isActive", i.network
     FROM certificate c JOIN seminar_registration r USING ("seminarID", "studentID")
     JOIN issuer_wallet i USING ("issuerWalletID") LEFT JOIN student_wallet w ON w."studentID" = c."studentID"
     WHERE c."certificateID" = $1 AND c."studentID" = $2 FOR UPDATE OF c`, [certificateID, studentID],
  );
  const certificate = rows[0];
  if (!certificate) throw new ConsentError(404, "Certificate not found.");
  if (!["PENDING", "FAILED"].includes(certificate.status)) throw new ConsentError(409, "This certificate is no longer awaiting approval.");
  if (!certificate.attended) throw new ConsentError(409, "Your attendance must be confirmed before approval.");
  if (!certificate.walletAddress) throw new ConsentError(409, "Connect your Google account's wallet before approval.");
  if (!certificate.isActive || certificate.network !== "polygon-amoy") throw new ConsentError(409, "The certificate issuer is unavailable.");
  return certificate;
}

router.post("/student/certificates/:certificateID/consent-request", async (req, res) => {
  let context;
  try { context = await certificateIssuer(); }
  catch { return res.status(503).json({ error: "Cannot read the Amoy contract issuer. Please try again later." }); }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const certificate = await lockCertificate(client, req.params.certificateID, req.student.studentID);
    if (certificate.consentedAt) throw new ConsentError(409, "You have already approved this certificate.");
    if (certificate.issuerAddress.toLowerCase() !== context.issuerAddress) throw new ConsentError(409, "The certificate issuer has changed. Contact CICT.");
    const hash = certificateHash(certificate, context);
    const message = certificateConsentMessage(certificate, context, hash, randomBytes(16).toString("hex"), new Date().toISOString());
    if (!secret.length) throw new Error("Missing session configuration");
    const challenge = await new SignJWT({ purpose: audience, certificateID: certificate.certificateID, hash, context, message })
      .setProtectedHeader({ alg: "HS256" }).setSubject(req.student.studentID).setAudience(audience)
      .setIssuedAt().setExpirationTime("10m").sign(secret);
    await client.query(
      `UPDATE certificate SET "studentWalletID" = $2, "certificateHash" = $3 WHERE "certificateID" = $1`,
      [certificate.certificateID, certificate.linkedWalletID, hash],
    );
    await client.query("COMMIT");
    res.json({ certificate: { certificateID: certificate.certificateID, certificateNo: certificate.certificateNo,
      recipientName: certificate.recipientName, seminarTitle: certificate.seminarTitle, seminarDate: certificate.seminarDate,
      walletAddress: certificate.walletAddress }, context, message, challenge });
  } catch (err) { await client.query("ROLLBACK"); throw err; }
  finally { client.release(); }
});

router.post("/student/certificates/:certificateID/consent", async (req, res) => {
  const { challenge, signature } = req.body || {};
  if (typeof challenge !== "string" || challenge.length > 8192 || typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    return res.status(400).json({ error: "A certificate approval request and wallet signature are required." });
  }
  let payload;
  try {
    ({ payload } = await jwtVerify(challenge, secret, {
      algorithms: ["HS256"], audience, requiredClaims: ["exp", "iat", "sub"], maxTokenAge: "10m",
    }));
    if (payload.purpose !== audience || payload.sub !== req.student.studentID || payload.certificateID !== req.params.certificateID ||
        typeof payload.message !== "string" || !payload.context || typeof payload.hash !== "string") throw new Error("Invalid challenge");
  } catch { return res.status(400).json({ error: "Approval request is invalid or expired. Review the certificate again." }); }
  const { address } = certificateContract();
  if (payload.context.chainId !== polygonAmoy.id || payload.context.contractAddress !== address.toLowerCase()) {
    return res.status(409).json({ error: "The contract configuration changed. Review the certificate again." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const certificate = await lockCertificate(client, req.params.certificateID, req.student.studentID);
    if (payload.context.issuerAddress !== certificate.issuerAddress.toLowerCase() ||
        certificate.studentWalletID !== certificate.linkedWalletID ||
        certificateHash(certificate, payload.context) !== payload.hash || certificate.certificateHash !== payload.hash) {
      throw new ConsentError(409, "Certificate details changed. Review the certificate again.");
    }
    let valid = false;
    try { valid = await verifyMessage({ address: certificate.walletAddress, message: payload.message, signature }); }
    catch { /* Invalid signatures must not save consent. */ }
    if (!valid) throw new ConsentError(400, "The signature does not match your registered wallet.");
    if (certificate.consentedAt) {
      if (certificate.consentMessage !== payload.message || certificate.consentSignature !== signature) {
        throw new ConsentError(409, "This certificate already has a different approval.");
      }
    } else {
      await client.query(
        `UPDATE certificate SET "consentMessage" = $2, "consentSignature" = $3, "consentedAt" = CURRENT_TIMESTAMP
         WHERE "certificateID" = $1`, [certificate.certificateID, payload.message, signature],
      );
    }
    await client.query("COMMIT");
    if (process.env.AUTO_ISSUE === "true") autoIssueTick(); // not awaited; it never rejects
    res.json({ approved: true });
  } catch (err) { await client.query("ROLLBACK"); throw err; }
  finally { client.release(); }
});

router.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof ConsentError) return res.status(err.status).json({ error: err.message });
  console.error("Certificate approval failed:", { code: err.code || "REQUEST_FAILED" });
  res.status(500).json({ error: "Could not save or load certificate approval. Please try again." });
});

export default router;

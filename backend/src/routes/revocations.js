import { Router } from "express";
import { requireFaculty, requireActiveFaculty, requireCanIssue } from "../middleware/requireFaculty.js";
import { pool } from "../db/pool.js";
import { IssuanceError } from "../services/issuance.js";
import { findCertificate, prepareReplacement, revokeCertificate } from "../services/revocation.js";

const router = Router();
router.use("/faculty/certificates", requireFaculty, requireActiveFaculty);

router.param("certificateNo", (req, res, next, value) => {
  if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) {
    return res.status(400).json({ error: "Invalid certificate number." });
  }
  next();
});

// Registered before :certificateNo, which would otherwise reject "summary" as an invalid number.
router.get("/faculty/certificates/summary", async (_req, res) => {
  const list = (status, column) => pool.query(
    `SELECT "certificateNo", "recipientName", "seminarTitle", "${column}" AS "at" FROM certificate
     WHERE status = $1 ORDER BY "${column}" DESC LIMIT ${status === "ISSUED" ? 4 : 3}`, [status]);
  const [counts, issued, revoked] = await Promise.all([
    pool.query(`SELECT count(*) FILTER (WHERE status = 'ISSUED')::int AS "issuedCount", count(*) FILTER (WHERE status = 'REVOKED')::int AS "revokedCount" FROM certificate`),
    list("ISSUED", "issuedAt"), list("REVOKED", "revokedAt")]);
  res.json({ ...counts.rows[0], recentIssued: issued.rows, recentRevoked: revoked.rows });
});

// Registry: certificates that reached the chain (issued or revoked), newest first.
router.get("/faculty/certificates", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 255) : "";
  const statuses = ["ISSUED", "REVOKED"].includes(req.query.status) ? [req.query.status] : ["ISSUED", "REVOKED"];
  // shortcut: newest 200 matches only, no paging; add paging when a search routinely returns more.
  const { rows } = await pool.query(
    `SELECT c."certificateNo", c."recipientName", c."seminarTitle", to_char(c."seminarDate", 'YYYY-MM-DD') AS "seminarDate",
            c."certificateHash", c."status", c."issuedAt", c."revokedAt", u."email"
     FROM certificate c JOIN student s ON s."studentID" = c."studentID" JOIN users u ON u."userID" = s."userID"
     WHERE c."status" = ANY($1) AND ($2 = '' OR c."certificateNo"::text = $3 OR c."recipientName" ILIKE '%' || $2 || '%'
       OR u."email" ILIKE '%' || $2 || '%' OR c."seminarTitle" ILIKE '%' || $2 || '%')
     ORDER BY c."issuedAt" DESC, c."certificateNo" DESC LIMIT 200`,
    [statuses, q.replace(/[\\%_]/g, "\\$&"), q.replace(/^#/, "")],
  );
  res.json(rows);
});

router.get("/faculty/certificates/:certificateNo", async (req, res) => {
  const certificate = await findCertificate(req.params.certificateNo);
  if (!certificate) return res.status(404).json({ error: "Certificate not found." });
  res.json(certificate);
});

// /revoke may sign a new transaction; /revocation/check only reconciles or rebroadcasts the saved one.
router.post(["/faculty/certificates/:certificateNo/revoke", "/faculty/certificates/:certificateNo/revocation/check"],
  requireCanIssue, async (req, res) => {
    const allowNew = req.path.endsWith("/revoke");
    res.json(await revokeCertificate(req.params.certificateNo, req.faculty, req.body?.reason, allowNew));
  });

// Corrected facts are entered by faculty and saved only on the new certificate.
router.post("/faculty/certificates/:certificateNo/replacement", requireCanIssue, async (req, res) => {
  res.status(201).json(await prepareReplacement(req.params.certificateNo, req.faculty, req.body));
});

router.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof IssuanceError) return res.status(err.status).json({ error: err.message });
  console.error("Revocation request failed:", { code: err.code || "REQUEST_FAILED" });
  res.status(500).json({ error: "Could not load, revoke or replace the certificate. Please try again." });
});

export default router;

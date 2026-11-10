import { Router } from "express";
import { requireFaculty, requireActiveFaculty, requireCanIssue } from "../middleware/requireFaculty.js";
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

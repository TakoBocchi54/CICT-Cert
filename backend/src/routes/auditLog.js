import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireFaculty, requireActiveFaculty, requireCanIssue } from "../middleware/requireFaculty.js";

const router = Router();
router.use("/faculty/audit-log", requireFaculty, requireActiveFaculty, requireCanIssue);

// ?kind= groups actions for the page's filter (regexes over the stored action, e.g. "POST /faculty/seminars/:id/certificates/issue").
const KINDS = {
  certificates: "/certificates(/|$)",
  attendance: "/(registrations|attendance|registration)/",
  seminars: "^[A-Z]+ /faculty/seminars(/:id)?$",
  students: "^[A-Z]+ /faculty/students",
  account: "/(certificate-templates|account)",
};

// Newest first. ?before=<auditID> continues after the last row of the previous page; ?q= matches the actor or the action.
router.get("/faculty/audit-log", async (req, res) => {
  const kind = req.query.kind === undefined ? null : KINDS[req.query.kind];
  if (kind === undefined) return res.status(400).json({ error: "Unknown filter." });
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
  const before = req.query.before === undefined ? null : String(req.query.before);
  if (before !== null && !/^[1-9]\d{0,17}$/.test(before)) return res.status(400).json({ error: "Invalid cursor." });
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  const pattern = "%" + q.replace(/[\\%_]/g, "\\$&") + "%";
  const { rows } = await pool.query(
    `SELECT "auditID", "at", "actorFacultyID", "actorName", "actorEmail", "action", "ids", "details" FROM audit_log
     WHERE ($1::bigint IS NULL OR "auditID" < $1::bigint)
       AND ($2 = '' OR "actorName" ILIKE $3 OR "actorEmail" ILIKE $3 OR "action" ILIKE $3)
       AND ($5::text IS NULL OR "action" ~ $5)
     ORDER BY "auditID" DESC LIMIT $4`, [before, q, pattern, limit, kind]);
  res.json(rows);
});

router.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  console.error("Audit log request failed:", { code: err.code || "REQUEST_FAILED" });
  res.status(500).json({ error: "Could not load the audit log. Please try again." });
});

export default router;

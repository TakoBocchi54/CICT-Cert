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
  account: "/(certificate-templates|account|members)",
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
  // For /faculty/members/:id the URL only holds the changed account's internal ID, so its name and email are looked
  // up here (current values; NULL once the account is gone) for the page to show instead of the number.
  const { rows } = await pool.query(
    `SELECT a."auditID", a."at", a."actorFacultyID", a."actorName", a."actorEmail", a."action", a."ids", a."details",
            tf."firstName" || ' ' || tf."lastName" AS "targetName", tu."email" AS "targetEmail"
     FROM audit_log a
     LEFT JOIN cict_faculty tf ON a."action" ~ '^[A-Z]+ /faculty/members/:id' AND tf."facultyID" = (a."ids"->>0)::bigint
     LEFT JOIN users tu ON tu."userID" = tf."userID"
     WHERE ($1::bigint IS NULL OR a."auditID" < $1::bigint)
       AND ($2 = '' OR a."actorName" ILIKE $3 OR a."actorEmail" ILIKE $3 OR a."action" ILIKE $3)
       AND ($5::text IS NULL OR a."action" ~ $5)
     ORDER BY a."auditID" DESC LIMIT $4`, [before, q, pattern, limit, kind]);
  // Certificate numbers (in /faculty/certificates/:id/... and a batch revoke's certificateNos) are shown with their
  // seminar date, e.g. 20261118-0042, so each row gets the dates of the numbers it mentions.
  const numbersOf = row => [...(/^[A-Z]+ \/faculty\/certificates\/:id/.test(row.action) ? [row.ids[0]] : []),
    ...(Array.isArray(row.details?.certificateNos) ? row.details.certificateNos : [])]
    .map(Number).filter(no => Number.isInteger(no) && no > 0 && no <= 2147483647);
  const numbers = [...new Set(rows.flatMap(numbersOf))];
  const dates = numbers.length ? new Map((await pool.query(
    `SELECT "certificateNo", to_char("seminarDate", 'YYYY-MM-DD') AS "seminarDate" FROM certificate WHERE "certificateNo" = ANY($1::int[])`,
    [numbers])).rows.map(row => [row.certificateNo, row.seminarDate])) : new Map();
  for (const row of rows) row.certificateDates = Object.fromEntries(numbersOf(row).filter(no => dates.has(no)).map(no => [no, dates.get(no)]));
  res.json(rows);
});

router.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  console.error("Audit log request failed:", { code: err.code || "REQUEST_FAILED" });
  res.status(500).json({ error: "Could not load the audit log. Please try again." });
});

export default router;

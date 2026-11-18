import { pool } from "../db/pool.js";

// Records every successful faculty change in audit_log. Mounted once in app.js before the routers. The row is written
// when the route sends its response (res.end), not when the response finishes: a browser that leaves during a slow
// issuance never gets a "finish", but the change still happened. req.faculty is only set by requireFaculty, so login,
// student and public routes are skipped on their own.
const WRITES = new Set(["POST", "PATCH", "PUT", "DELETE"]);
// POSTs that change nothing new: the attendance preview, and the status checks the Issue step and Registry poll every
// few seconds (they only re-check or rebroadcast a transaction whose issue or revoke was already recorded).
const SKIPPED = /\/(attendance\/preview|issuance\/check|revocation\/check)$/;

// Only the fields each action actually uses are kept, so other request fields can't show up in an entry. Bodies are
// never stored whole (CSVs, passwords, images and contact numbers stay out).
const SEMINAR = ["seminarTitle", "seminarDate", "venue", "registrationClosesAt", "templateID"];
const DETAILS = [
  [/^(POST \/faculty\/seminars|PATCH \/faculty\/seminars\/:id)$/, SEMINAR],
  [/^PATCH \/faculty\/seminars\/:id\/registrations\/:id$/, ["attended"]],
  [/^PATCH \/faculty\/seminars\/:id\/certificates\/:id$/, ["recipientName"]],
  [/^POST \/faculty\/certificates\/revoke$/, ["certificateNos", "reason"]],
  [/^POST \/faculty\/certificates\/:id\/revoke$/, ["reason"]],
  [/^POST \/faculty\/certificates\/:id\/replacement$/, ["recipientName", "seminarTitle", "seminarDate"]],
  [/^(POST \/faculty\/certificate-templates|PATCH \/faculty\/certificate-templates\/:id)$/, ["name"]],
  // Never the generated password: it is only in the response, which is not logged.
  [/^POST \/faculty\/members$/, ["firstName", "lastName", "email", "canIssue"]],
  [/^PATCH \/faculty\/members\/:id$/, ["canIssue", "active"]],
];
const clip = value => typeof value === "string" ? value.slice(0, 300)
  : typeof value === "number" || typeof value === "boolean" ? value
  : Array.isArray(value) ? value.slice(0, 200).map(clip) : null;

async function record(req, status) {
  const url = req.originalUrl.split("?")[0];
  if (!req.faculty || !WRITES.has(req.method) || status >= 400 || !url.startsWith("/api/faculty/") || SKIPPED.test(url)) return;
  const action = `${req.method} ${url.replace(/^\/api/, "").replace(/\/\d+(?=\/|$)/g, "/:id")}`.slice(0, 200);
  const ids = [...url.matchAll(/\/(\d+)(?=\/|$)/g)].map(match => Number(match[1]));
  // Template uploads carry the image as the body and the name in the query string.
  const source = { ...req.query, ...(req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) ? req.body : {}) };
  const keys = DETAILS.find(([pattern]) => pattern.test(action))?.[1] ?? [];
  const details = Object.fromEntries(keys.map(key => [key, clip(source[key])]).filter(([, value]) => value !== null));
  await pool.query(
    `INSERT INTO audit_log ("actorFacultyID", "actorName", "actorEmail", "action", "ids", "details")
     SELECT f."facultyID", f."firstName" || ' ' || f."lastName", u."email", $2, $3::jsonb, $4::jsonb
     FROM cict_faculty f JOIN users u ON u."userID" = f."userID" WHERE f."facultyID" = $1`,
    [req.faculty.facultyID, action, JSON.stringify(ids), JSON.stringify(details)]);
}

export function auditLog(req, res, next) {
  const end = res.end;
  res.end = function (...args) {
    res.end = end;
    record(req, res.statusCode).catch(err => {
      // shortcut: best effort, outside the route's transaction; a failed write (or a crash right now) loses this
      // entry. Move the insert into each route's transaction if the log must be lossless.
      console.error("Audit log write failed:", { code: err.code || "AUDIT_FAILED" });
    });
    return end.apply(this, args);
  };
  next();
}

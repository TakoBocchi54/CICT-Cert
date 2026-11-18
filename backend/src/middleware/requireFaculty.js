import { jwtVerify } from "jose";
import { secret, COOKIE } from "../utils/session.js";
import { pool } from "../db/pool.js";

export async function requireFaculty(req, res, next) {
  const token = req.cookies[COOKIE];
  if (!token) return res.status(401).json({ error: "Not signed in" });
  let payload;
  try {
    ({ payload } = await jwtVerify(token, secret));
  } catch {
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }
  // One login cookie per browser: a student sign-in in another tab (e.g. a registration link) replaced this one.
  if (payload.role !== "FACULTY") {
    return res.status(401).json({ error: "This browser is now signed in as a student, probably in another tab. Sign in again as faculty." });
  }
  req.faculty = { userID: payload.userID, facultyID: payload.facultyID };
  next();
}

// Use after requireFaculty to reject sessions whose faculty account no longer exists or was deactivated.
export async function requireActiveFaculty(req, res, next) {
  res.set("Cache-Control", "no-store");
  const { rows } = await pool.query(
    `SELECT f."facultyID" FROM cict_faculty f JOIN users u ON u."userID" = f."userID"
     WHERE f."facultyID" = $1 AND u."userID" = $2 AND u."role" = 'FACULTY' AND f."deactivatedAt" IS NULL`,
    [req.faculty.facultyID, req.faculty.userID],
  );
  if (!rows.length) return res.status(401).json({ error: "Faculty account not found." });
  next();
}

// Use after requireFaculty on routes that issue or revoke certificates.
// Reads the flag from the database each time, so revoking access takes effect immediately.
export async function requireCanIssue(req, res, next) {
  const { rows } = await pool.query(
    `SELECT "canIssue" FROM cict_faculty WHERE "facultyID" = $1`,
    [req.faculty.facultyID]
  );
  if (!rows[0]?.canIssue) {
    return res.status(403).json({ error: "You are not authorized to issue certificates" });
  }
  next();
}

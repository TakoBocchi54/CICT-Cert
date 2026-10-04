import { jwtVerify } from "jose";
import { secret, COOKIE } from "../utils/session.js";
import { pool } from "../db/pool.js";

export async function requireFaculty(req, res, next) {
  const token = req.cookies[COOKIE];
  if (!token) return res.status(401).json({ error: "Not signed in" });
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.role !== "FACULTY") throw new Error("wrong role");
    req.faculty = { userID: payload.userID, facultyID: payload.facultyID };
    next();
  } catch {
    res.status(401).json({ error: "Session expired. Please sign in again." });
  }
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

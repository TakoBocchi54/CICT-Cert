import { Router } from "express";
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { requireFaculty, requireActiveFaculty, requireCanIssue } from "../middleware/requireFaculty.js";

// Faculty account management for faculty with issuing permission: add organizers, set what they may do, reset a
// password, switch an account off or on. Accounts are never deleted (seminars, certificates and the audit log point at them).
const router = Router();
router.use("/faculty/members", requireFaculty, requireActiveFaculty, requireCanIssue);
router.use("/faculty/members", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
router.param("facultyID", (req, res, next, value) => {
  if (!/^[1-9]\d{0,9}$/.test(value) || BigInt(value) > 2147483647n) return res.status(400).json({ error: "Invalid faculty ID." });
  next();
});

class MemberError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const MEMBER_COLUMNS = `f."facultyID", f."firstName", f."lastName", f."canIssue", f."deactivatedAt", f."temporaryPassword",
  u."email", u."createdAt"`;

// 16 characters from an alphabet without look-alikes (0/O, 1/l/I), grouped for reading aloud: about 92 bits.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
export function temporaryPassword() {
  const chars = Array.from({ length: 16 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return chars.match(/.{4}/g).join("-");
}

const nameText = value => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
const validName = value => value.length >= 1 && value.length <= 255 && !/[\u0000-\u001f\u007f]/.test(value);

router.get("/faculty/members", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT ${MEMBER_COLUMNS} FROM cict_faculty f JOIN users u ON u."userID" = f."userID" WHERE u."role" = 'FACULTY'
     ORDER BY f."deactivatedAt" IS NOT NULL, f."lastName", f."firstName", f."facultyID"`);
  res.json(rows);
});

// Returns the generated password once; only its hash is stored.
router.post("/faculty/members", async (req, res) => {
  const firstName = nameText(req.body?.firstName), lastName = nameText(req.body?.lastName);
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const canIssue = req.body?.canIssue ?? false;
  if (!validName(firstName) || !validName(lastName)) return res.status(400).json({ error: "Enter a first and last name, each 1–255 characters." });
  if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (typeof canIssue !== "boolean") return res.status(400).json({ error: "Choose what this account may do." });
  const password = temporaryPassword();
  const hash = await bcrypt.hash(password, 12);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [user] } = await client.query(
      `INSERT INTO users ("email", "passwordHash", "role") VALUES ($1, $2, 'FACULTY') RETURNING "userID"`, [email, hash]);
    const { rows: [{ facultyID }] } = await client.query(
      `INSERT INTO cict_faculty ("userID", "firstName", "lastName", "canIssue", "temporaryPassword")
       VALUES ($1, $2, $3, $4, true) RETURNING "facultyID"`, [user.userID, firstName, lastName, canIssue]);
    const { rows: [member] } = await client.query(
      `SELECT ${MEMBER_COLUMNS} FROM cict_faculty f JOIN users u ON u."userID" = f."userID" WHERE f."facultyID" = $1`, [facultyID]);
    await client.query("COMMIT");
    res.status(201).json({ member, temporaryPassword: password });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") throw new MemberError(409, "That email already has an account (faculty or student).");
    throw err;
  } finally { client.release(); }
});

// Changes the permission and/or switches the account off or on. Nobody can demote or deactivate themselves, so the
// faculty member making the change always keeps issuing permission and there is always at least one administrator.
router.patch("/faculty/members/:facultyID", async (req, res) => {
  const { canIssue, active } = req.body ?? {};
  if ((canIssue !== undefined && typeof canIssue !== "boolean") || (active !== undefined && typeof active !== "boolean") ||
      (canIssue === undefined && active === undefined)) {
    return res.status(400).json({ error: "Send canIssue and/or active as true or false." });
  }
  const target = Number(req.params.facultyID), me = Number(req.faculty.facultyID);
  if (target === me && (canIssue === false || active === false)) {
    throw new MemberError(409, "You can't remove your own issuing permission or deactivate your own account. Ask another administrator.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Lock both rows in ID order, then re-check the caller inside the lock: two administrators demoting each other at
    // the same moment can't both succeed and leave nobody able to manage accounts.
    const { rows } = await client.query(
      `SELECT "facultyID", "canIssue", "deactivatedAt" FROM cict_faculty WHERE "facultyID" = ANY($1::int[])
       ORDER BY "facultyID" FOR UPDATE`, [[...new Set([target, me])]]);
    const caller = rows.find(row => row.facultyID === me);
    if (!caller?.canIssue || caller.deactivatedAt) throw new MemberError(403, "You are not authorized to manage faculty accounts.");
    if (!rows.some(row => row.facultyID === target)) throw new MemberError(404, "Faculty account not found.");
    await client.query(
      `UPDATE cict_faculty SET "canIssue" = COALESCE($2, "canIssue"),
         "deactivatedAt" = CASE WHEN $3::boolean IS NULL THEN "deactivatedAt" WHEN $3 THEN NULL ELSE COALESCE("deactivatedAt", now()) END
       WHERE "facultyID" = $1`, [target, canIssue ?? null, active ?? null]);
    const { rows: [member] } = await client.query(
      `SELECT ${MEMBER_COLUMNS} FROM cict_faculty f JOIN users u ON u."userID" = f."userID" WHERE f."facultyID" = $1`, [target]);
    await client.query("COMMIT");
    res.json(member);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally { client.release(); }
});

// For a forgotten password. Your own password is changed in Account settings instead.
router.post("/faculty/members/:facultyID/reset-password", async (req, res) => {
  if (Number(req.params.facultyID) === Number(req.faculty.facultyID)) {
    throw new MemberError(409, "Change your own password in Account settings.");
  }
  const password = temporaryPassword();
  const hash = await bcrypt.hash(password, 12);
  const { rows: [member] } = await pool.query(
    `WITH target AS (UPDATE cict_faculty SET "temporaryPassword" = true WHERE "facultyID" = $1 RETURNING "userID"),
          changed AS (UPDATE users SET "passwordHash" = $2 WHERE "userID" IN (SELECT "userID" FROM target) AND "role" = 'FACULTY' RETURNING "userID")
     SELECT "userID" FROM changed`, [req.params.facultyID, hash]);
  if (!member) throw new MemberError(404, "Faculty account not found.");
  res.json({ temporaryPassword: password });
});

router.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof MemberError) return res.status(err.status).json({ error: err.message });
  console.error("Faculty account management failed:", { code: err.code || "REQUEST_FAILED" });
  res.status(500).json({ error: "Could not load or change faculty accounts. Please try again." });
});

export default router;

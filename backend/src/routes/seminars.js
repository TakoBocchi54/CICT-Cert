import { Router } from "express";
import { createHash } from "node:crypto";
import { pool } from "../db/pool.js";
import { requireFaculty, requireCanIssue } from "../middleware/requireFaculty.js";
import { certificateIssuer } from "../services/certificates.js";
import { issueCertificate, IssuanceError } from "../services/issuance.js";
import { readRegistrationCsv, readAttendanceCsv, CsvError } from "../utils/seminarCsv.js";

const router = Router();
router.use("/faculty/seminars", requireFaculty, async (req, res, next) => {
  res.set("Cache-Control", "no-store");
  const { rows } = await pool.query(
    `SELECT f."facultyID" FROM cict_faculty f JOIN users u ON u."userID" = f."userID"
     WHERE f."facultyID" = $1 AND u."userID" = $2 AND u."role" = 'FACULTY'`,
    [req.faculty.facultyID, req.faculty.userID],
  );
  if (!rows.length) return res.status(401).json({ error: "Faculty account not found." });
  next();
});

router.param("seminarID", (req, res, next, value) => {
  if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) {
    return res.status(400).json({ error: "Invalid seminar ID." });
  }
  next();
});

router.get("/faculty/seminars", async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT s."seminarID", s."seminarTitle", to_char(s."seminarDate", 'YYYY-MM-DD') AS "seminarDate", s."createdBy",
           count(r."studentID")::int AS "registrationCount",
           count(r."studentID") FILTER (WHERE r."attended")::int AS "attendanceCount",
           count(w."studentWalletID")::int AS "walletCount"
    FROM seminar s LEFT JOIN seminar_registration r ON r."seminarID" = s."seminarID"
    LEFT JOIN student_wallet w ON w."studentID" = r."studentID"
    GROUP BY s."seminarID" ORDER BY s."seminarDate" DESC, s."seminarID" DESC
  `);
  res.json(rows);
});

router.post("/faculty/seminars", async (req, res) => {
  const title = typeof req.body?.seminarTitle === "string" ? req.body.seminarTitle.trim() : "";
  const date = req.body?.seminarDate;
  if (!title || title.length > 255 || /[\u0000-\u001f\u007f]/.test(title)) {
    return res.status(400).json({ error: "Enter a seminar title containing 1–255 characters." });
  }
  if (typeof date !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    return res.status(400).json({ error: "Enter a valid seminar date in YYYY-MM-DD format." });
  }
  const { rows } = await pool.query(
    `INSERT INTO seminar ("seminarTitle", "seminarDate", "createdBy") VALUES ($1, $2, $3)
     RETURNING "seminarID", "seminarTitle", to_char("seminarDate", 'YYYY-MM-DD') AS "seminarDate", "createdBy"`,
    [title, date, req.faculty.facultyID],
  );
  res.status(201).json(rows[0]);
});

router.get("/faculty/seminars/:seminarID/registrations", async (req, res) => {
  const seminar = await pool.query(`SELECT "seminarID" FROM seminar WHERE "seminarID" = $1`, [req.params.seminarID]);
  if (!seminar.rowCount) return res.status(404).json({ error: "Seminar not found." });
  const { rows } = await pool.query(
    `SELECT s."studentID", s."fullName", s."program", u."email", r."attended", r."registeredAt",
            (w."studentWalletID" IS NOT NULL) AS "walletConnected"
     FROM seminar_registration r JOIN student s ON s."studentID" = r."studentID"
     JOIN users u ON u."userID" = s."userID"
     LEFT JOIN student_wallet w ON w."studentID" = s."studentID"
     WHERE r."seminarID" = $1 ORDER BY s."fullName", s."studentID"`,
    [req.params.seminarID],
  );
  res.json(rows);
});

router.post("/faculty/seminars/:seminarID/registrations/import", async (req, res) => {
  const { students, duplicatesSkipped } = readRegistrationCsv(req.body?.csv);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const seminar = await client.query(`SELECT "seminarID" FROM seminar WHERE "seminarID" = $1 FOR UPDATE`, [req.params.seminarID]);
    if (!seminar.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Seminar not found." });
    }
    const data = JSON.stringify(students);
    const emails = students.map(student => student.google_account);
    // Stable email order avoids conflicting insert locks during imports for different seminars.
    const createdUsers = await client.query(
      `INSERT INTO users ("email", "role")
       SELECT google_account, 'STUDENT' FROM jsonb_to_recordset($1::jsonb) AS csv(google_account text)
       ORDER BY google_account ON CONFLICT ("email") DO NOTHING RETURNING "userID"`, [data],
    );
    const accounts = await client.query(
      `SELECT u."userID", u."role", s."studentID" FROM users u
       LEFT JOIN student s ON s."userID" = u."userID" WHERE u."email" = ANY($1::text[])`, [emails],
    );
    const newUserIDs = new Set(createdUsers.rows.map(user => user.userID));
    if (accounts.rows.some(account => account.role !== "STUDENT" || (!account.studentID && !newUserIDs.has(account.userID)))) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "An email belongs to a faculty account or an incomplete student profile. No registrations were imported; contact CICT to resolve the account." });
    }
    const profiles = await client.query(
      `INSERT INTO student ("userID", "fullName", "program")
       SELECT u."userID", csv.full_name, csv.program
       FROM jsonb_to_recordset($1::jsonb) AS csv(full_name text, program text, google_account text)
       JOIN users u ON u."email" = csv.google_account
       ORDER BY u."userID" ON CONFLICT ("userID") DO NOTHING`, [data],
    );
    const registrations = await client.query(
      `INSERT INTO seminar_registration ("seminarID", "studentID")
       SELECT $1, s."studentID" FROM student s JOIN users u ON u."userID" = s."userID"
       WHERE u."email" = ANY($2::text[]) ORDER BY s."studentID"
       ON CONFLICT ("seminarID", "studentID") DO NOTHING RETURNING "studentID"`,
      [req.params.seminarID, emails],
    );
    await client.query("COMMIT");
    res.json({ imported: registrations.rowCount, alreadyRegistered: students.length - registrations.rowCount,
      newStudents: profiles.rowCount, duplicatesSkipped });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

router.post(["/faculty/seminars/:seminarID/attendance/preview", "/faculty/seminars/:seminarID/attendance/import"], async (req, res) => {
  const { emails, duplicatesSkipped } = readAttendanceCsv(req.body?.csv);
  const saving = req.path.endsWith("/import");
  if (saving && (typeof req.body.previewHash !== "string" || !/^[0-9a-f]{64}$/.test(req.body.previewHash))) {
    return res.status(400).json({ error: "Review the attendance CSV before confirming it." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const seminar = await client.query(`SELECT "seminarID" FROM seminar WHERE "seminarID" = $1 FOR UPDATE`, [req.params.seminarID]);
    if (!seminar.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Seminar not found." });
    }
    const { rows } = await client.query(
      `SELECT r."studentID", r."attended", s."fullName", u."email",
              (w."studentWalletID" IS NOT NULL) AS "walletConnected",
              EXISTS (SELECT 1 FROM certificate c WHERE c."seminarID" = r."seminarID" AND c."studentID" = r."studentID"
                AND (c."status" = 'ISSUED' OR EXISTS (
                  SELECT 1 FROM blockchain_record b WHERE b."certificateID" = c."certificateID"
                    AND (b."transactionStatus" = 'PENDING' OR (b."transactionType" = 'MINT' AND b."transactionStatus" = 'CONFIRMED' AND c."status" <> 'REVOKED'))
                ))) AS "attendanceLocked"
       FROM seminar_registration r JOIN student s ON s."studentID" = r."studentID"
       JOIN users u ON u."userID" = s."userID"
       LEFT JOIN student_wallet w ON w."studentID" = r."studentID"
       WHERE r."seminarID" = $1 ORDER BY r."studentID"`, [req.params.seminarID],
    );
    const listedEmails = new Set(emails);
    const registeredEmails = new Set(rows.map(row => row.email));
    const matched = rows.filter(row => listedEmails.has(row.email));
    const unmatched = emails.filter(email => !registeredEmails.has(email));
    const removed = rows.filter(row => row.attended && !listedEmails.has(row.email));
    const blocked = removed.filter(row => row.attendanceLocked);
    // Detect attendance or registration changes between review and confirmation without adding a version column.
    const previewHash = createHash("sha256").update(JSON.stringify({ seminarID: req.params.seminarID,
      emails: [...emails].sort(), registrations: rows.map(row => [row.studentID, row.email, row.attended, row.attendanceLocked]),
    })).digest("hex");
    if (!saving) {
      await client.query("COMMIT");
      return res.json({ previewHash, matched, unmatched, removed, blocked, duplicatesSkipped,
        newlyAttended: matched.filter(row => !row.attended).length,
        awaitingWallet: matched.filter(row => !row.walletConnected).length,
        canSave: unmatched.length === 0 && blocked.length === 0 });
    }
    if (req.body.previewHash !== previewHash) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Registrations or attendance changed since your review. Review the CSV again before saving." });
    }
    if (unmatched.length || blocked.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: unmatched.length
        ? "Some emails are not registered for this seminar. Correct the CSV or register those students, then review again. No attendance was changed."
        : "Attendance cannot be cleared for students with an issued certificate or an unresolved blockchain transaction. No attendance was changed." });
    }
    await client.query(
      `UPDATE seminar_registration SET "attended" = ("studentID" = ANY($2::bigint[]))
       WHERE "seminarID" = $1 AND "attended" IS DISTINCT FROM ("studentID" = ANY($2::bigint[]))`,
      [req.params.seminarID, matched.map(row => row.studentID)],
    );
    await client.query("COMMIT");
    res.json({ attended: matched.length, markedAttended: matched.filter(row => !row.attended).length,
      markedAbsent: removed.length, awaitingWallet: matched.filter(row => !row.walletConnected).length, duplicatesSkipped });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

router.get("/faculty/seminars/:seminarID/certificates", async (req, res) => {
  const seminar = await pool.query(`SELECT "seminarID" FROM seminar WHERE "seminarID" = $1`, [req.params.seminarID]);
  if (!seminar.rowCount) return res.status(404).json({ error: "Seminar not found." });
  const { rows } = await pool.query(
    `SELECT c."certificateID", c."certificateNo", c."recipientName", c."status", c."consentedAt",
            r."attended", u."email", (w."studentWalletID" IS NOT NULL) AS "walletConnected",
            b."transactionStatus", b."transactionHash", b."tokenID", c."certificateHash"
     FROM certificate c JOIN seminar_registration r USING ("seminarID", "studentID")
     JOIN student s ON s."studentID" = c."studentID" JOIN users u ON u."userID" = s."userID"
     LEFT JOIN student_wallet w ON w."studentID" = s."studentID"
     LEFT JOIN LATERAL (SELECT "transactionStatus", "transactionHash", "tokenID" FROM blockchain_record
       WHERE "certificateID" = c."certificateID" AND "transactionType" = 'MINT' ORDER BY "transactionID" DESC LIMIT 1) b ON true
     WHERE c."seminarID" = $1 ORDER BY c."certificateNo"`, [req.params.seminarID],
  );
  res.json(rows);
});

router.post("/faculty/seminars/:seminarID/certificates/prepare", requireCanIssue, async (req, res) => {
  let context;
  try { context = await certificateIssuer(); }
  catch { return res.status(503).json({ error: "Cannot read the Amoy contract issuer. Check blockchain configuration and try again." }); }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const seminar = await client.query(`SELECT "seminarID" FROM seminar WHERE "seminarID" = $1 FOR UPDATE`, [req.params.seminarID]);
    if (!seminar.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Seminar not found." });
    }
    const { rows: counts } = await client.query(
      `SELECT count(*)::int AS attended, count(*) FILTER (WHERE w."studentWalletID" IS NULL)::int AS "awaitingWallet"
       FROM seminar_registration r LEFT JOIN student_wallet w USING ("studentID") WHERE r."seminarID" = $1 AND r."attended"`,
      [req.params.seminarID],
    );
    if (!counts[0].attended) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Confirm attendance before preparing certificates." });
    }
    const { rows: issuers } = await client.query(
      `INSERT INTO issuer_wallet ("issuerWalletAddress", label, network) VALUES ($1, 'CICT', 'polygon-amoy')
       ON CONFLICT (lower("issuerWalletAddress")) DO UPDATE SET "issuerWalletAddress" = issuer_wallet."issuerWalletAddress"
       RETURNING "issuerWalletID", "isActive", network`, [context.issuerAddress],
    );
    const issuer = issuers[0];
    if (!issuer.isActive || issuer.network !== "polygon-amoy") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "The configured issuer wallet is inactive or belongs to a different network." });
    }
    const prepared = await client.query(
      `INSERT INTO certificate ("studentID", "seminarID", "studentWalletID", "authorizedBy", "issuerWalletID",
                               "recipientName", "seminarTitle", "seminarDate")
       SELECT r."studentID", r."seminarID", w."studentWalletID", $2, $3, s."fullName", e."seminarTitle", e."seminarDate"
       FROM seminar_registration r JOIN student s USING ("studentID") JOIN seminar e USING ("seminarID")
       LEFT JOIN student_wallet w ON w."studentID" = r."studentID"
       WHERE r."seminarID" = $1 AND r."attended" AND NOT EXISTS (
         SELECT 1 FROM certificate c WHERE c."seminarID" = r."seminarID" AND c."studentID" = r."studentID")
       ORDER BY r."studentID"
       ON CONFLICT ("seminarID", "studentID") WHERE status <> 'REVOKED' DO NOTHING`,
      [req.params.seminarID, req.faculty.facultyID, issuer.issuerWalletID],
    );
    await client.query("COMMIT");
    res.json({ prepared: prepared.rowCount, alreadyPrepared: counts[0].attended - prepared.rowCount,
      awaitingWallet: counts[0].awaitingWallet });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally { client.release(); }
});

router.post(["/faculty/seminars/:seminarID/certificates/:certificateID/issue",
  "/faculty/seminars/:seminarID/certificates/:certificateID/issuance/check"], requireCanIssue, async (req, res) => {
  const id = req.params.certificateID;
  if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) return res.status(400).json({ error: "Invalid certificate ID." });
  res.json(await issueCertificate(req.params.seminarID, id, req.faculty, req.path.endsWith("/issue")));
});

router.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof CsvError) return res.status(400).json({ error: err.message });
  if (err instanceof IssuanceError) return res.status(err.status).json({ error: err.message });
  console.error("Seminar request failed:", { code: err.code || "REQUEST_FAILED" });
  res.status(500).json({ error: "Could not save or load seminar records. Please try again." });
});

export default router;

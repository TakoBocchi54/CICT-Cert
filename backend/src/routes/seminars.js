import { Router } from "express";
import { createHash } from "node:crypto";
import { pool } from "../db/pool.js";
import { requireFaculty, requireActiveFaculty, requireCanIssue } from "../middleware/requireFaculty.js";
import { certificateIssuer } from "../services/certificates.js";
import { ensureIssuerWallet, issueCertificate, IssuanceError } from "../services/issuance.js";
import { readAttendanceCsv, googleEmail, CsvError } from "../utils/seminarCsv.js";

const router = Router();
router.use("/faculty/seminars", requireFaculty, requireActiveFaculty);

router.param("seminarID", (req, res, next, value) => {
  if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) {
    return res.status(400).json({ error: "Invalid seminar ID." });
  }
  next();
});

router.get("/faculty/seminars", async (_req, res) => {
  // readyCount: approved, not yet issued; awaitingCount: prepared, waiting for the student's approval.
  const { rows } = await pool.query(`
    WITH certs AS (
      SELECT c."seminarID",
             count(*) FILTER (WHERE cr."attended" AND c."consentedAt" IS NOT NULL AND c.status IN ('PENDING', 'FAILED'))::int AS "readyCount",
             count(*) FILTER (WHERE cr."attended" AND c."consentedAt" IS NULL AND c.status = 'PENDING')::int AS "awaitingCount",
             count(*) FILTER (WHERE c.status = 'ISSUED')::int AS "issuedCount"
      FROM certificate c JOIN seminar_registration cr USING ("seminarID", "studentID") GROUP BY c."seminarID")
    SELECT s."seminarID", s."seminarTitle", to_char(s."seminarDate", 'YYYY-MM-DD') AS "seminarDate", s."createdBy",
           count(r."studentID")::int AS "registrationCount",
           count(r."studentID") FILTER (WHERE r."attended")::int AS "attendanceCount",
           count(w."studentWalletID")::int AS "walletCount",
           coalesce(certs."readyCount", 0) AS "readyCount", coalesce(certs."awaitingCount", 0) AS "awaitingCount",
           coalesce(certs."issuedCount", 0) AS "issuedCount"
    FROM seminar s LEFT JOIN seminar_registration r ON r."seminarID" = s."seminarID"
    LEFT JOIN student_wallet w ON w."studentID" = r."studentID"
    LEFT JOIN certs ON certs."seminarID" = s."seminarID"
    GROUP BY s."seminarID", certs."readyCount", certs."awaitingCount", certs."issuedCount"
    ORDER BY s."seminarDate" DESC, s."seminarID" DESC
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

// aliases: { "<listed email>": "<existing student email>" }, chosen by faculty from the "Did you mean?" suggestions.
function readAliases(value, listed) {
  const aliases = new Map();
  if (value === undefined || value === null) return aliases;
  if (typeof value !== "object" || Array.isArray(value)) throw new CsvError("Aliases must map listed emails to existing student emails.");
  for (const [from, to] of Object.entries(value)) {
    const email = googleEmail(from, "Alias");
    if (!listed.has(email)) throw new CsvError(`Alias: ${email} is not in the attendance list.`);
    aliases.set(email, googleEmail(to, "Alias"));
  }
  return aliases;
}

const normalName = name => name.trim().replace(/\s+/g, " ").toLowerCase();

// Attendance is matched against every student account. Confirming replaces this seminar's attendance list: listed
// students get an attended row (created when missing) and everyone else on the seminar is marked absent.
router.post(["/faculty/seminars/:seminarID/attendance/preview", "/faculty/seminars/:seminarID/attendance/import"], async (req, res) => {
  const { emails, hints, duplicatesSkipped } = readAttendanceCsv(req.body?.csv);
  const aliases = readAliases(req.body?.aliases, new Set(emails));
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
    const accounts = await client.query(
      `SELECT u."email", u."role", s."studentID", s."fullName", (w."studentWalletID" IS NOT NULL) AS "walletConnected"
       FROM users u LEFT JOIN student s ON s."userID" = u."userID"
       LEFT JOIN student_wallet w ON w."studentID" = s."studentID"
       WHERE u."email" = ANY($1::text[])`, [[...emails, ...aliases.values()]],
    );
    const byEmail = new Map(accounts.rows.map(row => [row.email, row]));
    if ([...aliases].some(([from, to]) => byEmail.has(from) || byEmail.get(to)?.role !== "STUDENT" || !byEmail.get(to).studentID)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "A chosen account no longer applies: the listed email now has its own account, or the chosen student was removed. Review the CSV again." });
    }
    const current = new Map(rows.map(row => [row.studentID, row]));
    const matched = new Map(), unregistered = [], facultyEmails = [];
    for (const email of emails) {
      const account = byEmail.get(aliases.get(email) ?? email);
      if (account && account.role !== "STUDENT") facultyEmails.push(email);
      else if (account?.studentID) {
        if (!matched.has(account.studentID)) matched.set(account.studentID, { studentID: account.studentID, fullName: account.fullName,
          email: account.email, listedAs: aliases.has(email) ? email : null, walletConnected: account.walletConnected,
          attended: current.get(account.studentID)?.attended ?? false });
      } else unregistered.push({ email, ...hints.get(email), suggestions: [] }); // incomplete profiles land here; registering them reports the conflict
    }
    if (unregistered.length) {
      // "Did you mean?": same part before @ (this also covers domain typos such as gmial.com) or the same name as the CSV hint.
      // shortcut: scans all student accounts on each preview; index these expressions if accounts reach tens of thousands.
      const candidates = (await client.query(
        `SELECT s."studentID", s."fullName", u."email" FROM student s JOIN users u ON u."userID" = s."userID"
         WHERE u."role" = 'STUDENT' AND (split_part(u."email", '@', 1) = ANY($1::text[])
           OR lower(regexp_replace(btrim(s."fullName"), '\\s+', ' ', 'g')) = ANY($2::text[]))
         ORDER BY s."fullName", s."studentID"`,
        [unregistered.map(row => row.email.split("@")[0]), unregistered.map(row => normalName(row.fullName)).filter(Boolean)],
      )).rows;
      for (const row of unregistered) {
        const local = row.email.split("@")[0], name = normalName(row.fullName);
        row.suggestions = candidates.filter(candidate => candidate.email.split("@")[0] === local || (name && normalName(candidate.fullName) === name)).slice(0, 3);
      }
    }
    const unmatched = [...unregistered.map(row => row.email), ...facultyEmails];
    const removed = rows.filter(row => row.attended && !matched.has(row.studentID));
    const blocked = removed.filter(row => row.attendanceLocked);
    // Detect account, alias or attendance changes between review and confirmation without adding a version column.
    const previewHash = createHash("sha256").update(JSON.stringify({ seminarID: req.params.seminarID,
      emails: [...emails].sort(), aliases: [...aliases].sort(), accounts: [...matched.keys()].sort(), facultyEmails: [...facultyEmails].sort(),
      registrations: rows.map(row => [row.studentID, row.email, row.attended, row.attendanceLocked]),
    })).digest("hex");
    const attendees = [...matched.values()];
    if (!saving) {
      await client.query("COMMIT");
      return res.json({ previewHash, matched: attendees, unregistered, facultyEmails, removed, blocked, duplicatesSkipped,
        newlyAttended: attendees.filter(row => !row.attended).length,
        awaitingWallet: attendees.filter(row => !row.walletConnected).length,
        canSave: unmatched.length === 0 && blocked.length === 0 });
    }
    if (req.body.previewHash !== previewHash) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Student accounts or attendance changed since your review. Review the CSV again before saving." });
    }
    if (unmatched.length || blocked.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: unmatched.length
        ? "Some emails don't belong to a registered student. Register them or correct the CSV, then review again. No attendance was changed."
        : "Attendance cannot be cleared for students with an issued certificate or an unresolved blockchain transaction. No attendance was changed." });
    }
    const ids = [...matched.keys()];
    await client.query(
      `INSERT INTO seminar_registration ("seminarID", "studentID", "attended")
       SELECT $1, unnest($2::bigint[]), true ORDER BY 2
       ON CONFLICT ("seminarID", "studentID") DO UPDATE SET "attended" = true WHERE seminar_registration."attended" IS DISTINCT FROM true`,
      [req.params.seminarID, ids],
    );
    await client.query(
      `UPDATE seminar_registration SET "attended" = false WHERE "seminarID" = $1 AND "attended" AND NOT ("studentID" = ANY($2::bigint[]))`,
      [req.params.seminarID, ids],
    );
    await client.query("COMMIT");
    res.json({ attended: attendees.length, markedAttended: attendees.filter(row => !row.attended).length,
      markedAbsent: removed.length, awaitingWallet: attendees.filter(row => !row.walletConnected).length, duplicatesSkipped });
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
    const issuer = await ensureIssuerWallet(client, context);
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

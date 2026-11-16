import { Router } from "express";
import { createHash } from "node:crypto";
import { pool } from "../db/pool.js";
import { requireFaculty, requireActiveFaculty, requireCanIssue } from "../middleware/requireFaculty.js";
import { certificateIssuer } from "../services/certificates.js";
import { ensureIssuerWallet, issueSeminarBatch, IssuanceError } from "../services/issuance.js";
import { correctRecipientName } from "../services/revocation.js";
import { readAttendanceCsv, googleEmail, CsvError } from "../utils/seminarCsv.js";

const router = Router();
router.use("/faculty/seminars", requireFaculty, requireActiveFaculty);

for (const [name, label] of [["seminarID", "seminar"], ["studentID", "student"]]) {
  router.param(name, (req, res, next, value) => {
    if (!/^[1-9]\d{0,9}$/.test(value) || BigInt(value) > 2147483647n) {
      return res.status(400).json({ error: `Invalid ${label} ID.` });
    }
    next();
  });
}

// Attendance can't be cleared once the student's certificate is issued or has a blockchain transaction in flight.
const ATTENDANCE_LOCKED = `EXISTS (SELECT 1 FROM certificate c WHERE c."seminarID" = r."seminarID" AND c."studentID" = r."studentID"
  AND (c."status" = 'ISSUED' OR EXISTS (
    SELECT 1 FROM blockchain_record b WHERE b."certificateID" = c."certificateID"
      AND (b."transactionStatus" = 'PENDING' OR (b."transactionType" = 'MINT' AND b."transactionStatus" = 'CONFIRMED' AND c."status" <> 'REVOKED'))
  )))`;

router.get("/faculty/seminars", async (_req, res) => {
  // readyCount: wallet linked, not yet issued; awaitingCount: prepared, waiting for the student to link a wallet.
  const { rows } = await pool.query(`
    WITH certs AS (
      SELECT c."seminarID",
             count(*) FILTER (WHERE cr."attended" AND cw."studentWalletID" IS NOT NULL AND c.status IN ('PENDING', 'FAILED'))::int AS "readyCount",
             count(*) FILTER (WHERE cr."attended" AND cw."studentWalletID" IS NULL AND c.status IN ('PENDING', 'FAILED'))::int AS "awaitingCount",
             count(*) FILTER (WHERE c.status = 'ISSUED')::int AS "issuedCount",
             count(*)::int AS "certificateCount"
      FROM certificate c JOIN seminar_registration cr USING ("seminarID", "studentID")
      LEFT JOIN student_wallet cw ON cw."studentID" = c."studentID" GROUP BY c."seminarID")
    SELECT s."seminarID", s."seminarTitle", to_char(s."seminarDate", 'YYYY-MM-DD') AS "seminarDate", s."createdBy",
           s."templateID"::text AS "templateID", t."name" AS "templateName", s."venue", s."registrationToken",
           s."registrationClosesAt", coalesce(s."registrationClosesAt" > now(), false) AS "registrationOpen",
           count(r."studentID")::int AS "registrationCount",
           count(r."studentID") FILTER (WHERE r."attended")::int AS "attendanceCount",
           count(w."studentWalletID")::int AS "walletCount",
           coalesce(certs."readyCount", 0) AS "readyCount", coalesce(certs."awaitingCount", 0) AS "awaitingCount",
           coalesce(certs."issuedCount", 0) AS "issuedCount", coalesce(certs."certificateCount", 0) AS "certificateCount"
    FROM seminar s LEFT JOIN seminar_registration r ON r."seminarID" = s."seminarID"
    LEFT JOIN student_wallet w ON w."studentID" = r."studentID"
    LEFT JOIN certs ON certs."seminarID" = s."seminarID"
    LEFT JOIN certificate_template t ON t."templateID" = s."templateID"
    GROUP BY s."seminarID", t."templateID", certs."readyCount", certs."awaitingCount", certs."issuedCount", certs."certificateCount"
    ORDER BY s."seminarDate" DESC, s."seminarID" DESC
  `);
  res.json(rows);
});

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

// Returns { title, date, templateID, venue, closesAt } or { error } for a create/edit request body.
// The venue is required, except that an edit may leave it out to keep the current one.
function readSeminarFields(body, { editing = false } = {}) {
  const title = typeof body?.seminarTitle === "string" ? body.seminarTitle.trim() : "";
  const date = body?.seminarDate;
  if (!title || title.length > 255 || /[\u0000-\u001f\u007f]/.test(title)) {
    return { error: "Enter a seminar title containing 1–255 characters." };
  }
  if (typeof date !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    return { error: "Enter a valid seminar date in YYYY-MM-DD format." };
  }
  // Certificate design: null (or absent) = built-in; otherwise an existing template's ID.
  const templateID = body?.templateID ?? null;
  if (templateID !== null && (!["string", "number"].includes(typeof templateID) || !/^[1-9]\d{0,9}$/.test(String(templateID)) || BigInt(templateID) > 2147483647n)) {
    return { error: "Choose a valid certificate design." };
  }
  const venue = typeof body?.venue === "string" ? body.venue.trim() : body?.venue;
  if (!(editing && venue === undefined) && (typeof venue !== "string" || !venue || venue.length > 255 || /[\u0000-\u001f\u007f]/.test(venue))) {
    return { error: "Enter a venue containing 1–255 characters." };
  }
  // Registration deadline: null = registration closed (no link to share yet).
  const closesAt = body?.registrationClosesAt ?? null;
  if (closesAt !== null && (typeof closesAt !== "string" || !ISO_TIMESTAMP.test(closesAt) || !Number.isFinite(Date.parse(closesAt)))) {
    return { error: "Enter a valid registration deadline." };
  }
  return { title, date, templateID, venue, closesAt };
}

const SEMINAR_COLUMNS = `"seminarID", "seminarTitle", to_char("seminarDate", 'YYYY-MM-DD') AS "seminarDate", "createdBy", "templateID"::text AS "templateID",
  "venue", "registrationToken", "registrationClosesAt", coalesce("registrationClosesAt" > now(), false) AS "registrationOpen"`;
const MISSING_TEMPLATE = "That certificate design no longer exists. Choose another one.";

router.post("/faculty/seminars", async (req, res) => {
  const { title, date, templateID, venue, closesAt, error } = readSeminarFields(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const { rows } = await pool.query(
      `INSERT INTO seminar ("seminarTitle", "seminarDate", "createdBy", "templateID", "venue", "registrationClosesAt")
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${SEMINAR_COLUMNS}`,
      [title, date, req.faculty.facultyID, templateID, venue, closesAt],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23503" && err.constraint?.includes("template")) return res.status(400).json({ error: MISSING_TEMPLATE });
    throw err;
  }
});

// Runs change(client) holding the seminar row lock, which serializes it with attendance, preparation and issuance.
// change may throw IssuanceError for an HTTP error; an undefined result answers 204.
async function changeLockedSeminar(seminarID, res, change) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const seminar = await client.query(`SELECT "seminarID" FROM seminar WHERE "seminarID" = $1 FOR UPDATE`, [seminarID]);
    if (!seminar.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Seminar not found." });
    }
    const result = await change(client);
    await client.query("COMMIT");
    return result === undefined ? res.status(204).end() : res.json(result);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally { client.release(); }
}

// Fixing a mistaken seminar is only allowed before any certificate exists: certificates copy its title and date.
const changeUnusedSeminar = (seminarID, res, change) => changeLockedSeminar(seminarID, res, async client => {
  if ((await client.query(`SELECT 1 FROM certificate WHERE "seminarID" = $1 LIMIT 1`, [seminarID])).rowCount) {
    throw new IssuanceError(409, "Certificates have already been prepared for this seminar, so its title, date and attendance record can no longer be changed or deleted.");
  }
  return change(client);
});

router.patch("/faculty/seminars/:seminarID", async (req, res) => {
  const { title, date, templateID, venue, closesAt, error } = readSeminarFields(req.body, { editing: true });
  if (error) return res.status(400).json({ error });
  // Fields left out of the body keep their current value.
  const keep = name => !Object.hasOwn(req.body ?? {}, name);
  const keepTemplate = keep("templateID");
  await changeUnusedSeminar(req.params.seminarID, res, async client => {
    // FOR SHARE keeps the chosen template from being deleted before this commits.
    if (!keepTemplate && templateID !== null && !(await client.query(
      `SELECT 1 FROM certificate_template WHERE "templateID" = $1 FOR SHARE`, [templateID])).rowCount) {
      throw new IssuanceError(400, MISSING_TEMPLATE);
    }
    return (await client.query(
      `UPDATE seminar SET "seminarTitle" = $2, "seminarDate" = $3, "templateID" = CASE WHEN $5 THEN "templateID" ELSE $4::int END,
         "venue" = CASE WHEN $7 THEN "venue" ELSE $6::varchar END,
         "registrationClosesAt" = CASE WHEN $9 THEN "registrationClosesAt" ELSE $8::timestamptz END
       WHERE "seminarID" = $1 RETURNING ${SEMINAR_COLUMNS}`,
      [req.params.seminarID, title, date, templateID, keepTemplate, venue, keep("venue"), closesAt, keep("registrationClosesAt")])).rows[0];
  });
});

// Deleting also removes the seminar's attendance rows; it never touches student accounts.
router.delete("/faculty/seminars/:seminarID", requireCanIssue, async (req, res) => {
  await changeUnusedSeminar(req.params.seminarID, res, async client => {
    await client.query(`DELETE FROM seminar_registration WHERE "seminarID" = $1`, [req.params.seminarID]);
    await client.query(`DELETE FROM seminar WHERE "seminarID" = $1`, [req.params.seminarID]);
  });
});

router.get("/faculty/seminars/:seminarID/registrations", async (req, res) => {
  const seminar = await pool.query(`SELECT "seminarID" FROM seminar WHERE "seminarID" = $1`, [req.params.seminarID]);
  if (!seminar.rowCount) return res.status(404).json({ error: "Seminar not found." });
  const { rows } = await pool.query(
    `SELECT s."studentID", s."fullName", s."program", u."email", r."attended", r."registeredAt",
            (w."studentWalletID" IS NOT NULL) AS "walletConnected", ${ATTENDANCE_LOCKED} AS "attendanceLocked",
            EXISTS (SELECT 1 FROM certificate c WHERE c."seminarID" = r."seminarID" AND c."studentID" = r."studentID") AS "hasCertificate"
     FROM seminar_registration r JOIN student s ON s."studentID" = r."studentID"
     JOIN users u ON u."userID" = s."userID"
     LEFT JOIN student_wallet w ON w."studentID" = s."studentID"
     WHERE r."seminarID" = $1 ORDER BY s."fullName", s."studentID"`,
    [req.params.seminarID],
  );
  res.json(rows);
});

// Registration closes on its own at the deadline; this closes it now.
router.post("/faculty/seminars/:seminarID/registration/close", async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE seminar SET "registrationClosesAt" = LEAST("registrationClosesAt", now()) WHERE "seminarID" = $1 RETURNING ${SEMINAR_COLUMNS}`,
    [req.params.seminarID]);
  if (!rows.length) return res.status(404).json({ error: "Seminar not found." });
  res.json(rows[0]);
});

// Marks one registered student as attended or absent (replaces the attendance CSV).
router.patch("/faculty/seminars/:seminarID/registrations/:studentID", async (req, res) => {
  const { seminarID, studentID } = req.params;
  const attended = req.body?.attended;
  if (typeof attended !== "boolean") return res.status(400).json({ error: "Choose whether the student attended." });
  await changeLockedSeminar(seminarID, res, async client => {
    const row = (await client.query(`SELECT ${ATTENDANCE_LOCKED} AS "attendanceLocked" FROM seminar_registration r
      WHERE r."seminarID" = $1 AND r."studentID" = $2`, [seminarID, studentID])).rows[0];
    if (!row) throw new IssuanceError(404, "This student is not registered for the seminar.");
    if (!attended && row.attendanceLocked) {
      throw new IssuanceError(409, "Attendance cannot be cleared for a student with an issued certificate or an unresolved blockchain transaction.");
    }
    await client.query(`UPDATE seminar_registration SET "attended" = $3 WHERE "seminarID" = $1 AND "studentID" = $2`, [seminarID, studentID, attended]);
    return { studentID: Number(studentID), attended };
  });
});

// Removes a registrant (for example someone who isn't a CICT student). Their account is kept.
router.delete("/faculty/seminars/:seminarID/registrations/:studentID", async (req, res) => {
  const { seminarID, studentID } = req.params;
  await changeLockedSeminar(seminarID, res, async client => {
    if ((await client.query(`SELECT 1 FROM certificate WHERE "seminarID" = $1 AND "studentID" = $2 LIMIT 1`, [seminarID, studentID])).rowCount) {
      throw new IssuanceError(409, "A certificate already exists for this student, so they can't be removed from the seminar.");
    }
    const deleted = await client.query(`DELETE FROM seminar_registration WHERE "seminarID" = $1 AND "studentID" = $2`, [seminarID, studentID]);
    if (!deleted.rowCount) throw new IssuanceError(404, "This student is not registered for the seminar.");
  });
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
              (w."studentWalletID" IS NOT NULL) AS "walletConnected", ${ATTENDANCE_LOCKED} AS "attendanceLocked"
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
       SELECT $1, unnest($2::int[]), true ORDER BY 2
       ON CONFLICT ("seminarID", "studentID") DO UPDATE SET "attended" = true WHERE seminar_registration."attended" IS DISTINCT FROM true`,
      [req.params.seminarID, ids],
    );
    await client.query(
      `UPDATE seminar_registration SET "attended" = false WHERE "seminarID" = $1 AND "attended" AND NOT ("studentID" = ANY($2::int[]))`,
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
    `SELECT c."certificateID", c."certificateNo", c."recipientName", c."status",
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

// /issue may sign the seminar's next batch; /issuance/check only reconciles or rebroadcasts the pending one.
router.post(["/faculty/seminars/:seminarID/certificates/issue", "/faculty/seminars/:seminarID/certificates/issuance/check"],
  requireCanIssue, async (req, res) => {
    res.json(await issueSeminarBatch(req.params.seminarID, req.faculty, req.path.endsWith("/issue")));
  });

// Name correction before issuance.
router.patch("/faculty/seminars/:seminarID/certificates/:certificateID", requireCanIssue, async (req, res) => {
  const id = req.params.certificateID;
  if (!/^[1-9]\d{0,9}$/.test(id) || BigInt(id) > 2147483647n) return res.status(400).json({ error: "Invalid certificate ID." });
  res.json(await correctRecipientName(req.params.seminarID, id, req.body));
});

router.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof CsvError) return res.status(400).json({ error: err.message });
  if (err instanceof IssuanceError) return res.status(err.status).json({ error: err.message });
  console.error("Seminar request failed:", { code: err.code || "REQUEST_FAILED" });
  res.status(500).json({ error: "Could not save or load seminar records. Please try again." });
});

export default router;

import { Router } from "express";
import { jwtVerify } from "jose";
import { pool } from "../db/pool.js";
import { secret, COOKIE } from "../utils/session.js";
import { issuerBalance } from "../services/certificates.js";

// In-app notifications for both roles. There is no events table: each item is derived from timestamps the app
// already keeps, and users."notificationsSeenAt" marks what the account has read.
const router = Router();
const WINDOW = "interval '60 days'";
const MAX_ITEMS = 20;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// Either role, re-checked against the database so a deleted account's cookie stops working.
router.use("/notifications", async (req, res, next) => {
  res.set("Cache-Control", "no-store");
  try {
    const { payload } = await jwtVerify(req.cookies[COOKIE] ?? "", secret);
    const { rows: [user] } = await pool.query(
      `SELECT u."userID", u."role", u."notificationsSeenAt", f."facultyID", f."canIssue", s."studentID"
       FROM users u LEFT JOIN cict_faculty f ON f."userID" = u."userID" LEFT JOIN student s ON s."userID" = u."userID"
       WHERE u."userID" = $1`, [payload.userID]);
    const valid = user && user.role === payload.role && (payload.role === "FACULTY"
      ? user.facultyID != null && String(user.facultyID) === String(payload.facultyID)
      : payload.role === "STUDENT" && user.studentID != null && String(user.studentID) === String(payload.studentID));
    if (!valid) throw new Error("Unknown account");
    req.account = user;
    next();
  } catch {
    res.status(401).json({ error: "Session expired. Please sign in again." });
  }
});

async function studentItems(studentID) {
  const { rows } = await pool.query(
    `SELECT c."certificateNo", c."seminarTitle", c."issuedAt", c."revokedAt",
       (SELECT b."revocationReason" FROM blockchain_record b WHERE b."certificateID" = c."certificateID" AND b."transactionType" = 'REVOKE'
        AND b."transactionStatus" = 'CONFIRMED' ORDER BY b."transactionID" DESC LIMIT 1) AS "reason"
     FROM certificate c WHERE c."studentID" = $1 AND c.status IN ('ISSUED', 'REVOKED')
       AND (c."issuedAt" > now() - ${WINDOW} OR c."revokedAt" > now() - ${WINDOW})`, [studentID]);
  const recent = at => at && at > Date.now() - 60 * 86_400_000;
  return rows.flatMap(row => [
    recent(row.issuedAt) && { id: `issued:${row.certificateNo}`, kind: "issued", at: row.issuedAt, link: `/student/certificates/${row.certificateNo}`,
      text: `Your certificate for ${row.seminarTitle} is ready.` },
    recent(row.revokedAt) && { id: `revoked:${row.certificateNo}`, kind: "revoked", at: row.revokedAt, link: `/student/certificates/${row.certificateNo}`,
      text: `Certificate No. ${row.certificateNo} for ${row.seminarTitle} was revoked${row.reason ? `: ${row.reason}` : "."}` },
  ].filter(Boolean));
}

async function facultyItems({ canIssue, notificationsSeenAt }) {
  const [registrations, closed, transactions] = await Promise.all([
    // F1: registrations per seminar, with how many arrived since the account last looked.
    pool.query(`SELECT s."seminarID", s."seminarTitle", count(*)::int AS "total", max(r."registeredAt") AS "at",
        count(*) FILTER (WHERE r."registeredAt" > coalesce($1::timestamptz, '-infinity'))::int AS "new"
      FROM seminar s JOIN seminar_registration r USING ("seminarID")
      GROUP BY s."seminarID" HAVING max(r."registeredAt") > now() - ${WINDOW}`, [notificationsSeenAt]),
    // F2: registration deadlines that have passed.
    pool.query(`SELECT s."seminarID", s."seminarTitle", s."registrationClosesAt" AS "at",
        count(r."studentID")::int AS "total", count(*) FILTER (WHERE r.attended)::int AS "attended"
      FROM seminar s LEFT JOIN seminar_registration r USING ("seminarID")
      WHERE s."registrationClosesAt" <= now() AND s."registrationClosesAt" > now() - ${WINDOW} GROUP BY s."seminarID"`),
    // F3 and F4: failed transactions whose certificates are still unresolved, and transactions pending over 15 minutes.
    canIssue ? pool.query(`SELECT b."transactionHash", b."transactionType", b."transactionStatus", min(b."createdAt") AS "at",
        count(*)::int AS "count", min(c."seminarID") AS "seminarID", min(c."seminarTitle") AS "seminarTitle"
      FROM blockchain_record b JOIN certificate c USING ("certificateID")
      WHERE (b."transactionStatus" = 'FAILED' AND b."createdAt" > now() - ${WINDOW}
             AND ((b."transactionType" = 'MINT' AND c.status IN ('PENDING', 'FAILED')) OR (b."transactionType" = 'REVOKE' AND c.status = 'ISSUED')))
         OR (b."transactionStatus" = 'PENDING' AND b."createdAt" < now() - interval '15 minutes')
      GROUP BY b."transactionHash", b."transactionType", b."transactionStatus"`) : { rows: [] },
  ]);
  const items = [
    ...registrations.rows.map(row => ({ id: `registrations:${row.seminarID}`, kind: "registrations", at: row.at, link: `/faculty/seminars?seminar=${row.seminarID}`,
      text: row.new && row.new < row.total ? `${plural(row.new, "new registration")} for ${row.seminarTitle} (${row.total} in total).`
        : `${plural(row.total, "student")} registered for ${row.seminarTitle}.` })),
    ...closed.rows.map(row => ({ id: `closed:${row.seminarID}`, kind: "closed", at: row.at, link: `/faculty/issue?seminar=${row.seminarID}`,
      text: `Registration for ${row.seminarTitle} closed with ${row.total} registered.${row.total && !row.attended ? " Mark who attended." : ""}` })),
    ...transactions.rows.map(row => {
      const mint = row.transactionType === "MINT", failed = row.transactionStatus === "FAILED";
      return { id: `${failed ? "failed" : "pending"}:${row.transactionHash}`, kind: failed ? "failed" : "pending", at: row.at,
        link: mint ? `/faculty/issue?seminar=${row.seminarID}` : "/faculty/registry",
        text: failed ? (mint ? `Issuing ${plural(row.count, "certificate")} for ${row.seminarTitle} failed on-chain. Issue them again.`
            : `Revoking ${plural(row.count, "certificate")} failed on-chain. Revoke them again.`)
          : mint ? `An issuing transaction for ${row.seminarTitle} is still pending. Check its status.`
          : `A revocation transaction is still pending. Check its status.` };
    }),
  ];
  // F5: low issuer balance; skipped when the RPC can't be reached.
  if (canIssue) {
    const wallet = await issuerBalance().catch(() => null);
    if (wallet?.low) items.push({ id: "low-balance", kind: "low-balance", at: wallet.lowSince ?? new Date(),
      link: `https://amoy.polygonscan.com/address/${wallet.address}`,
      text: `The issuer wallet has ${wallet.balance} POL, below ${wallet.threshold} POL. Top it up before issuing more.` });
  }
  return items;
}

router.get("/notifications", async (req, res) => {
  const account = req.account;
  const items = (account.role === "STUDENT" ? await studentItems(account.studentID) : await facultyItems(account))
    .sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, MAX_ITEMS);
  const seen = account.notificationsSeenAt ? new Date(account.notificationsSeenAt) : null;
  res.json({ unread: items.filter(item => !seen || new Date(item.at) > seen).length, seenAt: seen, items });
});

router.post("/notifications/seen", async (req, res) => {
  await pool.query(`UPDATE users SET "notificationsSeenAt" = now() WHERE "userID" = $1`, [req.account.userID]);
  res.json({ unread: 0 });
});

router.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  console.error("Notifications request failed:", { code: err.code || "REQUEST_FAILED" });
  res.status(500).json({ error: "Could not load notifications. Please try again." });
});

export default router;

import { pool } from "../db/pool.js";
import { issueCertificate, IssuanceError } from "./issuance.js";

const INTERVAL_MS = 30_000;
let running = false;

// Issues approved certificates one at a time, as the faculty member who prepared them. Everything
// else (locks, approval checks, signing, finality) is the same issueCertificate path the buttons use.
export async function autoIssueTick() {
  if (running) return;
  running = true;
  try {
    const pending = await pool.query(
      `SELECT c."certificateID", c."seminarID", f."facultyID", f."userID"
       FROM blockchain_record b JOIN certificate c USING ("certificateID") JOIN cict_faculty f ON f."facultyID" = c."authorizedBy"
       WHERE b."transactionType" = 'MINT' AND b."transactionStatus" = 'PENDING' ORDER BY b."transactionID"`);
    for (const row of pending.rows) {
      try { await issueCertificate(row.seminarID, row.certificateID, row, false); }
      catch (err) { logFailure(err); }
    }
    // shortcut: 20 rows per tick, so 20 permanently invalid approvals would starve the rest; upgrade if that happens.
    const queue = await pool.query(
      `SELECT c."certificateID", c."seminarID", f."facultyID", f."userID"
       FROM certificate c JOIN cict_faculty f ON f."facultyID" = c."authorizedBy"
       WHERE c.status = 'PENDING' AND c."consentedAt" IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM blockchain_record b WHERE b."certificateID" = c."certificateID" AND b."transactionType" = 'MINT')
       ORDER BY c."consentedAt" LIMIT 20`);
    for (const row of queue.rows) {
      try {
        // A new mint is pending until finality, and it blocks every other issuer transaction.
        if ((await issueCertificate(row.seminarID, row.certificateID, row, true)).transactionStatus === "PENDING") break;
      } catch (err) {
        logFailure(err);
        // RPC/key/POL problems and a pending issuer transaction affect every certificate; anything else is this one's.
        if (!(err instanceof IssuanceError) || err.status === 503 || /pending/.test(err.message)) break;
      }
    }
  } catch (err) { logFailure(err); }
  finally { running = false; }
}

function logFailure(err) { console.error("Auto-issue failed:", { code: err.code || err.status || "REQUEST_FAILED" }); }

export function startAutoIssue() {
  if (process.env.AUTO_ISSUE !== "true") return;
  setInterval(autoIssueTick, INTERVAL_MS).unref();
  autoIssueTick();
}

import { Router } from "express";
import { polygonAmoy } from "viem/chains";
import { pool } from "../db/pool.js";
import { requireStudent } from "../middleware/requireStudent.js";
import { certificateTemplateSql } from "../utils/certificateTemplate.js";
import { certificateContract, inclusionProof } from "../services/certificates.js";
import { certificatePayload } from "../utils/certificateConsent.js";
import { merkleLeaf } from "../utils/merkle.js";

// The student's own certificates. Students no longer approve each one: linking the wallet is the consent.
const router = Router();

router.use("/student/certificates", requireStudent, async (req, res, next) => {
  res.set("Cache-Control", "no-store");
  const { rows } = await pool.query(
    `SELECT s."studentID" FROM student s JOIN users u USING ("userID")
     WHERE s."studentID" = $1 AND u."userID" = $2 AND u.role = 'STUDENT'`,
    [req.student.studentID, req.student.userID],
  );
  if (!rows.length) return res.status(401).json({ error: "Student account not found." });
  next();
});

router.param("certificateID", (_req, res, next, value) => {
  if (!/^[1-9]\d{0,9}$/.test(value) || BigInt(value) > 2147483647n) {
    return res.status(400).json({ error: "Invalid certificate ID." });
  }
  next();
});

router.get("/student/certificates", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c."certificateID", c."certificateNo", c."recipientName", c."seminarTitle",
            to_char(c."seminarDate", 'YYYY-MM-DD') AS "seminarDate", c.status,
            r.attended, w."studentWalletAddress" AS "walletAddress", i."issuerWalletAddress" AS "issuerAddress",
            c."certificateHash", c."issuedAt", b."tokenID", b."transactionHash", b."blockNum", ${certificateTemplateSql("c")}
     FROM certificate c JOIN seminar_registration r USING ("seminarID", "studentID")
     JOIN issuer_wallet i USING ("issuerWalletID") LEFT JOIN student_wallet w ON w."studentID" = c."studentID"
     LEFT JOIN LATERAL (SELECT "tokenID", "transactionHash", "blockNum" FROM blockchain_record
       WHERE "certificateID" = c."certificateID" AND "transactionType" = 'MINT' AND "transactionStatus" = 'CONFIRMED'
       ORDER BY "transactionID" DESC LIMIT 1) b ON true
     WHERE c."studentID" = $1 ORDER BY c."certificateNo" DESC`,
    [req.student.studentID],
  );
  res.json(rows);
});

// Everything needed to check the certificate against the contract without this server: the hashed facts,
// the Merkle inclusion proof and where the batch root lives. Revocation is checked live, so it is not included.
router.get("/student/certificates/:certificateID/proof", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c."certificateNo", c."recipientName", c."seminarTitle", to_char(c."seminarDate", 'YYYY-MM-DD') AS "seminarDate",
            c."certificateHash", w."studentWalletAddress" AS "walletAddress", i."issuerWalletAddress" AS "issuerAddress"
     FROM certificate c JOIN issuer_wallet i USING ("issuerWalletID") JOIN student_wallet w ON w."studentWalletID" = c."studentWalletID"
     WHERE c."certificateID" = $1 AND c."studentID" = $2 AND c.status IN ('ISSUED', 'REVOKED')`,
    [req.params.certificateID, req.student.studentID],
  );
  const certificate = rows[0];
  let contractAddress;
  try { contractAddress = certificateContract().address.toLowerCase(); }
  catch { return res.status(503).json({ error: "Blockchain configuration is unavailable. Please try again later." }); }
  const proof = certificate && await inclusionProof(pool, certificate.certificateHash, contractAddress);
  if (!proof) return res.status(404).json({ error: "This certificate has no issued proof yet." });
  res.json({
    format: "cict-cert-merkle-proof-v1",
    network: { name: "Polygon Amoy", chainId: polygonAmoy.id },
    contractAddress,
    // keccak256 of this JSON, exactly as written (same key order, no spaces), is certificateHash.
    certificate: certificatePayload(certificate, { chainId: polygonAmoy.id, contractAddress, issuerAddress: certificate.issuerAddress }),
    certificateHash: certificate.certificateHash,
    tokenId: String(proof.tokenID),
    // leaf = keccak256(abi.encode(uint256 index, bytes32 certificateHash)); pairs are hashed in sorted order.
    index: proof.index,
    leaf: merkleLeaf(proof.index, certificate.certificateHash),
    merkleProof: proof.merkleProof,
    merkleRoot: proof.merkleRoot,
    transactionHash: proof.transactionHash,
    blockNumber: String(proof.blockNum),
    verify: "Call verify(tokenId, certificateHash, merkleProof, smtBitmap, smtSiblings) on the contract, or batchOf(recordOf(tokenId).batchId).root to compare merkleRoot.",
  });
});

router.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  console.error("Student certificate request failed:", { code: err.code || "REQUEST_FAILED" });
  res.status(500).json({ error: "Could not load your certificates. Please try again." });
});

export default router;

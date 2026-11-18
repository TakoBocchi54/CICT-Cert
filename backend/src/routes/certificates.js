import { Router } from "express";
import rateLimit from "express-rate-limit";
import { verifyCertificate, certificateIssuer } from "../services/certificates.js";
import { pool } from "../db/pool.js";
import { certificateHash } from "../utils/certificateConsent.js";
import { certificateTemplateSql } from "../utils/certificateTemplate.js";

const router = Router();

// Public and each call reads the chain: without a limit a script could use up the RPC quota that issuing needs.
const verifyLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many verification requests. Please wait a minute and try again." },
});

router.get("/certificates/verify/:certHash", verifyLimiter, async (req, res) => {
    res.set("Cache-Control", "no-store");

    const certHash = req.params.certHash.toLowerCase();

    if (!/^0x[0-9a-f]{64}$/.test(certHash)) {
        return res.status(400).json({
            error: "Certificate hash must be 0x followed by 64 hexadecimal characters",
        });
    }

    try {
        // The contract decides the status from a Merkle inclusion proof and a sparse Merkle revocation proof.
        const [record, context] = await Promise.all([verifyCertificate(certHash), certificateIssuer()]);
        let certificate = null;
        let detailsStatus = "NotFound";
        let revokedAt = null;
        if (record.status !== 0) {
            try {
                const { rows } = await pool.query(
                    `SELECT c."certificateNo", c."recipientName", c."seminarTitle", c."revokedAt",
                            to_char(c."seminarDate", 'YYYY-MM-DD') AS "seminarDate", w."studentWalletAddress" AS "walletAddress",
                            ${certificateTemplateSql("c")}
                     FROM certificate c LEFT JOIN student_wallet w ON w."studentWalletID" = c."studentWalletID"
                     WHERE c."certificateHash" = $1`, [certHash],
                );
                const saved = rows[0];
                detailsStatus = saved ? "Mismatch" : "Missing";
                // Only publish the snapshot if its facts reproduce the hash proven on this contract and the token's owner.
                if (saved?.walletAddress?.toLowerCase() === record.recipient.toLowerCase() &&
                    certificateHash(saved, context) === certHash) {
                    certificate = { certificateNo: saved.certificateNo, recipientName: saved.recipientName,
                        seminarTitle: saved.seminarTitle, seminarDate: saved.seminarDate, template: saved.template };
                    detailsStatus = "Verified";
                    revokedAt = saved.revokedAt;
                }
            } catch (err) {
                detailsStatus = "Unavailable";
                console.error("Certificate details lookup failed", { code: err.code || "LOOKUP_FAILED" });
            }
        }

        res.json({
            status: ["NotFound", "Valid", "Revoked"][record.status],
            tokenId: String(record.tokenID ?? 0),
            batchId: (record.batchId ?? 0n).toString(),
            recipient: record.recipient ?? "0x0000000000000000000000000000000000000000",
            issuedAt: (record.issuedAt ?? 0n).toString(),
            // The chain proves that a certificate is revoked, not when: the time is the revoking block's, saved at finality.
            revokedAt: revokedAt ? String(Math.floor(revokedAt.getTime() / 1000)) : "0",
            issuerAddress: context.issuerAddress,
            // For the page's Polygonscan links, so a verifier can check the token and its minting transaction there.
            contractAddress: context.contractAddress,
            transactionHash: record.transactionHash ?? null,
            certificate,
            detailsStatus,
        });
    } catch (err) {
        console.error("Certificate verification failed", {
            name: err.name,
        });

        res.status(503).json ({
            error: "Blockchain verification is unavailable. Please try again.",
        });
    }
});

export default router;

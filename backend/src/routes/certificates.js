import { Router } from "express";
import { verifyCertificate, certificateIssuer } from "../services/certificates.js";
import { pool } from "../db/pool.js";
import { certificateHash } from "../utils/certificateConsent.js";

const router = Router();

router.get("/certificates/verify/:certHash", async (req, res) => {
    res.set("Cache-Control", "no-store");

    const { certHash } = req.params;

    if (!/^0x[0-9a-fA-F]{64}$/.test(certHash)) {
        return res.status(400).json({
            error: "Certificate hash must be 0x followed by 64 hexadecimal characters",
        });
    }

    try {
        const [record, context] = await Promise.all([verifyCertificate(certHash), certificateIssuer()]);
        const [status, tokenId, recipient, issuedAt, revokedAt] = record;
        let certificate = null;
        let detailsStatus = "NotFound";
        if (status !== 0) {
            try {
                const { rows } = await pool.query(
                    `SELECT c."certificateNo", c."recipientName", c."seminarTitle",
                            to_char(c."seminarDate", 'YYYY-MM-DD') AS "seminarDate", w."studentWalletAddress" AS "walletAddress"
                     FROM certificate c LEFT JOIN student_wallet w ON w."studentWalletID" = c."studentWalletID"
                     WHERE c."certificateHash" = $1`, [certHash.toLowerCase()],
                );
                const saved = rows[0];
                detailsStatus = saved ? "Mismatch" : "Missing";
                // Only publish the snapshot if its facts reproduce the hash registered on this contract.
                if (saved?.walletAddress?.toLowerCase() === recipient.toLowerCase() &&
                    certificateHash(saved, context) === certHash.toLowerCase()) {
                    certificate = { certificateNo: saved.certificateNo, recipientName: saved.recipientName,
                        seminarTitle: saved.seminarTitle, seminarDate: saved.seminarDate };
                    detailsStatus = "Verified";
                }
            } catch (err) {
                detailsStatus = "Unavailable";
                console.error("Certificate details lookup failed", { code: err.code || "LOOKUP_FAILED" });
            }
        }

        res.json({
            status: ["NotFound", "Valid", "Revoked"][status],
            tokenId: tokenId.toString(),
            recipient,
            issuedAt: issuedAt.toString(),
            revokedAt: revokedAt.toString(),
            issuerAddress: context.issuerAddress,
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

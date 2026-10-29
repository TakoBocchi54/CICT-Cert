import { Router } from "express";
import { verifyCertificate } from "../services/certificates.js";

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
        const [status, tokenId, recipient, issuedAt, revokedAt] = await verifyCertificate(certHash);

        res.json({
            status: ["NotFound", "Valid", "Revoked"][status],
            tokenId: tokenId.toString(),
            recipient,
            issuedAt: issuedAt.toString(),
            revokedAt: revokedAt.toString(),
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
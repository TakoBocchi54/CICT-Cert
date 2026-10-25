import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

router.get("/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({status: "ok", database: "connected"})
    } catch (err) {
        // Log diagnostic codes without exposing connection credentials or error details publicly.
        console.error("Database health check failed:", {
            name: err.name,
            code: err.code,
            causeCode: err.cause?.code,
            errors: err.errors?.map(error => ({ name: error.name, code: error.code })),
        });
        res.status(500).json({status: "error", database: "unreachable"});
    }
});

export default router;

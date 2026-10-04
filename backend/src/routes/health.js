import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

router.get("/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({status: "ok", database: "connected"})
    } catch (err) {
        res.status(500).json({status: "error", database: "unreachable"});
    }
});

export default router;
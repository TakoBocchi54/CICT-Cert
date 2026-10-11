import { Router } from "express";
import { jwtVerify } from "jose";
import { pool } from "../db/pool.js";
import { secret, COOKIE } from "../utils/session.js";

const router = Router();

router.get("/auth/me", async (req,res) => {
    res.set("Cache-Control", "no-store");

    const token = req.cookies[COOKIE];
    if (!token) {
        return res.status(401).json({ error: "No session token found" });
    }

    let session;
    try {
        const { payload } = await jwtVerify(token, secret, {
            algorithms: ["HS256"],
            requiredClaims: ["exp", "iat", "role", "userID"],
        });
        session = payload;
    } catch {
        return res.status(401).json({ error: "Session expired or invalid" });
    } 

    let result;

    if (session.role === "STUDENT") {
        result = await pool.query(
            `SELECT u."email", s."studentID", s."firstName", s."lastName", w."studentWalletAddress" AS "walletAddress"
            FROM users u
            JOIN student s ON s."userID" = u."userID"
            LEFT JOIN student_wallet w ON w."studentID" = s."studentID"
            WHERE u."userID" = $1
                AND s."studentID" = $2
                AND u."role" = 'STUDENT'`,
            [session.userID, session.studentID]
        );
    } else if (session.role === "FACULTY") {
        result = await pool.query(
            `SELECT u."email", f."facultyID", f."firstName", f."lastName", f."canIssue"
            FROM users u
            JOIN cict_faculty f ON f."userID" = u."userID"
            WHERE u."userID" = $1
                AND f."facultyID" = $2
                AND u."role" = 'FACULTY'`,
            [session.userID, session.facultyID]
        );
    } else {
        return res.status(401).json({ error: "Invalid session role" });
    }

    const account = result.rows[0];

    if (!account) {
        return res.status(401).json({ error: "Account not found" });
    }

    const isStudent = session.role === "STUDENT";

    res.json ({
        role: isStudent ? "student" : "faculty",
        email: account.email,
        name: `${account.firstName} ${account.lastName}`,
        title: isStudent ? "Student" : "Faculty",
        ...(isStudent
            ? {
                studentID: account.studentID,
                walletAddress: account.walletAddress,
            }
            : {
                facultyID: account.facultyID,
                canIssue: account.canIssue,
            }),
    });
});

export default router;
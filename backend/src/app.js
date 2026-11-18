import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import healthRoutes from "./routes/health.js";
import studentAuthRoutes from "./routes/studentAuth.js";
import walletRoutes from "./routes/wallet.js";
import facultyAuthRoutes from "./routes/facultyAuth.js";
import authSessionRoutes from "./routes/authSession.js";
import certificateRoutes from "./routes/certificates.js";

import facultyAccountRoutes from "./routes/facultyAccount.js";
import seminarRoutes from "./routes/seminars.js";
import certificateApprovalRoutes from "./routes/certificateApprovals.js";
import revocationRoutes from "./routes/revocations.js";
import studentRoutes from "./routes/students.js";
import templateRoutes from "./routes/templates.js";
import registrationRoutes from "./routes/registration.js";
import notificationRoutes from "./routes/notifications.js";
import auditLogRoutes from "./routes/auditLog.js";
import { auditLog } from "./middleware/auditLog.js";

const app = express();
// Render and Vercel each sit in front of this app; without this every client shares the proxy's IP in the rate limiters.
// shortcut: trusts a fixed 2 hops (Vercel rewrite -> Render); adjust if the proxy chain changes.
app.set("trust proxy", 2);

app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(auditLog);

app.use("/api", healthRoutes);
app.use("/api", authSessionRoutes);
app.use("/api", studentAuthRoutes);
app.use("/api", walletRoutes);
app.use("/api", facultyAuthRoutes);
app.use("/api", certificateRoutes);

app.use("/api", facultyAccountRoutes);
app.use("/api", seminarRoutes);
app.use("/api", certificateApprovalRoutes);
app.use("/api", revocationRoutes);
app.use("/api", studentRoutes);
app.use("/api", templateRoutes);
app.use("/api", registrationRoutes);
app.use("/api", notificationRoutes);
app.use("/api", auditLogRoutes);

export default app;

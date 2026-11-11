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

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

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

export default app;

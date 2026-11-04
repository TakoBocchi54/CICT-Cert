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

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use("/api", healthRoutes);
app.use("/api", authSessionRoutes);
app.use("/api", studentAuthRoutes);
app.use("/api", walletRoutes);
app.use("/api", facultyAuthRoutes);
app.use("/api", certificateRoutes);

app.use("/api", facultyAccountRoutes);

export default app;
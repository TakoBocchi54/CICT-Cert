import { jwtVerify } from "jose";
import { secret, COOKIE } from "../utils/session.js";

export async function requireStudent(req, res, next) {
  const token = req.cookies[COOKIE];
  if (!token) return res.status(401).json({ error: "Not signed in" });
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.role !== "STUDENT") throw new Error("wrong role");
    req.student = { userID: payload.userID, studentID: payload.studentID };
    next();
  } catch {
    res.status(401).json({ error: "Session expired. Please sign in again." });
  }
}

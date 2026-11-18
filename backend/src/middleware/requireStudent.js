import { jwtVerify } from "jose";
import { secret, COOKIE } from "../utils/session.js";

export async function requireStudent(req, res, next) {
  const token = req.cookies[COOKIE];
  if (!token) return res.status(401).json({ error: "Not signed in" });
  let payload;
  try {
    ({ payload } = await jwtVerify(token, secret));
  } catch {
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }
  // One login cookie per browser: a faculty sign-in in another tab replaced this one.
  if (payload.role !== "STUDENT") {
    return res.status(401).json({ error: "This browser is now signed in as faculty, probably in another tab. Sign in again as a student." });
  }
  req.student = { userID: payload.userID, studentID: payload.studentID };
  next();
}

import { SignJWT } from "jose";

export const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
export const COOKIE = "cict_session";

export async function startSession(res, claims) {
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secret);

  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000,
  });
}

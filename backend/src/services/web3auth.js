import { createRemoteJWKSet, jwtVerify } from "jose";

const clientId = process.env.WEB3AUTH_CLIENT_ID?.trim();
const issuer = process.env.WEB3AUTH_ISSUER?.trim();
const jwksUrl = process.env.WEB3AUTH_JWKS_URL?.trim();

if (!clientId || !issuer || !jwksUrl) {
  throw new Error("Missing Web3Auth verification configuration");
}

const jwks = createRemoteJWKSet(new URL(jwksUrl));

export async function verifyIdToken(idToken) {
  const { payload } = await jwtVerify(idToken, jwks, {
    algorithms: ["ES256"],
    issuer,
    audience: clientId,
    requiredClaims: ["iss", "aud", "exp", "iat"],
    clockTolerance: 60  ,
  });

  const now = Math.floor(Date.now() / 1000);

  if (typeof payload.iat !== "number" || payload.iat > now + 60) {
    throw new Error("Invalid token issue time");
  }

  return payload;
}
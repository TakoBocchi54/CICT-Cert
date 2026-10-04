import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL(process.env.WEB3AUTH_JWKS_URL));

export async function verifyIdToken(idToken) {
  try {
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: process.env.WEB3AUTH_ISSUER || "https://web3auth.io",
      audience: process.env.WEB3AUTH_CLIENT_ID,
    });
    return payload;
  } catch (error) {
    console.error("JWT Verification Error Details:", {
      message: error.message,
      code: error.code,
      claim: error.claim,
      reason: error.reason,
      clientId: process.env.WEB3AUTH_CLIENT_ID,
      jwksUrl: process.env.WEB3AUTH_JWKS_URL,
      issuer: process.env.WEB3AUTH_ISSUER,
    });
    throw error;
  }
}

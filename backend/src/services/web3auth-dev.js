import { decodeJwt } from "jose";

/**
 * DEVELOPMENT ONLY: Simple token validation without signature verification
 * DO NOT USE IN PRODUCTION
 */
export async function verifyIdTokenDev(idToken) {
  try {
    // Decode without verification
    const payload = decodeJwt(idToken);
    
    // Basic checks
    if (payload.iss !== "web3auth.io") {
      throw new Error("Invalid issuer");
    }
    
    if (payload.aud !== process.env.WEB3AUTH_CLIENT_ID) {
      throw new Error("Invalid audience");
    }
    
    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      throw new Error("Token expired");
    }
    
    console.log("⚠️  WARNING: Using development token validation (no signature check)");
    return payload;
  } catch (error) {
    console.error("Token validation error:", error.message);
    throw error;
  }
}

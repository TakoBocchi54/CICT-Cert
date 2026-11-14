import test from "node:test";
import assert from "node:assert/strict";
import { keccak256, toBytes } from "viem";
import { certificateHash, certificatePayload, walletConsentMessage } from "./certificateConsent.js";

const certificate = { certificateNo: "9007199254740993", walletAddress: "0x1111111111111111111111111111111111111111",
  recipientName: "Juan Dela Cruz", seminarTitle: "Web Security", seminarDate: "2026-11-09" };
const context = { chainId: 80002, contractAddress: "0x2222222222222222222222222222222222222222",
  issuerAddress: "0x3333333333333333333333333333333333333333" };

test("certificate hash has a stable versioned encoding and preserves bigint certificate numbers", () => {
  assert.equal(certificateHash(certificate, context), "0x20f19dbf0b5a4c916f09dd21d16e41e87eee596ebe5f11751f20005384171919");
  assert.equal(certificateHash({ ...certificate, certificateNo: 9007199254740993n }, context), certificateHash(certificate, context));
  assert.notEqual(certificateHash({ ...certificate, certificateNo: "9007199254740992" }, context), certificateHash(certificate, context));
});

test("every approved fact and network domain affects the certificate hash", () => {
  const original = certificateHash(certificate, context);
  for (const [field, value] of Object.entries({ certificateNo: "2", walletAddress: context.contractAddress,
    recipientName: "Ana Reyes", seminarTitle: "Different Seminar", seminarDate: "2026-11-10" })) {
    assert.notEqual(certificateHash({ ...certificate, [field]: value }, context), original, field);
  }
  for (const [field, value] of Object.entries({ chainId: 137, contractAddress: certificate.walletAddress, issuerAddress: certificate.walletAddress })) {
    assert.notEqual(certificateHash(certificate, { ...context, [field]: value }), original, field);
  }
});

test("the published payload is exactly what is hashed, and states that nobody can burn the token", () => {
  const payload = certificatePayload(certificate, context);
  assert.equal(keccak256(toBytes(JSON.stringify(payload))), certificateHash(certificate, context));
  assert.deepEqual(Object.keys(payload), ["version", "chainId", "contractAddress", "issuerAddress", "certificateNo", "recipient",
    "recipientName", "seminarTitle", "seminarDate", "burnAuth"]);
  assert.equal(payload.version, 2); assert.equal(payload.burnAuth, "Neither");
});

test("the wallet-link message carries the student's standing consent and a request nonce", () => {
  const message = walletConsentMessage("42", "unique-request", "2026-11-09T00:00:00.000Z");
  for (const value of ["Student ID: 42", "unique-request", "2026-11-09T00:00:00.000Z"]) assert.ok(message.includes(value));
  assert.match(message, /agree to receive my CICT seminar certificates/);
  assert.match(message, /non-transferable tokens on Polygon Amoy/);
  assert.match(message, /CICT may mark a certificate as revoked/);
  assert.match(message, /does not send a blockchain transaction or authorize spending/);
});

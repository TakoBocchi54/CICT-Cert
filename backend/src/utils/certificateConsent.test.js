import test from "node:test";
import assert from "node:assert/strict";
import { certificateHash, certificateConsentMessage } from "./certificateConsent.js";

const certificate = { certificateNo: "9007199254740993", walletAddress: "0x1111111111111111111111111111111111111111",
  recipientName: "Juan Dela Cruz", seminarTitle: "Web Security", seminarDate: "2026-11-09" };
const context = { chainId: 80002, contractAddress: "0x2222222222222222222222222222222222222222",
  issuerAddress: "0x3333333333333333333333333333333333333333" };

test("certificate hash has a stable versioned encoding and preserves bigint certificate numbers", () => {
  assert.equal(certificateHash(certificate, context), "0x66dae6b97ce11e889d4a13d3476d44a1d3e8fad105230803fe12d0ca3ccc9d34");
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

test("approval message contains the exact facts, issuer-only policy and request nonce", () => {
  const hash = certificateHash(certificate, context);
  const message = certificateConsentMessage(certificate, context, hash, "unique-request", "2026-11-09T00:00:00.000Z");
  for (const value of [...Object.values(certificate), context.contractAddress, context.issuerAddress, hash, "unique-request"]) {
    assert.ok(message.includes(value));
  }
  assert.match(message, /Only the issuer may revoke \(burn\)/);
  assert.match(message, /cannot transfer it or burn it myself/);
  assert.match(message, /does not send a blockchain transaction or authorize spending/);
});

import { keccak256, toBytes } from "viem";

export function certificateHash(certificate, context) {
  // Field order and version define the canonical payload used again at issuance and verification.
  return keccak256(toBytes(JSON.stringify({
    version: 1,
    chainId: context.chainId,
    contractAddress: context.contractAddress.toLowerCase(),
    issuerAddress: context.issuerAddress.toLowerCase(),
    certificateNo: String(certificate.certificateNo),
    recipient: certificate.walletAddress.toLowerCase(),
    recipientName: certificate.recipientName,
    seminarTitle: certificate.seminarTitle,
    seminarDate: certificate.seminarDate,
    burnAuth: "IssuerOnly",
  })));
}

export function certificateConsentMessage(certificate, context, hash, nonce, requestedAt) {
  return [
    "CICT-Cert certificate approval",
    `Network: Polygon Amoy (${context.chainId})`,
    `Contract: ${context.contractAddress}`,
    `Issuer wallet: ${context.issuerAddress}`,
    `Certificate number: ${certificate.certificateNo}`,
    `Recipient: ${certificate.recipientName}`,
    `Seminar: ${certificate.seminarTitle}`,
    `Seminar date: ${certificate.seminarDate}`,
    `Recipient wallet: ${certificate.walletAddress.toLowerCase()}`,
    `Certificate hash: ${hash}`,
    "",
    "I approve issuance of this specific certificate to my wallet with the details above.",
    "Only the issuer may revoke (burn) this certificate. I cannot transfer it or burn it myself.",
    "The issued certificate details and burn authorization cannot be changed.",
    "This signature does not send a blockchain transaction or authorize spending.",
    "",
    `Request nonce: ${nonce}`,
    `Requested at: ${requestedAt}`,
  ].join("\n");
}

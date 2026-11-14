import { keccak256, toBytes } from "viem";

// Field order and version define the canonical payload used again at issuance and verification.
export function certificatePayload(certificate, context) {
  return {
    version: 2,
    chainId: context.chainId,
    contractAddress: context.contractAddress.toLowerCase(),
    issuerAddress: context.issuerAddress.toLowerCase(),
    certificateNo: String(certificate.certificateNo),
    recipient: certificate.walletAddress.toLowerCase(),
    recipientName: certificate.recipientName,
    seminarTitle: certificate.seminarTitle,
    seminarDate: certificate.seminarDate,
    burnAuth: "Neither",
  };
}

export const certificateHash = (certificate, context) => keccak256(toBytes(JSON.stringify(certificatePayload(certificate, context))));

// Signed once when the student links their wallet; it is their standing consent to every later certificate.
export function walletConsentMessage(studentID, nonce, issuedAt) {
  return [
    "CICT-Cert wallet link",
    `Student ID: ${studentID}`,
    "",
    "I link this wallet to my CICT-Cert account and agree to receive my CICT seminar certificates at it",
    "as non-transferable tokens on Polygon Amoy.",
    "Each certificate is issued under the name shown for it in my student portal.",
    "CICT may mark a certificate as revoked. I cannot transfer or remove a certificate.",
    "This signature does not send a blockchain transaction or authorize spending.",
    "",
    `Nonce: ${nonce}`,
    `Issued at: ${issuedAt}`,
  ].join("\n");
}

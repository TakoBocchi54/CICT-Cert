// Faculty-facing progress of one row from GET /api/faculty/seminars/:id/certificates.
export const certificateProgress = certificate =>
  ['ISSUED', 'REVOKED'].includes(certificate.status) ? certificate.status
    : certificate.transactionStatus === 'PENDING' ? 'Transaction pending'
    : !certificate.attended ? 'On hold: attendance not confirmed'
    : !certificate.walletConnected ? 'Awaiting wallet setup'
    : certificate.status === 'FAILED' ? 'Mint failed; ready to retry'
    : certificate.consentedAt ? 'Approved; awaiting issuance'
    : 'Awaiting student approval';

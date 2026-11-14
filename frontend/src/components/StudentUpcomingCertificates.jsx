import { Btn } from './design-system';

// Read-only: the student's certificates that are not issued yet, with the name exactly as it will be printed.
// `certificates` is App's GET /api/student/certificates query. There is nothing to sign: linking the wallet was the consent.
export default function StudentUpcomingCertificates({ certificates }) {
  const upcoming = certificates.data?.filter(certificate => ['PENDING', 'FAILED'].includes(certificate.status)) || [];

  return <section className="sheet mb-8 min-w-0 p-5 md:p-7" aria-labelledby="upcoming-certificates-title">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 id="upcoming-certificates-title" className="font-serif text-2xl">Upcoming certificates</h2>
      <Btn variant="line" size="sm" disabled={certificates.isFetching} onClick={() => certificates.refetch()}>Refresh</Btn>
    </div>
    {certificates.isPending ? <p role="status">Loading certificates...</p> : certificates.error ? <p role="alert" className="text-sm text-revoked">{certificates.error.message}</p> : !upcoming.length ? <p className="text-sm text-ink-soft">No certificates are being prepared for you right now.</p> : <>
      <p className="mb-4 max-w-2xl text-sm text-ink-soft">Your name will be printed exactly as shown below. If it is wrong, tell your CICT faculty before the certificate is issued; after that it can only be corrected by revoking it and issuing a new one.</p>
      <ul className="space-y-3">
        {upcoming.map(certificate => <li key={certificate.certificateID} className="rounded-xl border border-[var(--line)] p-4">
          <p className="break-words font-medium">{certificate.seminarTitle}</p>
          <p className="text-sm text-ink-soft">#{certificate.certificateNo} · {certificate.seminarDate}</p>
          <p className="mt-2 text-sm">Name on certificate: <strong className="break-words font-semibold">{certificate.recipientName}</strong></p>
          <p className="mt-1 text-sm text-ink-soft">{!certificate.attended ? 'On hold: attendance not confirmed' : !certificate.walletAddress ? 'Awaiting wallet setup' : 'Awaiting issuance by faculty'}</p>
        </li>)}
      </ul>
    </>}
  </section>;
}

import { Lockup, Seal, Btn, Pill, Rosette, Certificate } from '../components/design-system';
import { useCertificateVerification } from '../hooks/useCertificateVerification';
import { certificateVerificationUrl } from '../lib/certificateVerificationUrl';

const RESULTS = {
  Valid: {
    title: 'Certificate is valid',
    description: 'This hash is registered and has not been revoked.',
    seal: 'Verified',
    backgroundClass: 'bg-verified',
  },
  Revoked: {
    title: 'Certificate has been revoked',
    description: 'The issuer has revoked this certificate. Do not rely on it.',
    seal: 'Revoked',
    backgroundClass: 'bg-revoked',
  },
  NotFound: {
    title: 'No matching certificate found',
    description: 'This hash is not registered in this contract.',
    seal: 'Invalid',
    backgroundClass: 'bg-ink-soft',
  },
};

// One request does all of these; they are shown together, not ticked on a timer.
const CHECKS = [
  'Reading the record from Polygon Amoy',
  'Checking revocation status',
  'Matching the stored certificate details',
];

const DETAILS_MESSAGES = {
  Missing: 'This blockchain record has no certificate details available in this portal.',
  Mismatch: 'The stored certificate details do not match this blockchain record and cannot be confirmed.',
  Unavailable: 'The blockchain record was checked, but certificate details are temporarily unavailable. Please try again.',
};

const formatTime = value =>
  value === '0'
    ? '—'
    : new Date(Number(value) * 1000).toLocaleString();

const Row = ({ label, children, mono }) => (
  <div className="hair flex items-baseline justify-between gap-6 py-3 first:border-t-0">
    <dt className="eyebrow shrink-0">{label}</dt>
    <dd className={`min-w-0 break-all text-right text-sm text-ink ${mono ? 'font-mono text-xs' : 'font-medium'}`}>
      {children}
    </dd>
  </div>
);

// Only reachable through a certificate's QR code (/verify?id=<hash>); there is no manual hash entry.
export default function VerifierPortalPage({
  initialId = '',
  onBackToPortal,
  loggedIn = false,
}) {
  const id = initialId.trim();
  const submittedHash = /^0x[0-9a-fA-F]{64}$/.test(id) ? id : '';

  const verification = useCertificateVerification(submittedHash);
  const result = verification.data;

  const phase = verification.isFetching
    ? 'checking'
    : result && !verification.isError
      ? 'result'
      : 'idle';

  const banner = result ? RESULTS[result.status] : null;
  const error = id && !submittedHash
    ? 'This verification link is incomplete or damaged. Scan the QR code on the certificate again.'
    : verification.error?.message;
  const details = result?.certificate;

  const chainRecord = result && (
    <section className="sheet p-6 sm:p-7">
      <h2 className="eyebrow mb-1">Blockchain record</h2>
      <dl>
        <Row label="Network">Polygon Amoy testnet</Row>
        <Row label="Token standard">ERC-5484 (soulbound)</Row>
        <Row label="Status"><Pill status={banner.seal} /></Row>
        {result.status !== 'NotFound' && <>
          <Row label="Token ID" mono>{result.tokenId}</Row>
          <Row label="Batch" mono>#{result.batchId}</Row>
          <Row label="Issued">{formatTime(result.issuedAt)}</Row>
          <Row label="Revoked">{formatTime(result.revokedAt)}</Row>
          <Row label="Issuer wallet" mono>{result.issuerAddress}</Row>
          <Row label="Recipient wallet" mono>{result.recipient}</Row>
        </>}
      </dl>
      <div className="hair pt-3">
        <div className="eyebrow mb-2">Certificate hash</div>
        <div className="break-all rounded-lg border border-paper-3 bg-paper-2 p-3 font-mono text-[11px]">{submittedHash}</div>
      </div>
    </section>
  );

  return (
    <div className="min-h-screen bg-paper-2 text-ink">
      <div className="bg-forest text-xs text-white/80">
        <div className="mx-auto flex max-w-6xl justify-between gap-4 px-6 py-2">
          <span>Official certificate inspection · College of Information and Communications Technology</span>
          <span className="hidden shrink-0 sm:inline">No login required</span>
        </div>
      </div>

      <header className="border-b border-paper-3 bg-paper">
        <div className="mx-auto flex min-h-20 max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <Lockup />
          <button
            type="button"
            onClick={onBackToPortal}
            className="flex items-center gap-2 rounded-sm text-sm font-semibold text-ink-soft hover:text-forest focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest"
          >
            {loggedIn ? 'Back to portal' : 'Institution sign-in'}
            <i className="ph-bold ph-arrow-right" aria-hidden="true"></i>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10 sm:py-14">
        {phase === 'idle' && (
          <section className="fade-view mx-auto max-w-2xl text-center">
            <div className="mb-6 flex justify-center"><Seal status="Verified" size={92} /></div>
            <h1 className="font-serif text-5xl font-medium leading-[1.02] sm:text-6xl">
              Verify a certificate
            </h1>
            <p className="mt-5 text-lg text-ink-soft">
              Scan the QR code on the certificate with your phone camera.
              The result comes straight from the blockchain record on Polygon Amoy.
            </p>

            {error && (
              <div role="alert" className="mx-auto mt-8 max-w-md rounded-xl border border-revoked/20 bg-revoked-bg p-4 text-sm text-revoked">
                <p>{error}</p>
                {submittedHash && <Btn variant="line" size="sm" className="mt-3" onClick={() => verification.refetch()}>Try again</Btn>}
              </div>
            )}
          </section>
        )}

        {phase === 'checking' && (
          <section role="status" className="fade-view mx-auto max-w-md py-20 text-center">
            <div
              aria-hidden="true"
              className="mx-auto size-24 animate-spin rounded-full border-4 border-paper-3 border-t-forest motion-reduce:animate-none"
            />
            <h1 className="mt-8 font-serif text-3xl font-medium">
              Inspecting certificate…
            </h1>
            <p className="mt-2 break-all font-mono text-xs text-ink-muted">
              {submittedHash}
            </p>
            <ul className="mt-8 inline-block space-y-3 text-left">
              {CHECKS.map(check => (
                <li key={check} className="flex items-center gap-3 text-sm font-medium text-ink-soft">
                  <i className="ph ph-circle-dashed text-xl text-forest" aria-hidden="true"></i>
                  {check}
                </li>
              ))}
            </ul>
          </section>
        )}

        {phase === 'result' && (
          <section className="fade-view">
            <div className={`relative flex flex-wrap items-center gap-8 overflow-hidden rounded-3xl p-8 text-white md:p-10 ${banner.backgroundClass}`}>
              <Rosette color="#fff" className="pointer-events-none absolute" style={{ width: 420, right: -120, top: -170, opacity: 0.13 }} />
              <div className="relative"><Seal status={banner.seal} size={118} animate /></div>
              <div className="relative min-w-[240px] flex-1">
                <h1 className="font-serif text-4xl font-medium leading-tight md:text-5xl">
                  {result.status === 'Valid' && !details ? 'Blockchain record is valid' : banner.title}
                </h1>
                <p className="mt-3 text-lg text-white/80">
                  {banner.description}
                </p>
              </div>
            </div>

            {details ? (
              <div className="mt-8 grid items-start gap-8 lg:grid-cols-12">
                <div className="space-y-4 lg:col-span-7">
                  <Certificate
                    tilt={false}
                    verificationUrl={certificateVerificationUrl(submittedHash, window.location.origin)}
                    cert={{
                      id: details.certificateNo,
                      recipient: details.recipientName,
                      seminar: details.seminarTitle,
                      iso: details.seminarDate,
                      status: banner.seal,
                      hash: submittedHash,
                      template: details.template,
                    }}
                  />
                  <p className="text-sm text-ink-soft">
                    These details match the certificate hash registered on the blockchain. Compare them with the certificate you received.
                  </p>
                </div>
                <div className="space-y-6 lg:col-span-5">
                  <section className="sheet p-6 sm:p-7">
                    <h2 className="eyebrow mb-1">Inspection record</h2>
                    <div className="hair py-4">
                      <div className="eyebrow mb-1">Certificate holder</div>
                      <div className="font-serif text-3xl font-medium leading-tight">{details.recipientName}</div>
                    </div>
                    <div className="hair py-4">
                      <div className="eyebrow mb-1">Seminar</div>
                      <div className="font-serif text-xl font-medium leading-snug">{details.seminarTitle}</div>
                    </div>
                    <dl>
                      <Row label="Issuing institution">CICT, University of Batangas</Row>
                      <Row label="Certificate number" mono>{details.certificateNo}</Row>
                      <Row label="Seminar date">{details.seminarDate}</Row>
                    </dl>
                  </section>
                  <div>{chainRecord}</div>
                </div>
              </div>
            ) : (
              <div className="mx-auto mt-8 max-w-2xl space-y-4">
                {chainRecord}
                {DETAILS_MESSAGES[result.detailsStatus] && <div role="alert" className="rounded-xl border border-paper-3 bg-paper p-4 text-sm text-ink-soft">
                  <p>{DETAILS_MESSAGES[result.detailsStatus]} Compare the certificate details before accepting it as proof.</p>
                  {result.detailsStatus === 'Unavailable' && <Btn variant="line" size="sm" className="mt-3" onClick={() => verification.refetch()}>Try again</Btn>}
                </div>}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

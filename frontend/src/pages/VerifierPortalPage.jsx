import { Lockup, Seal, Btn, Pill, Rosette, Certificate } from '../components/design-system';
import { useCertificateVerification } from '../hooks/useCertificateVerification';
import { certificateVerificationUrl } from '../lib/certificateVerificationUrl';
import { formatCertificateNo } from '../lib/certificateNumber';
import { polygonscan } from '../lib/polygonscan';

const RESULTS = {
  Valid: {
    title: 'Certificate is valid',
    description: 'This hash is registered.',
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

const longDate = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

const Row = ({ label, children, mono }) => (
  <div className="hair flex items-baseline justify-between gap-6 py-3 first:border-t-0">
    <dt className="eyebrow shrink-0">{label}</dt>
    <dd className={`min-w-0 text-right text-sm text-ink [overflow-wrap:anywhere] ${mono ? 'font-mono text-xs' : 'font-medium'}`}>
      {children}
    </dd>
  </div>
);

// A value a verifier can open on Polygonscan to check it independently.
const ScanLink = ({ href, children, label }) => (
  <a href={href} target="_blank" rel="noreferrer"
    className="rounded-sm text-forest-600 underline decoration-forest-600/30 underline-offset-2 hover:decoration-forest-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest">
    {children}
    <i className="ph-bold ph-arrow-square-out ml-1 align-[-1px]" aria-hidden="true"></i>
    <span className="sr-only"> ({label}, opens Polygonscan in a new tab)</span>
  </a>
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

  const found = result && result.status !== 'NotFound';
  const chainRecord = result && (
    <section className="sheet p-6 sm:p-7" aria-labelledby="chain-record-title">
      <h2 id="chain-record-title" className="eyebrow mb-1">Blockchain record</h2>
      <dl>
        <Row label="Network">Polygon Amoy testnet</Row>
        <Row label="Token standard">ERC-5484 (soulbound)</Row>
        <Row label="Status"><Pill status={banner.seal} /></Row>
        {found && <>
          <Row label="Token ID" mono>
            {result.contractAddress ? <ScanLink href={polygonscan.token(result.contractAddress, result.tokenId)} label="token">{result.tokenId}</ScanLink> : result.tokenId}
          </Row>
          <Row label="Batch" mono>#{result.batchId}</Row>
          <Row label="Issued">{formatTime(result.issuedAt)}</Row>
          {result.status === 'Revoked' && <Row label="Revoked">{formatTime(result.revokedAt)}</Row>}
          {result.transactionHash && <Row label="Issuing transaction" mono>
            <ScanLink href={polygonscan.tx(result.transactionHash)} label="issuing transaction">{result.transactionHash}</ScanLink>
          </Row>}
          <Row label="Issuer wallet" mono><ScanLink href={polygonscan.address(result.issuerAddress)} label="issuer wallet">{result.issuerAddress}</ScanLink></Row>
          <Row label="Recipient wallet" mono><ScanLink href={polygonscan.address(result.recipient)} label="recipient wallet">{result.recipient}</ScanLink></Row>
        </>}
        {result.contractAddress && <Row label="Smart contract" mono>
          <ScanLink href={polygonscan.address(result.contractAddress)} label="smart contract">{result.contractAddress}</ScanLink>
        </Row>}
      </dl>
      <div className="hair pt-3">
        <div className="eyebrow mb-2">Certificate hash</div>
        <div className="rounded-lg border border-paper-3 bg-paper-2 p-3 font-mono text-[11px] [overflow-wrap:anywhere]">{submittedHash}</div>
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
          // One centered column: the verdict, the certificate, then its details, all the same width.
          <section className="fade-view mx-auto max-w-3xl space-y-6">
            <div className={`relative overflow-hidden rounded-3xl px-6 py-8 text-center text-white sm:px-10 ${banner.backgroundClass}`}>
              <Rosette color="#fff" className="pointer-events-none absolute" style={{ width: 420, right: -140, top: -180, opacity: 0.13 }} />
              <div className="relative flex flex-col items-center gap-5 sm:flex-row sm:justify-center sm:text-left">
                <Seal status={banner.seal} size={96} animate />
                <div>
                  <h1 className="font-serif text-3xl font-medium leading-tight text-balance md:text-4xl">
                    {result.status === 'Valid' && !details ? 'Blockchain record is valid' : banner.title}
                  </h1>
                  <p className="mt-2 text-base text-white/85">{banner.description}</p>
                </div>
              </div>
            </div>

            {details ? <>
              <figure>
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
                <figcaption className="mx-auto mt-3 max-w-xl text-center text-sm text-ink-soft">
                  These details match the certificate hash registered on the blockchain. Compare them with the certificate you received.
                </figcaption>
              </figure>

              <section className="sheet p-6 sm:p-7" aria-labelledby="inspection-title">
                <h2 id="inspection-title" className="eyebrow mb-1">Inspection record</h2>
                <div className="hair py-4">
                  <div className="eyebrow mb-1">Seminar</div>
                  <div className="font-serif text-xl font-medium leading-snug">{details.seminarTitle}</div>
                </div>
                <div className="hair py-4">
                  <div className="eyebrow mb-1">Certificate holder</div>
                  <div className="font-serif text-2xl font-medium leading-tight">{details.recipientName}</div>
                </div>
                <dl>
                  <Row label="Issuing institution">CICT, University of Batangas</Row>
                  <Row label="Certificate number" mono>{formatCertificateNo(details.certificateNo, details.seminarDate)}</Row>
                  <Row label="Seminar date">{longDate(details.seminarDate)}</Row>
                </dl>
              </section>

              {chainRecord}
            </> : <>
              {chainRecord}
              {DETAILS_MESSAGES[result.detailsStatus] && <div role="alert" className="rounded-xl border border-paper-3 bg-paper p-4 text-sm text-ink-soft">
                <p>{DETAILS_MESSAGES[result.detailsStatus]} Compare the certificate details before accepting it as proof.</p>
                {result.detailsStatus === 'Unavailable' && <Btn variant="line" size="sm" className="mt-3" onClick={() => verification.refetch()}>Try again</Btn>}
              </div>}
            </>}
          </section>
        )}
      </main>
    </div>
  );
}

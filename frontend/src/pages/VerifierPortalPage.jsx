import { useState } from 'react';
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

export default function VerifierPortalPage({
  initialId = '',
  onBackToPortal,
  loggedIn = false,
}) {
  const [input,setInput] = useState(initialId);
  const [submittedHash, setSubmittedHash] = useState(initialId.trim());
  const [inputError, setInputError] = useState('');

  const verification = useCertificateVerification(submittedHash);
  const result = verification.data;

  const phase = verification.isFetching
    ? 'checking'
    : result && !verification.isError
      ? 'result'
      : 'idle';

  const banner = result ? RESULTS[result.status] : null;
  const error = inputError || verification.error?.message;
  const details = result?.certificate;

  function handleSubmit(event) {
    event.preventDefault();

    const hash = input.trim();

    if(!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      setInputError('Enter 0x followed by 64 hexadecimal characters.');
      return;
    }

    setInputError('');
    setInput(hash);

    if (hash === submittedHash) {
      verification.refetch();
    } else {
      setSubmittedHash(hash);
    }
  }

  function reset() {
    setSubmittedHash('');
    setInput('');
    setInputError('');
  }

  const chainRecord = result && (
    <section className="sheet p-6 sm:p-7">
      <h2 className="eyebrow mb-1">Blockchain record</h2>
      <dl>
        <Row label="Network">Polygon Amoy testnet</Row>
        <Row label="Token standard">ERC-5484 (soulbound)</Row>
        <Row label="Status"><Pill status={banner.seal} /></Row>
        {result.status !== 'NotFound' && <>
          <Row label="Token ID" mono>{result.tokenId}</Row>
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
            <div className="mb-6 flex justify-center"><Seal status="Verified" size={92} animate /></div>
            <div className="eyebrow mb-3">University of Batangas · CICT</div>
            <h1 className="font-serif text-5xl font-medium leading-[1.02] sm:text-6xl">
              Verify a certificate
            </h1>
            <p className="mt-5 text-lg text-ink-soft">
              Enter the certificate hash, or scan the QR code on the certificate with your phone camera.
              The result comes straight from the blockchain record on Polygon Amoy.
            </p>

            <form
              onSubmit={handleSubmit}
              className="sheet tick-corners mt-10 p-6 text-left sm:p-8"
            >
              <label htmlFor="certificate-hash" className="eyebrow mb-2 block">
                Certificate hash
              </label>
              <input
                id="certificate-hash"
                value={input}
                onChange={event => setInput(event.target.value)}
                className="field font-mono !py-4"
                placeholder="0x..."
                required
                aria-invalid={Boolean(inputError)}
                aria-describedby={error ? 'verification-error' : undefined}
              />

              {error && (
                <p
                  id="verification-error"
                  role="alert"
                  className="mt-3 text-sm text-revoked"
                >
                  {error}
                </p>
              )}

              <Btn
                type="submit"
                iconRight="ph-arrow-right"
                className="mt-4 w-full !py-3.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest"
              >
                Verify certificate
              </Btn>
            </form>
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
                <div className="eyebrow !text-white/70">Verification result</div>
                <h1 className="rise mt-2 font-serif text-4xl font-medium leading-tight md:text-5xl">
                  {result.status === 'Valid' && !details ? 'Blockchain record is valid' : banner.title}
                </h1>
                <p className="rise mt-3 text-lg text-white/80" style={{ '--d': '.1s' }}>
                  {banner.description}
                </p>
              </div>
            </div>

            {details ? (
              <div className="mt-8 grid items-start gap-8 lg:grid-cols-12">
                <div className="rise space-y-4 lg:col-span-7">
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
                  <section className="sheet rise p-6 sm:p-7" style={{ '--d': '.06s' }}>
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
                  <div className="rise" style={{ '--d': '.12s' }}>{chainRecord}</div>
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

            <div className="mx-auto mt-8 max-w-2xl">
              <Btn
                variant="line"
                className="w-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest"
                onClick={reset}
              >
                Verify another certificate
              </Btn>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

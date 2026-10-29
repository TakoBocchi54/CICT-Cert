import { useState } from 'react';
import { Lockup, Seal, Btn } from '../components/design-system';
import { useCertificateVerification } from '../hooks/useCertificateVerification';

const RESULTS = {
  Valid: {
    title: 'Certificate is valid',
    description: 'This hash is registered and has not been revoked.',
    seal: 'Verified',
    backgroundClass: 'bg-verified',
  },
  Revoked: {
    title: 'Certificate has been revoked',
    description: ' The issuer has revoked this certificate',
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

const formatTime = value =>
  value === '0'
    ? '—'
    : new Date(Number(value) * 1000).toLocaleString();

const Row = ({ label, children }) => (
  <div className="border-t border-paper-3 py-3 first:border-t-0">
    <dt className="mb-1 text-xs font-semibold uppercase tracking-widest text-ink-muted">
      {label}
    </dt>
    <dd className="break-all font-mono text-sm text-ink">
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

  return (
    <div className="min-h-screen bg-paper-2 text-ink">
      <div className="bg-forest text-xs text-white/80">
        <div className="mx-auto max-w-6xl px-6 py-2">
          CICT certificate verification · No login required
        </div>
      </div>

      <header className="border-b border-paper-3 bg-paper">
        <div className="mx-auto flex min-h-20 max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <Lockup />
          <button
            type="button"
            onClick={onBackToPortal}
            className="rounded-sm text-sm font-semibold text-ink-soft hover:text-forest focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest"
          >
            {loggedIn ? 'Back to portal' : 'Institution sign-in'}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10 sm:py-14">
        {phase === 'idle' && (
          <section>
            <h1 className="font-serif text-4xl font-medium sm:text-5xl">
              Verify a certificate
            </h1>
            <p className="mt-4 text-ink-soft">
              Enter the certificate hash to check its record
              on Polygon Amoy.
            </p>

            <form
              onSubmit={handleSubmit}
              className="mt-8 rounded-2xl border border-paper-3 bg-paper p-6 shadow-sm sm:p-8"
            >
              <label
                htmlFor="certificate-hash"
                className="mb-2 block text-xs font-semibold uppercase tracking-widest text-ink-muted"
              >
                Certificate hash
              </label>
              <input
                id="certificate-hash"
                value={input}
                onChange={event => setInput(event.target.value)}
                className="w-full rounded-xl border border-paper-3 bg-white px-4 py-3 font-mono text-sm text-ink placeholder:text-ink-muted focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/20"
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
                className="mt-4 w-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest"
              >
                Verify certificate
              </Btn>
            </form>
          </section>
        )}

        {phase === 'checking' && (
          <section role="status" className="py-20 text-center">
            <div
              aria-hidden="true"
              className="mx-auto size-16 animate-spin rounded-full border-4 border-paper-3 border-t-forest motion-reduce:animate-none"
            />
            <h1 className="mt-6 font-serif text-3xl">
              Checking blockchain record
            </h1>
            <p className="mt-4 break-all font-mono text-xs text-ink-muted">
              {submittedHash}
            </p>
          </section>
        )}

        {phase === 'result' && (
          <section>
            <div
              className={`rounded-3xl p-6 text-center text-white sm:p-8 ${banner.backgroundClass}`}
            >
              <div className="flex justify-center">
                <Seal status={banner.seal} size={100} animate />
              </div>
              <h1 className="mt-5 font-serif text-3xl sm:text-4xl">
                {banner.title}
              </h1>
              <p className="mt-3 text-white/80">
                {banner.description}
              </p>
            </div>

            <dl className="mt-6 rounded-2xl border border-paper-3 bg-paper p-6 shadow-sm sm:p-7">
              <Row label="Network">Polygon Amoy testnet</Row>
              <Row label="Certificate hash">{submittedHash}</Row>
              <Row label="Status">{result.status}</Row>

              {result.status !== 'NotFound' && (
                <>
                  <Row label="Token ID">{result.tokenId}</Row>
                  <Row label="Recipient wallet">{result.recipient}</Row>
                  <Row label="Issued">{formatTime(result.issuedAt)}</Row>
                  <Row label="Revoked">{formatTime(result.revokedAt)}</Row>
                </>
              )}
            </dl>

            <p className="mt-3 text-xs text-ink-muted">
              Dates use your browser’s local time.
            </p>

            <Btn
              variant="line"
              className="mt-6 w-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest"
              onClick={reset}
            >
              Verify another certificate
            </Btn>
          </section>
        )}
      </main>
    </div>
  );
}
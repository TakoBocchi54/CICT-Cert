import { useState } from 'react';
import { Certificate, Seal, Pill, Btn } from '../components/design-system';

const fmt = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

function WalletCard({ walletAddress }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="sheet mb-6 flex items-center justify-between gap-4 p-5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-forest/10" aria-hidden="true">
          <i className="ph-bold ph-wallet text-xl text-forest"></i>
        </div>
        <div className="min-w-0">
          <div className="eyebrow">Your wallet address</div>
          <div className="mt-1 font-mono text-sm" title={walletAddress}>{walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</div>
        </div>
      </div>
      <Btn variant="line" size="sm" icon={copied ? 'ph-check' : 'ph-copy'} onClick={copy} aria-label="Copy full wallet address">
        <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
      </Btn>
    </div>
  );
}

export default function StudentDashboardPage({ certificates = [], onCertificateClick, onVerifyClick, onDownloadClick, onNavigateCollection, walletAddress }) {
  const sortedCerts = [...certificates].sort((a, b) => b.iso.localeCompare(a.iso));
  const featured = sortedCerts.find(c => c.status === 'Verified') || sortedCerts[0];

  const counts = { Verified: 0, Revoked: 0 };
  sortedCerts.forEach(c => counts[c.status]++);

  const totalIssued = sortedCerts.length;

  // Empty state
  if (!certificates.length) {
    return (
      <div>
        {walletAddress && <WalletCard walletAddress={walletAddress} />}

        <div className="max-w-2xl mx-auto text-center py-20">
          <div className="flex justify-center mb-6">
            <Seal status="Verified" size={92} />
          </div>
          <h1 className="font-serif text-5xl font-medium leading-[1.02]">No credentials yet</h1>
          <p className="text-ink-soft text-lg mt-5 max-w-md mx-auto">
            Your verified seminar certificates will appear here once CICT issues them.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {walletAddress && <WalletCard walletAddress={walletAddress} />}

      <div className="grid lg:grid-cols-12 gap-6 items-start">
        {/* Featured certificate: dominant */}
        <section className="lg:col-span-8" aria-labelledby="featured-title">
          <h1 id="featured-title" className="eyebrow mb-3">Latest verified credential</h1>
          <button type="button" className="block w-full cursor-pointer rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest"
            onClick={() => onCertificateClick(featured)} aria-label={`Open certificate: ${featured.seminar}`}>
            <Certificate cert={featured} />
          </button>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Btn icon="ph-seal-check" onClick={() => onVerifyClick(featured.hash)}>
              Verify credential
            </Btn>
            <Btn variant="ghost" icon="ph-download-simple" onClick={() => onDownloadClick(featured)}>
              Download PDF
            </Btn>
            <div className="ml-auto">
              <Pill status={featured.status} />
            </div>
          </div>
        </section>

        {/* Right column: count + recent */}
        <aside className="lg:col-span-4 space-y-6">
          <div className="sheet p-6">
            <h2 className="eyebrow">Credentials earned</h2>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="font-serif text-5xl font-medium leading-none tabular-nums">{counts.Verified}</span>
              <span className="text-ink-soft">verified of {totalIssued} issued</span>
            </p>
            <div className="flex h-1.5 rounded-full overflow-hidden mt-5 bg-paper-2" aria-hidden="true">
              <div style={{ width: (counts.Verified / totalIssued * 100) + '%', background: 'var(--verified)' }}></div>
              <div style={{ width: (counts.Revoked / totalIssued * 100) + '%', background: 'var(--revoked)' }}></div>
            </div>
            <div className="flex gap-4 mt-3 text-xs text-ink-muted font-medium">
              <span><b className="text-verified">{counts.Verified}</b> Verified</span>
              <span><b className="text-revoked">{counts.Revoked}</b> Revoked</span>
            </div>
          </div>

          <div className="sheet p-6">
            <h2 className="eyebrow mb-4">Recently earned</h2>
            <div className="space-y-1">
              {sortedCerts.slice(0, 3).map(c => (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => onCertificateClick(c)}
                  className="group w-full flex items-center gap-4 p-2.5 -mx-2.5 rounded-xl hover:bg-paper-2 transition-colors text-left focus-visible:outline-2 focus-visible:outline-forest"
                >
                  <Seal status={c.status} size={44} />
                  <div className="flex-1 min-w-0">
                    <div className="font-serif font-medium leading-tight truncate">{c.seminar}</div>
                    <div className="text-xs text-ink-muted mt-1">{fmt(c.iso)}</div>
                  </div>
                  <i className="ph-bold ph-arrow-up-right text-ink-muted group-hover:text-ink" aria-hidden="true"></i>
                </button>
              ))}
            </div>
            <button type="button" onClick={onNavigateCollection}
              className="mt-4 inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-forest-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest">
              View full collection <i className="ph-bold ph-arrow-right" aria-hidden="true"></i>
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

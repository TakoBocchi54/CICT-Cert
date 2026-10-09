import { useState } from 'react';
import { Certificate, Seal, Pill, Btn } from '../components/design-system';

const fmt = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

const STATUS_CONFIG = {
  Verified: { color: '#157347' },
  Revoked: { color: '#b3261e' },
  Pending: { color: '#a96a0c' },
};

export default function StudentDashboardPage({ certificates = [], onCertificateClick, onShareClick, onVerifyClick, onNavigateCollection, walletAddress }) {
  const [copiedWallet, setCopiedWallet] = useState(false);
  
  const sortedCerts = [...certificates].sort((a, b) => b.iso.localeCompare(a.iso));
  const featured = sortedCerts.find(c => c.status === 'Verified') || sortedCerts[0];
  
  const counts = { Verified: 0, Pending: 0, Revoked: 0 };
  sortedCerts.forEach(c => counts[c.status]++);
  
  const totalIssued = sortedCerts.length;

  const copyWalletAddress = () => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      setCopiedWallet(true);
      setTimeout(() => setCopiedWallet(false), 2000);
    }
  };

  const shortenAddress = (addr) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  // Empty state
  if (!certificates.length) {
    return (
      <div>
        {/* Wallet Address Card - if available */}
        {walletAddress && (
          <div className="sheet p-5 mb-6 rise">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-forest/10 flex items-center justify-center">
                  <i className="ph-duotone ph-wallet text-forest text-xl"></i>
                </div>
                <div>
                  <div className="eyebrow">Your Wallet Address</div>
                  <div className="font-mono text-sm mt-1">{shortenAddress(walletAddress)}</div>
                </div>
              </div>
              <button
                onClick={copyWalletAddress}
                className="btn btn-line btn-sm"
                title="Copy full address"
              >
                <i className={copiedWallet ? "ph-bold ph-check" : "ph-bold ph-copy"}></i>
                {copiedWallet ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        <div className="max-w-2xl mx-auto text-center py-20">
          <div className="flex justify-center mb-6">
            <Seal status="Verified" size={92} />
          </div>
          <div className="eyebrow mb-3">Student Portfolio</div>
          <h1 className="font-serif text-5xl font-medium leading-[1.02]">No credentials yet</h1>
          <p className="text-ink-soft text-lg mt-5 max-w-md mx-auto">
            Your verified seminar certificates will appear here once CICT issues them.
          </p>
        </div>
      </div>
    );
  }

  if (!featured) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        <div className="eyebrow mb-3">Loading</div>
        <h1 className="font-serif text-5xl font-medium">Loading your portfolio...</h1>
      </div>
    );
  }

  return (
    <div>
      {/* Wallet Address Card - if available */}
      {walletAddress && (
        <div className="sheet p-5 mb-6 rise">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-forest/10 flex items-center justify-center">
                <i className="ph-duotone ph-wallet text-forest text-xl"></i>
              </div>
              <div>
                <div className="eyebrow">Your Wallet Address</div>
                <div className="font-mono text-sm mt-1">{shortenAddress(walletAddress)}</div>
              </div>
            </div>
            <button
              onClick={copyWalletAddress}
              className="btn btn-line btn-sm"
              title="Copy full address"
            >
              <i className={copiedWallet ? "ph-bold ph-check" : "ph-bold ph-copy"}></i>
              {copiedWallet ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-12 gap-6 items-start">
        {/* Featured certificate: dominant */}
        <section className="lg:col-span-8">
          <div className="eyebrow mb-3 rise">
            Latest verified credential
          </div>
          <div className="rise" style={{ '--d': '.05s' }}>
            <div className="cursor-pointer" onClick={() => onCertificateClick(featured)}>
              <Certificate cert={featured} />
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3 rise" style={{ '--d': '.12s' }}>
            <Btn icon="ph-share-network" onClick={() => onShareClick(featured)}>
              Share credential
            </Btn>
            <Btn variant="line" icon="ph-seal-check" onClick={() => onVerifyClick(featured.id)}>
              Verify credential
            </Btn>
            <Btn variant="ghost" icon="ph-download-simple">
              Download PDF
            </Btn>
            <div className="ml-auto">
              <Pill status={featured.status} />
            </div>
          </div>
        </section>

        {/* Right column: numerals + recent */}
        <aside className="lg:col-span-4 space-y-6">
          <div className="sheet p-7 rise tick-corners" style={{ '--d': '.1s' }}>
            <div className="eyebrow">Credentials earned</div>
            <div className="flex items-end gap-3 mt-2">
              <div className="font-serif font-medium leading-none" style={{ fontSize: 120, letterSpacing: '-.04em' }}>
                {counts.Verified}
              </div>
              <div className="pb-4 text-ink-soft leading-snug">
                verified<br />of {totalIssued} issued
              </div>
            </div>
            <div className="flex h-2 rounded-full overflow-hidden mt-5 bg-paper-2">
              <div className="fillbar" style={{ width: (counts.Verified / totalIssued * 100) + '%', background: 'var(--verified)' }}></div>
              <div className="fillbar" style={{ width: (counts.Pending / totalIssued * 100) + '%', background: 'var(--pending)' }}></div>
              <div className="fillbar" style={{ width: (counts.Revoked / totalIssued * 100) + '%', background: 'var(--revoked)' }}></div>
            </div>
            <div className="flex gap-4 mt-3 text-xs text-ink-muted font-medium">
              <span><b className="text-verified">{counts.Verified}</b> Verified</span>
              <span><b className="text-pending">{counts.Pending}</b> Pending</span>
              <span><b className="text-revoked">{counts.Revoked}</b> Revoked</span>
            </div>
          </div>

          <div className="sheet p-6 rise" style={{ '--d': '.16s' }}>
            <div className="eyebrow mb-4">Recently earned</div>
            <div className="space-y-1">
              {sortedCerts.slice(0, 3).map(c => (
                <button
                  key={c.id}
                  onClick={() => onCertificateClick(c)}
                  className="group w-full flex items-center gap-4 p-2.5 -mx-2.5 rounded-xl hover:bg-paper-2 transition-colors text-left"
                >
                  <Seal status={c.status} size={44} />
                  <div className="flex-1 min-w-0">
                    <div className="font-serif font-medium leading-tight truncate">{c.seminar}</div>
                    <div className="text-xs text-ink-muted mt-1">{fmt(c.iso)}</div>
                  </div>
                  <i className="ph-bold ph-arrow-up-right text-ink-muted group-hover:text-ink transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"></i>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Credential history: subtle */}
        <section className="lg:col-span-12 mt-4 rise" style={{ '--d': '.2s' }}>
          <div className="flex items-end justify-between mb-5">
            <h3 className="font-serif text-3xl font-medium">Credential history</h3>
            <button onClick={onNavigateCollection} className="text-sm font-semibold text-forest-600 hover:underline">
              View full collection →
            </button>
          </div>
          <div className="relative">
            <div className="absolute left-0 right-0 top-[11px] h-px bg-[var(--line)]"></div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6 relative">
              {[...sortedCerts].reverse().map(c => (
                <button
                  key={c.id}
                  onClick={() => onCertificateClick(c)}
                  className="text-left group"
                >
                  <div
                    className="w-[23px] h-[23px] rounded-full border-2 bg-paper flex items-center justify-center mb-4"
                    style={{ borderColor: STATUS_CONFIG[c.status].color }}
                  >
                    <div className="w-2 h-2 rounded-full" style={{ background: STATUS_CONFIG[c.status].color }}></div>
                  </div>
                  <div className="eyebrow">{fmt(c.iso).slice(0, 6)}</div>
                  <div className="font-serif leading-snug mt-1 group-hover:underline decoration-[var(--line)] underline-offset-4">
                    {c.seminar}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

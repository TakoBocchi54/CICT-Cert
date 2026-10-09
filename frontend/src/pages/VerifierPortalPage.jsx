import { useState, useEffect, useMemo } from 'react';
import { Lockup, Seal, Certificate, QR, Rosette, Btn } from '../components/design-system';

const fmt = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

const Row = ({ label, children, mono }) => (
  <div className="flex items-baseline justify-between gap-6 py-3 hair first:border-t-0">
    <div className="eyebrow shrink-0">{label}</div>
    <div className={'text-right text-sm font-medium ' + (mono ? 'font-mono text-[13px]' : '')}>
      {children}
    </div>
  </div>
);

export default function VerifierPortalPage({ 
  certificates = [], 
  initialId = '', 
  onBackToPortal, 
  loggedIn = false 
}) {
  const [input, setInput] = useState(initialId || '');
  const [phase, setPhase] = useState(initialId ? 'checking' : 'idle');
  const [id, setId] = useState(initialId || '');
  const [tick, setTick] = useState(0);
  const [scan, setScan] = useState(false);

  const cert = useMemo(
    () => certificates.find(c => c.id.toLowerCase() === id.trim().toLowerCase()),
    [id, certificates]
  );
  const status = cert ? cert.status : 'Invalid';

  useEffect(() => {
    if (phase !== 'checking') return;
    setTick(0);
    const timer = setInterval(() => {
      setTick(x => {
        if (x >= 3) {
          clearInterval(timer);
          setPhase('result');
          return x;
        }
        return x + 1;
      });
    }, 650);
    return () => clearInterval(timer);
  }, [phase, id]);

  const run = v => {
    setId(v);
    setInput(v);
    setPhase('checking');
    setScan(false);
  };

  const steps = [
    'Locating certificate in the CICT registry',
    'Reading token from Polygon',
    'Checking revocation list'
  ];

  const banner = {
    Verified: [
      '#0e5a37',
      'This certificate is valid',
      'Issued by CICT and confirmed on the blockchain.'
    ],
    Revoked: [
      '#97201a',
      'This certificate has been revoked',
      'The issuer has invalidated it. Do not rely on it.'
    ],
    Pending: [
      '#8a5508',
      'Confirmation in progress',
      'Issued, but the network has not finished confirming it.'
    ],
    Invalid: [
      '#374151',
      'No matching certificate found',
      'This ID does not exist in the CICT registry.'
    ]
  }[status];

  return (
    <div className="min-h-screen" style={{ background: '#f3efe6' }}>
      {/* Top Bar */}
      <div className="bg-forest text-white/80 text-xs font-medium tracking-wide">
        <div className="max-w-[1100px] mx-auto px-6 py-2 flex justify-between">
          <span>Official certificate inspection · College of Information and Communications Technology</span>
          <span className="hidden sm:inline">No login required</span>
        </div>
      </div>

      {/* Header */}
      <header className="bg-paper border-b border-[var(--line)]">
        <div className="max-w-[1100px] mx-auto px-6 h-20 flex items-center justify-between">
          <Lockup />
          <button
            onClick={onBackToPortal}
            className="text-sm font-semibold text-ink-soft hover:text-ink flex items-center gap-2"
          >
            {loggedIn ? 'Back to portal' : 'Institution sign-in'}
            <i className="ph-bold ph-arrow-right"></i>
          </button>
        </div>
      </header>

      <main className="max-w-[1100px] mx-auto px-6 py-14">
        {/* Idle State */}
        {phase === 'idle' && (
          <div className="max-w-2xl mx-auto text-center fade-view">
            <div className="flex justify-center mb-6">
              <Seal status="Verified" size={92} animate />
            </div>
            <div className="eyebrow mb-3">University of Batangas · CICT</div>
            <h1 className="font-serif text-6xl font-medium leading-[1.02]">Verify a certificate</h1>
            <p className="text-ink-soft text-lg mt-5">
              Enter a certificate ID or scan the QR code on a certificate. The result comes straight from the
              blockchain record.
            </p>
            <div className="sheet p-8 mt-10 text-left tick-corners">
              <div className="grid grid-cols-2 p-1 rounded-xl bg-paper-2 border border-[var(--line)] mb-6">
                <button
                  onClick={() => setScan(false)}
                  className={
                    'py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 ' +
                    (!scan ? 'bg-white shadow' : 'text-ink-muted')
                  }
                >
                  <i className="ph-bold ph-hash"></i>
                  Certificate ID
                </button>
                <button
                  onClick={() => setScan(true)}
                  className={
                    'py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 ' +
                    (scan ? 'bg-white shadow' : 'text-ink-muted')
                  }
                >
                  <i className="ph-bold ph-qr-code"></i>
                  Scan QR
                </button>
              </div>
              {!scan ? (
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    if (input.trim()) run(input);
                  }}
                >
                  <label className="eyebrow block mb-2">Certificate ID</label>
                  <input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    className="field font-mono !py-4 !text-base"
                    placeholder="SBT-0000-X0"
                  />
                  <Btn type="submit" className="w-full mt-4 !py-3.5" iconRight="ph-arrow-right">
                    Verify certificate
                  </Btn>
                  <div className="mt-6 text-xs text-ink-muted">
                    <div className="eyebrow mb-2">Try an example</div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        ['SBT-0000-00', 'Try example']
                      ].map(([v, l]) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => run(v)}
                          className="px-3 py-1.5 rounded-full border border-[var(--line)] bg-paper hover:border-forest text-ink-soft font-medium transition-colors"
                        >
                          {l} <span className="font-mono text-ink-muted">{v}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </form>
              ) : (
                <div className="text-center">
                  <div className="relative mx-auto w-56 h-56 rounded-2xl bg-ink overflow-hidden">
                    <div className="absolute inset-6 border-2 border-white/40 rounded-lg"></div>
                    <div className="scanline absolute left-6 right-6 h-0.5 bg-[#7fd6a6] shadow-[0_0_12px_#7fd6a6]"></div>
                    <i className="ph-duotone ph-camera text-5xl text-white/30 absolute inset-0 flex items-center justify-center"></i>
                  </div>
                  <p className="text-sm text-ink-muted mt-4">
                    Point your camera at the QR code on the certificate.
                  </p>
                  <Btn variant="line" size="sm" className="mt-4" onClick={() => run('SBT-0000-00')}>
                    Simulate a scan
                  </Btn>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Checking State */}
        {phase === 'checking' && (
          <div className="max-w-md mx-auto text-center py-20 fade-view">
            <div className="flex justify-center">
              <div className="w-24 h-24 rounded-full border-4 border-[var(--line)] border-t-forest animate-spin"></div>
            </div>
            <h2 className="font-serif text-3xl font-medium mt-8">Inspecting certificate</h2>
            <div className="font-mono text-xs text-ink-muted mt-2">{id}</div>
            <div className="mt-8 space-y-3 text-left inline-block">
              {steps.map((s, i) => (
                <div
                  key={s}
                  className={
                    'flex items-center gap-3 text-sm font-medium transition-opacity ' +
                    (i > tick ? 'opacity-25' : '')
                  }
                >
                  {i < tick ? (
                    <i className="ph-fill ph-check-circle text-verified text-xl"></i>
                  ) : (
                    <i className="ph ph-circle text-xl"></i>
                  )}
                  {s}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Result State */}
        {phase === 'result' && (
          <div className="fade-view">
            <div
              className="rounded-3xl text-white p-8 md:p-10 flex flex-wrap items-center gap-8 relative overflow-hidden"
              style={{ background: banner[0] }}
            >
              <Rosette
                color="#fff"
                className="absolute"
                style={{ width: 420, right: -120, top: -170, opacity: 0.13 }}
              />
              <div className="relative bg-white/0">
                <Seal status={status} size={118} animate />
              </div>
              <div className="relative flex-1 min-w-[260px]">
                <div className="eyebrow !text-white/70">Verification result</div>
                <h1 className="font-serif text-4xl md:text-5xl font-medium leading-tight mt-2 rise">
                  {banner[1]}
                </h1>
                <p className="text-white/80 mt-3 text-lg rise" style={{ '--d': '.1s' }}>
                  {banner[2]}
                </p>
              </div>
            </div>

            {cert ? (
              <div className="grid lg:grid-cols-12 gap-8 mt-8 items-start">
                <div className="lg:col-span-7 space-y-6">
                  <div className="rise">
                    <Certificate cert={cert} />
                  </div>
                  <div className="sheet p-6 flex items-center gap-6 rise" style={{ '--d': '.08s' }}>
                    <div className="p-2 border border-[var(--line)] bg-white rounded-lg shrink-0">
                      <QR value={cert.id} size={92} />
                    </div>
                    <div>
                      <div className="eyebrow">QR verification</div>
                      <p className="text-sm text-ink-soft mt-1">
                        This code resolves to the record you're viewing. Anyone can scan it to confirm the
                        same result.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="lg:col-span-5 space-y-6">
                  <section className="sheet p-7 rise" style={{ '--d': '.06s' }}>
                    <div className="eyebrow mb-1">Inspection record</div>
                    <div className="py-4 hair">
                      <div className="eyebrow mb-1">Certificate holder</div>
                      <div className="font-serif text-3xl font-medium leading-tight">{cert.recipient}</div>
                    </div>
                    <div className="py-4 hair">
                      <div className="eyebrow mb-1">Seminar</div>
                      <div className="font-serif text-xl font-medium leading-snug">{cert.seminar}</div>
                    </div>
                    <Row label="Issuing institution">CICT, University of Batangas</Row>
                    <Row label="Status">
                      <span className={'pill pill-' + cert.status}>
                        <i className={'ph-fill ph-seal-check'}></i>
                        {cert.status}
                      </span>
                    </Row>
                    <Row label="Certificate ID" mono>
                      {cert.id}
                    </Row>
                    <Row label="Issue date">{fmt(cert.iso)}</Row>
                  </section>
                  <section className="sheet p-7 rise" style={{ '--d': '.12s' }}>
                    <div className="eyebrow mb-1">Blockchain verification</div>
                    <Row label="Network">Polygon PoS</Row>
                    <Row label="Token standard">ERC-5192 (non-transferable)</Row>
                    <Row label="Block" mono>
                      #{cert.block.toLocaleString()}
                    </Row>
                    <Row label="Confirmations">{cert.confirmations}</Row>
                    <div className="hair pt-3">
                      <div className="eyebrow mb-2">Transaction hash</div>
                      <div className="font-mono text-[11px] break-all bg-paper-2 p-3 rounded-lg border border-[var(--line)]">
                        {cert.hash || '0x...'}
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-6 mt-8">
                <div className="sheet p-8">
                  <div className="eyebrow mb-2">You searched for</div>
                  <div className="font-mono text-2xl break-all">{id}</div>
                  <p className="text-ink-soft mt-4 text-sm">
                    A missing record can mean a mistyped ID, a forged document, or a certificate issued by
                    another institution.
                  </p>
                </div>
                <div className="sheet p-8">
                  <div className="eyebrow mb-3">What to do next</div>
                  {[
                    'Check the ID against the printed certificate',
                    'Scan the QR code instead of typing',
                    'Contact the CICT office to confirm'
                  ].map(t => (
                    <div key={t} className="flex gap-3 py-2 text-sm">
                      <i className="ph-bold ph-arrow-right mt-0.5 text-ink-muted"></i>
                      {t}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="text-center mt-12">
              <Btn
                variant="line"
                icon="ph-arrow-counter-clockwise"
                onClick={() => {
                  setPhase('idle');
                  setInput('');
                }}
              >
                Verify another certificate
              </Btn>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

import { useState, useRef, useEffect } from 'react';
import { Certificate, Seal, Pill, Btn } from '../components/design-system';

const STAGES = [
  ['Attendance', 'Upload the record'],
  ['Template', 'Choose the design'],
  ['Review', 'Confirm recipients'],
  ['Issue', 'Mint on Polygon']
];

// Sample data
const SAMPLE_CERT = {
  id: 'SBT-PREVIEW-01',
  recipient: 'Student Name',
  seminar: 'Sample Seminar',
  iso: '2026-01-01',
  status: 'Verified',
  block: 58000000,
};

const RECIPIENTS = Array.from({ length: 142 }, (_, i) => ({
  id: `2023-${String(100 + i * 3).padStart(5, '0')}`,
  name: `Student ${i + 1}`,
  email: `student${i + 1}@ub.edu.ph`,
  attendance: i % 9 === 0 ? '92%' : '100%'
}));

const INELIGIBLE = [
  { id: '2023-00211', name: 'Cruz, Jonathan', att: '45%', why: 'Below 80% minimum' },
  { id: '2023-00412', name: 'Flores, Mark', att: '20%', why: 'Below 80% minimum' },
  { id: '2023-00533', name: 'Garcia, Lea', att: '62%', why: 'Below 80% minimum' },
  { id: '2023-00541', name: 'Hernandez, Paolo', att: '78%', why: 'Below 80% minimum' },
  { id: '2023-00618', name: 'Ibarra, Nico', att: '100%', why: 'No sign-out record' },
  { id: '2023-00702', name: 'Javier, Ella', att: '—', why: 'Email not institutional' },
  { id: '2023-00755', name: 'Lopez, Ramon', att: '55%', why: 'Below 80% minimum' },
  { id: '2023-00809', name: 'Mendoza, Ina', att: '100%', why: 'Duplicate entry' },
];

export default function IssuancePage({ onComplete, onNavigateRegistry }) {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [drag, setDrag] = useState(false);
  const [theme, setTheme] = useState('classic');
  const [query, setQuery] = useState('');
  const [minted, setMinted] = useState(0);
  const inputRef = useRef();

  // Minting animation
  useEffect(() => {
    if (step !== 4 || minted >= 142) return;
    const timer = setInterval(() => {
      setMinted(m => Math.min(142, m + 3 + Math.floor(Math.random() * 6)));
    }, 140);
    return () => clearInterval(timer);
  }, [step, minted]);

  const phase = minted >= 142 ? 3 : minted > 110 ? 2 : minted > 15 ? 1 : 0;
  const phases = [
    'Preparing certificate metadata',
    'Minting soulbound tokens on Polygon',
    'Waiting for block confirmations',
    'All credentials confirmed'
  ];

  const filtered = RECIPIENTS.filter(r =>
    (r.name + r.id + r.email).toLowerCase().includes(query.toLowerCase())
  );

  const loadFile = (name) => {
    setFile(name || 'seminar_attendance.csv');
  };

  return (
    <div>
      {/* Page Header */}
      <div className="mb-10">
        <div className="eyebrow mb-3 rise">
          Issue certificates
        </div>
        <h1 className="font-serif text-5xl md:text-6xl font-medium leading-[1.02] rise" style={{ '--d': '.05s' }}>
          Stage {step}: {STAGES[step - 1][0]}
        </h1>
      </div>

      <div className="grid lg:grid-cols-[250px_1fr] gap-8">
        {/* Stage rail */}
        <ol className="hidden lg:block space-y-1 sticky top-28 self-start">
          {STAGES.map(([name, subtitle], i) => {
            const done = step > i + 1;
            const current = step === i + 1;
            return (
              <li
                key={name}
                className={
                  'flex items-center gap-4 p-3 rounded-2xl transition-all ' +
                  (current ? 'bg-white border border-[var(--line)] shadow-sm' : '')
                }
              >
                <div
                  className={
                    'w-10 h-10 rounded-full flex items-center justify-center font-serif text-lg shrink-0 transition-all ' +
                    (done
                      ? 'bg-verified text-white'
                      : current
                      ? 'bg-forest text-white'
                      : 'border border-[var(--line)] text-ink-muted')
                  }
                >
                  {done ? <i className="ph-bold ph-check text-base"></i> : i + 1}
                </div>
                <div>
                  <div className={'font-semibold text-sm ' + (current || done ? '' : 'text-ink-muted')}>
                    {name}
                  </div>
                  <div className="text-xs text-ink-muted">{subtitle}</div>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="sheet p-8 md:p-10 min-h-[560px] flex flex-col" key={step}>
          {/* Stage 1: Attendance Upload */}
          {step === 1 && (
            <div className="flex-1 flex flex-col fade-view">
              <p className="text-ink-soft mb-6 max-w-lg">
                Upload the attendance export from the seminar. We'll read student IDs, emails and sign-in/out times.
              </p>
              <div
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); loadFile(e.dataTransfer.files[0]?.name); }}
                onClick={() => !file && inputRef.current?.click()}
                className={
                  'flex-1 min-h-[300px] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center text-center p-10 transition-all ' +
                  (drag
                    ? 'border-forest bg-[#e7f4ec] scale-[1.01]'
                    : file
                    ? 'border-verified/40 bg-[#f4faf6]'
                    : 'border-[#cfc7b0] bg-paper hover:border-forest cursor-pointer')
                }
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={e => loadFile(e.target.files[0]?.name)}
                />
                {!file ? (
                  <>
                    <div className="w-20 h-20 rounded-2xl bg-white border border-[var(--line)] flex items-center justify-center mb-5">
                      <i className="ph-duotone ph-file-csv text-4xl text-forest"></i>
                    </div>
                    <div className="font-serif text-3xl font-medium">
                      {drag ? 'Release to upload' : 'Drag the attendance CSV here'}
                    </div>
                    <p className="text-ink-muted mt-2 mb-6">or click to browse your files</p>
                    <Btn variant="line" size="sm" onClick={e => { e.stopPropagation(); loadFile(); }}>
                      Use sample file
                    </Btn>
                  </>
                ) : (
                  <>
                    <Seal status="Verified" size={72} animate />
                    <div className="font-serif text-3xl font-medium mt-5">File read successfully</div>
                    <div className="font-mono text-sm text-ink-muted mt-2">{file}</div>
                    <div className="flex gap-6 mt-6 text-sm">
                      {['150 rows', '6 columns', 'IDs matched'].map(t => (
                        <span key={t} className="flex items-center gap-1.5 font-medium">
                          <i className="ph-fill ph-check-circle text-verified"></i>
                          {t}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); setFile(null); }}
                      className="text-xs text-ink-muted hover:text-ink mt-6 underline"
                    >
                      Replace file
                    </button>
                  </>
                )}
              </div>
              <div className="flex justify-end mt-8">
                <Btn
                  disabled={!file}
                  className={!file ? 'opacity-40 pointer-events-none' : ''}
                  iconRight="ph-arrow-right"
                  onClick={() => setStep(2)}
                >
                  Continue to template
                </Btn>
              </div>
            </div>
          )}

          {/* Stage 2: Template */}
          {step === 2 && (
            <div className="flex-1 flex flex-col fade-view">
              <p className="text-ink-soft mb-8 max-w-lg">
                These are the actual certificates your recipients will receive. Pick a design.
              </p>
              <div className="grid md:grid-cols-3 gap-6">
                {[['classic', 'Classic'], ['modern', 'Modern'], ['formal', 'Formal']].map(([t, name]) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    className={
                      'text-left p-2.5 rounded-2xl border-2 transition-all ' +
                      (theme === t
                        ? 'border-forest bg-white shadow-lg -translate-y-1'
                        : 'border-transparent hover:border-[var(--line)]')
                    }
                  >
                    <Certificate cert={SAMPLE_CERT} theme={t} tilt={false} />
                    <div className="flex items-center justify-between px-1.5 pt-3 pb-1">
                      <span className="font-serif text-lg font-medium">{name}</span>
                      {theme === t && <i className="ph-fill ph-check-circle text-forest text-xl"></i>}
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex justify-between mt-auto pt-8">
                <Btn variant="ghost" onClick={() => setStep(1)}>
                  Back
                </Btn>
                <Btn iconRight="ph-arrow-right" onClick={() => setStep(3)}>
                  Use {theme} template
                </Btn>
              </div>
            </div>
          )}

          {/* Stage 3: Review */}
          {step === 3 && (
            <div className="flex-1 flex flex-col fade-view">
              <div className="grid md:grid-cols-[1fr_240px] gap-6 flex-1">
                <div className="flex flex-col min-h-[340px]">
                  <div className="flex items-center justify-between mb-3">
                    <div className="eyebrow">Recipients ({filtered.length})</div>
                    <input
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      placeholder="Search name or ID"
                      className="field !py-2 !px-3 !text-sm !w-56"
                    />
                  </div>
                  <div className="border border-[var(--line)] rounded-xl overflow-y-auto bg-white" style={{ maxHeight: 360 }}>
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-paper-2 text-left">
                        <tr className="eyebrow">
                          <th className="py-2.5 px-4">Student</th>
                          <th className="px-4 hidden sm:table-cell">Email</th>
                          <th className="px-4 text-right">Receives</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(r => (
                          <tr key={r.id} className="border-t border-[var(--line)] hover:bg-paper">
                            <td className="py-2.5 px-4">
                              <div className="font-medium">{r.name}</div>
                              <div className="font-mono text-[11px] text-ink-muted">{r.id}</div>
                            </td>
                            <td className="px-4 text-ink-muted text-xs hidden sm:table-cell">{r.email}</td>
                            <td className="px-4 text-right">
                              <Pill status="Verified" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="rounded-2xl bg-paper-2 p-5 border border-[var(--line)]">
                    <div className="eyebrow">Seminar</div>
                    <div className="font-serif text-lg font-medium leading-tight mt-1">
                      Sample Seminar
                    </div>
                    <div className="eyebrow mt-4">Template</div>
                    <div className="font-serif text-lg capitalize">{theme}</div>
                    <div className="eyebrow mt-4">Network</div>
                    <div className="font-serif text-lg">Polygon PoS</div>
                  </div>
                  <div
                    className="rounded-2xl p-5 text-sm"
                    style={{ background: '#fbf1dc', border: '1px solid #ecd5a2', color: '#8a5508' }}
                  >
                    <i className="ph-fill ph-warning text-lg"></i>
                    <p className="mt-1 font-medium">
                      Issuance is permanent. Credentials can be revoked later but not deleted.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex justify-between mt-8">
                <Btn variant="ghost" onClick={() => setStep(2)}>
                  Back
                </Btn>
                <Btn icon="ph-stamp" onClick={() => { setMinted(0); setStep(4); }}>
                  Issue 142 certificates
                </Btn>
              </div>
            </div>
          )}

          {/* Stage 4: Issue */}
          {step === 4 && (
            <div className="flex-1 flex flex-col items-center justify-center text-center fade-view py-6">
              {minted < 142 ? (
                <>
                  <div className="relative w-40 h-40 flex items-center justify-center">
                    <svg className="absolute inset-0 -rotate-90" viewBox="0 0 120 120">
                      <circle cx="60" cy="60" r="54" fill="none" stroke="#e9e3d3" strokeWidth="5" />
                      <circle
                        cx="60"
                        cy="60"
                        r="54"
                        fill="none"
                        stroke="#0e3b2c"
                        strokeWidth="5"
                        strokeLinecap="round"
                        strokeDasharray={339}
                        strokeDashoffset={339 - (339 * minted) / 142}
                        style={{ transition: 'stroke-dashoffset .2s' }}
                      />
                    </svg>
                    <div className="font-serif text-5xl font-medium">{minted}</div>
                  </div>
                  <div className="font-serif text-3xl font-medium mt-8">Writing to the blockchain</div>
                  <p className="text-ink-muted mt-2">
                    {minted} of 142 credentials minted. Please keep this page open.
                  </p>
                  <div className="mt-8 space-y-3 text-left">
                    {phases.slice(0, 3).map((p, i) => (
                      <div
                        key={p}
                        className={
                          'flex items-center gap-3 text-sm font-medium transition-opacity ' +
                          (i > phase ? 'opacity-30' : '')
                        }
                      >
                        {i < phase ? (
                          <i className="ph-fill ph-check-circle text-verified text-xl"></i>
                        ) : i === phase ? (
                          <i className="ph-bold ph-circle-notch animate-spin text-forest text-xl"></i>
                        ) : (
                          <i className="ph ph-circle text-xl"></i>
                        )}
                        {p}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <Seal status="Verified" size={150} animate />
                  <div className="font-serif text-5xl font-medium mt-8">142 certificates issued</div>
                  <p className="text-ink-soft mt-3 max-w-md">
                    Every credential is confirmed on Polygon. Recipients have been emailed their verification links.
                  </p>
                  <div className="flex gap-6 mt-8 font-mono text-xs text-ink-muted">
                    <span>Block #58,214,902</span>
                    <span>Gas 0.0214 MATIC</span>
                  </div>
                  <div className="flex gap-3 mt-10">
                    <Btn iconRight="ph-arrow-right" onClick={onComplete}>
                      Back to workspace
                    </Btn>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

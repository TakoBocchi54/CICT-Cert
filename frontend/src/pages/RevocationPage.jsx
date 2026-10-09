import { useState } from 'react';
import { Seal, Pill, Btn } from '../components/design-system';

const fmt = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

export default function RevocationPage({ certificates = [], onRevoke }) {
  const [query, setQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState('Attendance record corrected');

  const found = query.trim()
    ? certificates.find(c => c.id.toLowerCase() === query.trim().toLowerCase())
    : null;

  const revoked = certificates.filter(c => c.status === 'Revoked');

  const handleRevoke = () => {
    if (target) {
      onRevoke(target.id, reason);
      setShowModal(false);
      setTarget(null);
      setQuery('');
    }
  };

  return (
    <div>
      {/* Page Header */}
      <div className="mb-10">
        <div className="eyebrow mb-3 rise">Governance</div>
        <h1 className="font-serif text-5xl md:text-6xl font-medium leading-[1.02] rise" style={{ '--d': '.05s' }}>
          Revocations
        </h1>
        <p className="text-ink-soft text-lg mt-4 max-w-xl rise" style={{ '--d': '.1s' }}>
          Invalidate a credential. Public verification updates immediately.
        </p>
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Find certificate */}
        <section className="lg:col-span-7 sheet p-8">
          <div className="eyebrow mb-3">Find a certificate</div>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="field font-mono !py-4 !text-base"
            placeholder="e.g. SBT-9001-Z4"
          />
          <div className="mt-6 min-h-[170px]">
            {found ? (
              <div className="rounded-2xl border border-[var(--line)] bg-paper p-6 flex items-center gap-5 pop">
                <Seal status={found.status} size={72} />
                <div className="flex-1">
                  <div className="font-serif text-2xl font-medium leading-tight">{found.seminar}</div>
                  <div className="text-sm text-ink-soft mt-1">
                    {found.recipient} · {fmt(found.iso)}
                  </div>
                </div>
                {found.status !== 'Revoked' ? (
                  <Btn
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      setTarget(found);
                      setShowModal(true);
                    }}
                  >
                    Revoke
                  </Btn>
                ) : (
                  <Pill status="Revoked" />
                )}
              </div>
            ) : (
              <p className="text-ink-muted text-sm">
                {query ? 'No certificate with that ID.' : 'Enter a certificate ID to search.'}
              </p>
            )}
          </div>
        </section>

        {/* Revoked list */}
        <section className="lg:col-span-5 sheet p-8">
          <div className="eyebrow mb-4">Revoked in this session</div>
          {revoked.length === 0 ? (
            <p className="text-ink-muted text-sm">No revoked certificates</p>
          ) : (
            revoked.map(c => (
              <div key={c.id} className="flex items-center gap-3 py-3 hair">
                <Seal status="Revoked" size={34} />
                <div className="flex-1">
                  <div className="text-sm font-medium">{c.recipient}</div>
                  <div className="text-xs text-ink-muted truncate">{c.seminar}</div>
                </div>
                <span className="font-mono text-[11px] text-ink-muted">{c.id}</span>
              </div>
            ))
          )}
        </section>
      </div>

      {/* Revoke Modal */}
      {showModal && target && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(22,35,29,.45)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowModal(false)}
        >
          <div className="sheet pop w-full max-w-lg p-8 relative" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setShowModal(false)}
              className="absolute top-4 right-4 w-9 h-9 rounded-full hover:bg-paper-2 flex items-center justify-center text-ink-muted"
            >
              <i className="ph-bold ph-x"></i>
            </button>
            <div className="flex justify-center mb-5">
              <Seal status="Revoked" size={80} />
            </div>
            <h3 className="font-serif text-3xl font-medium text-center">Revoke this credential?</h3>
            <p className="text-center text-ink-soft text-sm mt-2 mb-6">
              {target.recipient} · {target.seminar}
              <br />
              <span className="font-mono text-xs">{target.id}</span>
            </p>
            <label className="eyebrow block mb-2">Reason (recorded on-chain)</label>
            <select value={reason} onChange={e => setReason(e.target.value)} className="field mb-6">
              {[
                'Attendance record corrected',
                'Issued in error',
                'Academic misconduct',
                'Recipient request'
              ].map(r => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <div className="flex gap-3">
              <Btn variant="line" className="flex-1" onClick={() => setShowModal(false)}>
                Cancel
              </Btn>
              <Btn variant="danger" className="flex-1" onClick={handleRevoke}>
                Revoke credential
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

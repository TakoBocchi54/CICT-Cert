import { Certificate, Seal, Pill, Btn, Rosette } from '../components/design-system';

const fmt = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

export default function FacultyDashboardPage({ 
  certificates = [],
  onIssueClick,
  onNavigateRevocation
}) {
  const recent = [...certificates]
    .sort((a, b) => b.iso.localeCompare(a.iso))
    .filter(c => c.status !== 'Revoked')
    .slice(0, 4);
  
  const revoked = certificates.filter(c => c.status === 'Revoked').slice(0, 3);
  const totalIssued = certificates.length;

  return (
    <div>
      {/* Page Header */}
      <div className="flex flex-wrap items-end justify-between gap-6 mb-10">
        <div>
          <div className="eyebrow mb-3 rise">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
          <h1 className="font-serif text-5xl md:text-6xl font-medium leading-[1.02] rise" style={{ '--d': '.05s' }}>
            Issuance workspace
          </h1>
          <p className="text-ink-soft text-lg mt-4 max-w-xl rise" style={{ '--d': '.1s' }}>
            Your seminar management dashboard.
          </p>
        </div>
        <Btn 
          onClick={onIssueClick} 
          icon="ph-stamp" 
          iconRight="ph-arrow-right" 
          className="!py-3.5 !px-7 !text-base rise" 
          style={{ '--d': '.15s' }}
        >
          Issue certificates
        </Btn>
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Primary: ready to issue - Now shows empty state */}
        <section className="lg:col-span-8 sheet p-9 rise">
          <div className="text-center py-12">
            <div className="flex justify-center mb-6">
              <Seal status="Pending" size={92} />
            </div>
            <h2 className="font-serif text-3xl font-medium">No seminars ready</h2>
            <p className="text-ink-soft mt-3 max-w-md mx-auto">
              Upload attendance records to begin the issuance process.
            </p>
            <Btn className="mt-6" icon="ph-stamp" onClick={onIssueClick}>
              Start issuance
            </Btn>
          </div>
        </section>

        {/* Attendance processing - Empty state */}
        <section className="lg:col-span-4 sheet p-7 rise" style={{ '--d': '.08s' }}>
          <div className="eyebrow mb-5">Attendance processing</div>
          <div className="text-center py-8">
            <p className="text-sm text-ink-muted">No files processing</p>
          </div>
          <div className="hair pt-5 mt-6">
            <div className="eyebrow mb-3">Upcoming</div>
            <p className="text-sm text-ink-muted">No scheduled seminars</p>
          </div>
        </section>

        {/* Recently issued */}
        <section className="lg:col-span-7 sheet p-7 rise" style={{ '--d': '.12s' }}>
          <h3 className="font-serif text-2xl font-medium mb-3">Recently issued</h3>
          {recent.length === 0 ? (
            <div className="text-center py-12 text-ink-muted">
              <p>No certificates issued yet</p>
            </div>
          ) : (
            <>
              {recent.map(c => (
                <div key={c.id} className="flex items-center gap-4 py-3.5 hair">
                  <Seal status={c.status} size={40} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{c.recipient}</div>
                    <div className="text-xs text-ink-muted truncate">{c.seminar}</div>
                  </div>
                  <div className="font-mono text-xs text-ink-muted hidden sm:block">{c.id}</div>
                  <Pill status={c.status} />
                </div>
              ))}
              <div className="hair pt-5 mt-1 flex items-baseline gap-3">
                <span className="font-serif text-4xl">{totalIssued.toLocaleString()}</span>
                <span className="text-sm text-ink-muted">certificates issued to date</span>
              </div>
            </>
          )}
        </section>

        {/* Revoked: compact */}
        <section className="lg:col-span-5 sheet p-7 rise" style={{ '--d': '.16s', background: 'linear-gradient(180deg,#fff,#fdf4f2)' }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="eyebrow">Revoked</div>
              <div className="font-serif text-6xl leading-none mt-2 text-revoked">
                {revoked.length}
              </div>
            </div>
            <Seal status="Revoked" size={64} />
          </div>
          {revoked.length === 0 ? (
            <p className="text-sm text-ink-muted mt-6">No revoked certificates</p>
          ) : (
            <>
              <div className="mt-6 space-y-3">
                {revoked.map(c => (
                  <div key={c.id} className="flex justify-between text-sm">
                    <span className="font-medium">{c.recipient}</span>
                    <span className="font-mono text-xs text-ink-muted">{c.id}</span>
                  </div>
                ))}
              </div>
              <Btn variant="line" size="sm" className="mt-6" onClick={onNavigateRevocation}>
                Manage revocations
              </Btn>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

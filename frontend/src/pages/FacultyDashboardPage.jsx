import { useQuery } from '@tanstack/react-query';
import { Seal, Pill, Btn } from '../components/design-system';
import { api } from '../lib/api';

const fmt = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

export default function FacultyDashboardPage({ 
  onIssueClick,
  onNavigateRevocation
}) {
  const seminars = useQuery({
    queryKey: ['faculty-seminars'],
    queryFn: () => api('/api/faculty/seminars'),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const summary = useQuery({
    queryKey: ['certificate-summary'],
    queryFn: () => api('/api/faculty/certificates/summary'),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const recent = summary.data?.recentIssued || [];
  const revoked = summary.data?.recentRevoked || [];
  const totalIssued = summary.data?.issuedCount ?? 0;
  const totalRevoked = summary.data?.revokedCount ?? 0;

  return (
    <div>
      {/* Page Header */}
      <div className="flex flex-wrap items-end justify-between gap-6 mb-10">
        <div>
          <div className="eyebrow mb-3 rise">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
          <h1 className="font-serif text-5xl md:text-6xl font-medium leading-[1.02] rise" style={{ '--d': '.05s' }}>
            Seminar workspace
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
          Manage seminars
        </Btn>
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Seminar registrations */}
        <section className="lg:col-span-8 sheet p-9 rise">
          <h2 className="font-serif text-3xl font-medium">Seminar registrations</h2>
          {seminars.isPending ? <p role="status" className="mt-5 text-ink-soft">Loading seminars...</p> : seminars.error ? (
            <div role="alert" className="mt-5 space-y-3">
              <p className="text-sm text-revoked">{seminars.error.message}</p>
              <Btn variant="line" onClick={() => seminars.refetch()}>Try again</Btn>
            </div>
          ) : seminars.data.length ? (
            <div className="mt-5 space-y-4">
              {seminars.data.slice(0, 4).map(seminar => (
                <div key={seminar.seminarID} className="rounded-xl border border-[var(--line)] p-4">
                  <h3 className="break-words font-medium">{seminar.seminarTitle}</h3>
                  <p className="mt-1 text-sm text-ink-muted">{fmt(seminar.seminarDate)}</p>
                  <p className="mt-3 text-sm text-ink-soft">{seminar.registrationCount} registered · {seminar.attendanceCount} attended · {seminar.walletCount} wallets connected</p>
                </div>
              ))}
              <Btn variant="line" onClick={onIssueClick}>Manage registrations</Btn>
            </div>
          ) : <div className="text-center py-12">
            <div className="flex justify-center mb-6">
              <Seal status="Pending" size={92} />
            </div>
            <h3 className="font-serif text-3xl font-medium">No seminars yet</h3>
            <p className="text-ink-soft mt-3 max-w-md mx-auto">
              Create a seminar and import the registration CSV before the event.
            </p>
            <Btn className="mt-6" icon="ph-stamp" onClick={onIssueClick}>
              Create your first seminar
            </Btn>
          </div>}
        </section>

        {/* Registration guidance */}
        <section className="lg:col-span-4 sheet p-7 rise" style={{ '--d': '.08s' }}>
          <div className="eyebrow mb-5">Before the seminar</div>
          <ol className="list-decimal space-y-4 pl-5 text-sm leading-relaxed text-ink-soft">
            <li>Create the seminar with its title and date.</li>
            <li>Import student registrations using their Google account emails.</li>
            <li>Ask students to sign in and connect their wallets.</li>
          </ol>
          <p className="hair mt-6 pt-5 text-sm text-ink-muted">The final attendance list determines recipients after the seminar.</p>
        </section>

        {/* Recently issued */}
        <section className="lg:col-span-7 sheet p-7 rise" style={{ '--d': '.12s' }}>
          <h3 className="font-serif text-2xl font-medium mb-3">Recently issued</h3>
          {summary.error ? (
            <p role="alert" className="py-12 text-center text-sm text-revoked">{summary.error.message}</p>
          ) : recent.length === 0 ? (
            <div className="text-center py-12 text-ink-muted">
              <p>{summary.isPending ? 'Loading...' : 'No certificates issued yet'}</p>
            </div>
          ) : (
            <>
              {recent.map(c => (
                <div key={c.certificateNo} className="flex items-center gap-4 py-3.5 hair">
                  <Seal status="Verified" size={40} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{c.recipientName}</div>
                    <div className="text-xs text-ink-muted truncate">{c.seminarTitle}</div>
                  </div>
                  <div className="font-mono text-xs text-ink-muted hidden sm:block">No. {c.certificateNo}</div>
                  <Pill status="Verified" />
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
                {totalRevoked}
              </div>
            </div>
            <Seal status="Revoked" size={64} />
          </div>
          {totalRevoked === 0 ? (
            <p className="text-sm text-ink-muted mt-6">No revoked certificates</p>
          ) : (
            <>
              <div className="mt-6 space-y-3">
                {revoked.map(c => (
                  <div key={c.certificateNo} className="flex justify-between text-sm">
                    <span className="font-medium">{c.recipientName}</span>
                    <span className="font-mono text-xs text-ink-muted">No. {c.certificateNo}</span>
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

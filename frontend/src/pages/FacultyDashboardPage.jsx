import { useQuery } from '@tanstack/react-query';
import { Seal, Pill, Btn, Rosette } from '../components/design-system';
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
  // Newest seminar date first; ties go to the most recently created.
  const byLatest = [...(seminars.data || [])].sort((x, y) => y.seminarDate.localeCompare(x.seminarDate) || Number(y.seminarID) - Number(x.seminarID));
  const latest = byLatest[0];
  const plural = (n, one, many) => n === 1 ? one : many;
  // What the latest seminar needs next, in workflow order.
  const hero = !latest ? null
    : latest.readyCount ? { count: latest.readyCount, badge: 'Ready to issue', icon: 'ph-check-circle', action: 'Begin issuance',
      label: plural(latest.readyCount, 'Certificate approved by its student', 'Certificates approved by students') }
    : latest.awaitingCount ? { count: latest.awaitingCount, badge: 'Awaiting student approval', icon: 'ph-hourglass-medium', action: 'Open seminar',
      label: plural(latest.awaitingCount, 'Certificate waiting for its student', 'Certificates waiting for students') }
    : !latest.attendanceCount ? { count: null, badge: 'Attendance not imported', icon: 'ph-users', action: 'Import attendance',
      label: 'Upload the final attendee list' }
    : latest.issuedCount < latest.attendanceCount ? { count: latest.attendanceCount - latest.issuedCount, badge: 'Certificates to prepare', icon: 'ph-stamp', action: 'Open seminar',
      label: plural(latest.attendanceCount - latest.issuedCount, 'Attendee without a certificate yet', 'Attendees without a certificate yet') }
    : { count: latest.issuedCount, badge: 'All issued', icon: 'ph-seal-check', action: 'Open seminar',
      label: plural(latest.issuedCount, 'Certificate issued', 'Certificates issued') };

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
        </div>
        <Btn 
          onClick={() => onIssueClick()} 
          icon="ph-stamp" 
          iconRight="ph-arrow-right" 
          className="!py-3.5 !px-7 !text-base rise" 
          style={{ '--d': '.15s' }}
        >
          Manage seminars
        </Btn>
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {seminars.data?.length > 0 && <>
          {/* Hero: what needs attention next */}
          <section className="lg:col-span-7 sheet-dark p-7 rise">
            <Rosette color="#fff" className="absolute" style={{ width: 380, right: -120, top: -150, opacity: .1 }} />
            <div className="relative">
              <div className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded-full" style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)' }}>
                <i className={'ph-fill ' + hero.icon + ' text-[#7fd6a6]'}></i>{hero.badge}
              </div>
              <h2 className="font-serif text-3xl font-medium leading-tight mt-4 break-words">{latest.seminarTitle}</h2>
              <p className="text-white/60 mt-1 text-sm">Held {fmt(latest.seminarDate)} · {latest.attendanceCount} attendees recorded</p>
              <div className="flex flex-wrap items-end justify-between gap-6 mt-5">
                <div>
                  {hero.count !== null && <div className="font-serif font-medium leading-none" style={{ fontSize: 136, letterSpacing: '-.04em' }}>{hero.count}</div>}
                  <div className="eyebrow !text-[#7fd6a6] mt-2">{hero.label}</div>
                </div>
                <button type="button" onClick={() => onIssueClick(latest.seminarID)} className="bg-white text-forest font-semibold text-sm px-5 py-2.5 rounded-xl hover:-translate-y-0.5 transition-transform inline-flex items-center gap-2">
                  {hero.action} <i className="ph-bold ph-arrow-right"></i>
                </button>
              </div>
            </div>
          </section>

          {/* Issuance progress: issued out of attended, newest seminars first */}
          <section className="lg:col-span-5 sheet p-7 rise" style={{ '--d': '.08s' }}>
            <div className="eyebrow mb-5">Issuance progress</div>
            {byLatest.slice(0, 3).map(seminar => {
              const percent = seminar.attendanceCount ? Math.min(100, Math.round(seminar.issuedCount / seminar.attendanceCount * 100)) : 0;
              return (
                <div key={seminar.seminarID} className="mb-6 last:mb-0">
                  <div className="flex justify-between items-baseline gap-3">
                    <div className="font-serif text-lg font-medium leading-tight truncate" title={seminar.seminarTitle}>{seminar.seminarTitle}</div>
                    <div className="font-serif text-2xl shrink-0">{percent}<span className="text-sm text-ink-muted">%</span></div>
                  </div>
                  <div className="h-1.5 bg-paper-2 rounded-full mt-3 overflow-hidden" role="progressbar" aria-label={seminar.seminarTitle + ' issuance'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                    <div className="h-full rounded-full fillbar" style={{ width: percent + '%', background: percent === 100 ? 'var(--verified)' : 'var(--pending)' }}></div>
                  </div>
                  <div className="text-xs text-ink-muted mt-2">
                    {seminar.attendanceCount
                      ? `${seminar.issuedCount} of ${seminar.attendanceCount} issued · ${seminar.readyCount} ready · ${seminar.awaitingCount} awaiting approval`
                      : 'Attendance not imported yet'}
                  </div>
                </div>
              );
            })}
          </section>
        </>}

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
                View revoked certificates
              </Btn>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

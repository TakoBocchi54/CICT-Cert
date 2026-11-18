import { useQuery } from '@tanstack/react-query';
import { Seal, Btn, Rosette } from '../components/design-system';
import { api } from '../lib/api';
import { formatCertificateNo } from '../lib/certificateNumber';

const fmt = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
const shortDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const plural = (n, one, many) => n === 1 ? one : many;
const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest';
const linkButton = 'cursor-pointer rounded text-sm font-semibold text-forest hover:underline ' + focusRing;
// Grey placeholder bars while data loads, so the cards keep their shape.
const Bar = ({ className }) => <span className={'block animate-pulse rounded-md bg-paper-2 ' + className} aria-hidden="true" />;

export default function FacultyDashboardPage({ onIssueClick, onNavigateRevocation, onNavigateSeminars, onNavigateRegistry }) {
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
  const issuerWallet = useQuery({
    queryKey: ['issuer-wallet'],
    queryFn: () => api('/api/faculty/certificates/issuer-wallet'),
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
  // What the latest seminar needs next, in workflow order.
  const hero = !latest ? null
    : latest.readyCount ? { count: latest.readyCount, badge: 'Ready to issue', icon: 'ph-check-circle', action: 'Begin issuance',
      label: plural(latest.readyCount, 'Certificate ready for its batch', 'Certificates ready to issue in one batch') }
    : latest.awaitingCount ? { count: latest.awaitingCount, badge: 'Awaiting wallet setup', icon: 'ph-hourglass-medium', action: 'Open seminar',
      label: plural(latest.awaitingCount, 'Attendee has not signed in yet', 'Attendees have not signed in yet') }
    : !latest.attendanceCount ? { count: latest.registrationCount, badge: 'Attendance not marked', icon: 'ph-users', action: 'Mark attendance',
      label: plural(latest.registrationCount, 'Student registered', 'Students registered') }
    : latest.issuedCount < latest.attendanceCount ? { count: latest.attendanceCount - latest.issuedCount, badge: 'Certificates to prepare', icon: 'ph-stamp', action: 'Open seminar',
      label: plural(latest.attendanceCount - latest.issuedCount, 'Attendee without a certificate yet', 'Attendees without a certificate yet') }
    : { count: latest.issuedCount, badge: 'All issued', icon: 'ph-seal-check', action: 'Open seminar',
      label: plural(latest.issuedCount, 'Certificate issued', 'Certificates issued') };

  return (
    <div className="pb-16 md:pb-24">
      {/* Page Header */}
      <div className="flex flex-wrap items-end justify-between gap-6 mb-10">
        <div>
          <h1 className="font-serif text-5xl md:text-6xl font-medium leading-[1.02]">
            Seminar workspace
          </h1>
        </div>
        <IssuerWallet query={issuerWallet} />
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {seminars.isPending ? <>
          <div role="status" className="lg:col-span-7 sheet p-7 min-h-[300px] space-y-4">
            <span className="sr-only">Loading seminars...</span>
            <Bar className="h-7 w-40 !rounded-full" /><Bar className="h-9 w-3/4" /><Bar className="h-4 w-1/2" /><Bar className="!mt-10 h-24 w-32" />
          </div>
          <div className="lg:col-span-5 sheet p-7 space-y-7" aria-hidden="true">
            {[0, 1, 2].map(i => <div key={i} className="space-y-3"><Bar className="h-5 w-2/3" /><Bar className="h-1.5 w-full" /><Bar className="h-3 w-1/2" /></div>)}
          </div>
        </> : seminars.error ? (
          <div role="alert" className="lg:col-span-12 flex flex-wrap items-center gap-4 rounded-2xl bg-revoked-bg p-5 text-sm text-revoked">
            <i className="ph-bold ph-warning-circle text-xl" aria-hidden="true"></i>
            <span className="flex-1">{seminars.error.message}</span>
            <Btn variant="line" size="sm" onClick={() => seminars.refetch()}>Try again</Btn>
          </div>
        ) : !latest ? (
          /* No seminars yet: point to where one is created. */
          <section className="lg:col-span-12 sheet flex flex-col items-center p-10 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-paper-2 text-2xl text-forest" aria-hidden="true"><i className="ph-bold ph-calendar-plus"></i></span>
            <h2 className="mt-4 font-serif text-3xl font-medium">No seminars yet</h2>
            <p className="mt-2 max-w-md text-sm text-ink-soft">Create a seminar to get a registration link for students. Its progress shows up here.</p>
            {onNavigateSeminars && <Btn className="mt-6" icon="ph-plus" onClick={onNavigateSeminars}>Create a seminar</Btn>}
          </section>
        ) : <>
          {/* Hero: what needs attention next */}
          <section className="lg:col-span-7 sheet-dark p-7" aria-labelledby="dashboard-hero-title">
            <Rosette color="#fff" className="absolute" style={{ width: 380, right: -120, top: -150, opacity: .1 }} />
            <div className="relative">
              <div className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded-full" style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)' }}>
                <i className={'ph-fill ' + hero.icon + ' text-[#7fd6a6]'} aria-hidden="true"></i>{hero.badge}
              </div>
              <h2 id="dashboard-hero-title" className="font-serif text-3xl font-medium leading-tight mt-4 break-words">{latest.seminarTitle}</h2>
              <p className="text-white/70 mt-1 text-sm">
                Held {fmt(latest.seminarDate)}{latest.venue && ` · ${latest.venue}`} · {latest.attendanceCount} {plural(latest.attendanceCount, 'attendee', 'attendees')} recorded
              </p>
              <div className="flex flex-wrap items-end justify-between gap-6 mt-5">
                <div>
                  <div className="font-serif font-medium leading-none tabular-nums text-[96px] sm:text-[136px]" style={{ letterSpacing: '-.04em' }}>{hero.count}</div>
                  <div className="mt-2 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#7fd6a6]">{hero.label}</div>
                </div>
                <button type="button" onClick={() => onIssueClick(latest.seminarID)}
                  className="bg-white text-forest font-semibold text-sm px-5 py-2.5 rounded-xl hover:-translate-y-0.5 transition-transform inline-flex items-center gap-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                  {hero.action} <i className="ph-bold ph-arrow-right" aria-hidden="true"></i>
                </button>
              </div>
            </div>
          </section>

          {/* Issuance progress: issued out of attended, newest seminars first. Each row opens that seminar's Issue wizard. */}
          <section className="lg:col-span-5 sheet p-7" aria-labelledby="dashboard-progress-title">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 id="dashboard-progress-title" className="font-serif text-2xl font-medium">Issuance progress</h2>
              {onNavigateSeminars && seminars.data.length > 3 && <button type="button" onClick={onNavigateSeminars} className={linkButton}>All seminars</button>}
            </div>
            <ul className="-mx-3">
              {byLatest.slice(0, 3).map(seminar => {
                const percent = seminar.attendanceCount ? Math.min(100, Math.round(seminar.issuedCount / seminar.attendanceCount * 100)) : 0;
                return (
                  <li key={seminar.seminarID}>
                    <button type="button" onClick={() => onIssueClick(seminar.seminarID)}
                      className={'group w-full cursor-pointer rounded-xl px-3 py-3 text-left transition-colors hover:bg-paper ' + focusRing}>
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate font-serif text-lg font-medium leading-tight" title={seminar.seminarTitle}>{seminar.seminarTitle}</span>
                        <span className="shrink-0 font-serif text-2xl tabular-nums">{percent}<span className="text-sm text-ink-muted">%</span></span>
                      </span>
                      <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-paper-2" role="progressbar" aria-label={seminar.seminarTitle + ' issuance'}
                        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                        <span className="fillbar block h-full rounded-full" style={{ width: percent + '%', background: percent === 100 ? 'var(--verified)' : 'var(--pending)' }}></span>
                      </span>
                      <span className="mt-2 flex items-center justify-between gap-3 text-xs text-ink-muted">
                        <span>{seminar.attendanceCount
                          ? `${seminar.issuedCount} of ${seminar.attendanceCount} issued · ${seminar.readyCount} ready · ${seminar.awaitingCount} awaiting wallet`
                          : 'Attendance not marked yet'}</span>
                        <i className="ph-bold ph-arrow-right shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true"></i>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </>}

        {/* Recently issued */}
        <section className="lg:col-span-7 sheet p-7" aria-labelledby="dashboard-recent-title">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id="dashboard-recent-title" className="font-serif text-2xl font-medium">Recently issued</h2>
            {onNavigateRegistry && totalIssued > 0 && <button type="button" onClick={onNavigateRegistry} className={linkButton}>Open registry</button>}
          </div>
          {summary.error ? (
            <div role="alert" className="flex flex-col items-center gap-3 py-12 text-center text-sm text-revoked">
              <p>{summary.error.message}</p>
              <Btn variant="line" size="sm" onClick={() => summary.refetch()}>Try again</Btn>
            </div>
          ) : summary.isPending ? (
            <div role="status">
              <span className="sr-only">Loading recent certificates...</span>
              {[0, 1, 2].map(i => <div key={i} className="flex items-center gap-4 py-3.5 hair" aria-hidden="true">
                <Bar className="h-10 w-10 !rounded-full" />
                <div className="flex-1 space-y-2"><Bar className="h-4 w-1/2" /><Bar className="h-3 w-1/3" /></div>
              </div>)}
            </div>
          ) : recent.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <Seal status="Verified" size={48} />
              <p className="mt-3 text-ink-muted">No certificates issued yet</p>
            </div>
          ) : (
            <>
              <ul>
                {recent.map(c => (
                  <li key={c.certificateNo} className="flex items-center gap-4 py-3.5 hair">
                    <Seal status="Verified" size={40} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{c.recipientName}</div>
                      <div className="text-xs text-ink-muted truncate">{c.seminarTitle}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm text-ink-soft">{shortDate(c.at)}</div>
                      <div className="font-mono text-xs text-ink-muted">{formatCertificateNo(c.certificateNo, c.seminarDate)}</div>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="hair pt-5 mt-1 flex items-baseline gap-3">
                <span className="font-serif text-4xl tabular-nums">{totalIssued.toLocaleString()}</span>
                <span className="text-sm text-ink-muted">{plural(totalIssued, 'certificate', 'certificates')} issued to date</span>
              </div>
            </>
          )}
        </section>

        {/* Revoked: compact */}
        <section className="lg:col-span-5 sheet p-7 flex flex-col" aria-labelledby="dashboard-revoked-title">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="dashboard-revoked-title" className="font-serif text-2xl font-medium">Revoked</h2>
              {summary.isPending ? <Bar className="mt-2 h-14 w-16" />
                : <div className="font-serif text-5xl leading-none mt-2 text-revoked tabular-nums">{totalRevoked}</div>}
            </div>
            <Seal status="Revoked" size={64} />
          </div>
          {summary.isPending || summary.error ? null : totalRevoked === 0 ? (
            <p className="text-sm text-ink-muted mt-6">No revoked certificates</p>
          ) : (
            <>
              <ul className="mt-6 mb-6 space-y-3">
                {revoked.map(c => (
                  <li key={c.certificateNo} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate font-medium">{c.recipientName}</span>
                    <span className="shrink-0 font-mono text-xs text-ink-muted">{formatCertificateNo(c.certificateNo, c.seminarDate)}</span>
                  </li>
                ))}
              </ul>
              <Btn variant="line" size="sm" iconRight="ph-arrow-right" className="mt-auto self-start" onClick={onNavigateRevocation}>
                View revoked certificates
              </Btn>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// POL in the issuer wallet pays the gas for every issue and revoke transaction. Sized like a large button.
function IssuerWallet({ query }) {
  const { data, error, isPending } = query;
  const low = data?.low;
  const look = 'inline-flex items-center gap-2.5 rounded-xl border px-7 py-3.5 text-base font-semibold '
    + (low ? 'border-pending/40 bg-pending-bg' : 'border-[var(--line)] bg-white');
  if (isPending || error) return (
    <div role={error ? 'alert' : 'status'} className={look + (error ? ' text-revoked' : ' text-ink-muted')} title={error?.message}>
      <i className={'ph-bold ' + (error ? 'ph-warning-circle' : 'ph-wallet')} aria-hidden="true"></i>
      {error ? 'Issuer balance unavailable' : 'Loading issuer balance...'}
    </div>
  );
  return (
    <a href={`https://amoy.polygonscan.com/address/${data.address}`} target="_blank" rel="noreferrer"
      title={low ? `Below the ${data.threshold} POL warning level. Top up before issuing more.` : data.address}
      aria-label={`Issuer wallet balance ${data.balance} POL${low ? `, low: below ${data.threshold} POL` : ''}. View on PolygonScan (opens in a new tab)`}
      className={look + ' text-ink transition-colors hover:border-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest'}>
      <i className={'ph-bold ' + (low ? 'ph-warning text-pending' : 'ph-wallet text-forest')} aria-hidden="true"></i>
      <span className="font-normal text-ink-muted">Issuer wallet</span>
      <span className="tabular-nums">{Number(data.balance).toLocaleString('en-US', { maximumFractionDigits: 4 })} POL</span>
      {/* Darker than --pending so white text keeps 4.5:1. */}
      {low && <span className="rounded-full bg-[#8a5609] px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">Low</span>}
      <i className="ph-bold ph-arrow-square-out text-sm text-ink-muted" aria-hidden="true"></i>
    </a>
  );
}

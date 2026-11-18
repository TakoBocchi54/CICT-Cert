import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Btn } from './design-system';
import { formatCertificateNo } from '../lib/certificateNumber';

const PAGE = 50;
// Entries shown before the list scrolls.
const VISIBLE = 6;

// Same groups as ?kind= in backend/src/routes/auditLog.js.
const FILTERS = [['', 'All'], ['certificates', 'Certificates'], ['attendance', 'Attendance'], ['seminars', 'Seminars'],
  ['students', 'Students'], ['account', 'Designs & account']];

// Tones pair a colour with an icon and the sentence, so meaning never rests on colour alone.
const TONES = {
  good: 'bg-verified-bg text-verified',
  danger: 'bg-revoked-bg text-revoked',
  wait: 'bg-pending-bg text-pending',
  plain: 'bg-paper-2 text-forest',
};
// [route pattern, what happened, icon, tone]; ':id' stands for any number. Unknown routes fall back to the raw action.
const ACTIONS = [
  [/^POST \/faculty\/seminars$/, 'created a seminar', 'ph-calendar-plus', 'plain'],
  [/^PATCH \/faculty\/seminars\/:id$/, 'edited a seminar', 'ph-pencil-simple', 'plain'],
  [/^DELETE \/faculty\/seminars\/:id$/, 'deleted a seminar', 'ph-trash', 'danger'],
  [/\/registration\/close$/, 'closed registration', 'ph-lock-simple', 'plain'],
  [/\/check-in$/, 'checked a student in', 'ph-user-check', 'good'],
  [/^PATCH \/faculty\/seminars\/:id\/registrations\/:id$/, 'changed attendance', 'ph-check-square', 'wait'],
  [/^DELETE \/faculty\/seminars\/:id\/registrations\/:id$/, 'removed a registrant', 'ph-user-minus', 'danger'],
  [/\/attendance\/import$/, 'imported attendance from a CSV', 'ph-file-csv', 'wait'],
  [/\/certificates\/prepare$/, 'prepared certificates', 'ph-stack', 'plain'],
  [/\/certificates\/issue$/, 'issued certificates on Amoy', 'ph-stamp', 'good'],
  [/^PATCH \/faculty\/seminars\/:id\/certificates\/:id$/, 'corrected a name on a certificate', 'ph-text-aa', 'wait'],
  [/^POST \/faculty\/certificates\/(:id\/)?revoke$/, 'revoked certificates', 'ph-seal-warning', 'danger'],
  [/\/replacement$/, 'prepared a replacement certificate', 'ph-arrows-clockwise', 'plain'],
  [/^POST \/faculty\/students\/import$/, 'registered students from a CSV', 'ph-users-three', 'plain'],
  [/^POST \/faculty\/students$/, 'registered students', 'ph-user-plus', 'plain'],
  [/^DELETE \/faculty\/students\/:id$/, 'removed a student account', 'ph-user-minus', 'danger'],
  [/^PATCH \/faculty\/account$/, 'updated their profile', 'ph-user-circle', 'plain'],
  [/\/account\/password$/, 'changed their password', 'ph-key', 'plain'],
  [/^POST \/faculty\/certificate-templates$/, 'created a certificate design', 'ph-palette', 'plain'],
  [/^DELETE \/faculty\/certificate-templates\/:id$/, 'deleted a certificate design', 'ph-trash', 'danger'],
  [/\/certificate-templates\//, 'edited a certificate design', 'ph-paint-brush', 'plain'],
  [/^POST \/faculty\/members$/, 'added a faculty account', 'ph-user-plus', 'plain'],
  [/\/members\/:id\/reset-password$/, "reset a faculty member's password", 'ph-key', 'wait'],
  [/^PATCH \/faculty\/members\/:id$/, 'changed a faculty account', 'ph-user-gear', 'wait'],
];
const describe = (action, details = {}) => {
  // One route both switches accounts off/on and changes permission; the saved fields say which.
  if (/^PATCH \/faculty\/members\/:id$/.test(action)) {
    if (details.active === false) return { verb: 'deactivated a faculty account', icon: 'ph-user-minus', tone: 'danger' };
    if (details.active === true) return { verb: 'reactivated a faculty account', icon: 'ph-user-check', tone: 'good' };
    if (details.canIssue === true) return { verb: 'gave a faculty member issuing permission', icon: 'ph-seal-check', tone: 'wait' };
    if (details.canIssue === false) return { verb: "removed a faculty member's issuing permission", icon: 'ph-lock-simple', tone: 'danger' };
  }
  const match = ACTIONS.find(([pattern]) => pattern.test(action));
  return match ? { verb: match[1], icon: match[2], tone: match[3] } : { verb: action, icon: 'ph-dot-outline', tone: 'plain' };
};

// Names the numbers in the URL by the path segment before each one, e.g. /seminars/5/registrations/12.
const ID_NAMES = { seminars: 'Seminar', registrations: 'Student', students: 'Student', 'certificate-templates': 'Design', signatures: 'Signature' };
// certificateDates (from the server) gives each mentioned certificate number its seminar date for the shown format.
function idChips({ action, ids, targetName, targetEmail, certificateDates = {} }) {
  const segments = action.split(' ')[1]?.split('/') ?? [];
  const names = segments.flatMap((segment, index) => segment === ':id' ? [segments[index - 1]] : []);
  return ids.flatMap((id, index) => {
    const noun = names[index];
    // /faculty/certificates/:id is a certificate number; the nested seminar route uses the internal certificate ID.
    if (noun === 'certificates') return index === 0 ? formatCertificateNo(id, certificateDates[id]) : `Certificate ID ${id}`;
    // The changed faculty account, by name (the server looks it up) rather than its internal ID.
    if (noun === 'members') return targetName ? [`Account: ${targetName}`, targetEmail && `Email: ${targetEmail}`].filter(Boolean) : 'Removed account';
    return `${ID_NAMES[noun] || 'Record'} #${id}`;
  });
}

const fmtDay = date => date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDateOnly = value => /^\d{4}-\d{2}-\d{2}$/.test(value) ? fmtDay(new Date(value + 'T00:00:00')) : value;
// The reason is shown as a quote below the chips, not as a chip.
function detailChips({ certificateNos, recipientName, attended, seminarTitle, seminarDate, venue, registrationClosesAt, name, firstName, lastName, email, canIssue }, certificateDates = {}) {
  return [
    (firstName || lastName) && `Name: ${[firstName, lastName].filter(Boolean).join(' ')}`,
    email && `Email: ${email}`,
    canIssue !== undefined && (canIssue ? 'Can issue' : 'Attendance & records'),
    certificateNos?.length && certificateNos.map(no => formatCertificateNo(no, certificateDates[no])).join(', '),
    attended !== undefined && (attended ? 'Marked attended' : 'Marked absent'),
    recipientName && `Name: ${recipientName}`,
    seminarTitle && `Title: ${seminarTitle}`,
    seminarDate && `Date: ${fmtDateOnly(seminarDate)}`,
    venue && `Venue: ${venue}`,
    registrationClosesAt && `Registration closes ${new Date(registrationClosesAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`,
    name && `Design: ${name}`,
  ].filter(Boolean);
}

function dayLabel(date) {
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// Consecutive rows that share a calendar day (rows arrive newest first).
function byDay(rows) {
  const days = [];
  for (const row of rows) {
    const key = new Date(row.at).toDateString();
    if (days.at(-1)?.key !== key) days.push({ key, label: dayLabel(new Date(row.at)), rows: [] });
    days.at(-1).rows.push(row);
  }
  return days;
}

function Entry({ row }) {
  const at = new Date(row.at);
  const { verb, icon, tone } = describe(row.action, row.details);
  const chips = [...idChips(row), ...detailChips(row.details, row.certificateDates)];
  return (
    <li data-entry className="flex gap-4 px-5 py-4 sm:px-6 hover:bg-paper">
      <span className={'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg ' + TONES[tone]} aria-hidden="true">
        <i className={'ph-bold ' + icon}></i>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="min-w-0 text-[15px] leading-snug">
            <span className="font-semibold">{row.actorName || 'Removed account'}</span> {verb}
          </p>
          <time dateTime={row.at} title={at.toLocaleString()} className="shrink-0 text-xs tabular-nums text-ink-muted">
            {at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          </time>
        </div>
        {row.actorEmail && <p className="mt-0.5 text-xs text-ink-muted [overflow-wrap:anywhere]">{row.actorEmail}</p>}
        {chips.length > 0 && <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Details">
          {chips.map(chip => <li key={chip} className="rounded-md border border-[var(--line)] bg-paper px-2 py-0.5 text-xs text-ink-soft [overflow-wrap:anywhere]">{chip}</li>)}
        </ul>}
        {row.details?.reason && <p className="mt-2.5 border-l-2 border-[var(--line)] pl-3 text-sm italic text-ink-soft [overflow-wrap:anywhere]">
          <span className="sr-only">Reason: </span>“{row.details.reason}”</p>}
      </div>
    </li>
  );
}

function Skeleton() {
  return (
    <ul className="divide-y divide-[var(--line)]" aria-hidden="true">
      {[0, 1, 2, 3].map(index => <li key={index} className="flex gap-4 px-6 py-5">
        <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-paper-2 motion-reduce:animate-none"></span>
        <div className="flex-1 space-y-2.5 pt-1">
          <span className="block h-3.5 w-2/5 animate-pulse rounded bg-paper-2 motion-reduce:animate-none"></span>
          <span className="block h-3 w-1/4 animate-pulse rounded bg-paper-2 motion-reduce:animate-none"></span>
        </div>
      </li>)}
    </ul>
  );
}

// Every faculty change, newest first. Only faculty with issuance permission can open it (server-enforced).
// Account settings → Audit log, for faculty with issuing permission (the server enforces it too).
export default function AuditLog() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const log = useInfiniteQuery({
    queryKey: ['audit-log', q, kind],
    queryFn: ({ pageParam }) => api('/api/faculty/audit-log?' + new URLSearchParams({
      limit: PAGE, ...(q && { q }), ...(kind && { kind }), ...(pageParam && { before: pageParam }) })),
    initialPageParam: '',
    getNextPageParam: last => last.length === PAGE ? last[last.length - 1].auditID : undefined,
    placeholderData: previous => previous,
    retry: false,
  });
  const rows = log.data?.pages.flat() ?? [];
  const filtered = q || kind;

  // Entries differ in height (chips, reasons), so cap the list at the bottom of the sixth one.
  const scroller = useRef(null);
  const [maxHeight, setMaxHeight] = useState();
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => {
      const entries = element.querySelectorAll('[data-entry]');
      const last = entries[VISIBLE - 1];
      setMaxHeight(entries.length > VISIBLE ? last.offsetTop + last.offsetHeight : undefined);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [log.data]);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0; }, [q, kind]);

  return (
    <div>
      <section className="sheet overflow-hidden" aria-labelledby="audit-title">
        <h2 id="audit-title" className="sr-only">Audit log entries</h2>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] bg-paper p-5">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by type">
            {FILTERS.map(([value, label]) => (
              <button key={label} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}
                className={'min-h-9 cursor-pointer rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest ' +
                  (kind === value ? 'border-forest bg-forest text-white' : 'border-[var(--line)] bg-white text-ink-soft hover:border-ink-muted')}>
                {label}
              </button>
            ))}
          </div>
          <div className="relative w-full lg:w-80">
            <label htmlFor="audit-search" className="sr-only">Search by person or action</label>
            <i className="ph ph-magnifying-glass pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true"></i>
            <input id="audit-search" type="search" className="field !pl-10 !py-2.5 !text-sm" placeholder="Search name, email or action"
              value={search} onChange={event => setSearch(event.target.value)} />
          </div>
        </div>

        {log.isPending ? <><p role="status" className="sr-only">Loading the audit log...</p><Skeleton /></> : log.error ? (
          <div role="alert" className="flex flex-col items-center gap-4 px-6 py-16 text-center">
            <i className="ph-bold ph-warning-circle text-3xl text-revoked" aria-hidden="true"></i>
            <p className="text-sm text-revoked">{log.error.message}</p>
            <Btn variant="line" icon="ph-arrows-clockwise" onClick={() => log.refetch()}>Try again</Btn>
          </div>
        ) : !rows.length ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-paper-2 text-2xl text-ink-muted" aria-hidden="true">
              <i className={'ph-bold ' + (filtered ? 'ph-magnifying-glass' : 'ph-clock-counter-clockwise')}></i>
            </span>
            <p className="font-serif text-xl">{filtered ? 'No entries match' : 'Nothing recorded yet'}</p>
            <p className="max-w-sm text-sm text-ink-muted">{filtered ? 'Try another filter or search term.' : 'Changes faculty make from now on, like check-ins, issuance and revocations, will appear here.'}</p>
            {filtered && <Btn variant="line" size="sm" onClick={() => { setSearch(''); setQ(''); setKind(''); }}>Clear filters</Btn>}
          </div>
        ) : (
          <div className={log.isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'} aria-busy={log.isFetching}>
            <div ref={scroller} className="relative overflow-y-auto overscroll-contain" style={{ maxHeight }}
              tabIndex={maxHeight ? 0 : undefined} aria-label={maxHeight ? 'Audit log entries, scrollable' : undefined}>
              {byDay(rows).map(day => (
                <section key={day.key} aria-label={day.label}>
                  <h3 className="eyebrow sticky top-0 z-10 border-b border-[var(--line)] bg-paper-2 px-5 py-2.5 sm:px-6">{day.label}</h3>
                  <ol className="divide-y divide-[var(--line)]">{day.rows.map(row => <Entry key={row.auditID} row={row} />)}</ol>
                </section>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] bg-paper px-5 py-4 sm:px-6">
              <p className="text-sm text-ink-muted tabular-nums" role="status">{rows.length} {rows.length === 1 ? 'entry' : 'entries'} shown</p>
              {log.hasNextPage ? <Btn variant="line" size="sm" icon={log.isFetchingNextPage ? undefined : 'ph-caret-down'} disabled={log.isFetchingNextPage}
                onClick={() => log.fetchNextPage()}>{log.isFetchingNextPage ? 'Loading...' : 'Load older entries'}</Btn>
                : <p className="text-sm text-ink-muted"></p>}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

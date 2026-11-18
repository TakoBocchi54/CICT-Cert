import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Btn } from '../components/design-system';

const PAGE = 50;

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
];
const describe = action => {
  const match = ACTIONS.find(([pattern]) => pattern.test(action));
  return match ? { verb: match[1], icon: match[2], tone: match[3] } : { verb: action, icon: 'ph-dot-outline', tone: 'plain' };
};

// Names the numbers in the URL by the path segment before each one, e.g. /seminars/5/registrations/12.
const ID_NAMES = { seminars: 'Seminar', registrations: 'Student', students: 'Student', 'certificate-templates': 'Design', signatures: 'Signature' };
function idChips(action, ids) {
  const segments = action.split(' ')[1]?.split('/') ?? [];
  const names = segments.flatMap((segment, index) => segment === ':id' ? [segments[index - 1]] : []);
  return ids.map((id, index) => {
    const noun = names[index];
    // /faculty/certificates/:id is a certificate number; the nested seminar route uses the internal certificate ID.
    if (noun === 'certificates') return index === 0 ? `Certificate No. ${id}` : `Certificate ID ${id}`;
    return `${ID_NAMES[noun] || 'Record'} #${id}`;
  });
}

const fmtDay = date => date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDateOnly = value => /^\d{4}-\d{2}-\d{2}$/.test(value) ? fmtDay(new Date(value + 'T00:00:00')) : value;
// The reason is shown as a quote below the chips, not as a chip.
function detailChips({ certificateNos, recipientName, attended, seminarTitle, seminarDate, venue, registrationClosesAt, name }) {
  return [
    certificateNos?.length && `Certificate No. ${certificateNos.join(', ')}`,
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
  const { verb, icon, tone } = describe(row.action);
  const chips = [...idChips(row.action, row.ids), ...detailChips(row.details)];
  return (
    <li className="flex gap-4 px-5 py-4 sm:px-6 hover:bg-paper">
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
        <p className="mt-2 font-mono text-[11px] text-ink-muted/80 [overflow-wrap:anywhere]">{row.action}</p>
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
export default function AuditLogPage() {
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

  return (
    <div className="pb-16 md:pb-24">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="font-serif text-5xl md:text-6xl font-medium leading-[1.02]">Audit log</h1>
          <p className="mt-4 max-w-xl text-lg text-ink-soft">Every change faculty made, who made it and when.</p>
        </div>
        <p className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-paper px-4 py-2 text-sm text-ink-soft">
          <i className="ph-bold ph-lock-simple text-forest" aria-hidden="true"></i>Entries can't be edited or deleted
        </p>
      </div>

      <section className="sheet overflow-hidden" aria-labelledby="audit-title">
        <h2 id="audit-title" className="sr-only">Entries</h2>
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
            {byDay(rows).map(day => (
              <section key={day.key} aria-label={day.label}>
                <h3 className="eyebrow border-b border-[var(--line)] bg-paper-2 px-5 py-2.5 sm:px-6">{day.label}</h3>
                <ol className="divide-y divide-[var(--line)]">{day.rows.map(row => <Entry key={row.auditID} row={row} />)}</ol>
              </section>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] bg-paper px-5 py-4 sm:px-6">
              <p className="text-sm text-ink-muted tabular-nums" role="status">{rows.length} {rows.length === 1 ? 'entry' : 'entries'} shown</p>
              {log.hasNextPage ? <Btn variant="line" size="sm" icon={log.isFetchingNextPage ? undefined : 'ph-caret-down'} disabled={log.isFetchingNextPage}
                onClick={() => log.fetchNextPage()}>{log.isFetchingNextPage ? 'Loading...' : 'Load older entries'}</Btn>
                : <p className="text-sm text-ink-muted">You've reached the first entry.</p>}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

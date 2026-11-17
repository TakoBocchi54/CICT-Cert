import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn, QR } from './design-system';
import { api } from '../lib/api';
import { registrationUrl, formatDeadline } from '../lib/registrationLink';
import { saveBlob } from '../lib/saveBlob';

// Draws the on-screen QR SVG onto a 1024px canvas so the download prints sharply on posters and slides.
async function downloadQr(svg, filename) {
  const image = new Image();
  image.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  try {
    await image.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: 1024, height: 1024 });
    canvas.getContext('2d').drawImage(image, 0, 0, 1024, 1024);
    saveBlob(await new Promise(resolve => canvas.toBlob(resolve, 'image/png')), filename);
  } finally { URL.revokeObjectURL(image.src); }
}

// The shareable registration link, its open/closed state, and closing it early.
export function RegistrationLink({ seminar }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const qr = useRef(null);
  const download = useMutation({
    mutationFn: () => downloadQr(qr.current.querySelector('svg'),
      `registration-qr-${seminar.seminarTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || seminar.seminarID}.png`),
  });
  const close = useMutation({
    mutationFn: () => api(`/api/faculty/seminars/${seminar.seminarID}/registration/close`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['faculty-seminars'] }),
  });
  if (!seminar.registrationClosesAt) return (
    <p role="note" className="rounded-xl border border-[var(--line)] bg-paper-2 p-4 text-sm text-ink-soft">
      Registration isn't open. Set a registration deadline with <b>Edit</b> to get a link students can register with.
    </p>
  );
  const url = registrationUrl(seminar.registrationToken);
  return (
    <div className="rounded-xl border border-[var(--line)] bg-paper-2 p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium '
          + (seminar.registrationOpen ? 'bg-verified-bg text-verified' : 'bg-white text-ink-soft')}>
          <i className={'ph-bold ' + (seminar.registrationOpen ? 'ph-door-open' : 'ph-lock-simple')} aria-hidden="true"></i>
          {seminar.registrationOpen ? 'Registration open' : 'Registration closed'}
        </span>
        <span className="text-ink-soft">{seminar.registrationOpen ? 'until' : 'since'} {formatDeadline(seminar.registrationClosesAt)}</span>
        {seminar.registrationOpen && <Btn variant="ghost" size="sm" className="ml-auto" icon="ph-lock-simple" disabled={close.isPending}
          onClick={() => close.mutate()}>{close.isPending ? 'Closing...' : 'Close registration now'}</Btn>}
      </div>
      <label htmlFor={`registration-link-${seminar.seminarID}`} className="eyebrow mb-2 mt-4 block">Registration link to share with students</label>
      <div className="flex gap-2">
        <input id={`registration-link-${seminar.seminarID}`} className="field min-w-0 flex-1 font-mono !text-xs" readOnly value={url}
          onFocus={event => event.target.select()} />
        <Btn variant="line" icon={copied ? 'ph-check' : 'ph-copy'} onClick={() => navigator.clipboard?.writeText(url).then(() => setCopied(true), () => {})}>
          {copied ? 'Copied' : 'Copy'}</Btn>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <div ref={qr} className="shrink-0 overflow-hidden rounded-lg border border-[var(--line)]">
          <QR value={url} size={112} color="#000" label={`QR code for the registration link of ${seminar.seminarTitle}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink-soft">Students can scan this to open the registration page. Put it on a slide or a printed poster.</p>
          <Btn variant="line" size="sm" className="mt-3" icon="ph-download-simple" disabled={download.isPending} onClick={() => download.mutate()}>
            {download.isPending ? 'Preparing...' : 'Download QR code'}</Btn>
          {download.error && <p role="alert" className="mt-2 text-sm text-revoked">Could not create the QR image. Please try again.</p>}
        </div>
      </div>
      {close.error && <p role="alert" className="mt-3 text-sm text-revoked">{close.error.message}</p>}
    </div>
  );
}

const MIN_SEARCH = 2;
const SEARCH_LIMIT = 20; // the backend's limit for ?q= searches
const NOTICE_LOOK = { verified: 'bg-verified-bg text-verified', pending: 'bg-pending-bg text-pending', revoked: 'bg-revoked-bg text-revoked' };

// The attendance desk. Every search asks the database for this seminar's registrants and every check-in is saved
// right away, so several laptops can check people in at once without working from a stale list.
// action: an extra control shown beside the search box (the Issue page's CSV upload button).
export default function Registrants({ seminar, action }) {
  const { seminarID } = seminar;
  const queryClient = useQueryClient();
  const input = useRef(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [removing, setRemoving] = useState(null);
  const [notice, setNotice] = useState(null); // { tone: 'verified' | 'pending' | 'revoked', text }
  const base = `/api/faculty/seminars/${seminarID}/registrations`;

  // Search once typing pauses instead of on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim().replace(/\s+/g, ' ')), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const results = useQuery({
    queryKey: ['registration-search', seminarID, query],
    queryFn: ({ signal }) => api(`${base}?q=${encodeURIComponent(query)}`, { signal }),
    enabled: query.length >= MIN_SEARCH,
    placeholderData: keepPreviousData,
    // Results on screen follow check-ins made on other laptops.
    refetchInterval: 5000,
    retry: false,
  });
  const refresh = () => Promise.all([['registration-search', seminarID], ['seminar-registrations', seminarID], ['faculty-seminars'],
    ['seminar-certificates', seminarID]].map(queryKey => queryClient.invalidateQueries({ queryKey })));
  const failed = (error, row) => setNotice(error.status === 409 && error.message.includes('already checked in')
    ? { tone: 'pending', text: `${row.fullName} is already checked in.` }
    : { tone: 'revoked', text: error.message });

  const checkIn = useMutation({
    mutationFn: row => api(`${base}/${row.studentID}/check-in`, { method: 'POST' }),
    onMutate: () => setNotice(null),
    onSuccess: (_data, row) => {
      setNotice({ tone: 'verified', text: `${row.fullName} is checked in.` });
      // Ready for the next student in line.
      setSearch('');
      setQuery('');
      input.current?.focus();
    },
    onError: failed,
    onSettled: refresh,
  });
  const undo = useMutation({
    mutationFn: row => api(`${base}/${row.studentID}`, { method: 'PATCH', body: { attended: false } }),
    onMutate: () => setNotice(null),
    onSuccess: (_data, row) => setNotice({ tone: 'pending', text: `Check-in undone for ${row.fullName}.` }),
    onError: failed,
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: row => api(`${base}/${row.studentID}`, { method: 'DELETE' }),
    onMutate: () => setNotice(null),
    onSuccess: (_data, row) => { setRemoving(null); setNotice({ tone: 'pending', text: `${row.fullName} was removed from this seminar.` }); },
    onError: failed,
    onSettled: refresh,
  });
  const busy = checkIn.isPending || undo.isPending || remove.isPending;
  const rows = results.data ?? [];
  const searching = query.length >= MIN_SEARCH;

  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-2xl font-medium">Check in attendees</h2>
        <p className="text-sm text-ink-soft tabular-nums">{seminar.registrationCount} registered · {seminar.attendanceCount} checked in</p>
      </div>
      <p className="mb-4 max-w-2xl text-sm text-ink-muted">
        Search for each student as they arrive and check them in. Check-ins are saved immediately, so several laptops can work at once.
        Only checked-in students receive a certificate.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 basis-60 sm:max-w-md">
          <label htmlFor={`registrant-search-${seminarID}`} className="sr-only">Search this seminar's registered students by name or email</label>
          <i className="ph-bold ph-magnifying-glass pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true"></i>
          <input ref={input} id={`registrant-search-${seminarID}`} type="search" className="field !pl-11" autoComplete="off"
            placeholder="Search by name or email" value={search} maxLength={100}
            onChange={event => { setSearch(event.target.value); setRemoving(null); }} />
        </div>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {notice && <p role={notice.tone === 'revoked' ? 'alert' : 'status'} className={'mb-3 rounded-xl p-3 text-sm ' + NOTICE_LOOK[notice.tone]}>{notice.text}</p>}

      {!searching ? (
        <p className="rounded-xl border border-dashed border-[var(--line)] p-6 text-center text-sm text-ink-muted">
          Type at least {MIN_SEARCH} letters of the student's name or email.</p>
      ) : results.isPending ? (
        <p role="status" className="p-6 text-center text-sm text-ink-soft">Searching registered students...</p>
      ) : results.error && !results.data ? (
        <div role="alert" className="space-y-3 rounded-xl bg-revoked-bg p-4 text-sm text-revoked">
          <p>{results.error.message}</p>
          <Btn variant="line" size="sm" onClick={() => results.refetch()}>Try again</Btn>
        </div>
      ) : !rows.length ? (
        <div role="status" className="rounded-xl border border-[var(--line)] bg-paper p-5">
          <p className="font-medium">No one matching "{query}" is registered for this seminar.</p>
          <p className="mt-1 text-sm text-ink-soft">Check the spelling, or ask the student to register: they scan this QR code
            or open the link, sign in with Google, then you search for them again.</p>
          <div className="mt-4"><RegistrationLink seminar={seminar} /></div>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-[var(--line)] bg-white" aria-label="Matching registered students">
            {rows.map(row => (
              <li key={row.studentID} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="font-medium">{row.fullName}</p>
                  <p className="break-all text-xs text-ink-soft">{row.email}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">{row.program} · {row.walletConnected ? 'Wallet linked' : 'Wallet not linked yet'}</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {removing === row.studentID ? <>
                    <Btn variant="danger" size="sm" disabled={busy} onClick={() => remove.mutate(row)}>{remove.isPending ? 'Removing...' : 'Remove'}</Btn>
                    <Btn variant="ghost" size="sm" disabled={busy} onClick={() => setRemoving(null)}>Cancel</Btn>
                  </> : <>
                    {!row.hasCertificate && <Btn variant="ghost" size="sm" disabled={busy} aria-label={`Remove ${row.fullName} from this seminar`}
                      onClick={() => setRemoving(row.studentID)}>Remove</Btn>}
                    {row.attended ? <>
                      {/* An issued or in-flight certificate keeps the student checked in. */}
                      {!row.attendanceLocked && <Btn variant="ghost" size="sm" disabled={busy} aria-label={`Undo check-in for ${row.fullName}`}
                        onClick={() => undo.mutate(row)}>Undo</Btn>}
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-verified-bg px-3 py-1.5 text-sm font-semibold text-verified">
                        <i className="ph-bold ph-check-circle" aria-hidden="true"></i>Checked in</span>
                    </> : <Btn size="sm" icon="ph-check" disabled={busy} aria-label={`Check in ${row.fullName}`} onClick={() => checkIn.mutate(row)}>
                      {checkIn.isPending && checkIn.variables?.studentID === row.studentID ? 'Checking in...' : 'Check in'}</Btn>}
                  </>}
                </div>
              </li>
            ))}
          </ul>
          {rows.length >= SEARCH_LIMIT && <p className="mt-2 text-xs text-ink-muted">Showing the first {SEARCH_LIMIT} matches. Type more of the name to narrow it down.</p>}
        </>
      )}
    </div>
  );
}

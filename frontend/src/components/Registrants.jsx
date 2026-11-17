import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
      {close.error &&<p role="alert" className="mt-3 text-sm text-revoked">{close.error.message}</p>}
    </div>
  );
}

// Everyone who registered through the link. Faculty tick who attended and remove registrants who aren't CICT students.
// action: an extra control shown beside the search box (the Issue page's CSV upload button).
export default function Registrants({ seminarID, action }) {
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState(null);
  const [search, setSearch] = useState('');
  const base = `/api/faculty/seminars/${seminarID}/registrations`;
  const registrants = useQuery({
    queryKey: ['seminar-registrations', seminarID],
    queryFn: ({ signal }) => api(base, { signal }),
    retry: false,
  });
  const refresh = () => Promise.all([['seminar-registrations', seminarID], ['faculty-seminars'], ['seminar-certificates', seminarID]]
    .map(queryKey => queryClient.invalidateQueries({ queryKey })));
  const mark = useMutation({
    mutationFn: ({ studentID, attended }) => api(`${base}/${studentID}`, { method: 'PATCH', body: { attended } }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: studentID => api(`${base}/${studentID}`, { method: 'DELETE' }),
    onSuccess: () => setRemoving(null),
    onSettled: refresh,
  });
  const busy = mark.isPending || remove.isPending;

  if (registrants.isPending) return <p role="status" className="mt-6 text-sm text-ink-soft">Loading registered students...</p>;
  if (registrants.error) return (
    <div role="alert" className="mt-6 space-y-3 text-sm text-revoked">
      <p>{registrants.error.message}</p>
      <div className="flex flex-wrap gap-3">
        <Btn variant="line" size="sm" onClick={() => registrants.refetch()}>Try again</Btn>
        {action}
      </div>
    </div>
  );
  const rows = registrants.data;
  const attended = rows.filter(row => row.attended).length;
  const query = search.trim().toLowerCase();
  const shown = query ? rows.filter(row => row.fullName.toLowerCase().includes(query) || row.email.toLowerCase().includes(query)) : rows;
  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-2xl font-medium">Registered students</h2>
        <p className="text-sm text-ink-soft tabular-nums">{rows.length} registered · {attended} attended</p>
      </div>
      <p className="mb-4 max-w-2xl text-sm text-ink-muted">
        Tick everyone who attended; only they receive a certificate. Remove anyone who isn't a CICT student.
      </p>
      {(rows.length > 0 || action) && <div className="mb-3 flex flex-wrap items-center gap-3">
        {rows.length > 0 && <div className="relative min-w-0 flex-1 basis-60 sm:max-w-md">
          <label htmlFor={`registrant-search-${seminarID}`} className="sr-only">Search registered students by name or email</label>
          <i className="ph-bold ph-magnifying-glass pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true"></i>
          <input id={`registrant-search-${seminarID}`} type="search" className="field !pl-11" autoComplete="off" placeholder="Search by name or email"
            value={search} onChange={event => setSearch(event.target.value)} />
        </div>}
        {action && <div className="ml-auto">{action}</div>}
      </div>}
      {(mark.error || remove.error) && <p role="alert" className="mb-3 text-sm text-revoked">{(mark.error || remove.error).message}</p>}
      {!rows.length ? <p className="rounded-xl border border-dashed border-[var(--line)] p-6 text-center text-sm text-ink-muted">No one has registered yet.</p> : (
        <div className="max-h-[480px] overflow-auto rounded-xl border border-[var(--line)]">
          <table className="w-full min-w-[620px] text-left text-sm">
            <caption className="sr-only">Registered students and their attendance</caption>
            <thead className="sticky top-0 z-10 bg-paper-2">
              <tr>{['Attended', 'Name', 'Program', 'Wallet', ''].map(head =>
                <th key={head} scope="col" className="eyebrow px-4 py-3 font-semibold">{head || <span className="sr-only">Actions</span>}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {!shown.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-ink-muted">No registered student matches "{search.trim()}".</td></tr>}
              {shown.map(row => (
                <tr key={row.studentID} className="hover:bg-paper">
                  <td className="px-4 py-3">
                    {/* An issued or in-flight certificate keeps the student marked as attended. */}
                    <input type="checkbox" className="h-5 w-5 cursor-pointer accent-[var(--forest)] disabled:cursor-not-allowed"
                      aria-label={`${row.fullName} attended`} checked={row.attended}
                      disabled={busy || (row.attended && row.attendanceLocked)}
                      onChange={event => { remove.reset(); mark.mutate({ studentID: row.studentID, attended: event.target.checked }); }} />
                  </td>
                  <td className="px-4 py-3"><span className="font-medium">{row.fullName}</span>
                    <span className="block break-all text-xs text-ink-soft">{row.email}</span></td>
                  <td className="px-4 py-3 text-ink-soft">{row.program}</td>
                  <td className="px-4 py-3 text-ink-soft">{row.walletConnected ? 'Connected' : 'Not linked yet'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {row.hasCertificate ? null : removing === row.studentID ? <>
                      <Btn variant="danger" size="sm" disabled={busy} onClick={() => remove.mutate(row.studentID)}>
                        {remove.isPending ? 'Removing...' : 'Remove'}</Btn>
                      <Btn variant="ghost" size="sm" disabled={busy} onClick={() => setRemoving(null)}>Cancel</Btn>
                    </> : <Btn variant="ghost" size="sm" disabled={busy} aria-label={`Remove ${row.fullName} from this seminar`}
                      onClick={() => { mark.reset(); remove.reset(); setRemoving(row.studentID); }}>Remove</Btn>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { certificateProgress } from '../lib/certificateProgress';
import { certificateVerificationUrl } from '../lib/certificateVerificationUrl';
import { Btn } from '../components/design-system';

const day = iso => new Date(iso + 'T00:00:00');
const fmt = iso => day(iso).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

// Loading / error / empty handling shared by every query on this page.
function QueryState({ query, label, empty, icon = 'ph-tray', children }) {
  if (query.isPending) return (
    <div role="status" className="flex items-center gap-3 p-6 text-sm text-ink-soft">
      <i className="ph-bold ph-circle-notch animate-spin text-lg motion-reduce:animate-none" aria-hidden="true"></i>Loading {label}...
    </div>
  );
  if (query.error) return (
    <div role="alert" className="m-5 flex items-start gap-3 rounded-xl bg-revoked-bg px-4 py-3 text-sm text-revoked">
      <i className="ph-bold ph-warning-circle mt-0.5 text-base" aria-hidden="true"></i>
      <div className="space-y-3">
        <p>{query.error.message}</p>
        <Btn variant="line" size="sm" onClick={() => query.refetch()}>Try again</Btn>
      </div>
    </div>
  );
  if (!query.data.length) return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <i className={'ph ' + icon + ' text-3xl text-ink-muted'} aria-hidden="true"></i>
      <p className="text-sm text-ink-muted">{empty}</p>
    </div>
  );
  return children(query.data);
}

// Fixed height: long lists scroll inside the card and the header row stays visible.
const ScrollTable = ({ caption, head, children }) => (
  <div className="max-h-[420px] overflow-auto">
    <table className="w-full min-w-[640px] text-left text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead className="sticky top-0 z-10 bg-paper-2">
        <tr>{head.map(h => <th key={h} scope="col" className="eyebrow px-4 py-3 font-semibold">{h}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-[var(--line)]">{children}</tbody>
    </table>
  </div>
);

const TONES = {
  neutral: 'bg-paper-2 text-ink-soft',
  pending: 'bg-pending-bg text-pending',
  success: 'bg-verified-bg text-verified',
  danger: 'bg-revoked-bg text-revoked',
};
// Status text with an icon so the meaning never rests on color alone.
const Badge = ({ tone = 'neutral', icon, children }) => (
  <span className={'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ' + TONES[tone]}>
    <i className={'ph-bold ' + icon} aria-hidden="true"></i>{children}
  </span>
);

// Tone and icon for the label certificateProgress() gives the same row.
const progressLook = row =>
  row.status === 'ISSUED' ? ['success', 'ph-seal-check']
    : row.status === 'REVOKED' ? ['danger', 'ph-seal-warning']
    : row.transactionStatus === 'PENDING' ? ['pending', 'ph-hourglass-medium']
    : !row.attended ? ['neutral', 'ph-pause-circle']
    : !row.walletConnected ? ['neutral', 'ph-wallet']
    : row.status === 'FAILED' ? ['danger', 'ph-arrow-clockwise']
    : row.consentedAt ? ['pending', 'ph-check-circle']
    : ['neutral', 'ph-signature'];

const SectionHead = ({ id, icon, title, count }) => (
  <div className="flex items-center gap-3 border-b border-[var(--line)] px-5 py-4">
    <span className="grid h-9 w-9 place-items-center rounded-lg bg-paper-2 text-forest"><i className={'ph-bold ' + icon} aria-hidden="true"></i></span>
    <h2 id={id} className="font-serif text-2xl font-medium">{title}</h2>
    {count != null && <span className="ml-auto rounded-full bg-paper-2 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-ink-soft">{count}</span>}
  </div>
);

// Read-only view of seminars and their attendance and certificates. Creating and issuing happen in the Issue tab.
export default function SeminarsPage() {
  const [selectedId, setSelectedId] = useState(null);
  const seminars = useQuery({ queryKey: ['faculty-seminars'], queryFn: () => api('/api/faculty/seminars'), retry: false });
  const selected = seminars.data?.find(seminar => seminar.seminarID === selectedId) || seminars.data?.[0];
  const id = selected?.seminarID;
  const attendees = useQuery({
    queryKey: ['seminar-registrations', id],
    queryFn: ({ signal }) => api(`/api/faculty/seminars/${id}/registrations`, { signal }),
    enabled: !!id, retry: false,
  });
  const certificates = useQuery({
    queryKey: ['seminar-certificates', id],
    queryFn: ({ signal }) => api(`/api/faculty/seminars/${id}/certificates`, { signal }),
    enabled: !!id, retry: false,
  });

  return (
    <div className="pb-16">
      <div className="mb-10">
        <div className="eyebrow mb-3 rise">Seminars</div>
        <h1 className="font-serif text-5xl md:text-6xl font-medium leading-[1.02] rise" style={{ '--d': '.05s' }}>Seminars</h1>
        <p className="text-ink-soft text-lg mt-4 max-w-xl rise" style={{ '--d': '.1s' }}>
          See each seminar's attendance and certificates. Create seminars and issue certificates in the Issue tab.
        </p>
      </div>

      <div className={seminars.data?.length ? '' : 'sheet'}>
        <QueryState query={seminars} label="seminars" icon="ph-calendar-blank" empty="No seminars yet. Create one in the Issue tab.">
          {list => (
            <div className="grid gap-8 lg:grid-cols-12">
              <aside aria-labelledby="seminar-list-title" className="lg:col-span-4">
                <div className="sheet overflow-hidden lg:sticky lg:top-24">
                  <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
                    <h2 id="seminar-list-title" className="eyebrow">All seminars</h2>
                    <span className="text-xs font-semibold tabular-nums text-ink-muted">{list.length}</span>
                  </div>
                  <ul className="max-h-80 space-y-1 overflow-y-auto p-2 lg:max-h-[calc(100vh-14rem)]">
                    {list.map(seminar => {
                      const active = seminar.seminarID === id;
                      const date = day(seminar.seminarDate);
                      return (
                        <li key={seminar.seminarID}>
                          <button type="button" aria-pressed={active} onClick={() => setSelectedId(seminar.seminarID)}
                            className={'relative flex w-full cursor-pointer items-start gap-3 rounded-xl p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest '
                              + (active ? 'bg-paper-2 before:absolute before:inset-y-3 before:left-0 before:w-1 before:rounded-full before:bg-forest' : 'hover:bg-paper')}>
                            <span aria-hidden="true" className={'flex w-12 shrink-0 flex-col items-center rounded-lg border py-1.5 leading-none '
                              + (active ? 'border-forest bg-forest text-white' : 'border-[var(--line)] bg-white text-ink')}>
                              <span className="text-[10px] font-semibold uppercase tracking-wider">{date.toLocaleDateString('en-US', { month: 'short' })}</span>
                              <span className="mt-1 font-serif text-xl font-medium tabular-nums">{date.toLocaleDateString('en-US', { day: '2-digit' })}</span>
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block font-medium break-words">{seminar.seminarTitle}</span>
                              <span className="mt-0.5 block text-sm text-ink-muted">{fmt(seminar.seminarDate)}</span>
                              <span className="mt-1.5 block text-xs text-ink-soft">{seminar.attendanceCount} attended · {seminar.issuedCount} issued</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </aside>

              <div className="min-w-0 space-y-6 lg:col-span-8">
                <SeminarSummary seminar={selected} />

                <section className="sheet overflow-hidden" aria-labelledby="attendees-title">
                  <SectionHead id="attendees-title" icon="ph-users-three" title="Attendees" count={attendees.data?.length} />
                  <QueryState query={attendees} label="attendees" icon="ph-users-three" empty="No attendance imported yet.">
                    {rows => (
                      <ScrollTable caption="Seminar attendees" head={['Name', 'Program', 'Google account', 'Attendance', 'Wallet']}>
                        {rows.map(row => (
                          <tr key={row.studentID} className="transition-colors hover:bg-paper">
                            <td className="px-4 py-3 font-medium">{row.fullName}</td>
                            <td className="px-4 py-3 text-ink-soft">{row.program}</td>
                            <td className="break-all px-4 py-3 text-ink-soft">{row.email}</td>
                            <td className="px-4 py-3">{row.attended
                              ? <Badge tone="success" icon="ph-check">Attended</Badge>
                              : <Badge icon="ph-minus">Absent</Badge>}</td>
                            <td className="px-4 py-3">{row.walletConnected
                              ? <Badge tone="success" icon="ph-wallet">Connected</Badge>
                              : <Badge icon="ph-clock">Not signed in yet</Badge>}</td>
                          </tr>
                        ))}
                      </ScrollTable>
                    )}
                  </QueryState>
                </section>

                <section className="sheet overflow-hidden" aria-labelledby="certificates-title">
                  <SectionHead id="certificates-title" icon="ph-certificate" title="Certificates" count={certificates.data?.length} />
                  <QueryState query={certificates} label="certificates" icon="ph-certificate" empty="No certificates prepared yet.">
                    {rows => (
                      <ScrollTable caption="Seminar certificates" head={['No.', 'Recipient', 'Status', '']}>
                        {rows.map(row => {
                          const [tone, icon] = progressLook(row);
                          return (
                            <tr key={row.certificateID} className="transition-colors hover:bg-paper">
                              <td className="px-4 py-3 font-mono text-xs">{row.certificateNo}</td>
                              <td className="px-4 py-3"><span className="font-medium">{row.recipientName}</span>
                                <span className="block break-all text-xs text-ink-soft">{row.email}</span></td>
                              <td className="px-4 py-3"><Badge tone={tone} icon={icon}>{certificateProgress(row)}</Badge></td>
                              <td className="px-4 py-3 text-right">
                                {['ISSUED', 'REVOKED'].includes(row.status) && row.certificateHash && (
                                  <a href={certificateVerificationUrl(row.certificateHash, window.location.origin)} target="_blank" rel="noreferrer"
                                    className="btn btn-line btn-sm" aria-label={`Verify certificate ${row.certificateNo} (opens in a new tab)`}>
                                    Verify<i className="ph-bold ph-arrow-square-out" aria-hidden="true"></i></a>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </ScrollTable>
                    )}
                  </QueryState>
                </section>
              </div>
            </div>
          )}
        </QueryState>
      </div>
    </div>
  );
}

const STATS = [
  ['Attended', 'attendanceCount', 'ph-users-three'],
  ['With wallet', 'walletCount', 'ph-wallet'],
  ['Awaiting approval', 'awaitingCount', 'ph-signature'],
  ['Ready to issue', 'readyCount', 'ph-stamp'],
  ['Issued', 'issuedCount', 'ph-seal-check'],
];

function SeminarSummary({ seminar }) {
  const issuedShare = seminar.attendanceCount ? Math.min(100, Math.round(seminar.issuedCount / seminar.attendanceCount * 100)) : 0;
  return (
    <section className="sheet overflow-hidden" aria-labelledby="seminar-title">
      <div className="p-6">
        <h2 id="seminar-title" className="font-serif text-3xl font-medium break-words">{seminar.seminarTitle}</h2>
        <div className="mt-3 flex flex-wrap gap-2 text-sm text-ink-soft">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-paper-2 px-3 py-1">
            <i className="ph-bold ph-calendar-blank" aria-hidden="true"></i>{fmt(seminar.seminarDate)}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-paper-2 px-3 py-1">
            <i className="ph-bold ph-frame-corners" aria-hidden="true"></i>{seminar.templateName ? `Design: ${seminar.templateName}` : 'Built-in design'}</span>
        </div>
        <div className="mt-5">
          <div className="flex justify-between text-xs text-ink-muted">
            <span>{seminar.issuedCount} of {seminar.attendanceCount} attendees issued</span>
            <span className="tabular-nums">{issuedShare}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper-2" aria-hidden="true">
            <div className="h-full rounded-full bg-verified transition-[width] duration-500" style={{ width: issuedShare + '%' }}></div>
          </div>
        </div>
      </div>
      <dl className="grid grid-cols-2 border-t border-[var(--line)] sm:grid-cols-5">
        {STATS.map(([label, key, icon], index) => {
          const last = index === STATS.length - 1;
          return (
            <div key={key} className={'border-[var(--line)] p-4 sm:border-l sm:first:border-l-0 '
              + (index % 2 ? 'border-l ' : '') + (index > 1 ? 'border-t sm:border-t-0 ' : '')
              + (last ? 'col-span-2 bg-verified-bg sm:col-span-1 ' : '')}>
              <dt className={'eyebrow flex items-center gap-1.5 ' + (last ? '!text-verified' : '')}>
                <i className={'ph-bold text-sm ' + icon} aria-hidden="true"></i>{label}</dt>
              <dd className={'mt-1.5 font-serif text-3xl font-medium tabular-nums ' + (last ? 'text-verified' : '')}>{seminar[key]}</dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

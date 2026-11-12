import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { certificateVerificationUrl } from '../lib/certificateVerificationUrl';
import { Btn, Pill } from '../components/design-system';

const FILTERS = [['', 'All'], ['ISSUED', 'Verified'], ['REVOKED', 'Revoked']];
const fmtDate = value => new Date(value).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

// Registry: every certificate that reached the chain. A row's Revoke/Details opens the revocation page for that certificate.
export default function RegistryPage({ initialStatus = '', onOpenRevocation }) {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(() => FILTERS.some(([value]) => value === initialStatus) ? initialStatus : '');

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const params = new URLSearchParams(Object.entries({ q, status }).filter(([, value]) => value)).toString();
  const certificates = useQuery({
    queryKey: ['faculty-certificates', q, status],
    queryFn: ({ signal }) => api('/api/faculty/certificates' + (params ? '?' + params : ''), { signal }),
    placeholderData: previous => previous,
    retry: false,
  });

  return (
    <div>
      <div className="mb-10">
        <div className="eyebrow mb-3 rise">Registry</div>
        <h1 className="font-serif text-5xl md:text-6xl font-medium leading-[1.02] rise" style={{ '--d': '.05s' }}>Issued certificates</h1>
      </div>

      <section className="sheet overflow-hidden" aria-labelledby="registry-title">
        <h2 id="registry-title" className="sr-only">Certificates</h2>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] bg-paper p-5">
          <div className="flex gap-2" role="group" aria-label="Filter by status">
            {FILTERS.map(([value, label]) => (
              <button key={label} type="button" aria-pressed={status === value} onClick={() => setStatus(value)}
                className={'rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest ' +
                  (status === value ? 'border-forest bg-forest text-white' : 'border-[var(--line)] bg-white text-ink-soft hover:border-ink-muted')}>
                {label}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-80">
            <label htmlFor="registry-search" className="sr-only">Search by name, email, certificate number or seminar</label>
            <i className="ph ph-magnifying-glass pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true"></i>
            <input id="registry-search" type="search" className="field !pl-10 !py-2.5 !text-sm" placeholder="Search name, email, number or seminar"
              value={search} onChange={event => setSearch(event.target.value)} />
          </div>
        </div>

        {certificates.isPending ? <p role="status" className="p-6 text-sm">Loading certificates...</p> : certificates.error ? (
          <div role="alert" className="space-y-3 p-6">
            <p className="text-sm text-revoked">{certificates.error.message}</p>
            <Btn variant="line" onClick={() => certificates.refetch()}>Try again</Btn>
          </div>
        ) : (
          // Fixed height: the list scrolls inside the card and the header row stays visible.
          <div className="h-[560px] overflow-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <caption className="sr-only">Issued and revoked certificates</caption>
              <thead className="sticky top-0 z-10 bg-paper-2"><tr className="eyebrow">
                <th scope="col" className="px-6 py-3.5">Recipient</th><th scope="col" className="p-3">Seminar</th>
                <th scope="col" className="p-3">No.</th><th scope="col" className="p-3">Issued</th>
                <th scope="col" className="p-3">Status</th><th scope="col" className="px-6 py-3 text-right">Actions</th>
              </tr></thead>
              <tbody>
                {certificates.data.map(cert => (
                  <tr key={cert.certificateNo} className="border-t border-[var(--line)] hover:bg-paper">
                    <td className="px-6 py-4"><div className="font-medium">{cert.recipientName}</div><div className="break-all text-xs text-ink-muted">{cert.email}</div></td>
                    <td className="max-w-[260px] p-3"><div className="text-ink-soft">{cert.seminarTitle}</div><div className="text-xs text-ink-muted">{fmtDate(cert.seminarDate + 'T00:00:00')}</div></td>
                    <td className="p-3 font-mono text-xs text-ink-muted">{cert.certificateNo}</td>
                    <td className="p-3 text-ink-soft">{fmtDate(cert.issuedAt)}</td>
                    <td className="p-3"><Pill status={cert.status === 'ISSUED' ? 'Verified' : 'Revoked'} /></td>
                    <td className="whitespace-nowrap px-6 py-3 text-right">
                      <a href={certificateVerificationUrl(cert.certificateHash, window.location.origin)} target="_blank" rel="noreferrer"
                        className="btn btn-ghost btn-sm" aria-label={`Verify certificate ${cert.certificateNo} (opens in a new tab)`}>Verify</a>
                      <Btn variant="ghost" size="sm" onClick={() => onOpenRevocation(cert.certificateNo)}
                        aria-label={`${cert.status === 'ISSUED' ? 'Revoke' : 'Revocation details for'} certificate ${cert.certificateNo}`}>
                        {cert.status === 'ISSUED' ? 'Revoke' : 'Details'}
                      </Btn>
                    </td>
                  </tr>
                ))}
                {!certificates.data.length && <tr><td colSpan={6} className="py-16 text-center text-ink-muted">
                  {q || status ? 'No certificates match.' : 'No certificates issued yet.'}
                </td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {certificates.data?.length === 200 && <p className="mt-3 text-xs text-ink-muted">Showing the newest 200 matches. Search to narrow the list.</p>}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useFacultyMe } from '../hooks/useFacultyMe';
import { certificateVerificationUrl } from '../lib/certificateVerificationUrl';
import { Btn, Pill } from '../components/design-system';

const FILTERS = [['', 'All'], ['ISSUED', 'Verified'], ['REVOKED', 'Revoked']];
const fmtDate = value => new Date(value).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
const MAX_REASON = 500, MAX_BATCH = 200; // same limits as the backend

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
  const queryClient = useQueryClient();
  const faculty = useFacultyMe();
  const [selected, setSelected] = useState([]); // certificate numbers chosen for one batch revocation
  const [reason, setReason] = useState('');
  const [progress, setProgress] = useState('');
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  // One revokeBatch transaction for every selected certificate, then poll until Amoy finalizes it (about three minutes at most).
  const revoke = useMutation({
    mutationFn: async () => {
      request.current = new AbortController();
      const { signal } = request.current, body = { certificateNos: selected, reason: reason.trim() };
      setProgress('Sending the revocation...');
      let result = await api('/api/faculty/certificates/revoke', { method: 'POST', body, signal });
      const pending = () => result.certificates.some(certificate => certificate.transactionStatus === 'PENDING' && certificate.status !== 'REVOKED');
      for (let check = 0; pending() && check < 36; check++) {
        setProgress('Waiting for Amoy to finalize the revocation...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        result = await api('/api/faculty/certificates/revocation/check', { method: 'POST', body, signal });
      }
      const revoked = result.certificates.filter(certificate => certificate.status === 'REVOKED').length;
      if (result.certificates.some(certificate => certificate.transactionStatus === 'FAILED' && certificate.status !== 'REVOKED')) {
        throw new Error('The revocation transaction reverted. The certificates are still valid; check the cause before retrying.');
      }
      return result.warning || (pending() ? `Revocation submitted for ${selected.length}. It is still confirming; open a certificate's Details to check it.`
        : `${revoked} certificate${revoked === 1 ? '' : 's'} revoked on Amoy in one transaction.`);
    },
    onSuccess: () => { setSelected([]); setReason(''); },
    onSettled: () => {
      setProgress('');
      return Promise.all([queryClient.invalidateQueries({ queryKey: ['faculty-certificates'] }), queryClient.invalidateQueries({ queryKey: ['certificate-summary'] })]);
    },
  });
  const issued = certificates.data?.filter(cert => cert.status === 'ISSUED').map(cert => cert.certificateNo) || [];
  const toggle = no => setSelected(current => current.includes(no) ? current.filter(value => value !== no) : [...current, no]);
  const allSelected = issued.length > 0 && issued.every(no => selected.includes(no));
  const canRevoke = !!faculty.data?.canIssue;

  return (
    <div className="pb-16 md:pb-24">
      <div className="mb-10">
        <h1 className="font-serif text-5xl md:text-6xl font-medium leading-[1.02]">Issued certificates</h1>
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

        {canRevoke && (selected.length > 0 || revoke.data || revoke.error) && <form className="space-y-3 border-b border-[var(--line)] bg-revoked-bg/40 p-5"
          onSubmit={event => { event.preventDefault(); if (!revoke.isPending) revoke.mutate(); }}>
          {selected.length > 0 && <>
            <p className="text-sm font-medium">Revoke {selected.length} selected certificate{selected.length === 1 ? '' : 's'} in one transaction. Tokens are not burned; the revocation root on Amoy marks them revoked. This cannot be undone.</p>
            <div>
              <label htmlFor="batch-reason" className="eyebrow mb-2 block">Reason (applies to all selected)</label>
              <textarea id="batch-reason" className="field !text-sm" rows={2} required maxLength={MAX_REASON} disabled={revoke.isPending}
                value={reason} onChange={event => setReason(event.target.value)} />
            </div>
            <div className="flex flex-wrap gap-3">
              <Btn type="submit" icon="ph-seal-warning" disabled={revoke.isPending || !reason.trim() || selected.length > MAX_BATCH}>{revoke.isPending ? 'Revoking...' : `Revoke ${selected.length}`}</Btn>
              <Btn type="button" variant="line" disabled={revoke.isPending} onClick={() => setSelected([])}>Clear selection</Btn>
            </div>
            {selected.length > MAX_BATCH && <p role="alert" className="text-sm text-revoked">Select at most {MAX_BATCH} certificates per revocation.</p>}
          </>}
          {progress && <p role="status" className="text-sm">{progress}</p>}
          {revoke.error && <p role="alert" className="text-sm text-revoked">{revoke.error.message}</p>}
          {revoke.data && <p role="status" className="text-sm text-verified">{revoke.data}</p>}
        </form>}

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
                {canRevoke && <th scope="col" className="w-10 pl-6 py-3.5">
                  <input type="checkbox" aria-label="Select every issued certificate shown" disabled={!issued.length || revoke.isPending} checked={allSelected}
                    onChange={() => setSelected(allSelected ? [] : issued)} />
                </th>}
                <th scope="col" className="px-6 py-3.5">Recipient</th><th scope="col" className="p-3">Seminar</th>
                <th scope="col" className="p-3">No.</th><th scope="col" className="p-3">Issued</th>
                <th scope="col" className="p-3">Status</th><th scope="col" className="px-6 py-3 text-right">Actions</th>
              </tr></thead>
              <tbody>
                {certificates.data.map(cert => (
                  <tr key={cert.certificateNo} className="border-t border-[var(--line)] hover:bg-paper">
                    {canRevoke && <td className="pl-6 py-4">
                      {cert.status === 'ISSUED' && <input type="checkbox" aria-label={`Select certificate ${cert.certificateNo} for revocation`}
                        disabled={revoke.isPending} checked={selected.includes(cert.certificateNo)} onChange={() => toggle(cert.certificateNo)} />}
                    </td>}
                    <td className="px-6 py-4"><div className="font-medium">{cert.recipientName}</div><div className="break-all text-xs text-ink-muted">{cert.email}</div></td>
                    <td className="max-w-[260px] p-3"><div className="text-ink-soft">{cert.seminarTitle}</div><div className="text-xs text-ink-muted">{fmtDate(cert.seminarDate + 'T00:00:00')}</div></td>
                    <td className="p-3 font-mono text-xs text-ink-muted">{cert.certificateNo}</td>
                    <td className="p-3 text-ink-soft">{fmtDate(cert.issuedAt)}</td>
                    <td className="p-3"><Pill status={cert.status === 'ISSUED' ? 'Verified' : 'Revoked'} /></td>
                    <td className="whitespace-nowrap px-6 py-3 text-right">
                      <a href={certificateVerificationUrl(cert.certificateHash, window.location.origin)} target="_blank" rel="noreferrer"
                        className="btn btn-ghost btn-sm" aria-label={`View certificate ${cert.certificateNo} (opens in a new tab)`}>
                        View<i className="ph-bold ph-arrow-square-out" aria-hidden="true"></i></a>
                      {(() => {
                        // Revoke and Replace only for faculty who can issue; everyone else gets the read-only Details.
                        const [label, icon, tone] = cert.status === 'ISSUED' && canRevoke ? ['Revoke', 'ph-seal-warning', '!text-revoked hover:!bg-revoked-bg']
                          : cert.status === 'REVOKED' && canRevoke && !cert.replaced ? ['Replace', 'ph-arrows-clockwise', '']
                          : ['Details', 'ph-file-text', ''];
                        return <Btn variant="ghost" size="sm" icon={icon} className={tone} onClick={() => onOpenRevocation(cert.certificateNo)}
                          aria-label={`${label === 'Details' ? 'Details for' : label} certificate ${cert.certificateNo}`}>{label}</Btn>;
                      })()}
                    </td>
                  </tr>
                ))}
                {!certificates.data.length && <tr><td colSpan={canRevoke ? 7 : 6} className="py-16 text-center text-ink-muted">
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

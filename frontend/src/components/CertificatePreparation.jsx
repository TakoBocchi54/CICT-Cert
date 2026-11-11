import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn } from './design-system';
import { api } from '../lib/api';
import { useFacultyMe } from '../hooks/useFacultyMe';

// mode 'approvals': prepare certificates and track student approvals. mode 'issue': mint approved certificates.
export default function CertificatePreparation({ seminarID, disabled, mode }) {
  const queryClient = useQueryClient();
  const faculty = useFacultyMe();
  const [reviewingIssuance, setReviewingIssuance] = useState(false);
  const [progress, setProgress] = useState('');
  const issuanceRequest = useRef(null);
  useEffect(() => () => issuanceRequest.current?.abort(), []);
  const certificates = useQuery({
    queryKey: ['seminar-certificates', seminarID],
    queryFn: () => api(`/api/faculty/seminars/${seminarID}/certificates`),
    retry: false, refetchOnWindowFocus: false,
    // With auto-issuance the backend mints on its own, so the Issue step watches for changes.
    refetchInterval: mode === 'issue' && faculty.data?.autoIssue ? 15_000 : false,
  });
  const refreshCounts = () => queryClient.invalidateQueries({ queryKey: ['faculty-seminars'] });
  const prepare = useMutation({
    mutationFn: () => api(`/api/faculty/seminars/${seminarID}/certificates/prepare`, { method: 'POST' }),
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: ['seminar-certificates', seminarID] }), refreshCounts()]),
  });
  const issue = useMutation({
    mutationFn: async ids => {
      setReviewingIssuance(false);
      issuanceRequest.current = new AbortController();
      const signal = issuanceRequest.current.signal;
      let issued = 0;
      for (const [index, id] of ids.entries()) {
        setProgress(`Issuing ${index + 1} of ${ids.length}...`);
        let result = await api(`/api/faculty/seminars/${seminarID}/certificates/${id}/issue`, { method: 'POST', signal });
        for (let check = 0; result.transactionStatus === 'PENDING' && check < 5; check++) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          result = await api(`/api/faculty/seminars/${seminarID}/certificates/${id}/issuance/check`, { method: 'POST', signal });
        }
        await queryClient.invalidateQueries({ queryKey: ['seminar-certificates', seminarID] });
        if (result.status === 'FAILED') throw new Error('The mint transaction reverted. Earlier issued certificates are saved. Check the transaction before retrying.');
        if (result.status !== 'ISSUED') return `${issued} issued. A transaction is still pending; use Check transaction before continuing.`;
        issued++;
      }
      return `${issued} certificates issued on Amoy.`;
    },
    onSettled: () => {
      setProgress('');
      return Promise.all([queryClient.invalidateQueries({ queryKey: ['seminar-certificates', seminarID] }), refreshCounts()]);
    },
  });
  const check = useMutation({
    mutationFn: id => api(`/api/faculty/seminars/${seminarID}/certificates/${id}/issuance/check`, { method: 'POST' }),
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: ['seminar-certificates', seminarID] }), refreshCounts()]),
  });
  const busy = disabled || prepare.isPending || issue.isPending || check.isPending;
  const ready = certificates.data?.filter(certificate => ['PENDING', 'FAILED'].includes(certificate.status) && certificate.attended &&
    certificate.walletConnected && certificate.consentedAt && certificate.transactionStatus !== 'PENDING') || [];
  const pending = certificates.data?.some(certificate => certificate.transactionStatus === 'PENDING');
  return <div>
    {mode === 'approvals' ? <>
      <p className="mb-2 text-ink-soft max-w-2xl">Each confirmed attendee gets a numbered certificate to review and approve with their wallet in the student portal. Students without a wallet stay pending until they connect one.</p>
      <p className="mb-5 text-sm text-ink-muted max-w-2xl">Confirming attendance prepares certificates automatically. Run it again after adding attendees; existing numbers and approvals are kept. This does not mint or spend POL.</p>
      <div className="flex flex-wrap gap-3">
        <Btn variant="line" disabled={busy || !faculty.data?.canIssue} onClick={() => prepare.mutate()}>{prepare.isPending ? 'Preparing...' : 'Prepare certificates'}</Btn>
        <Btn variant="ghost" icon="ph-arrows-clockwise" disabled={busy || certificates.isFetching} onClick={() => certificates.refetch()}>Refresh approvals</Btn>
      </div>
      {faculty.error && <p role="alert" className="mt-3 text-sm text-revoked">{faculty.error.message}</p>}
      {faculty.data && !faculty.data.canIssue && <p className="mt-3 text-sm text-ink-soft">Your faculty account needs issuance permission to prepare certificates.</p>}
      {prepare.error && <p role="alert" className="mt-4 text-sm text-revoked">{prepare.error.message}</p>}
      {prepare.data && <p role="status" className="mt-4 text-sm text-verified">{prepare.data.prepared} certificates prepared; {prepare.data.alreadyPrepared} attendees already have certificate records; {prepare.data.awaitingWallet} attendees need wallet setup.</p>}
    </> : <div className="space-y-3">
      {faculty.data?.autoIssue && <div role="status" className="rounded-2xl border border-[#bfe0cd] bg-verified-bg p-5 text-sm text-verified">
        <p className="font-semibold flex items-center gap-2"><i className="ph-fill ph-lightning" aria-hidden="true"></i>Issuing automatically</p>
        <p className="mt-1">Approved certificates are minted one at a time, about every 30 seconds, and each waits for finality. This list refreshes every 15 seconds. You can still issue manually below.</p>
      </div>}
      <div className="rounded-2xl border border-[var(--line)] bg-paper p-5 space-y-3">
        <p className="font-serif text-4xl font-medium leading-none">{ready.length}</p>
        <p className="eyebrow">Approved and ready to issue</p>
        <p className="text-sm text-ink-soft">Only confirmed attendees with a linked wallet and saved approval can be issued. The issuer wallet pays Amoy POL for each transaction.</p>
        {pending && <p className="text-sm text-pending">A transaction is confirming. Check it below before issuing more certificates.</p>}
        {reviewingIssuance ? <div role="alert" className="rounded-xl p-4 text-sm space-y-3" style={{ background: '#fbf1dc', border: '1px solid #ecd5a2', color: '#8a5508' }}>
          <p className="font-medium"><i className="ph-fill ph-warning mr-1" aria-hidden="true"></i>Issue {ready.length} certificates on Polygon Amoy? Issued details cannot be edited; a correction needs revocation and a new certificate. Leaving the page stops the remaining batch, but a submitted transaction can still finish.</p>
          <div className="flex flex-wrap gap-3"><Btn icon="ph-stamp" disabled={busy || pending || !ready.length || !faculty.data?.canIssue} onClick={() => issue.mutate(ready.map(certificate => certificate.certificateID))}>Confirm issuance on Amoy</Btn><Btn variant="line" disabled={busy} onClick={() => setReviewingIssuance(false)}>Cancel</Btn></div>
        </div> : <Btn icon="ph-stamp" disabled={busy || pending || !ready.length || !faculty.data?.canIssue || certificates.isFetching} onClick={() => { issue.reset(); check.reset(); setReviewingIssuance(true); }}>{faculty.data?.autoIssue ? 'Issue now' : 'Review issuance'} ({ready.length})</Btn>}
        {progress && <p role="status" className="text-sm">{progress}</p>}
        {issue.error && <p role="alert" className="text-sm text-revoked">{issue.error.message}</p>}
        {issue.data && <p role="status" className="text-sm text-verified">{issue.data}</p>}
        {check.error && <p role="alert" className="text-sm text-revoked">{check.error.message}</p>}
        {check.data && <p role="status" className="text-sm">{check.data.warning || (check.data.status === 'ISSUED' ? 'Issuance confirmed.' : check.data.status === 'FAILED' ? 'Transaction reverted. The certificate can be retried after resolving the cause.' : 'Transaction is pending. Check again shortly.')}</p>}
      </div>
    </div>}
    {certificates.isPending ? <p role="status" className="mt-4">Loading certificates...</p> : certificates.error ? <p role="alert" className="mt-4 text-sm text-revoked">{certificates.error.message}</p> : !certificates.data.length ? <p className="mt-4 text-sm text-ink-soft">No certificates prepared yet.</p> : <div className="mt-5 overflow-x-auto rounded-xl border border-[var(--line)]">
      <table className="w-full min-w-[500px] text-left text-sm">
        <caption className="sr-only">Prepared certificates and recipient approvals</caption>
        <thead className="bg-paper-2"><tr><th scope="col" className="p-3">Number</th><th scope="col" className="p-3">Recipient</th><th scope="col" className="p-3">Progress</th></tr></thead>
        <tbody>{certificates.data.map(certificate => <tr key={certificate.certificateID} className="border-t border-[var(--line)]">
          <td className="p-3 font-mono">{certificate.certificateNo}</td>
          <td className="p-3">{certificate.recipientName}<span className="block break-all text-xs text-ink-soft">{certificate.email}</span></td>
          <td className="p-3">
            {['ISSUED', 'REVOKED'].includes(certificate.status) ? certificate.status : certificate.transactionStatus === 'PENDING' ? 'Transaction pending' : !certificate.attended ? 'On hold: attendance not confirmed' : !certificate.walletConnected ? 'Awaiting wallet setup' : certificate.status === 'FAILED' ? 'Mint failed; ready to retry' : certificate.consentedAt ? 'Approved; awaiting issuance' : 'Awaiting student approval'}
            {certificate.tokenID && <span className="mt-1 block text-xs">Token #{certificate.tokenID}</span>}
            {certificate.transactionHash && <a className="mt-1 block text-xs text-forest underline" href={`https://amoy.polygonscan.com/tx/${certificate.transactionHash}`} target="_blank" rel="noreferrer">View transaction</a>}
            {certificate.transactionStatus === 'PENDING' && <Btn variant="line" size="sm" className="mt-2" disabled={busy || !faculty.data?.canIssue} onClick={() => check.mutate(certificate.certificateID)}>Check transaction</Btn>}
            {certificate.status === 'ISSUED' && <a className="mt-1 block text-xs text-forest underline" href={`/verify?id=${certificate.certificateHash}`}>Verify certificate</a>}
          </td>
        </tr>)}</tbody>
      </table>
    </div>}
  </div>;
}

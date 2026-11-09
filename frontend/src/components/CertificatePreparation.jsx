import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn } from './design-system';
import { api } from '../lib/api';
import { useFacultyMe } from '../hooks/useFacultyMe';

export default function CertificatePreparation({ seminarID, disabled }) {
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
  });
  const prepare = useMutation({
    mutationFn: () => api(`/api/faculty/seminars/${seminarID}/certificates/prepare`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['seminar-certificates', seminarID] }),
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
      return queryClient.invalidateQueries({ queryKey: ['seminar-certificates', seminarID] });
    },
  });
  const check = useMutation({
    mutationFn: id => api(`/api/faculty/seminars/${seminarID}/certificates/${id}/issuance/check`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['seminar-certificates', seminarID] }),
  });
  const busy = disabled || prepare.isPending || issue.isPending || check.isPending;
  const ready = certificates.data?.filter(certificate => ['PENDING', 'FAILED'].includes(certificate.status) && certificate.attended &&
    certificate.walletConnected && certificate.consentedAt && certificate.transactionStatus !== 'PENDING') || [];
  const pending = certificates.data?.some(certificate => certificate.transactionStatus === 'PENDING');
  return <section className="mt-8 border-t border-[var(--line)] pt-6">
    <h3 className="font-serif text-2xl">Prepare certificates</h3>
    <p className="mb-4 mt-2 text-sm text-ink-soft">Create pending certificates for confirmed attendees. Each receives a certificate number and can review and approve it in the student portal. Students without wallets stay pending.</p>
    <p className="mb-4 text-sm text-ink-soft">Existing certificate numbers and approvals are preserved. This step does not issue tokens or spend POL.</p>
    <div className="flex flex-wrap gap-3">
      <Btn disabled={busy || !faculty.data?.canIssue} onClick={() => prepare.mutate()}>{prepare.isPending ? 'Preparing...' : 'Prepare pending certificates'}</Btn>
      <Btn variant="line" disabled={busy || certificates.isFetching} onClick={() => certificates.refetch()}>Refresh approvals</Btn>
    </div>
    {faculty.error && <p role="alert" className="mt-3 text-sm text-revoked">{faculty.error.message}</p>}
    {faculty.data && !faculty.data.canIssue && <p className="mt-3 text-sm text-ink-soft">Your faculty account needs issuance permission to prepare certificates.</p>}
    {prepare.error && <p role="alert" className="mt-4 text-sm text-revoked">{prepare.error.message}</p>}
    {prepare.data && <p role="status" className="mt-4 text-sm text-verified">{prepare.data.prepared} certificates prepared; {prepare.data.alreadyPrepared} attendees already have certificate records; {prepare.data.awaitingWallet} attendees need wallet setup.</p>}
    <div className="mt-5 space-y-3 rounded-xl border border-[var(--line)] bg-paper p-4">
      <h4 className="font-medium">Issue approved certificates</h4>
      <p className="text-sm text-ink-soft">{ready.length} ready for issuance. Only confirmed attendees with a linked wallet and saved approval can be issued. The issuer wallet pays Amoy POL for each transaction.</p>
      {pending && <p className="text-sm text-pending">Check the pending transaction below before issuing more certificates.</p>}
      {reviewingIssuance ? <>
        <p className="text-sm">Issue {ready.length} certificates on Polygon Amoy? Issued details cannot be edited. Leaving this page stops the remaining batch; a submitted transaction can still finish.</p>
        <div className="flex flex-wrap gap-3"><Btn disabled={busy || pending || !ready.length || !faculty.data?.canIssue} onClick={() => issue.mutate(ready.map(certificate => certificate.certificateID))}>Confirm issuance on Amoy</Btn><Btn variant="line" disabled={busy} onClick={() => setReviewingIssuance(false)}>Cancel issuance</Btn></div>
      </> : <Btn disabled={busy || pending || !ready.length || !faculty.data?.canIssue || certificates.isFetching} onClick={() => { issue.reset(); check.reset(); setReviewingIssuance(true); }}>Review issuance ({ready.length})</Btn>}
      {progress && <p role="status" className="text-sm">{progress}</p>}
      {issue.error && <p role="alert" className="text-sm text-revoked">{issue.error.message}</p>}
      {issue.data && <p role="status" className="text-sm text-verified">{issue.data}</p>}
      {check.error && <p role="alert" className="text-sm text-revoked">{check.error.message}</p>}
      {check.data && <p role="status" className="text-sm">{check.data.warning || (check.data.status === 'ISSUED' ? 'Issuance confirmed.' : check.data.status === 'FAILED' ? 'Transaction reverted. The certificate can be retried after resolving the cause.' : 'Transaction is pending. Check again shortly.')}</p>}
    </div>
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
  </section>;
}

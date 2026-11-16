import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn } from './design-system';
import { api } from '../lib/api';
import { useFacultyMe } from '../hooks/useFacultyMe';
import { certificateProgress } from '../lib/certificateProgress';

const count = (n, noun = 'certificate') => `${n} ${noun}${n === 1 ? '' : 's'}`;

// mode 'review': prepare certificates and check the list (names can be corrected). mode 'issue': mint every ready certificate in batches.
export default function CertificatePreparation({ seminarID, disabled, mode }) {
  const queryClient = useQueryClient();
  const faculty = useFacultyMe();
  const [reviewingIssuance, setReviewingIssuance] = useState(false);
  const [progress, setProgress] = useState('');
  const [editing, setEditing] = useState(null); // { id, name }: the recipient name being corrected
  const issuanceRequest = useRef(null);
  useEffect(() => () => issuanceRequest.current?.abort(), []);
  const base = `/api/faculty/seminars/${seminarID}/certificates`;
  const certificates = useQuery({
    queryKey: ['seminar-certificates', seminarID],
    queryFn: () => api(base),
    retry: false, refetchOnWindowFocus: false,
  });
  const refreshList = () => queryClient.invalidateQueries({ queryKey: ['seminar-certificates', seminarID] });
  const refresh = () => Promise.all([refreshList(), queryClient.invalidateQueries({ queryKey: ['faculty-seminars'] })]);
  const prepare = useMutation({ mutationFn: () => api(base + '/prepare', { method: 'POST' }), onSuccess: refresh });
  const rename = useMutation({
    mutationFn: ({ id, name }) => api(`${base}/${id}`, { method: 'PATCH', body: { recipientName: name } }),
    onSuccess: () => { setEditing(null); return refreshList(); },
  });
  const issue = useMutation({
    mutationFn: async () => {
      setReviewingIssuance(false);
      issuanceRequest.current = new AbortController();
      const signal = issuanceRequest.current.signal;
      let issued = 0, result;
      // One transaction per batch; the backend allows only one pending issuer transaction, so each must be final before the next.
      do {
        setProgress(`${count(issued)} issued. Sending the next batch...`);
        result = await api(base + '/issue', { method: 'POST', signal });
        // Poll for about three minutes, then leave it to Check transaction.
        for (let check = 0; result.transactionStatus === 'PENDING' && check < 36; check++) {
          setProgress(`${count(issued)} issued. Waiting for Amoy to finalize the batch...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
          result = await api(base + '/issuance/check', { method: 'POST', signal });
        }
        await refreshList();
        if (result.transactionStatus === 'FAILED') throw new Error(`The batch transaction reverted, so none of its certificates were issued (${count(issued)} from earlier batches are saved). Resolve the cause before issuing again.`);
        if (result.transactionStatus !== 'CONFIRMED') return { ...result, message: `${count(issued)} issued. A batch is still confirming; use Check transaction before continuing.` };
        issued += result.issued;
      } while (result.remaining > 0);
      return { ...result, message: `${count(issued)} issued on Amoy.` };
    },
    onSettled: () => { setProgress(''); return refresh(); },
  });
  const check = useMutation({ mutationFn: () => api(base + '/issuance/check', { method: 'POST' }), onSuccess: refresh });
  const canIssue = !!faculty.data?.canIssue;
  const busy = disabled || prepare.isPending || issue.isPending || check.isPending || rename.isPending;
  const unissued = certificate => ['PENDING', 'FAILED'].includes(certificate.status) && certificate.transactionStatus !== 'PENDING';
  const ready = certificates.data?.filter(certificate => unissued(certificate) && certificate.attended && certificate.walletConnected) || [];
  const pending = certificates.data?.some(certificate => certificate.transactionStatus === 'PENDING');
  const outcome = issue.data || check.data;
  return <div>
    {mode === 'review' ? <>
      <p className="mb-2 text-ink-soft max-w-2xl">Check every name below: it is printed on the certificate exactly as shown, and students see the same name in their portal. Correct a name here before issuing; after issuance a correction needs revocation and a new certificate.</p>
      <p className="mb-5 text-sm text-ink-muted max-w-2xl">Prepare certificates once attendance is marked (importing a CSV prepares them automatically). Run it again after marking more attendees; existing numbers are kept. Students agreed to receive certificates when they linked their wallet, so there is no approval step. This does not mint or spend POL.</p>
      <div className="flex flex-wrap gap-3">
        <Btn variant="line" disabled={busy || !canIssue} onClick={() => prepare.mutate()}>{prepare.isPending ? 'Preparing...' : 'Prepare certificates'}</Btn>
        <Btn variant="ghost" icon="ph-arrows-clockwise" disabled={busy || certificates.isFetching} onClick={() => certificates.refetch()}>Refresh list</Btn>
      </div>
      {faculty.error && <p role="alert" className="mt-3 text-sm text-revoked">{faculty.error.message}</p>}
      {faculty.data && !canIssue && <p className="mt-3 text-sm text-ink-soft">Your faculty account needs issuance permission to prepare certificates or correct names.</p>}
      {prepare.error && <p role="alert" className="mt-4 text-sm text-revoked">{prepare.error.message}</p>}
      {prepare.data && <p role="status" className="mt-4 text-sm text-verified">{prepare.data.prepared} certificates prepared; {prepare.data.alreadyPrepared} attendees already have certificate records; {prepare.data.awaitingWallet} attendees need wallet setup.</p>}
    </> : <div className="rounded-2xl border border-[var(--line)] bg-paper p-5 space-y-3">
      <p className="font-serif text-4xl font-medium leading-none">{ready.length}</p>
      <p className="eyebrow">Ready to issue</p>
      <p className="text-sm text-ink-soft">Every confirmed attendee with a linked wallet is issued together: one transaction stores the batch's Merkle root and mints its tokens. Large seminars are sent as several batches. The issuer wallet pays Amoy POL for each transaction.</p>
      {pending && <p className="text-sm text-pending">A batch transaction is confirming. Check it before issuing more certificates.</p>}
      {pending && <Btn variant="line" size="sm" disabled={busy || !canIssue} onClick={() => { issue.reset(); check.mutate(); }}>{check.isPending ? 'Checking...' : 'Check transaction'}</Btn>}
      {reviewingIssuance ? <div role="alert" className="rounded-xl p-4 text-sm space-y-3" style={{ background: '#fbf1dc', border: '1px solid #ecd5a2', color: '#8a5508' }}>
        <p className="font-medium"><i className="ph-fill ph-warning mr-1" aria-hidden="true"></i>Issue {count(ready.length)} on Polygon Amoy? Issued details cannot be edited; a correction needs revocation and a new certificate. Leaving the page stops the remaining batches, but a submitted transaction can still finish.</p>
        <div className="flex flex-wrap gap-3"><Btn icon="ph-stamp" disabled={busy || pending || !ready.length || !canIssue} onClick={() => issue.mutate()}>Confirm issuance on Amoy</Btn><Btn variant="line" disabled={busy} onClick={() => setReviewingIssuance(false)}>Cancel</Btn></div>
      </div> : <Btn icon="ph-stamp" disabled={busy || pending || !ready.length || !canIssue || certificates.isFetching} onClick={() => { issue.reset(); check.reset(); setReviewingIssuance(true); }}>Issue {count(ready.length)}</Btn>}
      {progress && <p role="status" className="text-sm">{progress}</p>}
      {issue.error && <p role="alert" className="text-sm text-revoked">{issue.error.message}</p>}
      {issue.data && <p role="status" className="text-sm text-verified">{issue.data.message}</p>}
      {check.error && <p role="alert" className="text-sm text-revoked">{check.error.message}</p>}
      {check.data && <p role="status" className="text-sm">{check.data.warning || (check.data.transactionStatus === 'CONFIRMED' ? `Batch confirmed: ${count(check.data.issued)} issued.` : check.data.transactionStatus === 'FAILED' ? 'The batch transaction reverted. Its certificates can be issued again after resolving the cause.' : check.data.transactionStatus === 'PENDING' ? 'Transaction is pending. Check again shortly.' : 'No transaction is pending.')}</p>}
      {outcome?.skipped?.length > 0 && <div className="text-sm text-ink-soft">
        <p className="font-medium">Not issued ({outcome.skipped.length}):</p>
        <ul className="mt-1 max-h-40 list-disc space-y-0.5 overflow-auto pl-5">
          {outcome.skipped.map(skipped => <li key={skipped.certificateNo}>No. {skipped.certificateNo}, {skipped.recipientName}: {skipped.reason}</li>)}
        </ul>
      </div>}
    </div>}
    {certificates.isPending ? <p role="status" className="mt-4">Loading certificates...</p> : certificates.error ? <p role="alert" className="mt-4 text-sm text-revoked">{certificates.error.message}</p> : !certificates.data.length ? <p className="mt-4 text-sm text-ink-soft">No certificates prepared yet.</p> : <div className="mt-5 overflow-x-auto rounded-xl border border-[var(--line)]">
      <table className="w-full min-w-[500px] text-left text-sm">
        <caption className="sr-only">Prepared certificates: the name printed on each and its progress</caption>
        <thead className="bg-paper-2"><tr><th scope="col" className="p-3">Number</th><th scope="col" className="p-3">Name on certificate</th><th scope="col" className="p-3">Progress</th></tr></thead>
        <tbody>{certificates.data.map(certificate => <tr key={certificate.certificateID} className="border-t border-[var(--line)]">
          <td className="p-3 font-mono">{certificate.certificateNo}</td>
          <td className="p-3">
            {editing?.id === certificate.certificateID ? <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); if (!busy) rename.mutate(editing); }}>
              <label htmlFor={`recipient-name-${certificate.certificateID}`} className="sr-only">Name on certificate No. {certificate.certificateNo}</label>
              <input id={`recipient-name-${certificate.certificateID}`} className="field !py-1.5 !text-sm min-w-0 flex-1" required maxLength={255} autoComplete="off" autoFocus
                value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} />
              <Btn type="submit" size="sm" disabled={busy}>{rename.isPending ? 'Saving...' : 'Save'}</Btn>
              <Btn type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(null)}>Cancel</Btn>
              {rename.error && <p role="alert" className="w-full text-xs text-revoked">{rename.error.message}</p>}
            </form> : <>
              {certificate.recipientName}
              <span className="block break-all text-xs text-ink-soft">{certificate.email}</span>
              {mode === 'review' && canIssue && unissued(certificate) && <Btn variant="ghost" size="sm" icon="ph-pencil-simple" className="mt-1" disabled={busy}
                aria-label={`Correct the name on certificate No. ${certificate.certificateNo}`}
                onClick={() => { rename.reset(); setEditing({ id: certificate.certificateID, name: certificate.recipientName }); }}>Correct name</Btn>}
            </>}
          </td>
          <td className="p-3">
            {certificateProgress(certificate)}
            {certificate.tokenID && <span className="mt-1 block text-xs">Token #{certificate.tokenID}</span>}
            {certificate.transactionHash && <a className="mt-1 block text-xs text-forest underline" href={`https://amoy.polygonscan.com/tx/${certificate.transactionHash}`} target="_blank" rel="noreferrer">View transaction</a>}
            {certificate.status === 'ISSUED' && <a className="mt-1 block text-xs text-forest underline" href={`/verify?id=${certificate.certificateHash}`}>Verify certificate</a>}
          </td>
        </tr>)}</tbody>
      </table>
    </div>}
  </div>;
}

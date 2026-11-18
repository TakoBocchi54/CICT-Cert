import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn } from './design-system';
import { api } from '../lib/api';
import { useFacultyMe } from '../hooks/useFacultyMe';
import { certificateProgress } from '../lib/certificateProgress';
import { formatCertificateNo } from '../lib/certificateNumber';

const count = (n, noun = 'certificate') => `${n} ${noun}${n === 1 ? '' : 's'}`;

// mode 'review': prepare certificates and check the list (names can be corrected). mode 'issue': mint every ready certificate in batches.
// onDone: where the Done button goes once everything issuable is issued (issue mode). Issue/Done render into actionSlot, the wizard footer.
export default function CertificatePreparation({ seminarID, attendanceCount, disabled, mode, onDone, actionSlot }) {
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
  // Review step, before Prepare: list the attendees who will get a certificate (same table, numbers still blank).
  const attendees = useQuery({
    queryKey: ['seminar-attendees', seminarID, attendanceCount], // the count changes as people are checked in
    queryFn: async () => (await api(`/api/faculty/seminars/${seminarID}/registrations`)).filter(row => row.attended).map(row => ({
      certificateID: 'attendee-' + row.studentID, certificateNo: '', recipientName: row.fullName, email: row.email,
      attended: true, walletConnected: row.walletConnected, preview: true })),
    enabled: mode === 'review' && certificates.data?.length === 0,
    retry: false, refetchOnWindowFocus: false,
  });
  const rows = certificates.data?.length ? certificates.data : attendees.data || [];
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
  // Nothing left to issue and nothing in flight: the seminar is finished (those still without a wallet can't be issued yet).
  const done = !ready.length && !pending && !issue.isPending && !!certificates.data?.some(certificate => certificate.status === 'ISSUED');
  // Issue mode fills the step panel so its actions sit at the bottom, just above the wizard's Back button.
  return <div className={mode === 'issue' ? 'flex flex-1 flex-col' : undefined}>
    {mode === 'review' ? <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h2 className="font-serif text-2xl font-medium">Names on certificates</h2>
        <p className="mt-1 text-sm text-ink-muted">Printed exactly as shown. Correct any name before issuing.</p>
      </div>
      {rows.length > 0 && <p className="text-sm text-ink-soft tabular-nums">{rows[0].preview ? `${rows.length} attended` : count(rows.length)}</p>}
    </div> : <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h2 className="font-serif text-2xl font-medium">Certificates to issue</h2>
        <p className="mt-1 text-sm text-ink-muted">Minted on Polygon Amoy in batches. The issuer wallet pays the gas.</p>
      </div>
      <p className="text-sm text-ink-soft tabular-nums">{ready.length} ready</p>
    </div>}
    {certificates.isPending ? <p role="status" className="mt-4">Loading certificates...</p> : certificates.error ? <p role="alert" className="mt-4 text-sm text-revoked">{certificates.error.message}</p> : !rows.length ? <p className="mt-4 rounded-xl border border-dashed border-[var(--line)] p-6 text-center text-sm text-ink-muted">
      No certificates prepared yet.{mode === 'review' ? ' Prepare them for everyone marked attended.' : ' Prepare them in the Review step.'}</p> : <div className="mt-4 max-h-[480px] overflow-auto rounded-xl border border-[var(--line)]">
      <table className="w-full min-w-[500px] text-left text-sm">
        <caption className="sr-only">Prepared certificates: the name printed on each and its progress</caption>
        <thead className="sticky top-0 z-10 bg-table-head shadow-[inset_0_-1px_0_var(--line)]"><tr>{['No.', 'Name on certificate', 'Progress'].map(head =>
          <th key={head} scope="col" className="eyebrow px-4 py-3 font-semibold">{head}</th>)}</tr></thead>
        <tbody className="divide-y divide-[var(--line)]">{rows.map(certificate => <tr key={certificate.certificateID} className="align-top hover:bg-paper">
          <td className="px-4 py-3 font-mono">{formatCertificateNo(certificate.certificateNo, certificate.seminarDate)}</td>
          <td className="px-4 py-3">
            {editing?.id === certificate.certificateID ? <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); if (!busy) rename.mutate(editing); }}>
              <label htmlFor={`recipient-name-${certificate.certificateID}`} className="sr-only">Name on certificate {formatCertificateNo(certificate.certificateNo, certificate.seminarDate)}</label>
              <input id={`recipient-name-${certificate.certificateID}`} className="field !py-1.5 !text-sm min-w-0 flex-1" required maxLength={255} autoComplete="off" autoFocus
                value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} />
              <Btn type="submit" size="sm" disabled={busy}>{rename.isPending ? 'Saving...' : 'Save'}</Btn>
              <Btn type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(null)}>Cancel</Btn>
              {rename.error && <p role="alert" className="w-full text-xs text-revoked">{rename.error.message}</p>}
            </form> : <>
              {certificate.recipientName}
              <span className="block break-all text-xs text-ink-soft">{certificate.email}</span>
              {mode === 'review' && canIssue && unissued(certificate) && <Btn variant="ghost" size="sm" icon="ph-pencil-simple" className="mt-1" disabled={busy}
                aria-label={`Correct the name on certificate ${formatCertificateNo(certificate.certificateNo, certificate.seminarDate)}`}
                onClick={() => { rename.reset(); setEditing({ id: certificate.certificateID, name: certificate.recipientName }); }}>Correct name</Btn>}
            </>}
          </td>
          <td className="px-4 py-3">
            {certificate.preview ? `Not prepared${certificate.walletConnected ? '' : '; awaiting wallet setup'}` : certificateProgress(certificate)}
            {certificate.tokenID && <span className="mt-1 block text-xs">Token #{certificate.tokenID}</span>}
            {certificate.transactionHash && <a className="mt-1 block text-xs text-forest underline" href={`https://amoy.polygonscan.com/tx/${certificate.transactionHash}`} target="_blank" rel="noreferrer">View transaction</a>}
            {certificate.status === 'ISSUED' && <a className="mt-1 block text-xs text-forest underline" href={`/verify?id=${certificate.certificateHash}`}>Verify certificate</a>}
          </td>
        </tr>)}</tbody>
      </table>
    </div>}
    {mode === 'issue' && <div className="mt-auto space-y-3 pt-6">
      {pending && <div className="flex flex-wrap items-center gap-3 rounded-xl bg-pending-bg px-4 py-3 text-sm text-pending">
        <i className="ph-bold ph-hourglass-medium text-base" aria-hidden="true"></i>
        <span className="flex-1">A batch is confirming. Check it before issuing more.</span>
        <Btn variant="line" size="sm" disabled={busy || !canIssue} onClick={() => { issue.reset(); check.mutate(); }}>{check.isPending ? 'Checking...' : 'Check transaction'}</Btn>
      </div>}
      {reviewingIssuance && <IssueConfirmDialog total={ready.length} disabled={busy || pending || !ready.length || !canIssue}
        onConfirm={() => issue.mutate()} onClose={() => setReviewingIssuance(false)} />}
      <div className="flex flex-wrap items-center gap-3">
        {/* Issue, then Done once nothing is left, sit at the right of the wizard footer. */}
        {actionSlot && createPortal(done ? <Btn icon="ph-check" onClick={onDone}>Done</Btn>
          : <Btn icon="ph-stamp" disabled={busy || pending || !ready.length || !canIssue || certificates.isFetching} onClick={() => { issue.reset(); check.reset(); setReviewingIssuance(true); }}>
            {issue.isPending ? 'Issuing...' : `Issue ${count(ready.length)}`}</Btn>, actionSlot)}
        <Btn variant="ghost" icon="ph-arrows-clockwise" disabled={busy || certificates.isFetching} onClick={() => certificates.refetch()}>Refresh</Btn>
      </div>
      {faculty.data && !canIssue && <p className="text-sm text-ink-soft">You need issuance permission to issue certificates.</p>}
      {progress && <p role="status" className="flex items-center gap-2 text-sm"><i className="ph-bold ph-circle-notch animate-spin" aria-hidden="true"></i>{progress}</p>}
      {issue.error && <p role="alert" className="text-sm text-revoked">{issue.error.message}</p>}
      {issue.data && <p role="status" className="text-sm text-verified">{issue.data.message}</p>}
      {check.error && <p role="alert" className="text-sm text-revoked">{check.error.message}</p>}
      {check.data && <p role="status" className="text-sm">{check.data.warning || (check.data.transactionStatus === 'CONFIRMED' ? `Batch confirmed: ${count(check.data.issued)} issued.` : check.data.transactionStatus === 'FAILED' ? 'The batch transaction reverted. Its certificates can be issued again after resolving the cause.' : check.data.transactionStatus === 'PENDING' ? 'Transaction is pending. Check again shortly.' : 'No transaction is pending.')}</p>}
      {outcome?.skipped?.length > 0 && <div className="text-sm text-ink-soft">
        <p className="font-medium">Not issued ({outcome.skipped.length}):</p>
        <ul className="mt-1 max-h-40 list-disc space-y-0.5 overflow-auto pl-5">
          {outcome.skipped.map(skipped => <li key={skipped.certificateNo}>{formatCertificateNo(skipped.certificateNo, skipped.seminarDate)}, {skipped.recipientName}: {skipped.reason}</li>)}
        </ul>
      </div>}
    </div>}
    {mode === 'review' && <>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Btn variant={certificates.data?.length ? 'line' : 'primary'} icon="ph-stack" disabled={busy || !canIssue} onClick={() => prepare.mutate()}
          title="Creates a numbered certificate for each attendee. Run again after marking more attendees; nothing is minted.">
          {prepare.isPending ? 'Preparing...' : 'Prepare certificates'}</Btn>
        <Btn variant="ghost" icon="ph-arrows-clockwise" disabled={busy || certificates.isFetching} onClick={() => certificates.refetch()}>Refresh</Btn>
      </div>
      {faculty.error && <p role="alert" className="mt-3 text-sm text-revoked">{faculty.error.message}</p>}
      {faculty.data && !canIssue && <p className="mt-3 text-sm text-ink-soft">You need issuance permission to prepare certificates or correct names.</p>}
      {prepare.error && <p role="alert" className="mt-3 text-sm text-revoked">{prepare.error.message}</p>}
      {prepare.data && <p role="status" className="mt-3 text-sm text-verified">
        {count(prepare.data.prepared)} prepared{prepare.data.awaitingWallet > 0 && ` · ${prepare.data.awaitingWallet} attendee${prepare.data.awaitingWallet === 1 ? '' : 's'} still need a wallet`}.</p>}
    </>}
  </div>;
}

// The short "are you sure" before minting, as a modal like the app's other dialogs.
function IssueConfirmDialog({ total, disabled, onConfirm, onClose }) {
  const dialog = useRef(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  return createPortal(
    <dialog ref={dialog} aria-labelledby="issue-confirm-title" aria-describedby="issue-confirm-text"
      onCancel={event => { event.preventDefault(); onClose(); }}
      className="pop m-auto w-[calc(100%_-_2rem)] max-w-md rounded-2xl border border-paper-3 bg-paper p-0 text-ink shadow-xl backdrop:bg-[rgba(22,35,29,.45)] backdrop:backdrop-blur-sm">
      <div className="p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-forest text-xl text-white shadow" aria-hidden="true">
            <i className="ph-bold ph-stamp"></i>
          </span>
          <button type="button" onClick={onClose} aria-label="Close"
            className="-mr-2 -mt-1 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-black/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest">
            <i className="ph-bold ph-x" aria-hidden="true"></i>
          </button>
        </div>
        <p className="eyebrow mt-5">Final step</p>
        <h2 id="issue-confirm-title" className="mt-1 font-serif text-3xl font-medium leading-tight">Issue {count(total)}?</h2>
        <p id="issue-confirm-text" className="mt-2 text-sm text-ink-soft">Once issued, certificates can't be edited.</p>
        <dl className="mt-5 grid grid-cols-2 divide-x divide-[var(--line)] rounded-xl border border-[var(--line)] bg-paper-2">
          <div className="px-4 py-3"><dt className="eyebrow">Certificates</dt><dd className="mt-1 font-serif text-2xl tabular-nums">{total}</dd></div>
          <div className="px-4 py-3"><dt className="eyebrow">Network</dt><dd className="mt-1 flex items-center gap-1.5 pt-1.5 text-sm font-semibold">
            <i className="ph-bold ph-link-simple text-forest" aria-hidden="true"></i>Polygon Amoy</dd></div>
        </dl>
        <p className="mt-4 flex items-center gap-2 rounded-xl bg-pending-bg px-3 py-2 text-xs font-medium text-ink-soft">
          <i className="ph-bold ph-info text-sm text-pending" aria-hidden="true"></i>Keep this page open until it finishes.</p>
        <div className="mt-6 flex gap-3">
          <Btn type="button" variant="line" className="flex-1" onClick={onClose}>Cancel</Btn>
          <Btn type="button" icon="ph-stamp" className="flex-1" disabled={disabled} onClick={onConfirm}>Issue now</Btn>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}

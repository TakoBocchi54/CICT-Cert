import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Seal, Pill, Btn } from '../components/design-system';
import { api } from '../lib/api';
import { useFacultyMe } from '../hooks/useFacultyMe';

const MAX_REASON = 500;
const fmt = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
const fmtTime = (value) => new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const txLink = (hash) => `https://amoy.polygonscan.com/tx/${hash}`;

function sealStatus(certificate) {
  if (certificate.status === 'REVOKED') return 'Revoked';
  if (certificate.revocation.transactionStatus === 'PENDING') return 'Pending';
  return certificate.status === 'ISSUED' ? 'Verified' : 'Invalid';
}

function resultMessage(result) {
  if (result.warning) return result.warning;
  if (result.status === 'REVOKED') return 'Revocation confirmed on Amoy. Public verification now shows this certificate as revoked.';
  if (result.transactionStatus === 'FAILED') return 'The revocation transaction reverted. The certificate is still valid; check the cause before retrying.';
  return 'Revocation submitted. It is confirmed only after the block is finalized; check the transaction again shortly.';
}

const TONES = {
  info: 'bg-paper-2 text-ink-soft',
  pending: 'bg-pending-bg text-pending',
  success: 'bg-verified-bg text-verified',
  danger: 'bg-revoked-bg text-revoked',
};
// Tinted status line; the icon repeats the meaning so it doesn't rely on color alone.
const Note = ({ tone = 'info', icon, role, children }) => (
  <div role={role} className={'flex items-start gap-3 rounded-xl px-4 py-3 text-sm ' + TONES[tone]}>
    <i className={'ph-bold mt-0.5 shrink-0 text-base ' + icon} aria-hidden="true"></i>
    <div className="min-w-0 flex-1">{children}</div>
  </div>
);

// Native modal dialog: traps focus and closes on Escape (unless an action is running).
function Modal({ labelledBy, busy, onClose, children }) {
  const dialog = useRef(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  return createPortal(
    <dialog ref={dialog} aria-labelledby={labelledBy} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
      onClick={event => { if (event.target === dialog.current && !busy) onClose(); }}
      className="m-auto max-h-[90vh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border border-paper-3 bg-paper p-0 text-ink shadow-xl backdrop:bg-[rgba(22,35,29,.45)] backdrop:backdrop-blur-sm">
      <div className="relative p-6 sm:p-8">
        <button type="button" aria-label="Close" disabled={busy} onClick={onClose}
          className="absolute right-4 top-4 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-black/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest disabled:cursor-not-allowed disabled:opacity-40">
          <i className="ph-bold ph-x" aria-hidden="true"></i>
        </button>
        {children}
      </div>
    </dialog>,
    document.body,
  );
}

export default function RevocationPage({ initialNo = '', onBack }) {
  const queryClient = useQueryClient();
  const faculty = useFacultyMe();
  // Opened from a Registry row's Revoke/Details with ?no=.
  const [certificateNo, setCertificateNo] = useState(/^[1-9]\d{0,18}$/.test(initialNo) ? initialNo : null);
  const [showModal, setShowModal] = useState(false);
  const [reason, setReason] = useState('');
  // Corrected facts for a replacement; the replacement dialog is open while this is set.
  const [facts, setFacts] = useState(null);

  const lookup = useQuery({
    queryKey: ['faculty-certificate', certificateNo],
    queryFn: ({ signal }) => api(`/api/faculty/certificates/${certificateNo}`, { signal }),
    enabled: !!certificateNo, retry: false, refetchOnWindowFocus: false,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['faculty-certificate', certificateNo] });
  const revoke = useMutation({
    mutationFn: () => api(`/api/faculty/certificates/${certificateNo}/revoke`, { method: 'POST', body: { reason: reason.trim() } }),
    onSuccess: () => setShowModal(false),
    onSettled: refresh,
  });
  const replace = useMutation({
    mutationFn: () => api(`/api/faculty/certificates/${certificateNo}/replacement`, { method: 'POST', body: {
      recipientName: facts.recipientName.trim(), seminarTitle: facts.seminarTitle.trim(), seminarDate: facts.seminarDate } }),
    onSuccess: () => setFacts(null),
    onSettled: refresh,
  });
  const check = useMutation({
    mutationFn: () => api(`/api/faculty/certificates/${certificateNo}/revocation/check`, { method: 'POST' }),
    onSettled: refresh,
  });

  const openCertificate = (number) => { revoke.reset(); check.reset(); replace.reset(); setCertificateNo(String(number)); };

  const found = lookup.data;
  const revocation = found?.revocation;
  const busy = revoke.isPending || check.isPending || replace.isPending;
  const canIssue = !!faculty.data?.canIssue;
  const canRevoke = found?.status === 'ISSUED' && revocation.transactionStatus !== 'PENDING' && canIssue;
  const outcome = check.data || revoke.data;
  const failure = check.error || revoke.error;
  const trimmedReason = reason.trim();
  const factsComplete = facts && facts.recipientName.trim() && facts.seminarTitle.trim() && facts.seminarDate;
  const canReplace = found?.status === 'REVOKED' && !found.replacement && canIssue;

  return (
    <div className="mx-auto max-w-2xl pb-16">
      {onBack && <button type="button" onClick={onBack}
        className="mb-6 inline-flex cursor-pointer items-center gap-1.5 rounded-lg text-sm font-medium text-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest">
        <i className="ph-bold ph-arrow-left" aria-hidden="true"></i>Back to registry
      </button>}

      <div className="mb-8 text-center">
        <div className="eyebrow mb-3 rise">Registry</div>
        <h1 className="font-serif text-5xl md:text-6xl font-medium leading-[1.02] rise" style={{ '--d': '.05s' }}>Revocations</h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-ink-soft rise" style={{ '--d': '.1s' }}>
          Invalidate an issued certificate on Polygon Amoy, or prepare a corrected replacement for a revoked one.
        </p>
      </div>

      {!certificateNo ? (
        <Note icon="ph-info">Pick a certificate in the Registry and choose Revoke or Details to open it here.</Note>
      ) : lookup.isPending ? (
        <div role="status" className="sheet flex items-center justify-center gap-3 p-12 text-sm text-ink-soft">
          <i className="ph-bold ph-circle-notch animate-spin text-lg" aria-hidden="true"></i>Looking up certificate No. {certificateNo}...
        </div>
      ) : lookup.error ? (
        <Note tone="danger" icon="ph-warning-circle" role="alert">{lookup.error.message}</Note>
      ) : (
        <article className="sheet overflow-hidden pop" aria-labelledby="found-title">
          <header className="flex flex-col items-center border-b border-[var(--line)] px-6 pb-6 pt-8 text-center">
            <Seal status={sealStatus(found)} size={76} />
            {sealStatus(found) !== 'Invalid' && <div className="mt-4"><Pill status={sealStatus(found)} /></div>}
            <h2 id="found-title" className="mt-3 break-words font-serif text-3xl font-medium leading-tight">{found.recipientName}</h2>
            <p className="mt-1 break-words text-ink-soft">{found.seminarTitle}</p>
          </header>

          <div className="space-y-5 p-6">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2.5 text-sm">
              <dt className="text-ink-muted">Certificate no.</dt><dd className="font-mono">{found.certificateNo}</dd>
              {found.tokenID && <><dt className="text-ink-muted">Token ID</dt><dd className="font-mono">#{found.tokenID}</dd></>}
              <dt className="text-ink-muted">Seminar date</dt><dd>{fmt(found.seminarDate)}</dd>
              {found.walletAddress && <><dt className="text-ink-muted">Recipient wallet</dt><dd className="break-all font-mono text-xs leading-5">{found.walletAddress}</dd></>}
              {found.issuedAt && <><dt className="text-ink-muted">Issued</dt><dd>{fmtTime(found.issuedAt)}</dd></>}
              {found.revokedAt && <><dt className="text-ink-muted">Revoked</dt><dd>{fmtTime(found.revokedAt)}</dd></>}
              {revocation.reason && <><dt className="text-ink-muted">Reason</dt><dd className="break-words">{revocation.reason}</dd></>}
            </dl>

            {(found.mintTransactionHash || revocation.transactionHash || (found.certificateHash && ['ISSUED', 'REVOKED'].includes(found.status))) && (
              <div className="flex flex-wrap gap-2">
                {found.mintTransactionHash && <a className="btn btn-line btn-sm" href={txLink(found.mintTransactionHash)} target="_blank" rel="noreferrer">
                  Mint transaction<i className="ph-bold ph-arrow-up-right" aria-hidden="true"></i><span className="sr-only">(opens Polygonscan in a new tab)</span></a>}
                {revocation.transactionHash && <a className="btn btn-line btn-sm" href={txLink(revocation.transactionHash)} target="_blank" rel="noreferrer">
                  Revocation transaction<i className="ph-bold ph-arrow-up-right" aria-hidden="true"></i><span className="sr-only">(opens Polygonscan in a new tab)</span></a>}
                {found.certificateHash && ['ISSUED', 'REVOKED'].includes(found.status) && <a className="btn btn-line btn-sm" href={`/verify?id=${found.certificateHash}`}>
                  <i className="ph-bold ph-seal-check" aria-hidden="true"></i>Public verification</a>}
              </div>
            )}

            {(found.status !== 'ISSUED' && found.status !== 'REVOKED') && (
              <Note icon="ph-info">Only issued certificates can be revoked. This certificate is {found.status.toLowerCase()}.</Note>
            )}
            {found.status === 'ISSUED' && revocation.transactionStatus === 'PENDING' && (
              <Note tone="pending" icon="ph-hourglass-medium">
                <p>A revocation transaction is pending. The certificate stays valid until it is finalized.</p>
                <Btn variant="line" size="sm" className="mt-3" disabled={busy || !canIssue} onClick={() => check.mutate()}>
                  {check.isPending ? 'Checking...' : 'Check transaction'}
                </Btn>
              </Note>
            )}
            {found.status === 'ISSUED' && revocation.transactionStatus === 'FAILED' && !outcome && (
              <Note icon="ph-arrow-counter-clockwise">The last revocation attempt reverted. The certificate is still valid and can be revoked again.</Note>
            )}
            {found.status === 'ISSUED' && faculty.data && !canIssue && (
              <Note icon="ph-lock-simple">Your faculty account needs issuance permission to revoke certificates.</Note>
            )}
            {found.status === 'REVOKED' && found.replacement && (
              <Note icon="ph-arrows-clockwise">
                <p>Replaced by certificate No. {found.replacement.certificateNo} ({found.replacement.status.toLowerCase()}).</p>
                <Btn variant="line" size="sm" className="mt-3" onClick={() => openCertificate(found.replacement.certificateNo)}>Open No. {found.replacement.certificateNo}</Btn>
              </Note>
            )}
            {replace.data && (
              <Note tone="success" icon="ph-check-circle" role="status">
                Replacement certificate No. {replace.data.certificateNo} prepared. Issue it from the seminar's Issue step; it goes out in a new batch.
              </Note>
            )}
            {outcome && !failure && <Note tone={outcome.status === 'REVOKED' ? 'success' : outcome.transactionStatus === 'FAILED' ? 'danger' : 'pending'}
              icon={outcome.status === 'REVOKED' ? 'ph-check-circle' : outcome.transactionStatus === 'FAILED' ? 'ph-warning-circle' : 'ph-hourglass-medium'} role="status">
              {resultMessage(outcome)}</Note>}
            {failure && !showModal && <Note tone="danger" icon="ph-warning-circle" role="alert">{failure.message}</Note>}
          </div>

          {(canRevoke || canReplace) && (
            <footer className={'border-t px-6 py-5 ' + (canRevoke ? 'border-[#f0c4bf] bg-revoked-bg/40' : 'border-[var(--line)] bg-paper-2/60')}>
              {canRevoke ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-ink-soft">Revoking is permanent. A corrected certificate needs a new number.</p>
                  <Btn variant="danger" icon="ph-seal-warning" className="shrink-0" disabled={busy}
                    onClick={() => { revoke.reset(); check.reset(); setReason(''); setShowModal(true); }}>Revoke certificate</Btn>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-ink-soft">To correct this certificate, prepare a replacement with a new certificate number.</p>
                  <Btn icon="ph-arrows-clockwise" className="shrink-0" disabled={busy}
                    onClick={() => { replace.reset(); setFacts({ recipientName: found.recipientName, seminarTitle: found.seminarTitle, seminarDate: found.seminarDate }); }}>
                    Prepare replacement
                  </Btn>
                </div>
              )}
            </footer>
          )}
        </article>
      )}

      {showModal && found && (
        <Modal labelledBy="revoke-title" busy={busy} onClose={() => setShowModal(false)}>
          <div className="mb-4 flex justify-center"><Seal status="Revoked" size={72} /></div>
          <h2 id="revoke-title" className="text-center font-serif text-3xl font-medium">Revoke this certificate?</h2>
          <p className="mt-2 break-words text-center text-sm text-ink-soft">
            {found.recipientName} · {found.seminarTitle} · {fmt(found.seminarDate)}
            <br />
            <span className="font-mono text-xs">No. {found.certificateNo} · Token #{found.tokenID}</span>
          </p>
          <div className="my-5">
            <Note tone="danger" icon="ph-warning">
              This sends an issuer-only transaction on Polygon Amoy and can't be undone. A corrected certificate needs a new certificate number.
            </Note>
          </div>
          <label htmlFor="revocation-reason" className="eyebrow mb-2 block">Reason <span className="text-revoked" aria-hidden="true">*</span></label>
          <textarea id="revocation-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={MAX_REASON} rows={3} required autoFocus
            aria-describedby="revocation-reason-hint" className="field" placeholder="e.g. Recipient name misspelled" />
          <p id="revocation-reason-hint" className="mt-1.5 mb-5 flex justify-between gap-3 text-xs text-ink-muted">
            <span>Saved in CICT records, not on-chain.</span><span>{reason.length}/{MAX_REASON}</span>
          </p>
          {revoke.error && <div className="mb-4"><Note tone="danger" icon="ph-warning-circle" role="alert">{revoke.error.message}</Note></div>}
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <Btn variant="line" className="flex-1" disabled={busy} onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="danger" className="flex-1" disabled={busy || !trimmedReason} onClick={() => revoke.mutate()}>
              {revoke.isPending ? 'Submitting...' : 'Confirm revocation on Amoy'}
            </Btn>
          </div>
        </Modal>
      )}

      {facts && found && (
        <Modal labelledBy="replace-title" busy={busy} onClose={() => setFacts(null)}>
          <h2 id="replace-title" className="pr-10 font-serif text-3xl font-medium">Prepare replacement</h2>
          <p className="mt-2 mb-5 text-sm text-ink-soft">
            Replaces revoked certificate No. {found.certificateNo}. Correct the details below; they are saved only on the new certificate, which gets a new number.
            It is issued in a new batch from the seminar's Issue step.
          </p>
          <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (!busy && factsComplete) replace.mutate(); }}>
            <div>
              <label htmlFor="replacement-name" className="eyebrow mb-2 block">Recipient name</label>
              <input id="replacement-name" className="field" maxLength={255} required autoFocus value={facts.recipientName}
                onChange={e => setFacts({ ...facts, recipientName: e.target.value })} />
            </div>
            <div>
              <label htmlFor="replacement-title" className="eyebrow mb-2 block">Seminar title</label>
              <input id="replacement-title" className="field" maxLength={255} required value={facts.seminarTitle}
                onChange={e => setFacts({ ...facts, seminarTitle: e.target.value })} />
            </div>
            <div>
              <label htmlFor="replacement-date" className="eyebrow mb-2 block">Seminar date</label>
              <input id="replacement-date" type="date" className="field" required value={facts.seminarDate}
                onChange={e => setFacts({ ...facts, seminarDate: e.target.value })} />
            </div>
            {replace.error && <Note tone="danger" icon="ph-warning-circle" role="alert">{replace.error.message}</Note>}
            <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row">
              <Btn type="button" variant="line" className="flex-1" disabled={busy} onClick={() => setFacts(null)}>Cancel</Btn>
              <Btn type="submit" className="flex-1" disabled={busy || !factsComplete}>{replace.isPending ? 'Preparing...' : 'Prepare replacement'}</Btn>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

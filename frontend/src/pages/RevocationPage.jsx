import { useState } from 'react';
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

export default function RevocationPage({ initialNo = '' }) {
  const queryClient = useQueryClient();
  const faculty = useFacultyMe();
  const [query, setQuery] = useState(initialNo);
  // Opened from the Registry with ?no=: look that certificate up straight away.
  const [certificateNo, setCertificateNo] = useState(/^[1-9]\d{0,18}$/.test(initialNo) ? initialNo : null);
  const [invalidQuery, setInvalidQuery] = useState(false);
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

  const lookUp = (value) => {
    const valid = /^[1-9]\d{0,18}$/.test(value);
    revoke.reset(); check.reset(); replace.reset();
    setInvalidQuery(!valid);
    setCertificateNo(valid ? value : null);
  };
  const search = (event) => {
    event.preventDefault();
    lookUp(query.trim().replace(/^#/, ''));
  };
  const openCertificate = (number) => { setQuery(number); lookUp(number); };

  const found = lookup.data;
  const revocation = found?.revocation;
  const busy = revoke.isPending || check.isPending || replace.isPending;
  const canIssue = !!faculty.data?.canIssue;
  const canRevoke = found?.status === 'ISSUED' && revocation.transactionStatus !== 'PENDING' && canIssue;
  const outcome = check.data || revoke.data;
  const failure = check.error || revoke.error;
  const trimmedReason = reason.trim();
  const factsComplete = facts && facts.recipientName.trim() && facts.seminarTitle.trim() && facts.seminarDate;

  return (
    <div>
      {/* Page Header */}
      <div className="mb-10">
        <div className="eyebrow mb-3 rise">Governance</div>
        <h1 className="font-serif text-5xl md:text-6xl font-medium leading-[1.02] rise" style={{ '--d': '.05s' }}>
          Revocations
        </h1>
        <p className="text-ink-soft text-lg mt-4 max-w-xl rise" style={{ '--d': '.1s' }}>
          Invalidate an issued certificate on Polygon Amoy. Public verification shows it as revoked once the transaction is finalized.
        </p>
      </div>

      <section className="sheet p-8 max-w-3xl">
        <form onSubmit={search}>
          <label htmlFor="certificate-number" className="eyebrow block mb-3">Find a certificate by number</label>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              id="certificate-number"
              value={query}
              onChange={e => setQuery(e.target.value)}
              inputMode="numeric"
              className="field font-mono !py-4 !text-base flex-1"
              placeholder="e.g. 1024"
            />
            <Btn type="submit" disabled={!query.trim() || lookup.isFetching}>Find</Btn>
          </div>
        </form>

        <div className="mt-6 min-h-[170px]">
          {invalidQuery ? (
            <p role="alert" className="text-sm text-revoked">Certificate numbers contain digits only.</p>
          ) : !certificateNo ? (
            <p className="text-ink-muted text-sm">Enter the numeric certificate number shown on the certificate.</p>
          ) : lookup.isPending ? (
            <p role="status" className="text-sm">Looking up certificate...</p>
          ) : lookup.error ? (
            <p role="alert" className="text-sm text-revoked">{lookup.error.message}</p>
          ) : (
            <div className="rounded-2xl border border-[var(--line)] bg-paper p-6 pop">
              <div className="flex flex-col sm:flex-row sm:items-center gap-5">
                <Seal status={sealStatus(found)} size={72} />
                <div className="flex-1 min-w-0">
                  <div className="font-serif text-2xl font-medium leading-tight">{found.seminarTitle}</div>
                  <div className="text-sm text-ink-soft mt-1">{found.recipientName} · {fmt(found.seminarDate)}</div>
                  <div className="font-mono text-xs text-ink-muted mt-1">
                    No. {found.certificateNo}{found.tokenID && ` · Token #${found.tokenID}`}
                  </div>
                </div>
                {found.status === 'REVOKED' ? <Pill status="Revoked" /> : canRevoke && (
                  <Btn variant="danger" size="sm" disabled={busy} onClick={() => { revoke.reset(); check.reset(); setReason(''); setShowModal(true); }}>
                    Revoke
                  </Btn>
                )}
              </div>

              <dl className="mt-5 grid gap-2 text-sm">
                {found.walletAddress && <div><dt className="inline text-ink-muted">Recipient wallet: </dt><dd className="inline font-mono break-all">{found.walletAddress}</dd></div>}
                {found.issuedAt && <div><dt className="inline text-ink-muted">Issued: </dt><dd className="inline">{fmtTime(found.issuedAt)}</dd></div>}
                {found.revokedAt && <div><dt className="inline text-ink-muted">Revoked: </dt><dd className="inline">{fmtTime(found.revokedAt)}</dd></div>}
                {revocation.reason && <div><dt className="inline text-ink-muted">Revocation reason: </dt><dd className="inline">{revocation.reason}</dd></div>}
              </dl>

              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {found.mintTransactionHash && <a className="text-forest underline" href={txLink(found.mintTransactionHash)} target="_blank" rel="noreferrer">Mint transaction</a>}
                {revocation.transactionHash && <a className="text-forest underline" href={txLink(revocation.transactionHash)} target="_blank" rel="noreferrer">Revocation transaction</a>}
                {found.certificateHash && ['ISSUED', 'REVOKED'].includes(found.status) && <a className="text-forest underline" href={`/verify?id=${found.certificateHash}`}>Public verification</a>}
              </div>

              {found.status !== 'ISSUED' && found.status !== 'REVOKED' && (
                <p className="mt-4 text-sm text-ink-soft">Only issued certificates can be revoked. This certificate is {found.status.toLowerCase()}.</p>
              )}
              {found.status === 'ISSUED' && revocation.transactionStatus === 'PENDING' && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <p className="text-sm text-pending">A revocation transaction is pending. The certificate stays valid until it is finalized.</p>
                  <Btn variant="line" size="sm" disabled={busy || !canIssue} onClick={() => check.mutate()}>
                    {check.isPending ? 'Checking...' : 'Check transaction'}
                  </Btn>
                </div>
              )}
              {found.status === 'ISSUED' && revocation.transactionStatus === 'FAILED' && !outcome && (
                <p className="mt-4 text-sm text-ink-soft">The last revocation attempt reverted. The certificate is still valid and can be revoked again.</p>
              )}
              {found.status === 'ISSUED' && faculty.data && !canIssue && (
                <p className="mt-4 text-sm text-ink-soft">Your faculty account needs issuance permission to revoke certificates.</p>
              )}
              {found.status === 'REVOKED' && (found.replacement ? (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <p className="text-sm">Replaced by certificate No. {found.replacement.certificateNo} ({found.replacement.status.toLowerCase()}).</p>
                  <Btn variant="line" size="sm" onClick={() => openCertificate(found.replacement.certificateNo)}>Open No. {found.replacement.certificateNo}</Btn>
                </div>
              ) : canIssue && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <p className="text-sm text-ink-soft">To correct this certificate, prepare a replacement with a new certificate number.</p>
                  <Btn size="sm" disabled={busy} onClick={() => { replace.reset(); setFacts({ recipientName: found.recipientName, seminarTitle: found.seminarTitle, seminarDate: found.seminarDate }); }}>
                    Prepare replacement
                  </Btn>
                </div>
              ))}
              {replace.data && (
                <p role="status" className="mt-4 text-sm text-verified">
                  Replacement certificate No. {replace.data.certificateNo} prepared. The student must approve it in the portal; then issue it from the seminar's certificate list.
                </p>
              )}
              {outcome && !failure && <p role="status" className="mt-4 text-sm">{resultMessage(outcome)}</p>}
              {failure && !showModal && <p role="alert" className="mt-4 text-sm text-revoked">{failure.message}</p>}
            </div>
          )}
        </div>
      </section>

      {/* Revoke Modal */}
      {showModal && found && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(22,35,29,.45)', backdropFilter: 'blur(4px)' }}
          onClick={() => !busy && setShowModal(false)}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="revoke-title" className="sheet pop w-full max-w-lg p-8 relative" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              aria-label="Close"
              disabled={busy}
              onClick={() => setShowModal(false)}
              className="absolute top-4 right-4 w-9 h-9 rounded-full hover:bg-paper-2 flex items-center justify-center text-ink-muted"
            >
              <i className="ph-bold ph-x"></i>
            </button>
            <div className="flex justify-center mb-5">
              <Seal status="Revoked" size={80} />
            </div>
            <h3 id="revoke-title" className="font-serif text-3xl font-medium text-center">Revoke this certificate?</h3>
            <p className="text-center text-ink-soft text-sm mt-2 mb-4">
              {found.recipientName} · {found.seminarTitle} · {fmt(found.seminarDate)}
              <br />
              <span className="font-mono text-xs">No. {found.certificateNo} · Token #{found.tokenID}</span>
            </p>
            <p className="text-sm mb-5">
              This sends an issuer-only transaction on Polygon Amoy. Revocation cannot be undone; a corrected certificate needs a new certificate number.
            </p>
            <label htmlFor="revocation-reason" className="eyebrow block mb-2">Reason (saved in CICT records, not on-chain)</label>
            <textarea
              id="revocation-reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={MAX_REASON}
              rows={3}
              className="field mb-1"
              placeholder="e.g. Recipient name misspelled"
            />
            <p className="text-xs text-ink-muted mb-5">{reason.length}/{MAX_REASON}</p>
            {revoke.error && <p role="alert" className="mb-4 text-sm text-revoked">{revoke.error.message}</p>}
            <div className="flex gap-3">
              <Btn variant="line" className="flex-1" disabled={busy} onClick={() => setShowModal(false)}>
                Cancel
              </Btn>
              <Btn variant="danger" className="flex-1" disabled={busy || !trimmedReason} onClick={() => revoke.mutate()}>
                {revoke.isPending ? 'Submitting...' : 'Confirm revocation on Amoy'}
              </Btn>
            </div>
          </div>
        </div>
      )}

      {/* Replacement Modal */}
      {facts && found && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(22,35,29,.45)', backdropFilter: 'blur(4px)' }}
          onClick={() => !busy && setFacts(null)}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="replace-title" className="sheet pop w-full max-w-lg p-8 relative max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              aria-label="Close"
              disabled={busy}
              onClick={() => setFacts(null)}
              className="absolute top-4 right-4 w-9 h-9 rounded-full hover:bg-paper-2 flex items-center justify-center text-ink-muted"
            >
              <i className="ph-bold ph-x"></i>
            </button>
            <h3 id="replace-title" className="font-serif text-3xl font-medium">Prepare replacement</h3>
            <p className="text-sm text-ink-soft mt-2 mb-5">
              Replaces revoked certificate No. {found.certificateNo}. Correct the details below; they are saved only on the new certificate, which gets a new number.
              The student must approve it again before it can be issued.
            </p>
            <label htmlFor="replacement-name" className="eyebrow block mb-2">Recipient name</label>
            <input id="replacement-name" className="field mb-4" maxLength={255} value={facts.recipientName}
              onChange={e => setFacts({ ...facts, recipientName: e.target.value })} />
            <label htmlFor="replacement-title" className="eyebrow block mb-2">Seminar title</label>
            <input id="replacement-title" className="field mb-4" maxLength={255} value={facts.seminarTitle}
              onChange={e => setFacts({ ...facts, seminarTitle: e.target.value })} />
            <label htmlFor="replacement-date" className="eyebrow block mb-2">Seminar date</label>
            <input id="replacement-date" type="date" className="field mb-5" value={facts.seminarDate}
              onChange={e => setFacts({ ...facts, seminarDate: e.target.value })} />
            {replace.error && <p role="alert" className="mb-4 text-sm text-revoked">{replace.error.message}</p>}
            <div className="flex gap-3">
              <Btn variant="line" className="flex-1" disabled={busy} onClick={() => setFacts(null)}>
                Cancel
              </Btn>
              <Btn className="flex-1" disabled={busy || !factsComplete} onClick={() => replace.mutate()}>
                {replace.isPending ? 'Preparing...' : 'Prepare replacement'}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

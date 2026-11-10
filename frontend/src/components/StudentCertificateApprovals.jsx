import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnection, useSignMessage } from 'wagmi';
import { useWeb3AuthConnect } from '@web3auth/modal/react';
import { isAddressEqual } from 'viem';
import { Btn, Certificate } from './design-system';
import { api } from '../lib/api';

export default function StudentCertificateApprovals({ studentID }) {
  const queryClient = useQueryClient();
  const { address, isConnected } = useConnection();
  const { mutateAsync: signMessage } = useSignMessage();
  const { connect, loading: connecting, error: connectionError } = useWeb3AuthConnect();
  const queryKey = ['student-certificate-approvals', studentID];
  const certificates = useQuery({
    queryKey, queryFn: ({ signal }) => api('/api/student/certificates', { signal }),
    retry: false, refetchOnWindowFocus: false,
  });
  const review = useMutation({
    mutationFn: id => api(`/api/student/certificates/${id}/consent-request`, { method: 'POST' }),
  });
  const approve = useMutation({
    mutationFn: async request => {
      if (!isConnected || !address || !isAddressEqual(address, request.certificate.walletAddress)) {
        throw new Error('Connect the wallet linked to your registered Google account.');
      }
      let signature;
      try { signature = await signMessage({ message: request.message, account: address }); }
      catch { throw new Error('Wallet signing was cancelled or failed. No approval was saved.'); }
      return api(`/api/student/certificates/${request.certificate.certificateID}/consent`, {
        method: 'POST', body: { challenge: request.challenge, signature },
      });
    },
    onSuccess: async () => {
      review.reset();
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const request = review.data;
  const pendingCertificates = certificates.data?.filter(certificate => ['PENDING', 'FAILED'].includes(certificate.status)) || [];
  const correctWallet = request && isConnected && address && isAddressEqual(address, request.certificate.walletAddress);
  const busy = review.isPending || approve.isPending;

  return <section className="sheet mb-8 min-w-0 p-5 md:p-7" aria-labelledby="certificate-approvals-title">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 id="certificate-approvals-title" className="font-serif text-2xl">Certificate approvals</h2>
      <Btn variant="line" size="sm" disabled={busy || certificates.isFetching} onClick={() => certificates.refetch()}>Refresh</Btn>
    </div>
    <p className="mb-4 text-sm text-ink-soft">Review your certificate before approving issuance. Your approval is a wallet signature; it does not spend POL.</p>
    {certificates.isPending ? <p role="status">Loading certificates...</p> : certificates.error ? <p role="alert" className="text-sm text-revoked">{certificates.error.message}</p> : !pendingCertificates.length ? <p className="text-sm text-ink-soft">No certificates awaiting approval yet.</p> : <ul className="space-y-3">
      {pendingCertificates.map(certificate => <li key={certificate.certificateID} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] p-4">
        <div className="min-w-0 flex-1">
          <p className="break-words font-medium">{certificate.seminarTitle}</p>
          <p className="text-sm text-ink-soft">#{certificate.certificateNo} · {certificate.seminarDate}</p>
          <p className="mt-1 text-sm text-ink-soft">{!certificate.attended ? 'On hold: attendance not confirmed' : !certificate.walletAddress ? 'Awaiting wallet setup' : certificate.consentedAt ? 'Approved; issuance in progress' : 'Awaiting your approval'}</p>
        </div>
        {!certificate.consentedAt && <Btn variant="line" size="sm" disabled={busy || !certificate.attended || !certificate.walletAddress} onClick={() => {
          approve.reset(); review.reset(); review.mutate(certificate.certificateID);
        }}>Review certificate #{certificate.certificateNo}</Btn>}
      </li>)}
    </ul>}
    {review.isPending && <p role="status" className="mt-4">Loading certificate review...</p>}
    {review.error && <p role="alert" className="mt-4 text-sm text-revoked">{review.error.message}</p>}
    {approve.error && <p role="alert" className="mt-4 text-sm text-revoked">{approve.error.message}</p>}
    {approve.isSuccess && <p role="status" className="mt-4 text-sm text-verified">Approval saved. Your certificate is pending faculty issuance.</p>}
    {request && <div className="mt-6 space-y-4 border-t border-[var(--line)] pt-5">
      <h3 className="font-serif text-xl">Review certificate #{request.certificate.certificateNo}</h3>
      <div className="max-w-3xl"><Certificate draft tilt={false} cert={{ id: request.certificate.certificateNo, recipient: request.certificate.recipientName, seminar: request.certificate.seminarTitle, iso: request.certificate.seminarDate, status: 'Pending' }} /></div>
      <dl className="grid gap-2 text-sm">
        <div><dt className="font-medium">Recipient</dt><dd className="break-words">{request.certificate.recipientName}</dd></div>
        <div><dt className="font-medium">Seminar and date</dt><dd className="break-words">{request.certificate.seminarTitle} · {request.certificate.seminarDate}</dd></div>
        <div><dt className="font-medium">Issuer wallet · Polygon Amoy</dt><dd className="break-all font-mono text-xs">{request.context.issuerAddress}</dd></div>
        <div><dt className="font-medium">Your recipient wallet</dt><dd className="break-all font-mono text-xs">{request.certificate.walletAddress}</dd></div>
      </dl>
      <p className="text-sm">Only the issuer may revoke (burn) this certificate. You cannot transfer it or burn it yourself. Issued details and this burn authorization cannot be changed. Contact CICT before approving if any details are incorrect.</p>
      <details><summary className="cursor-pointer text-sm font-medium">Exact message your wallet will sign</summary><pre className="mt-3 whitespace-pre-wrap break-all rounded-xl bg-paper p-4 text-xs">{request.message}</pre></details>
      {!isConnected && <Btn variant="line" disabled={connecting || busy} onClick={() => connect().catch(() => {})}>{connecting ? 'Connecting...' : 'Connect your Google wallet'}</Btn>}
      {isConnected && !correctWallet && <p role="alert" className="text-sm text-revoked">The connected wallet does not match your registered wallet. Sign out and use your registered Google account.</p>}
      {connectionError && <p role="alert" className="text-sm text-revoked">Could not connect your wallet. Please try again.</p>}
      <div className="flex flex-wrap gap-3">
        <Btn disabled={busy || !correctWallet} onClick={() => approve.mutate(request)}>{approve.isPending ? 'Waiting for wallet approval...' : 'Approve with my wallet'}</Btn>
        <Btn variant="line" disabled={busy} onClick={() => { review.reset(); approve.reset(); }}>Cancel</Btn>
      </div>
      <p className="text-xs text-ink-soft">Review requests expire after 10 minutes. If yours expires, open the certificate review again. Saved approval stays valid for these exact details.</p>
    </div>}
  </section>;
}

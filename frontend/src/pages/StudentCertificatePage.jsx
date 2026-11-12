import { useParams } from 'react-router-dom';
import { Btn, Certificate, Seal } from '../components/design-system';
import { certificateVerificationUrl } from '../lib/certificateVerificationUrl';

const STATUS_TEXT = {
  Verified: ['Valid and authentic', 'Issued on Polygon Amoy and confirmed in a finalized block.'],
  Revoked: ['Revoked', 'CICT revoked this certificate on the blockchain. It no longer verifies as valid.'],
};

const Row = ({ label, children, mono }) => (
  <div className="hair flex items-baseline justify-between gap-6 py-3 first:border-t-0">
    <dt className="eyebrow shrink-0">{label}</dt>
    <dd className={`min-w-0 break-all text-right text-sm ${mono ? 'font-mono text-xs' : 'font-medium'}`}>{children}</dd>
  </div>
);

// One of the signed-in student's own certificates; `certificates` is the list App already loads.
export default function StudentCertificatePage({ certificates, onBack, onDownload }) {
  const { certificateNo } = useParams();
  const cert = certificates.find(c => String(c.id) === certificateNo);

  const back = (
    <button type="button" onClick={onBack}
      className="mb-6 flex items-center gap-2 rounded-sm text-sm font-semibold text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest">
      <i className="ph-bold ph-arrow-left" aria-hidden="true"></i>Back to my certificates
    </button>
  );

  if (!cert) {
    return (
      <div>
        {back}
        <div className="sheet p-8">
          <h1 className="font-serif text-3xl font-medium">Certificate not found</h1>
          <p className="mt-2 text-sm text-ink-soft">There is no issued certificate #{certificateNo} in your collection.</p>
        </div>
      </div>
    );
  }

  const [title, description] = STATUS_TEXT[cert.status];

  return (
    <div>
      {back}
      <h1 className="sr-only">Certificate #{cert.id}: {cert.seminar}</h1>
      <div className="grid items-start gap-8 lg:grid-cols-12">
        <div className="rise lg:col-span-8">
          <Certificate cert={cert} tilt={false} verificationUrl={certificateVerificationUrl(cert.hash, window.location.origin)} />
          <Btn className="mt-5" icon="ph-download-simple" onClick={() => onDownload(cert)}>Download PDF</Btn>
        </div>
        <aside className="rise space-y-6 lg:col-span-4" style={{ '--d': '.1s' }}>
          <section className="sheet p-7 text-center">
            <div className="flex justify-center"><Seal status={cert.status} size={120} animate /></div>
            <h2 className="mt-4 font-serif text-3xl font-medium">{title}</h2>
            <p className="mt-2 text-sm text-ink-soft">{description}</p>
          </section>
          <section className="sheet p-6">
            <h2 className="eyebrow mb-1">Blockchain record</h2>
            <dl>
              <Row label="Certificate no." mono>{cert.id}</Row>
              <Row label="Network">Polygon Amoy testnet</Row>
              <Row label="Token standard">ERC-5484 (soulbound)</Row>
              {cert.tokenID && <Row label="Token ID" mono>{cert.tokenID}</Row>}
              {cert.block != null && <Row label="Block" mono>#{Number(cert.block).toLocaleString()}</Row>}
            </dl>
            {cert.transactionHash && <div className="hair mt-1 pt-3">
              <div className="eyebrow mb-2">Issuing transaction</div>
              <a href={`https://amoy.polygonscan.com/tx/${cert.transactionHash}`} target="_blank" rel="noreferrer"
                className="block break-all rounded-lg border border-[var(--line)] bg-paper-2 p-3 font-mono text-[11px] text-forest underline"
                aria-label="View the issuing transaction on Polygonscan (opens in a new tab)">{cert.transactionHash}</a>
            </div>}
          </section>
        </aside>
      </div>
    </div>
  );
}

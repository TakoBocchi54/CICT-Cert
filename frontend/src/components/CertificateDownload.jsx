import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Btn, Certificate } from './design-system';
import { certificateVerificationUrl } from '../lib/certificateVerificationUrl';
import { pageSizeMm } from '../lib/certificateTemplate';

export default function CertificateDownload({ cert, onClose }) {
  const dialog = useRef(null);
  const exportTemplate = useRef(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const verificationUrl = certificateVerificationUrl(cert.hash, window.location.origin);

  useEffect(() => {
    dialog.current.showModal();
  }, []);

  async function savePdf() {
    setDownloading(true);
    setError('');
    try {
      await document.fonts.ready;
      const [{ toPng }, { createCertificatePdf }] = await Promise.all([
        import('html-to-image'), import('../lib/certificatePdf'),
      ]);
      const node = exportTemplate.current.firstElementChild;
      const png = await toPng(node, { pixelRatio: 3, preferredFontFormat: 'woff2',
        filter: element => !element.classList?.contains('cert-reveal') });
      const bytes = await createCertificatePdf(png, pageSizeMm(cert.template), cert.id);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `CICT-Certificate-${cert.id}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { setError('Could not generate the certificate PDF. Please try again.'); }
    finally { setDownloading(false); }
  }

  return createPortal(<dialog ref={dialog} id="certificate-download" aria-labelledby="certificate-download-title" onCancel={onClose}
    className="m-auto max-h-[90vh] w-[calc(100%_-_2rem)] max-w-5xl overflow-auto rounded-2xl border border-paper-3 bg-paper p-4 text-ink shadow-xl backdrop:bg-black/40 md:p-6">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 id="certificate-download-title" className="font-serif text-2xl">Download certificate #{cert.id}</h2>
        <p className="mt-2 text-sm text-ink-soft">Download the certificate as a PDF. Scan its QR code to open the public verification page.</p>
      </div>
      <Btn variant="line" size="sm" onClick={onClose}>Close</Btn>
    </div>
    <Certificate cert={cert} verificationUrl={verificationUrl} tilt={false} />
    <div ref={exportTemplate} aria-hidden="true" inert className="pointer-events-none fixed -left-[10000px] top-0 w-[1122px]">
      <Certificate cert={cert} verificationUrl={verificationUrl} tilt={false} className="rounded-none! shadow-none!" />
    </div>
    <div className="mt-5 flex flex-wrap items-center gap-4">
      <Btn onClick={savePdf} disabled={downloading}>{downloading ? 'Generating PDF...' : 'Download PDF'}</Btn>
      <a href={verificationUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-forest underline">Open verification page</a>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-revoked">{error}</p>}
  </dialog>, document.body);
}

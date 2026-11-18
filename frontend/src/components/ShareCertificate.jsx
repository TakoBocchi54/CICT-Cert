import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Btn } from './design-system';
import { linkedInCertificationUrl } from '../lib/linkedInCertification';
import { formatCertificateNo } from '../lib/certificateNumber';

// One Share button that opens a modal: copy the public verification link, or add the certificate to LinkedIn.
export default function ShareCertificate({ cert, verificationUrl }) {
  const [open, setOpen] = useState(false);
  return <>
    <Btn variant="line" icon="ph-share-network" aria-haspopup="dialog" onClick={() => setOpen(true)}>Share</Btn>
    {open && <ShareDialog cert={cert} verificationUrl={verificationUrl} onClose={() => setOpen(false)} />}
  </>;
}

// A native modal like the app's other dialogs: it traps focus, closes on Escape or a click on the backdrop, and the
// browser returns focus to the Share button when it closes.
function ShareDialog({ cert, verificationUrl, onClose }) {
  const dialog = useRef(null), field = useRef(null);
  const [copied, setCopied] = useState(null); // null, 'copied' or 'manual' (clipboard blocked: the link is selected instead)
  const id = useId();
  useEffect(() => { dialog.current.showModal(); }, []);
  useEffect(() => {
    if (copied !== 'copied') return;
    const timer = setTimeout(() => setCopied(null), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    const manual = () => { field.current?.select(); setCopied('manual'); };
    if (!navigator.clipboard) return manual(); // e.g. a non-HTTPS origin
    navigator.clipboard.writeText(verificationUrl).then(() => setCopied('copied'), manual);
  };
  const linkedIn = linkedInCertificationUrl({ name: cert.seminar, issued: cert.issuedAt || cert.iso, certId: formatCertificateNo(cert.id, cert.iso), certUrl: verificationUrl });

  return createPortal(
    <dialog ref={dialog} aria-labelledby={id + '-title'} aria-describedby={id + '-text'}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === dialog.current) onClose(); }}
      className="pop m-auto w-[calc(100%_-_2rem)] max-w-md rounded-2xl border border-paper-3 bg-paper p-0 text-ink shadow-xl backdrop:bg-[rgba(22,35,29,.45)] backdrop:backdrop-blur-sm">
      <div className="p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-forest text-xl text-white shadow" aria-hidden="true">
            <i className="ph-bold ph-share-network"></i>
          </span>
          <button type="button" onClick={onClose} aria-label="Close"
            className="-mr-2 -mt-1 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-black/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest">
            <i className="ph-bold ph-x" aria-hidden="true"></i>
          </button>
        </div>
        <p className="eyebrow mt-5">Certificate No. {formatCertificateNo(cert.id, cert.iso)}</p>
        <h2 id={id + '-title'} className="mt-1 font-serif text-3xl font-medium leading-tight">Share certificate</h2>
        <p className="mt-1 text-sm font-medium text-ink-soft [overflow-wrap:anywhere]">{cert.seminar}</p>
        <p id={id + '-text'} className="mt-3 text-sm text-ink-muted">Anyone with the link can see your name, the seminar, and that the certificate is valid on Polygon Amoy.</p>

        <label htmlFor={id + '-link'} className="eyebrow mb-2 mt-6 block">Verification link</label>
        <div className="flex gap-2">
          <input ref={field} id={id + '-link'} readOnly value={verificationUrl} onFocus={event => event.target.select()}
            className="field min-w-0 flex-1 font-mono !py-2.5 !text-xs" />
          <Btn variant="line" icon={copied === 'copied' ? 'ph-check' : 'ph-copy'} onClick={copy} autoFocus>
            {copied === 'copied' ? 'Copied' : 'Copy link'}</Btn>
        </div>
        <p role="status" className="mt-1.5 min-h-4 text-xs text-ink-muted">
          {copied === 'copied' ? 'Link copied to your clipboard.' : copied === 'manual' ? 'Copying was blocked. The link is selected: press Ctrl+C (or ⌘C).' : ''}
        </p>

        <a href={linkedIn} target="_blank" rel="noreferrer"
          className="mt-3 flex items-center gap-3 rounded-xl border border-[var(--line)] bg-white p-3.5 text-sm font-semibold transition-colors hover:border-ink-muted hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0a66c2] text-xl text-white" aria-hidden="true">
            <i className="ph-fill ph-linkedin-logo"></i>
          </span>
          <span className="min-w-0 flex-1">
            Add to LinkedIn
            <span className="block text-xs font-normal text-ink-muted">Licenses &amp; certifications, prefilled</span>
          </span>
          <i className="ph-bold ph-arrow-square-out text-ink-muted" aria-hidden="true"></i>
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
    </dialog>,
    document.body,
  );
}

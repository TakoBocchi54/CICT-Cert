import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Btn } from './design-system';
import { CONSENT_TERMS } from '../lib/consentTerms';

// The full consent text, opened from the login page. The wallet signs the same text at the first sign-in.
export default function ConsentDialog({ onClose }) {
  const dialog = useRef(null);
  useEffect(() => { dialog.current.showModal(); }, []);

  return createPortal(
    <dialog ref={dialog} aria-labelledby="consent-title" aria-describedby="consent-text"
      onCancel={event => { event.preventDefault(); onClose(); }}
      className="m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-2xl border border-paper-3 bg-paper p-0 text-ink shadow-xl backdrop:bg-[rgba(22,35,29,.45)] backdrop:backdrop-blur-sm">
      <div className="p-6 sm:p-8">
        <div className="mb-5 flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-paper-2 text-xl text-forest" aria-hidden="true">
            <i className="ph-bold ph-file-text"></i>
          </span>
          <h2 id="consent-title" className="min-w-0 flex-1 pt-2 font-serif text-2xl font-medium leading-tight">CICT-Cert certificate consent</h2>
          <button type="button" onClick={onClose} aria-label="Close"
            className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-black/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest">
            <i className="ph-bold ph-x" aria-hidden="true"></i>
          </button>
        </div>

        <p className="text-sm text-ink-soft">
          The first time you sign in, your wallet signs this text, together with your student ID and a one-time code.
          CICT keeps the signature as the record of your consent.
        </p>
        <div id="consent-text" className="mt-4 space-y-3 rounded-xl border border-[var(--line)] bg-paper-2 p-4 text-sm leading-relaxed">
          {CONSENT_TERMS.map(term => <p key={term}>{term}</p>)}
        </div>

        <Btn type="button" variant="line" className="mt-6 w-full" onClick={onClose}>Close</Btn>
      </div>
    </dialog>,
    document.body,
  );
}

import { useRef, useState } from 'react';
import { Btn } from './design-system';

const MAX_BYTES = 1024 * 1024;

// Drag-and-drop or browse for a CSV; hands back { name, csv } text so the parent can keep it as a draft.
export default function CsvDropZone({ id, title, draft, onDraft, onError, disabled }) {
  const input = useRef(null);
  const [drag, setDrag] = useState(false);

  async function read(file) {
    if (!file) return;
    if (file.size === 0 || file.size > MAX_BYTES) return onError('Choose a non-empty CSV file up to 1 MB.');
    try { onDraft({ name: file.name, csv: await file.text() }); }
    catch { onError('The file could not be read. Choose it again.'); }
    if (input.current) input.current.value = '';
  }

  return (
    <div
      onDragOver={event => { event.preventDefault(); if (!disabled) setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={event => { event.preventDefault(); setDrag(false); if (!disabled) read(event.dataTransfer.files?.[0]); }}
      className={'rounded-2xl border-2 border-dashed focus-within:ring-2 focus-within:ring-forest flex flex-col items-center justify-center text-center p-8 min-h-[220px] transition-colors '
        + (drag ? 'border-forest bg-verified-bg' : draft ? 'border-verified/40 bg-[#f4faf6]' : 'border-[#cfc7b0] bg-paper')}
    >
      <input ref={input} id={id} type="file" accept=".csv,text/csv" className="sr-only" disabled={disabled}
        onChange={event => read(event.target.files?.[0])} />
      {draft ? <>
        <i className="ph-fill ph-check-circle text-4xl text-verified" aria-hidden="true"></i>
        <div className="font-serif text-2xl font-medium mt-3">File ready</div>
        <div className="font-mono text-sm text-ink-muted mt-1 break-all">{draft.name}</div>
        <div className="flex flex-wrap justify-center gap-3 mt-5">
          <label htmlFor={id} className={'btn btn-line btn-sm ' + (disabled ? 'opacity-50 pointer-events-none' : 'cursor-pointer')}>Replace file</label>
          <Btn variant="ghost" size="sm" disabled={disabled} onClick={() => onDraft(null)}>Remove</Btn>
        </div>
      </> : <>
        <div className="w-16 h-16 rounded-2xl bg-white border border-[var(--line)] flex items-center justify-center" aria-hidden="true">
          <i className="ph-duotone ph-file-csv text-3xl text-forest"></i>
        </div>
        <div className="font-serif text-2xl font-medium mt-4">{drag ? 'Release to add the file' : title}</div>
        <p className="text-ink-muted mt-1 mb-5 text-sm">Drag it here, or</p>
        <label htmlFor={id} className={'btn btn-line btn-sm ' + (disabled ? 'opacity-50 pointer-events-none' : 'cursor-pointer')}>Browse files</label>
      </>}
    </div>
  );
}

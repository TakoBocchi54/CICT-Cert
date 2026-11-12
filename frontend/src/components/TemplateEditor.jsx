import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Btn, Certificate } from './design-system';
import { api } from '../lib/api';
import { FIELD_LABELS, newSignatureField, paperLabel, SAMPLE_CERTIFICATE } from '../lib/certificateTemplate';

const MAX_SIGNATURES = 3;
const MAX_SIGNATURE_MB = 1;
const FONTS = [['serif', 'Serif (Fraunces)'], ['sans', 'Sans (Inter)'], ['script', 'Script (Allura)'], ['mono', 'Mono']];
const round = value => Math.round(value * 100) / 100;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
// Key-order-independent comparison: the server stores fields as JSONB, which reorders keys.
const stable = value => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v);

// Place the certificate's fields on an uploaded background. Fields are dragged on the preview or moved with the arrow
// keys / X and Y inputs. The preview is the real certificate renderer, so it matches the PDF.
export default function TemplateEditor({ template, onBack }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(template.name);
  const [fields, setFields] = useState(template.fields);
  const [selected, setSelected] = useState('recipientName');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [fileError, setFileError] = useState('');
  const drag = useRef(null);
  const replaceInput = useRef(null);
  const signatureInput = useRef(null);
  const editable = template.canEdit;
  const dirty = name.trim() !== template.name || stable(fields) !== stable(template.fields);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['certificate-templates'] });
  const path = `/api/faculty/certificate-templates/${template.templateID}`;

  const save = useMutation({
    mutationFn: () => api(path, { method: 'PATCH', body: { name, fields } }),
    onSuccess: async saved => { setName(saved.name); setFields(saved.fields); await refresh(); },
  });
  const replace = useMutation({ mutationFn: file => api(path + '/image', { method: 'PUT', body: file }), onSuccess: refresh });
  const addSignature = useMutation({
    mutationFn: file => api(path + '/signatures', { method: 'POST', body: file }),
    onSuccess: async ({ signatureID }) => {
      await refresh();
      setFields(current => ({ ...current, signatures: [...current.signatures, newSignatureField(signatureID)] }));
      setSelected('sig:' + signatureID);
    },
  });
  const removeSignature = useMutation({
    mutationFn: signatureID => api(`${path}/signatures/${signatureID}`, { method: 'DELETE' }),
    onSuccess: async (_data, signatureID) => {
      setFields(current => ({ ...current, signatures: current.signatures.filter(signature => signature.signatureID !== signatureID) }));
      setSelected('recipientName');
      await refresh();
    },
  });
  const remove = useMutation({ mutationFn: () => api(path, { method: 'DELETE' }), onSuccess: async () => { await refresh(); onBack(); } });
  const busy = save.isPending || replace.isPending || addSignature.isPending || removeSignature.isPending || remove.isPending;
  const error = fileError || [save, replace, addSignature, removeSignature, remove].find(mutation => mutation.error)?.error.message;

  // Field access by key: a text field name, 'qr', or 'sig:<signatureID>'.
  const get = key => key === 'qr' ? fields.qr : key.startsWith('sig:')
    ? fields.signatures.find(signature => 'sig:' + signature.signatureID === key) : fields.text[key];
  function set(key, patch) {
    save.reset();
    setFields(current => {
      if (key === 'qr') return { ...current, qr: { ...current.qr, ...patch } };
      if (key.startsWith('sig:')) return { ...current, signatures: current.signatures.map(signature =>
        'sig:' + signature.signatureID === key ? { ...signature, ...patch } : signature) };
      return { ...current, text: { ...current.text, [key]: { ...current.text[key], ...patch } } };
    });
  }
  const move = (key, x, y) => set(key, { x: round(clamp(x, 0, 100)), y: round(clamp(y, 0, 100)) });
  const labelOf = key => key.startsWith('sig:')
    ? `Signature ${fields.signatures.findIndex(signature => 'sig:' + signature.signatureID === key) + 1}` : FIELD_LABELS[key];

  function pickFile(file, maxMb, mutation) {
    setFileError('');
    mutation.reset();
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) return setFileError('Choose a PNG or JPG image.');
    if (file.size > maxMb * 1024 * 1024) return setFileError(`The image is larger than ${maxMb} MB. Export it smaller and try again.`);
    mutation.mutate(file);
  }

  const fieldProps = editable ? key => ({
    tabIndex: 0, role: 'button', 'aria-label': `${labelOf(key)}. Drag, or use the arrow keys to move (Shift for bigger steps).`,
    'aria-pressed': selected === key,
    className: 'cursor-move touch-none select-none rounded-[2px] outline-offset-2 '
      + (selected === key ? 'outline-2 outline-forest' : 'outline-1 outline-dashed outline-forest/40 hover:outline-forest'),
    onFocus: () => setSelected(key),
    onPointerDown: event => {
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      const rect = event.currentTarget.closest('.cert').getBoundingClientRect();
      const field = get(key);
      drag.current = { key, rect, startX: event.clientX, startY: event.clientY, x: field.x, y: field.y };
    },
    onPointerMove: event => {
      const d = drag.current;
      if (!d || d.key !== key) return;
      move(key, d.x + (event.clientX - d.startX) / d.rect.width * 100, d.y + (event.clientY - d.startY) / d.rect.height * 100);
    },
    onPointerUp: () => { drag.current = null; },
    onPointerCancel: () => { drag.current = null; },
    onKeyDown: event => {
      const step = event.shiftKey ? 5 : 0.5;
      const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
      if (!delta) return;
      event.preventDefault();
      const field = get(key);
      move(key, field.x + delta[0], field.y + delta[1]);
    },
  }) : undefined;

  const current = get(selected) ?? fields.text.recipientName;
  const selectedKey = get(selected) ? selected : 'recipientName';
  const isText = !!fields.text[selectedKey];
  const isSignature = selectedKey.startsWith('sig:');
  const listedKeys = [...Object.keys(FIELD_LABELS).filter(key => key !== 'qr'), 'qr', ...fields.signatures.map(signature => 'sig:' + signature.signatureID)];

  return (
    <div className="pb-16">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <button type="button" onClick={() => { if (!dirty || window.confirm('Leave without saving your changes?')) onBack(); }}
            className="mb-3 inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-ink-soft hover:text-ink">
            <i className="ph-bold ph-arrow-left" aria-hidden="true"></i>All templates
          </button>
          <h1 className="font-serif text-4xl md:text-5xl font-medium leading-[1.05] break-words">{template.name}</h1>
          <p className="mt-2 text-sm text-ink-muted">{paperLabel(template)} · {template.width}×{template.height} px · by {template.createdByName}</p>
        </div>
        {editable && <div className="flex flex-wrap items-center gap-3">
          {dirty && <span className="text-xs text-ink-muted" role="status">Unsaved changes</span>}
          <Btn icon="ph-check" disabled={busy || !dirty || !name.trim()} onClick={() => save.mutate()}>{save.isPending ? 'Saving...' : 'Save template'}</Btn>
        </div>}
      </div>

      {template.locked ? <p role="note" className="mb-6 rounded-xl border border-[var(--line)] bg-paper-2 p-4 text-sm text-ink-soft">
        <i className="ph-fill ph-lock-simple mr-1" aria-hidden="true"></i>
        Certificates already use this template, so it can't be changed: every issued certificate must keep rendering the same way.
      </p> : !editable && <p role="note" className="mb-6 rounded-xl border border-[var(--line)] bg-paper-2 p-4 text-sm text-ink-soft">
        Only the faculty member who created this template, or one who can issue certificates, can edit it.
      </p>}
      {error && <p role="alert" className="mb-6 text-sm text-revoked">{error}</p>}

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="lg:sticky lg:top-28">
          <div className="mx-auto" style={{ maxWidth: `min(100%, calc(72vh * ${template.width / template.height}))` }}>
            <Certificate cert={SAMPLE_CERTIFICATE} template={{ ...template, fields }} tilt={false} fieldProps={fieldProps} />
          </div>
          <p className="mt-3 text-center text-xs text-ink-muted">Preview with sample data. {editable && 'Drag a field, or select it and use the arrow keys.'}</p>
        </div>

        <div className="space-y-5">
          <div>
            <label htmlFor="template-name" className="eyebrow mb-2 block">Template name</label>
            <input id="template-name" className="field" maxLength={100} disabled={!editable || busy} value={name}
              onChange={event => { save.reset(); setName(event.target.value); }} />
          </div>

          <fieldset>
            <legend className="eyebrow mb-2">Fields</legend>
            <ul className="space-y-1.5">
              {listedKeys.map(key => {
                const field = get(key);
                const optional = fields.text[key] && key !== 'recipientName';
                return (
                  <li key={key} className={'flex items-center gap-2 rounded-xl border px-3 py-2 ' + (selectedKey === key ? 'border-forest bg-white' : 'border-[var(--line)]')}>
                    <button type="button" onClick={() => setSelected(key)} aria-pressed={selectedKey === key}
                      className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-forest">
                      {labelOf(key)}{key === 'recipientName' || key === 'qr' ? <span className="ml-1 text-xs font-normal text-ink-muted">· always shown</span> : null}
                    </button>
                    {optional && <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-soft">
                      <input type="checkbox" className="h-4 w-4 accent-[var(--forest)]" checked={field.show} disabled={!editable || busy}
                        onChange={event => set(key, { show: event.target.checked })} />Show
                    </label>}
                    {key.startsWith('sig:') && editable && <button type="button" disabled={busy} aria-label={`Remove ${labelOf(key)}`}
                      onClick={() => removeSignature.mutate(field.signatureID)}
                      className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-revoked-bg hover:text-revoked disabled:opacity-40">
                      <i className="ph-bold ph-x" aria-hidden="true"></i>
                    </button>}
                  </li>
                );
              })}
            </ul>
            {editable && <>
              <input ref={signatureInput} type="file" accept="image/png,image/jpeg" className="sr-only" tabIndex={-1} aria-hidden="true"
                onChange={event => { pickFile(event.target.files[0], MAX_SIGNATURE_MB, addSignature); event.target.value = ''; }} />
              <Btn variant="line" size="sm" icon="ph-signature" className="mt-3" disabled={busy || fields.signatures.length >= MAX_SIGNATURES}
                onClick={() => signatureInput.current.click()}>{addSignature.isPending ? 'Uploading...' : 'Add signature'}</Btn>
              <p className="mt-1.5 text-xs text-ink-muted">
                {fields.signatures.length >= MAX_SIGNATURES ? `Up to ${MAX_SIGNATURES} signatures.` : `A scanned signature, ideally a PNG with a transparent background (up to ${MAX_SIGNATURE_MB} MB).`}
              </p>
            </>}
          </fieldset>

          <fieldset disabled={!editable || busy} className="space-y-3 rounded-2xl border border-[var(--line)] p-4">
            <legend className="px-1 text-sm font-semibold">{labelOf(selectedKey)}</legend>
            <div className="grid grid-cols-2 gap-3">
              <NumberField id="field-x" label="X (%)" value={current.x} min={0} max={100} step={0.5} onChange={x => move(selectedKey, x, current.y)} />
              <NumberField id="field-y" label="Y (%)" value={current.y} min={0} max={100} step={0.5} onChange={y => move(selectedKey, current.x, y)} />
              {selectedKey === 'qr' && <NumberField id="field-qr-size" label="Size (% of width)" value={current.size} min={6} max={40} step={0.5}
                onChange={size => set('qr', { size })} />}
              {isSignature && <NumberField id="field-sig-width" label="Width (% of width)" value={current.width} min={5} max={60} step={0.5}
                onChange={width => set(selectedKey, { width })} />}
              {(isText || isSignature) && <NumberField id="field-size" label={isSignature ? 'Caption size' : 'Text size'} value={current.size}
                min={0.5} max={isSignature ? 6 : 15} step={0.1} onChange={size => set(selectedKey, { size })} />}
              {isText && <NumberField id="field-width" label="Max width (%)" value={current.maxWidth} min={5} max={100} step={1}
                onChange={maxWidth => set(selectedKey, { maxWidth })} />}
            </div>
            {(isText || isSignature) && <div className="grid grid-cols-[1fr_auto] gap-3">
              <div>
                <label htmlFor="field-font" className="mb-1 block text-xs font-medium text-ink-muted">Font</label>
                <select id="field-font" className="field" value={current.font} onChange={event => set(selectedKey, { font: event.target.value })}>
                  {FONTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="field-color" className="mb-1 block text-xs font-medium text-ink-muted">Color</label>
                <input id="field-color" type="color" className="h-[46px] w-14 cursor-pointer rounded-xl border border-[var(--line)] bg-white p-1"
                  value={current.color} onChange={event => set(selectedKey, { color: event.target.value })} />
              </div>
            </div>}
            {isText && <div className="flex flex-wrap items-center justify-between gap-3">
              <div role="group" aria-label="Alignment" className="inline-flex rounded-xl border border-[var(--line)] p-0.5">
                {[['left', 'ph-text-align-left'], ['center', 'ph-text-align-center'], ['right', 'ph-text-align-right']].map(([align, icon]) => (
                  <button key={align} type="button" aria-pressed={current.align === align} aria-label={`Align ${align}`} onClick={() => set(selectedKey, { align })}
                    className={'flex h-9 w-10 cursor-pointer items-center justify-center rounded-lg ' + (current.align === align ? 'bg-forest text-white' : 'text-ink-soft hover:bg-black/5')}>
                    <i className={'ph-bold ' + icon} aria-hidden="true"></i>
                  </button>
                ))}
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-[var(--forest)]" checked={current.bold} onChange={event => set(selectedKey, { bold: event.target.checked })} />Bold
              </label>
            </div>}
            {isSignature && <>
              <div>
                <label htmlFor="field-sig-name" className="mb-1 block text-xs font-medium text-ink-muted">Printed name (optional)</label>
                <input id="field-sig-name" className="field" maxLength={100} placeholder="e.g. Dr. Maria Santos" value={current.name}
                  onChange={event => set(selectedKey, { name: event.target.value })} />
              </div>
              <div>
                <label htmlFor="field-sig-title" className="mb-1 block text-xs font-medium text-ink-muted">Title (optional)</label>
                <input id="field-sig-title" className="field" maxLength={100} placeholder="e.g. Dean, CICT" value={current.title}
                  onChange={event => set(selectedKey, { title: event.target.value })} />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-[var(--forest)]" checked={current.line} onChange={event => set(selectedKey, { line: event.target.checked })} />
                Signature line under the image
              </label>
            </>}
          </fieldset>

          {editable && <div className="hair space-y-3 pt-5">
            <input ref={replaceInput} type="file" accept="image/png,image/jpeg" className="sr-only" tabIndex={-1} aria-hidden="true"
              onChange={event => { pickFile(event.target.files[0], 5, replace); event.target.value = ''; }} />
            <Btn variant="line" size="sm" icon="ph-image" disabled={busy} onClick={() => replaceInput.current.click()}>
              {replace.isPending ? 'Replacing...' : 'Replace background'}</Btn>
            {!confirmingDelete ? <Btn variant="ghost" size="sm" icon="ph-trash" className="!text-revoked hover:!bg-revoked-bg" disabled={busy}
              onClick={() => setConfirmingDelete(true)}>Delete template</Btn> : (
              <div role="alert" className="rounded-xl bg-revoked-bg p-4 text-sm">
                <p className="font-medium text-revoked">Delete “{template.name}”?</p>
                <p className="mt-1 text-ink-soft">
                  {template.seminarCount ? `${template.seminarCount} ${template.seminarCount === 1 ? 'seminar uses' : 'seminars use'} it and will switch to the built-in design. ` : ''}
                  This can't be undone.
                </p>
                <div className="mt-3 flex gap-2">
                  <Btn variant="line" size="sm" autoFocus disabled={busy} onClick={() => setConfirmingDelete(false)}>Cancel</Btn>
                  <Btn variant="danger" size="sm" icon="ph-trash" disabled={busy} onClick={() => remove.mutate()}>{remove.isPending ? 'Deleting...' : 'Delete'}</Btn>
                </div>
              </div>
            )}
          </div>}
        </div>
      </div>
    </div>
  );
}

function NumberField({ id, label, value, min, max, step, onChange }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-muted">{label}</label>
      <input id={id} type="number" className="field" min={min} max={max} step={step} value={value}
        onChange={event => { const next = event.target.valueAsNumber; if (Number.isFinite(next)) onChange(round(clamp(next, min, max))); }} />
    </div>
  );
}

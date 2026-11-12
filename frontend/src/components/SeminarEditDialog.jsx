import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Btn } from './design-system';
import { api } from '../lib/api';
import TemplatePicker from './TemplatePicker';

// Fix a mistaken seminar (typo in title or date), or delete it, before any certificate copies its details.
export default function SeminarEditDialog({ seminar, canDelete, onClose, onDeleted }) {
  const queryClient = useQueryClient();
  const dialog = useRef(null);
  const [title, setTitle] = useState(seminar.seminarTitle);
  const [date, setDate] = useState(seminar.seminarDate);
  const [templateID, setTemplateID] = useState(seminar.templateID ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const locked = seminar.certificateCount > 0;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['faculty-seminars'] });

  useEffect(() => { dialog.current.showModal(); }, []);

  const save = useMutation({
    mutationFn: () => api(`/api/faculty/seminars/${seminar.seminarID}`, { method: 'PATCH', body: { seminarTitle: title, seminarDate: date, templateID: templateID || null } }),
    onSuccess: async () => { await refresh(); onClose(); },
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/faculty/seminars/${seminar.seminarID}`, { method: 'DELETE' }),
    onSuccess: async () => { await refresh(); onDeleted(); },
  });
  const busy = save.isPending || remove.isPending;
  const unchanged = title.trim() === seminar.seminarTitle && date === seminar.seminarDate && templateID === (seminar.templateID ?? '');
  const [heading, icon, tone] = locked ? ['Seminar locked', 'ph-lock-simple', 'bg-paper-2 text-ink-muted']
    : confirmingDelete ? ['Delete this seminar?', 'ph-warning', 'bg-revoked-bg text-revoked']
    : ['Edit seminar', 'ph-pencil-simple', 'bg-paper-2 text-forest'];

  return createPortal(
    <dialog ref={dialog} aria-labelledby="seminar-edit-title" aria-describedby={confirmingDelete ? 'seminar-delete-text' : undefined}
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
      className="m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-2xl border border-paper-3 bg-paper p-0 text-ink shadow-xl backdrop:bg-[rgba(22,35,29,.45)] backdrop:backdrop-blur-sm">
      <div className="p-6 sm:p-8">
        <div className="mb-5 flex items-start gap-4">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl ${tone}`} aria-hidden="true">
            <i className={'ph-bold ' + icon}></i>
          </span>
          <div className="min-w-0 flex-1 pt-1">
            <h2 id="seminar-edit-title" className={`font-serif text-2xl font-medium leading-tight ${confirmingDelete ? 'text-revoked' : ''}`}>{heading}</h2>
            {!confirmingDelete && <p className="mt-1 break-words text-sm text-ink-muted">{seminar.seminarTitle}</p>}
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close"
            className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-black/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest disabled:cursor-not-allowed disabled:opacity-40">
            <i className="ph-bold ph-x" aria-hidden="true"></i>
          </button>
        </div>

        {locked ? (
          <p role="note" className="rounded-xl border border-[var(--line)] bg-paper-2 p-4 text-sm text-ink-soft">
            Certificates have already been prepared for this seminar, so its title, date and certificate design are fixed.
            To correct an issued certificate, revoke it in the Registry tab, then prepare a replacement.
          </p>
        ) : confirmingDelete ? (
          <div>
            <p id="seminar-delete-text" className="text-sm leading-relaxed text-ink-soft">
              <b className="break-words text-ink">{seminar.seminarTitle}</b> will be removed
              {seminar.registrationCount > 0 && <> together with its attendance list ({seminar.registrationCount} {seminar.registrationCount === 1 ? 'student' : 'students'})</>}.
              Student accounts are not affected.
            </p>
            <p className="mt-3 flex items-center gap-2 rounded-xl bg-revoked-bg px-4 py-3 text-sm font-medium text-revoked">
              <i className="ph-bold ph-warning-circle" aria-hidden="true"></i>This can't be undone.
            </p>
            {remove.error && <p role="alert" className="mt-3 text-sm text-revoked">{remove.error.message}</p>}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row">
              {/* Cancel takes focus so pressing Enter by habit doesn't delete. */}
              <Btn variant="line" className="flex-1" autoFocus disabled={busy} onClick={() => { remove.reset(); setConfirmingDelete(false); }}>Cancel</Btn>
              <Btn variant="danger" className="flex-1" icon="ph-trash" disabled={busy} onClick={() => remove.mutate()}>
                {remove.isPending ? 'Deleting...' : 'Delete seminar'}</Btn>
            </div>
          </div>
        ) : (
          <form onSubmit={event => { event.preventDefault(); if (!busy && !unchanged) save.mutate(); }}>
            <fieldset disabled={busy} className="space-y-4">
              <div>
                <label htmlFor="edit-seminar-title" className="eyebrow mb-2 block">Seminar title</label>
                <input id="edit-seminar-title" className="field" required maxLength={255} autoComplete="off" autoFocus
                  value={title} onChange={event => { save.reset(); setTitle(event.target.value); }} />
              </div>
              <div>
                <label htmlFor="edit-seminar-date" className="eyebrow mb-2 block">Seminar date</label>
                <input id="edit-seminar-date" className="field" type="date" min="0001-01-01" max="9999-12-31" required
                  value={date} onChange={event => { save.reset(); setDate(event.target.value); }} />
              </div>
              <TemplatePicker id="edit-seminar-template" value={templateID} onChange={value => { save.reset(); setTemplateID(value); }} />
              {save.error && <p role="alert" className="text-sm text-revoked">{save.error.message}</p>}
              <div className="flex gap-3 pt-2">
                <Btn type="button" variant="line" className="flex-1" onClick={onClose}>Cancel</Btn>
                <Btn type="submit" className="flex-1" icon="ph-check" disabled={unchanged}>{save.isPending ? 'Saving...' : 'Save changes'}</Btn>
              </div>
            </fieldset>
            {canDelete && <div className="hair mt-6 flex flex-wrap items-center justify-between gap-3 pt-5">
              <p className="text-xs text-ink-muted">Created this seminar by mistake?</p>
              <Btn type="button" variant="ghost" size="sm" icon="ph-trash" className="!text-revoked hover:!bg-revoked-bg"
                disabled={busy} onClick={() => setConfirmingDelete(true)}>Delete seminar</Btn>
            </div>}
          </form>
        )}
      </div>
    </dialog>,
    document.body,
  );
}

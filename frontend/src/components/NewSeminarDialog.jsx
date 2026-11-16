import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Btn } from './design-system';
import { api } from '../lib/api';
import TemplatePicker from './TemplatePicker';
import { inputToDeadline } from '../lib/registrationLink';

// Create a seminar; its registration link is ready to share as soon as it is saved.
export default function NewSeminarDialog({ onClose, onCreated }) {
  const queryClient = useQueryClient();
  const dialog = useRef(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [venue, setVenue] = useState('');
  const [deadline, setDeadline] = useState('');
  const [templateID, setTemplateID] = useState('');

  useEffect(() => { dialog.current.showModal(); }, []);

  const create = useMutation({
    mutationFn: () => api('/api/faculty/seminars', { method: 'POST', body: { seminarTitle: title, seminarDate: date, templateID: templateID || null,
      venue, registrationClosesAt: inputToDeadline(deadline) } }),
    onSuccess: async seminar => { await queryClient.invalidateQueries({ queryKey: ['faculty-seminars'] }); onCreated(seminar); },
  });
  const edit = setter => event => { create.reset(); setter(event.target.value); };

  return createPortal(
    <dialog ref={dialog} aria-labelledby="new-seminar-title"
      onCancel={event => { event.preventDefault(); if (!create.isPending) onClose(); }}
      className="m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-2xl border border-paper-3 bg-paper p-0 text-ink shadow-xl backdrop:bg-[rgba(22,35,29,.45)] backdrop:backdrop-blur-sm">
      <div className="p-6 sm:p-8">
        <div className="mb-5 flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-forest text-xl text-white" aria-hidden="true">
            <i className="ph-bold ph-calendar-plus"></i>
          </span>
          <div className="min-w-0 flex-1 pt-1">
            <h2 id="new-seminar-title" className="font-serif text-2xl font-medium leading-tight">New seminar</h2>
            <p className="mt-1 text-sm text-ink-muted">Then share its registration link with students.</p>
          </div>
          <button type="button" onClick={onClose} disabled={create.isPending} aria-label="Close"
            className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-black/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest disabled:cursor-not-allowed disabled:opacity-40">
            <i className="ph-bold ph-x" aria-hidden="true"></i>
          </button>
        </div>

        <form onSubmit={event => { event.preventDefault(); if (!create.isPending) create.mutate(); }}>
          <fieldset disabled={create.isPending} className="space-y-4">
            <div>
              <label htmlFor="seminar-title" className="eyebrow mb-2 block">Seminar title</label>
              <input id="seminar-title" className="field" required maxLength={255} autoComplete="off" autoFocus placeholder="e.g. Web Security Fundamentals"
                value={title} onChange={edit(setTitle)} />
            </div>
            <div>
              <label htmlFor="seminar-date" className="eyebrow mb-2 block">Seminar date</label>
              <input id="seminar-date" className="field" type="date" min="0001-01-01" max="9999-12-31" required value={date} onChange={edit(setDate)} />
            </div>
            <div>
              <label htmlFor="seminar-venue" className="eyebrow mb-2 block">Venue</label>
              <input id="seminar-venue" className="field" required maxLength={255} autoComplete="off" placeholder="e.g. CICT AVR" value={venue} onChange={edit(setVenue)} />
            </div>
            <div>
              <label htmlFor="seminar-deadline" className="eyebrow mb-2 block">Registration deadline</label>
              <input id="seminar-deadline" className="field" type="datetime-local" required value={deadline} onChange={edit(setDeadline)} />
            </div>
            <TemplatePicker id="seminar-template" value={templateID} onChange={value => { create.reset(); setTemplateID(value); }} />
            {create.error && <p role="alert" className="text-sm text-revoked">{create.error.message}</p>}
            <div className="flex gap-3 pt-2">
              <Btn type="button" variant="line" className="flex-1" onClick={onClose}>Cancel</Btn>
              <Btn type="submit" className="flex-1" icon="ph-plus">{create.isPending ? 'Creating...' : 'Create seminar'}</Btn>
            </div>
          </fieldset>
        </form>
      </div>
    </dialog>,
    document.body,
  );
}

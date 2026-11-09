import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Btn } from './design-system';
import { api } from '../lib/api';

export default function AttendanceImport({ seminarID, disabled }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState(null);
  const input = useRef(null);
  const review = useMutation({
    mutationFn: async file => {
      if (!file || file.size === 0 || file.size > 1024 * 1024) throw new Error('Choose a non-empty CSV file up to 1 MB.');
      const csv = await file.text();
      const result = await api('/api/faculty/seminars/' + seminarID + '/attendance/preview', { method: 'POST', body: { csv } });
      return { ...result, csv };
    },
  });
  const save = useMutation({
    mutationFn: () => api('/api/faculty/seminars/' + seminarID + '/attendance/import', {
      method: 'POST', body: { csv: review.data.csv, previewHash: review.data.previewHash },
    }),
    onSuccess: async () => {
      review.reset();
      setFile(null);
      if (input.current) input.current.value = '';
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['faculty-seminars'] }),
        queryClient.invalidateQueries({ queryKey: ['seminar-registrations', seminarID] }),
        queryClient.invalidateQueries({ queryKey: ['seminar-certificates', seminarID] }),
      ]);
    },
    onError: () => review.reset(),
  });
  const busy = disabled || review.isPending || save.isPending;
  const preview = review.data;

  return (
    <section className="mt-8 border-t border-[var(--line)] pt-6">
      <h3 className="font-serif text-2xl">Import final attendance</h3>
      <p className="mb-4 mt-2 text-sm text-ink-soft">Upload the final recipient list after the seminar. Only <code>google_account</code> is required; names, section, program, and student ID columns are ignored.</p>
      <p className="mb-4 text-sm text-ink-soft">This list replaces saved attendance for this seminar. Registered students omitted from the list will be marked absent. Review the changes before confirming.</p>
      <form className="space-y-4" onSubmit={event => {
        event.preventDefault();
        if (busy) return;
        save.reset();
        review.mutate(file);
      }}>
        <label htmlFor="attendance-csv" className="block text-sm font-medium">Attendance CSV (up to 1 MB)</label>
        <input ref={input} id="attendance-csv" className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-[var(--line)] file:bg-white file:px-3 file:py-2" type="file" accept=".csv,text/csv" required disabled={busy} onChange={event => {
          setFile(event.target.files?.[0] || null);
          review.reset();
          save.reset();
        }} />
        <Btn type="submit" variant="line" disabled={busy || !file}>{review.isPending ? 'Reviewing...' : 'Review attendance'}</Btn>
      </form>
      {review.error && <p role="alert" className="mt-4 text-sm text-revoked">{review.error.message}</p>}
      {save.error && <p role="alert" className="mt-4 text-sm text-revoked">{save.error.message}</p>}
      {preview && <div className="mt-5 space-y-4 rounded-xl border border-[var(--line)] bg-paper p-4">
        <p className="text-sm"><strong>{preview.matched.length}</strong> registered attendees matched; <strong>{preview.duplicatesSkipped}</strong> duplicate entries skipped; <strong>{preview.awaitingWallet}</strong> attendees awaiting wallet setup.</p>
        <p className="text-sm text-ink-soft">{preview.newlyAttended} will be marked attended; {preview.removed.length} previously marked attendees will be marked absent.</p>
        {preview.matched.length > 0 && <details>
          <summary className="cursor-pointer text-sm font-medium">Matched attendees ({preview.matched.length})</summary>
          <ul className="mt-2 space-y-2 text-sm text-ink-soft">{preview.matched.map(student => <li key={student.studentID} className="break-words">{student.fullName} — {student.email}</li>)}</ul>
        </details>}
        {preview.removed.length > 0 && <details>
          <summary className="cursor-pointer text-sm font-medium">Attendance to clear ({preview.removed.length})</summary>
          <ul className="mt-2 space-y-2 text-sm text-ink-soft">{preview.removed.map(student => <li key={student.studentID} className="break-words">{student.fullName} — {student.email}</li>)}</ul>
        </details>}
        {preview.unmatched.length > 0 && <div role="alert" className="text-sm text-revoked">
          <p className="font-medium">These emails are not registered for this seminar:</p>
          <ul className="my-2 list-disc space-y-1 pl-5">{preview.unmatched.map(email => <li key={email} className="break-all">{email}</li>)}</ul>
          <p>Correct the emails or import their registrations for this seminar, then review again. Nothing has been saved.</p>
        </div>}
        {preview.blocked.length > 0 && <div role="alert" className="text-sm text-revoked">
          <p>Attendance cannot be cleared while these students have an issued certificate or an unresolved blockchain transaction:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">{preview.blocked.map(student => <li key={student.studentID} className="break-words">{student.fullName} — {student.email}</li>)}</ul>
        </div>}
        <Btn type="button" disabled={busy || !preview.canSave} onClick={() => {
          if (!busy && preview.canSave) save.mutate();
        }}>{save.isPending ? 'Saving attendance...' : 'Confirm attendance'}</Btn>
      </div>}
      {save.data && <p role="status" className="mt-4 rounded-xl bg-verified-bg p-4 text-sm text-verified">
        Attendance saved: {save.data.attended} attended; {save.data.markedAttended} newly marked attended; {save.data.markedAbsent} marked absent. {save.data.awaitingWallet} attendees still need wallet setup.
      </p>}
    </section>
  );
}

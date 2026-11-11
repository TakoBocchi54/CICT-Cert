import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Btn } from './design-system';
import { api } from '../lib/api';
import { useSessionDraft } from '../lib/sessionDraft';
import { useFacultyMe } from '../hooks/useFacultyMe';
import CsvDropZone from './CsvDropZone';
import DoneCard from './DoneCard';

// Upload → preview → (register unknown attendees) → confirm. The draft ({ name, csv, aliases, preview }) survives tab
// switches and reloads; a stale preview is still rejected by the server on confirm.
export default function AttendanceImport({ seminarID, attendanceCount, disabled, onSaved }) {
  const queryClient = useQueryClient();
  const faculty = useFacultyMe();
  const [draft, setDraft] = useSessionDraft('cict-attendance-' + seminarID);
  const [fileError, setFileError] = useState('');
  const [correcting, setCorrecting] = useState(false);
  const review = useMutation({
    mutationFn: ({ csv, aliases }) => api('/api/faculty/seminars/' + seminarID + '/attendance/preview', { method: 'POST', body: { csv, aliases } }),
    onSuccess: (preview, { aliases }) => setDraft({ ...draft, aliases, preview }),
    // An alias that no longer applies is dropped so the next review starts clean.
    onError: () => { if (draft?.aliases) setDraft({ name: draft.name, csv: draft.csv }); },
  });
  const reviewDraft = (aliases = draft.aliases) => { save.reset(); review.mutate({ csv: draft.csv, aliases }); };
  const save = useMutation({
    mutationFn: async () => {
      const attendance = await api('/api/faculty/seminars/' + seminarID + '/attendance/import', {
        method: 'POST', body: { csv: draft.csv, previewHash: draft.preview.previewHash, aliases: draft.aliases },
      });
      // Attendance is saved at this point; a failed preparation is reported, not thrown.
      if (!faculty.data?.canIssue) return { attendance };
      try {
        return { attendance, prepared: await api(`/api/faculty/seminars/${seminarID}/certificates/prepare`, { method: 'POST' }) };
      } catch (err) { return { attendance, prepareError: err.message }; }
    },
    onSuccess: async result => {
      setDraft(null);
      setCorrecting(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['faculty-seminars'] }),
        queryClient.invalidateQueries({ queryKey: ['faculty-students'] }),
        queryClient.invalidateQueries({ queryKey: ['seminar-certificates', seminarID] }),
      ]);
      onSaved?.(result);
    },
    // A rejected confirm (usually a stale preview) needs a fresh review.
    onError: () => setDraft(draft && { name: draft.name, csv: draft.csv, aliases: draft.aliases }),
  });
  const busy = disabled || review.isPending || save.isPending;
  const preview = draft?.preview;
  const notMatched = preview ? preview.unregistered.length + preview.facultyEmails.length : 0;

  return (
    <div>
      <p className="mb-2 text-ink-soft max-w-2xl">Upload the final recipient list after the seminar. Only <code>google_account</code> is required. If the file has <code>full_name</code> and <code>program</code>, they prefill registration for attendees who don't have an account yet; other columns are ignored.</p>
      <p className="mb-6 text-sm text-ink-muted max-w-2xl">This list replaces saved attendance for this seminar: students left out are marked absent. Nothing is saved until you confirm.</p>
      {/* Once attendance is confirmed, the upload box stays out of the way unless the list needs correcting. */}
      {attendanceCount > 0 && !correcting && !draft ? <DoneCard count={attendanceCount}
        label={attendanceCount === 1 ? 'attendee confirmed' : 'attendees confirmed'}
        note="Correcting replaces the whole list. Students with an issued certificate cannot be removed."
        action="Correct attendance" onAction={() => { review.reset(); save.reset(); setCorrecting(true); }} disabled={busy} /> : <>
        <CsvDropZone id={'attendance-csv-' + seminarID} title="Drop the attendance CSV" draft={draft} disabled={busy}
          onDraft={next => { setFileError(''); review.reset(); save.reset(); setDraft(next); }} onError={setFileError} />
        {correcting && !draft && <Btn variant="ghost" size="sm" className="mt-3" onClick={() => setCorrecting(false)}>Cancel</Btn>}
      </>}
      {fileError && <p role="alert" className="mt-3 text-sm text-revoked">{fileError}</p>}
      {draft && !preview && <Btn className="mt-5" disabled={busy} iconRight="ph-arrow-right" onClick={() => reviewDraft()}>
        {review.isPending ? 'Reviewing...' : 'Review attendance'}
      </Btn>}
      {review.error && <p role="alert" className="mt-4 text-sm text-revoked">{review.error.message}</p>}
      {save.error && <p role="alert" className="mt-4 text-sm text-revoked">{save.error.message}</p>}

      {preview && <div className="mt-6 space-y-5">
        <div className="grid gap-4 sm:grid-cols-[1.5fr_1fr]">
          <div className="rounded-2xl p-6 bg-verified-bg border border-[#bfe0cd]">
            <div className="font-serif font-medium leading-none text-verified" style={{ fontSize: 64, letterSpacing: '-.04em' }}>{preview.matched.length}</div>
            <div className="eyebrow !text-verified mt-2">Registered attendees matched</div>
            <p className="text-xs text-verified mt-3">{preview.newlyAttended} newly marked attended · {preview.awaitingWallet} awaiting wallet setup · {preview.duplicatesSkipped} duplicates skipped</p>
          </div>
          <div className={'rounded-2xl p-6 border ' + (notMatched || preview.blocked.length ? 'bg-revoked-bg border-[#f0c4bf]' : 'bg-paper border-[var(--line)]')}>
            <div className={'font-serif font-medium leading-none ' + (notMatched ? 'text-revoked' : 'text-ink')} style={{ fontSize: 48 }}>{notMatched}</div>
            <div className={'eyebrow mt-2 ' + (notMatched ? '!text-revoked' : '')}>Not registered</div>
            <p className="text-xs text-ink-muted mt-3">{preview.removed.length} previously attended will be marked absent</p>
          </div>
        </div>
        {preview.matched.length > 0 && <details>
          <summary className="cursor-pointer text-sm font-medium">Matched attendees ({preview.matched.length})</summary>
          <ul className="mt-2 space-y-2 text-sm text-ink-soft">{preview.matched.map(student => <li key={student.studentID} className="break-words">
            {student.fullName} — {student.email}{student.listedAs && <span className="text-ink-muted"> (listed as {student.listedAs})</span>}
          </li>)}</ul>
        </details>}
        {preview.removed.length > 0 && <details>
          <summary className="cursor-pointer text-sm font-medium">Attendance to clear ({preview.removed.length})</summary>
          <ul className="mt-2 space-y-2 text-sm text-ink-soft">{preview.removed.map(student => <li key={student.studentID} className="break-words">{student.fullName} — {student.email}</li>)}</ul>
        </details>}
        {notMatched > 0 && <UnregisteredPrompt key={preview.previewHash} preview={preview} disabled={busy}
          onUseAccount={(listed, account) => reviewDraft({ ...draft.aliases, [listed]: account })} onRegistered={() => reviewDraft()} />}
        {preview.blocked.length > 0 && <div role="alert" className="text-sm text-revoked">
          <p>Attendance cannot be cleared while these students have an issued certificate or an unresolved blockchain transaction:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">{preview.blocked.map(student => <li key={student.studentID} className="break-words">{student.fullName} — {student.email}</li>)}</ul>
        </div>}
        <div className="flex flex-wrap items-center gap-3">
          <Btn disabled={busy || !preview.canSave} iconRight="ph-arrow-right" onClick={() => { if (!busy && preview.canSave) save.mutate(); }}>
            {save.isPending ? 'Saving attendance...' : faculty.data?.canIssue ? 'Confirm attendance and prepare certificates' : 'Confirm attendance'}
          </Btn>
          <span className="text-xs text-ink-muted">{preview.canSave ? 'Preparing certificates does not mint or spend POL.' : 'Every listed email must match a registered student before you can confirm.'}</span>
        </div>
      </div>}
    </div>
  );
}

// "N students in this list aren't registered yet. Register them?" Guards against creating wrong accounts:
// suggested matches start unticked (2), names and programs are editable (3), "Use this account" maps a typo to an
// existing student (1), and a list that is mostly unknown must be confirmed as the right file first (4).
function UnregisteredPrompt({ preview, disabled, onUseAccount, onRegistered }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState(() => Object.fromEntries(preview.unregistered.map(row =>
    [row.email, { checked: !row.suggestions.length, fullName: row.fullName, program: row.program }])));
  const [rightFile, setRightFile] = useState(false);
  const register = useMutation({
    mutationFn: students => api('/api/faculty/students', { method: 'POST', body: { students } }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['faculty-students'] }); onRegistered(); },
  });
  const count = preview.unregistered.length;
  const total = preview.matched.length + count + preview.facultyEmails.length;
  const suspicious = count >= 10 && count * 2 >= total;
  const selected = preview.unregistered.filter(row => rows[row.email].checked);
  const incomplete = selected.some(row => !rows[row.email].fullName.trim() || !rows[row.email].program.trim());
  const busy = disabled || register.isPending;
  const update = (email, patch) => { register.reset(); setRows({ ...rows, [email]: { ...rows[email], ...patch } }); };

  return (
    <div className="space-y-4">
      {preview.facultyEmails.length > 0 && <div role="alert" className="text-sm text-revoked">
        <p className="font-medium">These emails belong to faculty accounts and can't be registered as students. Remove them from the CSV and upload it again:</p>
        <ul className="my-2 list-disc space-y-1 pl-5">{preview.facultyEmails.map(email => <li key={email} className="break-all">{email}</li>)}</ul>
      </div>}
      {count > 0 && <section className="rounded-2xl border border-[#f0c4bf] bg-revoked-bg/40 p-5" aria-labelledby="unregistered-title">
        <h3 id="unregistered-title" className="font-serif text-2xl">
          {count === 1 ? "1 student in this list isn't registered yet." : `${count} students in this list aren't registered yet.`} Register them?
        </h3>
        <p className="text-sm text-ink-soft mt-1">Check each name and program: they appear on the certificate. Rows that look like an existing student start unticked.</p>
        {suspicious && <div role="alert" className="mt-4 rounded-xl border border-[#f0c4bf] bg-white p-4 text-sm">
          <p className="font-medium text-revoked">{count} of {total} aren't registered. Is this the right attendance file?</p>
          <label className="mt-2 flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={rightFile} disabled={busy} onChange={event => setRightFile(event.target.checked)} className="w-4 h-4 accent-[var(--forest)]" />
            I checked this is the right attendance file
          </label>
        </div>}
        <ul className="mt-4 space-y-3 max-h-[480px] overflow-y-auto pr-1">{preview.unregistered.map((row, index) => {
          const state = rows[row.email];
          return <li key={row.email} className="rounded-xl border border-[var(--line)] bg-white p-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={state.checked} disabled={busy} onChange={event => update(row.email, { checked: event.target.checked })} className="w-4 h-4 shrink-0 accent-[var(--forest)]" />
              <span className="font-mono text-sm break-all">{row.email}</span>
            </label>
            <div className="grid gap-3 sm:grid-cols-[1.5fr_1fr] mt-3">
              <div>
                <label htmlFor={'unregistered-name-' + index} className="block text-xs font-medium text-ink-muted mb-1">Full name</label>
                <input id={'unregistered-name-' + index} className="field" maxLength={255} disabled={busy || !state.checked} value={state.fullName}
                  onChange={event => update(row.email, { fullName: event.target.value })} />
              </div>
              <div>
                <label htmlFor={'unregistered-program-' + index} className="block text-xs font-medium text-ink-muted mb-1">Program</label>
                <input id={'unregistered-program-' + index} className="field" maxLength={255} disabled={busy || !state.checked} value={state.program}
                  onChange={event => update(row.email, { program: event.target.value })} />
              </div>
            </div>
            {row.suggestions.map(suggestion => <div key={suggestion.studentID} className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-paper-2 p-3 text-sm">
              <span className="break-words">Did you mean <strong>{suggestion.fullName}</strong> (<span className="break-all">{suggestion.email}</span>)?</span>
              <Btn variant="line" size="sm" disabled={busy} onClick={() => onUseAccount(row.email, suggestion.email)}>Use this account</Btn>
            </div>)}
          </li>;
        })}</ul>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Btn icon="ph-user-plus" disabled={busy || !selected.length || incomplete || (suspicious && !rightFile)}
            onClick={() => register.mutate(selected.map(row => ({ fullName: rows[row.email].fullName, program: rows[row.email].program, googleAccount: row.email })))}>
            {register.isPending ? 'Registering...' : `Register ${selected.length} selected`}
          </Btn>
          {incomplete && <span className="text-xs text-revoked">Fill in the name and program for every ticked row.</span>}
        </div>
        {register.error && <p role="alert" className="mt-3 text-sm text-revoked">{register.error.message}</p>}
      </section>}
    </div>
  );
}

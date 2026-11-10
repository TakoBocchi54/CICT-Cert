import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn } from '../components/design-system';
import { api } from '../lib/api';
import AttendanceImport from '../components/AttendanceImport';
import CertificatePreparation from '../components/CertificatePreparation';

export default function IssuancePage({ onNavigateRegistry }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [file, setFile] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const fileInput = useRef(null);
  const seminars = useQuery({
    queryKey: ['faculty-seminars'],
    queryFn: () => api('/api/faculty/seminars'),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const selected = seminars.data?.find(seminar => seminar.seminarID === selectedId) || seminars.data?.[0];
  const registrations = useQuery({
    queryKey: ['seminar-registrations', selected?.seminarID],
    queryFn: () => api('/api/faculty/seminars/' + selected.seminarID + '/registrations'),
    enabled: !!selected,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const create = useMutation({
    mutationFn: body => api('/api/faculty/seminars', { method: 'POST', body }),
    onSuccess: async seminar => {
      setTitle('');
      setDate('');
      changeSeminar(seminar.seminarID);
      await queryClient.invalidateQueries({ queryKey: ['faculty-seminars'] });
    },
  });
  const upload = useMutation({
    mutationFn: async ({ seminarID, file }) => {
      if (!file || file.size === 0 || file.size > 1024 * 1024) throw new Error('Choose a non-empty CSV file up to 1 MB.');
      return api('/api/faculty/seminars/' + seminarID + '/registrations/import', {
        method: 'POST', body: { csv: await file.text() },
      });
    },
    onSuccess: async (result, { seminarID }) => {
      setFeedback(result);
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['faculty-seminars'] }),
        queryClient.invalidateQueries({ queryKey: ['seminar-registrations', seminarID] }),
      ]);
    },
  });
  const busy = create.isPending || upload.isPending;

  function changeSeminar(id) {
    setSelectedId(id);
    setFile(null);
    setFeedback(null);
    upload.reset();
    if (fileInput.current) fileInput.current.value = '';
  }

  return (
    <div className="pb-16">
      <header className="mb-9 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-3">Faculty workspace</div>
          <h1 className="font-serif text-4xl font-medium md:text-5xl">Seminar registrations</h1>
          <p className="mt-3 max-w-2xl text-ink-soft">Create a seminar and register students using their Google accounts before the event.</p>
        </div>
        <Btn variant="line" onClick={onNavigateRegistry}>Back to dashboard</Btn>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[340px_1fr]">
        <section className="sheet p-6">
          <h2 className="mb-5 font-serif text-2xl">Create a seminar</h2>
          <form onSubmit={event => {
            event.preventDefault();
            if (!busy) create.mutate({ seminarTitle: title, seminarDate: date });
          }}>
            <fieldset disabled={busy} className="space-y-4">
              <div>
                <label htmlFor="seminar-title" className="mb-2 block text-sm font-medium">Seminar title</label>
                <input id="seminar-title" className="field" required maxLength={255} value={title} onChange={event => setTitle(event.target.value)} />
              </div>
              <div>
                <label htmlFor="seminar-date" className="mb-2 block text-sm font-medium">Seminar date</label>
                <input id="seminar-date" className="field" type="date" min="0001-01-01" max="9999-12-31" required value={date} onChange={event => setDate(event.target.value)} />
              </div>
              {create.error && <p role="alert" className="text-sm text-revoked">{create.error.message}</p>}
              <Btn type="submit" disabled={busy} className="w-full">{create.isPending ? 'Saving...' : 'Create seminar'}</Btn>
            </fieldset>
          </form>
        </section>

        <section className="sheet min-w-0 p-6">
          <h2 className="mb-5 font-serif text-2xl">Import registrations</h2>
          {seminars.isPending ? <p role="status">Loading seminars...</p> : seminars.error ? (
            <div role="alert" className="space-y-3">
              <p className="text-sm text-revoked">{seminars.error.message}</p>
              <Btn variant="line" onClick={() => seminars.refetch()}>Try again</Btn>
            </div>
          ) : !selected ? <p className="text-ink-soft">Create your first seminar to import its registration list.</p> : (
            <>
              <label htmlFor="selected-seminar" className="mb-2 block text-sm font-medium">Seminar</label>
              <select id="selected-seminar" className="field" value={selected.seminarID} disabled={busy} onChange={event => changeSeminar(event.target.value)}>
                {seminars.data.map(seminar => <option key={seminar.seminarID} value={seminar.seminarID}>{seminar.seminarTitle} — {seminar.seminarDate}</option>)}
              </select>
              <div className="my-5 flex flex-wrap gap-4 text-sm">
                <span><strong>{selected.registrationCount}</strong> registered</span>
                <span><strong>{selected.walletCount}</strong> wallets connected</span>
                <span><strong>{selected.attendanceCount}</strong> attended</span>
                <span><strong>{selected.registrationCount - selected.walletCount}</strong> awaiting wallet setup</span>
              </div>
              <form className="space-y-4 rounded-xl border border-[var(--line)] bg-paper p-4" onSubmit={event => {
                event.preventDefault();
                if (busy) return;
                setFeedback(null);
                upload.mutate({ seminarID: selected.seminarID, file });
              }}>
                <div>
                  <label htmlFor="registration-csv" className="mb-2 block text-sm font-medium">Registration CSV</label>
                  <input ref={fileInput} id="registration-csv" className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-[var(--line)] file:bg-white file:px-3 file:py-2" type="file" accept=".csv,text/csv" required disabled={busy} onChange={event => {
                    setFile(event.target.files?.[0] || null);
                    setFeedback(null);
                    upload.reset();
                  }} />
                </div>
                <p className="break-words text-xs leading-relaxed text-ink-soft">Required headers: <code>full_name,program,google_account</code>. Your <code>section</code> column and other extra columns are ignored. Maximum file size: 1 MB.</p>
                <p className="text-xs leading-relaxed text-ink-soft">Existing student profiles and wallet links are kept. Reimporting adds only missing registrations; review the saved names below.</p>
                {upload.error && <p role="alert" className="text-sm text-revoked">{upload.error.message}</p>}
                <Btn type="submit" disabled={busy || !file}>{upload.isPending ? 'Importing...' : 'Import registrations'}</Btn>
              </form>
              {feedback && <p role="status" className="mt-4 rounded-xl bg-verified-bg p-4 text-sm text-verified">
                {feedback.imported} registrations added; {feedback.alreadyRegistered} already registered; {feedback.duplicatesSkipped} duplicate CSV entries skipped. {feedback.newStudents} new student accounts created.
              </p>}
              <p className="mt-5 text-sm text-ink-soft">Registered students can sign in with their listed Google account and connect a wallet. Certificate issuance follows attendance and recipient approval.</p>
              <h3 className="mb-3 mt-7 font-serif text-xl">Registered students</h3>
              {registrations.isPending ? <p role="status">Loading registrations...</p> : registrations.error ? (
                <div role="alert" className="space-y-3">
                  <p className="text-sm text-revoked">{registrations.error.message}</p>
                  <Btn variant="line" onClick={() => registrations.refetch()}>Try again</Btn>
                </div>
              ) : !registrations.data?.length ? <p className="text-sm text-ink-muted">No students registered for this seminar yet.</p> : (
                <div className="overflow-x-auto rounded-xl border border-[var(--line)]">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <caption className="sr-only">Students registered for {selected.seminarTitle}</caption>
                    <thead className="bg-paper-2"><tr>
                      <th scope="col" className="p-3">Name</th><th scope="col" className="p-3">Google account</th>
                      <th scope="col" className="p-3">Program</th><th scope="col" className="p-3">Wallet</th><th scope="col" className="p-3">Attendance</th>
                    </tr></thead>
                    <tbody>{registrations.data.map(student => <tr key={student.studentID} className="border-t border-[var(--line)]">
                      <td className="p-3">{student.fullName}</td><td className="break-all p-3">{student.email}</td>
                      <td className="p-3">{student.program}</td><td className="p-3">{student.walletConnected ? 'Connected' : 'Awaiting setup'}</td><td className="p-3">{student.attended ? 'Attended' : 'Not marked'}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
              )}
              <AttendanceImport key={'attendance-' + selected.seminarID} seminarID={selected.seminarID} disabled={busy} />
              <CertificatePreparation key={'prepare-' + selected.seminarID} seminarID={selected.seminarID} disabled={busy} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

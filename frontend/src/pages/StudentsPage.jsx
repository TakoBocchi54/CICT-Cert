import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useSessionDraft } from '../lib/sessionDraft';
import { useFacultyMe } from '../hooks/useFacultyMe';
import CsvDropZone from '../components/CsvDropZone';
import { Btn } from '../components/design-system';

const EMPTY = { fullName: '', program: '', googleAccount: '' };

// Student accounts: registering a Google account is what lets a student sign in. Attendance is matched to these accounts.
export default function StudentsPage() {
  const queryClient = useQueryClient();
  const faculty = useFacultyMe();
  const [draft, setDraft] = useSessionDraft('cict-students-csv');
  const [fileError, setFileError] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [removing, setRemoving] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const students = useQuery({
    queryKey: ['faculty-students', q],
    queryFn: () => api('/api/faculty/students' + (q ? '?q=' + encodeURIComponent(q) : '')),
    placeholderData: previous => previous,
    retry: false,
  });
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['faculty-students'] }),
    queryClient.invalidateQueries({ queryKey: ['faculty-seminars'] }),
  ]);
  const upload = useMutation({
    mutationFn: csv => api('/api/faculty/students/import', { method: 'POST', body: { csv } }),
    onSuccess: async () => { setDraft(null); await refresh(); },
  });
  const add = useMutation({
    mutationFn: student => api('/api/faculty/students', { method: 'POST', body: { students: [student] } }),
    onSuccess: async () => { setForm(EMPTY); await refresh(); },
  });
  const remove = useMutation({
    mutationFn: studentID => api('/api/faculty/students/' + studentID, { method: 'DELETE' }),
    onSuccess: async () => { setRemoving(null); await refresh(); },
  });
  const field = name => ({ value: form[name], onChange: event => { add.reset(); setForm({ ...form, [name]: event.target.value }); } });
  const canRemove = faculty.data?.canIssue;

  return (
    <div>
      <div className="mb-10">
        <div className="eyebrow mb-3 rise">Accounts</div>
        <h1 className="font-serif text-5xl md:text-6xl font-medium leading-[1.02] rise" style={{ '--d': '.05s' }}>Students</h1>
        <p className="text-ink-soft text-lg mt-4 max-w-xl rise" style={{ '--d': '.1s' }}>
          Register a student's Google account so they can sign in. Seminar attendance is matched to these accounts by email.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="sheet p-8 lg:col-span-7" aria-labelledby="bulk-title">
          <h2 id="bulk-title" className="font-serif text-2xl mb-2">Register from a CSV</h2>
          <p className="mb-5 text-sm text-ink-muted">Required headers: <code>full_name,program,google_account</code>. Extra columns are ignored. Existing accounts are kept unchanged.</p>
          <CsvDropZone id="students-csv" title="Drop the student CSV" draft={draft} disabled={upload.isPending}
            onDraft={next => { setFileError(''); upload.reset(); setDraft(next); }} onError={setFileError} />
          {fileError && <p role="alert" className="mt-3 text-sm text-revoked">{fileError}</p>}
          {draft && <Btn className="mt-5" disabled={upload.isPending} icon="ph-upload-simple" onClick={() => upload.mutate(draft.csv)}>
            {upload.isPending ? 'Registering...' : 'Register students'}</Btn>}
          {upload.error && <p role="alert" className="mt-4 text-sm text-revoked">{upload.error.message}</p>}
          {upload.data && <p role="status" className="mt-4 rounded-xl bg-verified-bg p-4 text-sm text-verified">
            {upload.data.created} new accounts registered; {upload.data.existing} already registered; {upload.data.duplicatesSkipped} duplicate CSV entries skipped.
          </p>}
        </section>

        <section className="sheet p-8 lg:col-span-5" aria-labelledby="single-title">
          <h2 id="single-title" className="font-serif text-2xl mb-5">Add one student</h2>
          <form onSubmit={event => { event.preventDefault(); add.mutate(form); }}>
            <label htmlFor="student-name" className="eyebrow block mb-2">Full name</label>
            <input id="student-name" className="field mb-4" required maxLength={255} autoComplete="off" {...field('fullName')} />
            <label htmlFor="student-program" className="eyebrow block mb-2">Program</label>
            <input id="student-program" className="field mb-4" required maxLength={255} autoComplete="off" placeholder="e.g. BSIT" {...field('program')} />
            <label htmlFor="student-email" className="eyebrow block mb-2">Google account</label>
            <input id="student-email" type="email" className="field mb-5" required maxLength={255} autoComplete="off" placeholder="name@gmail.com" {...field('googleAccount')} />
            <Btn type="submit" disabled={add.isPending} icon="ph-user-plus">{add.isPending ? 'Registering...' : 'Register student'}</Btn>
          </form>
          {add.error && <p role="alert" className="mt-4 text-sm text-revoked">{add.error.message}</p>}
          {add.data && <p role="status" className="mt-4 rounded-xl bg-verified-bg p-4 text-sm text-verified">
            {add.data.created ? 'Student registered. They can now sign in with Google.' : 'This Google account was already registered; nothing changed.'}
          </p>}
        </section>
      </div>

      <section className="mt-10" aria-labelledby="list-title">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
          <h2 id="list-title" className="font-serif text-3xl">Registered students</h2>
          <div className="w-full sm:w-80">
            <label htmlFor="student-search" className="sr-only">Search by name or email</label>
            <input id="student-search" type="search" className="field" placeholder="Search by name or email" value={search} onChange={event => setSearch(event.target.value)} />
          </div>
        </div>
        {students.isPending ? <p role="status">Loading students...</p> : students.error ? (
          <div role="alert" className="space-y-3">
            <p className="text-sm text-revoked">{students.error.message}</p>
            <Btn variant="line" onClick={() => students.refetch()}>Try again</Btn>
          </div>
        ) : !students.data.length ? <p className="text-sm text-ink-muted">{q ? 'No students match this search.' : 'No students registered yet.'}</p> : <>
          <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-white">
            <table className="w-full min-w-[720px] text-left text-sm">
              <caption className="sr-only">Registered students</caption>
              <thead className="bg-paper-2"><tr>
                <th scope="col" className="p-3">Name</th><th scope="col" className="p-3">Program</th>
                <th scope="col" className="p-3">Google account</th><th scope="col" className="p-3">Wallet</th>
                <th scope="col" className="p-3 text-right">Seminars</th><th scope="col" className="p-3 text-right">Certificates</th>
                {canRemove && <th scope="col" className="p-3"><span className="sr-only">Actions</span></th>}
              </tr></thead>
              <tbody>{students.data.map(student => <tr key={student.studentID} className="border-t border-[var(--line)]">
                <td className="p-3">{student.fullName}</td><td className="p-3">{student.program}</td>
                <td className="break-all p-3">{student.email}</td>
                <td className="p-3">{student.walletConnected ? 'Connected' : <span className="text-ink-muted">Not signed in yet</span>}</td>
                <td className="p-3 text-right tabular-nums">{student.seminarsAttended}</td>
                <td className="p-3 text-right tabular-nums">{student.certificates}</td>
                {canRemove && <td className="p-3 text-right">{student.removable &&
                  <Btn variant="ghost" size="sm" onClick={() => { remove.reset(); setRemoving(student); }}>Remove</Btn>}</td>}
              </tr>)}</tbody>
            </table>
          </div>
          {students.data.length === 200 && <p className="mt-3 text-xs text-ink-muted">Showing the first 200 students. Search to narrow the list.</p>}
        </>}
      </section>

      {removing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(22,35,29,.45)', backdropFilter: 'blur(4px)' }}
          onClick={() => !remove.isPending && setRemoving(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="remove-title" className="sheet pop w-full max-w-lg p-8" onClick={event => event.stopPropagation()}>
            <h3 id="remove-title" className="font-serif text-3xl font-medium">Remove this student?</h3>
            <p className="text-sm text-ink-soft mt-3">{removing.fullName} · <span className="break-all">{removing.email}</span></p>
            <p className="text-sm mt-4 mb-5">The account is deleted and the student can no longer sign in. {removing.seminarsAttended > 0 &&
              `Their attendance in ${removing.seminarsAttended} seminar${removing.seminarsAttended === 1 ? '' : 's'} is removed too. `}
              Only accounts that never connected a wallet and have no certificate can be removed.</p>
            {remove.error && <p role="alert" className="mb-4 text-sm text-revoked">{remove.error.message}</p>}
            <div className="flex gap-3">
              <Btn variant="line" className="flex-1" disabled={remove.isPending} onClick={() => setRemoving(null)}>Cancel</Btn>
              <Btn variant="danger" className="flex-1" disabled={remove.isPending} onClick={() => remove.mutate(removing.studentID)}>
                {remove.isPending ? 'Removing...' : 'Remove student'}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

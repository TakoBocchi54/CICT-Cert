import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn } from '../components/design-system';
import { api } from '../lib/api';
import { useFacultyMe } from '../hooks/useFacultyMe';
import AttendanceImport from '../components/AttendanceImport';
import CertificatePreparation from '../components/CertificatePreparation';

const fmt = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

// Students are registered in the Students tab; a seminar's attendees come from its attendance list.
const STEPS = ['Seminar', 'Attendance', 'Approvals', 'Issue'];

// Whether a seminar has finished each step, from the counts in GET /api/faculty/seminars.
function stepDone(seminar, index) {
  const { attendanceCount, readyCount, awaitingCount, issuedCount } = seminar;
  return [
    true,
    attendanceCount > 0,
    attendanceCount > 0 && awaitingCount === 0 && readyCount + issuedCount >= attendanceCount,
    attendanceCount > 0 && issuedCount >= attendanceCount,
  ][index];
}
const firstOpenStep = seminar => [1, 2, 3].find(index => !stepDone(seminar, index)) ?? 3;

function stepHint(seminar, index) {
  if (!seminar) return index === 0 ? 'Choose or create' : '';
  return [
    seminar.seminarTitle,
    seminar.attendanceCount ? `${seminar.attendanceCount} attended` : 'Final attendee list',
    seminar.awaitingCount ? `${seminar.awaitingCount} awaiting approval` : 'Students approve',
    seminar.attendanceCount ? `${seminar.issuedCount} of ${seminar.attendanceCount} issued` : 'Mint on Polygon',
  ][index];
}

export default function IssuancePage({ onNavigateRegistry }) {
  const queryClient = useQueryClient();
  const faculty = useFacultyMe();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  // ?seminar=<id> preselects a seminar (dashboard buttons); unknown IDs fall back to the newest seminar.
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get('seminar') || '');
  const [step, setStep] = useState(null);
  const [attendanceResult, setAttendanceResult] = useState(null);
  const seminars = useQuery({
    queryKey: ['faculty-seminars'],
    queryFn: () => api('/api/faculty/seminars'),
    retry: false,
    refetchOnWindowFocus: false,
    // Keep the rail counts current while auto-issuance mints in the background.
    refetchInterval: step === 3 && faculty.data?.autoIssue ? 15_000 : false,
  });
  const selected = seminars.data?.find(seminar => seminar.seminarID === selectedId) || seminars.data?.[0];
  // Open each seminar at its first unfinished step, once; after that the faculty member drives navigation.
  if (step === null && seminars.data) setStep(selected ? firstOpenStep(selected) : 0);
  const current = step ?? 0;

  const create = useMutation({
    mutationFn: body => api('/api/faculty/seminars', { method: 'POST', body }),
    onSuccess: async seminar => {
      setTitle('');
      setDate('');
      changeSeminar(seminar.seminarID, 1);
      await queryClient.invalidateQueries({ queryKey: ['faculty-seminars'] });
    },
  });

  function changeSeminar(id, nextStep) {
    setSelectedId(id);
    setAttendanceResult(null);
    setStep(nextStep);
  }

  const panelTitle = current === 0 ? 'Choose a seminar' : STEPS[current];
  return (
    <div className="pb-16">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <div className="eyebrow mb-3 rise break-words">Seminars{selected ? ' · ' + selected.seminarTitle : ''}</div>
          <h1 className="font-serif text-4xl md:text-5xl font-medium leading-[1.02] rise" style={{ '--d': '.05s' }}>Stage {current + 1}: {panelTitle}</h1>
        </div>
        <Btn variant="line" onClick={onNavigateRegistry}>Back to dashboard</Btn>
      </header>

      {seminars.isPending ? <p role="status">Loading seminars...</p> : seminars.error ? (
        <div role="alert" className="space-y-3">
          <p className="text-sm text-revoked">{seminars.error.message}</p>
          <Btn variant="line" onClick={() => seminars.refetch()}>Try again</Btn>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[250px_1fr]">
          {/* Stage rail: always clickable once a seminar exists */}
          <nav aria-label="Seminar steps" className="lg:sticky lg:top-28 lg:self-start">
            <ol className="grid grid-cols-4 gap-1 lg:grid-cols-1">
              {STEPS.map((name, index) => {
                const done = selected && index !== current && stepDone(selected, index);
                const active = index === current;
                return (
                  <li key={name}>
                    <button type="button" disabled={!selected && index > 0} aria-current={active ? 'step' : undefined}
                      onClick={() => setStep(index)}
                      className={'w-full flex flex-col lg:flex-row items-center gap-2 lg:gap-4 p-2 lg:p-3 rounded-2xl text-center lg:text-left transition-colors disabled:opacity-40 '
                        + (active ? 'bg-white border border-[var(--line)] shadow-sm' : 'hover:bg-black/5')}>
                      <span className={'w-10 h-10 rounded-full flex items-center justify-center font-serif text-lg shrink-0 '
                        + (done ? 'bg-verified text-white' : active ? 'bg-forest text-white' : 'border border-[var(--line)] text-ink-muted')}>
                        {done ? <i className="ph-bold ph-check text-base" aria-label="done"></i> : index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className={'block font-semibold text-xs lg:text-sm ' + (active || done ? '' : 'text-ink-muted')}>{name}</span>
                        <span className="hidden lg:block text-xs text-ink-muted truncate">{stepHint(selected, index)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className="sheet min-w-0 p-6 md:p-10 min-h-[520px] flex flex-col">
            {/* Every panel stays mounted (hidden when inactive) so switching steps keeps files and running batches. */}
            <section hidden={current !== 0} className="flex-1 fade-view">
              <SeminarStep seminars={seminars.data} selected={selected} onSelect={seminar => changeSeminar(seminar.seminarID, firstOpenStep(seminar))}
                create={create} title={title} setTitle={setTitle} date={date} setDate={setDate} />
            </section>
            {selected && <div key={selected.seminarID} className="flex-1 flex flex-col">
              <section hidden={current !== 1} className="flex-1 fade-view">
                <AttendanceImport seminarID={selected.seminarID} attendanceCount={selected.attendanceCount} disabled={create.isPending}
                  onSaved={result => { setAttendanceResult(result); setStep(2); }} />
              </section>
              <section hidden={current !== 2} className="flex-1 fade-view">
                {attendanceResult && <div role="status" className="mb-6 rounded-xl bg-verified-bg p-4 text-sm text-verified">
                  Attendance saved: {attendanceResult.attendance.attended} attended, {attendanceResult.attendance.markedAbsent} marked absent.
                  {attendanceResult.prepared && ` ${attendanceResult.prepared.prepared} certificates prepared; ${attendanceResult.prepared.awaitingWallet} attendees still need a wallet.`}
                  {attendanceResult.prepareError && <span className="block text-revoked">Certificates were not prepared: {attendanceResult.prepareError} Use Prepare certificates below.</span>}
                </div>}
                <CertificatePreparation mode="approvals" seminarID={selected.seminarID} disabled={create.isPending} />
              </section>
              <section hidden={current !== 3} className="flex-1 fade-view">
                <CertificatePreparation mode="issue" seminarID={selected.seminarID} disabled={create.isPending} />
              </section>
            </div>}

            <div className="flex justify-between gap-3 mt-10">
              {current > 0 ? <Btn variant="ghost" icon="ph-arrow-left" onClick={() => setStep(current - 1)}>Back</Btn> : <span />}
              {current < STEPS.length - 1 && selected && <Btn variant="line" iconRight="ph-arrow-right" onClick={() => setStep(current + 1)}>Continue to {STEPS[current + 1]}</Btn>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SeminarStep({ seminars, selected, onSelect, create, title, setTitle, date, setDate }) {
  return (
    <div className="grid gap-8 md:grid-cols-[1.3fr_1fr]">
      <div className="min-w-0">
        <h2 className="eyebrow mb-3">Your seminars</h2>
        {!seminars.length ? <p className="text-ink-soft">No seminars yet. Create one, then import its final attendance list.</p> : (
          <ul className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {seminars.map(seminar => {
              const active = seminar.seminarID === selected?.seminarID;
              return (
                <li key={seminar.seminarID}>
                  <button type="button" aria-pressed={active} onClick={() => onSelect(seminar)}
                    className={'w-full text-left rounded-xl border p-4 transition-colors ' + (active ? 'border-forest bg-white shadow-sm' : 'border-[var(--line)] hover:bg-paper')}>
                    <span className="flex items-start justify-between gap-3">
                      <span className="font-medium break-words">{seminar.seminarTitle}</span>
                      {active && <i className="ph-fill ph-check-circle text-forest text-xl shrink-0" aria-hidden="true"></i>}
                    </span>
                    <span className="block text-sm text-ink-muted mt-1">{fmt(seminar.seminarDate)}</span>
                    <span className="block text-xs text-ink-soft mt-2">{seminar.attendanceCount} attended · {seminar.issuedCount} issued</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <form className="rounded-2xl border border-[var(--line)] bg-paper p-6 self-start" onSubmit={event => {
        event.preventDefault();
        if (!create.isPending) create.mutate({ seminarTitle: title, seminarDate: date });
      }}>
        <h2 className="font-serif text-2xl mb-5">New seminar</h2>
        <fieldset disabled={create.isPending} className="space-y-4">
          <div>
            <label htmlFor="seminar-title" className="mb-2 block text-sm font-medium">Seminar title</label>
            <input id="seminar-title" className="field" required maxLength={255} value={title} onChange={event => setTitle(event.target.value)} />
          </div>
          <div>
            <label htmlFor="seminar-date" className="mb-2 block text-sm font-medium">Seminar date</label>
            <input id="seminar-date" className="field" type="date" min="0001-01-01" max="9999-12-31" required value={date} onChange={event => setDate(event.target.value)} />
          </div>
          {create.error && <p role="alert" className="text-sm text-revoked">{create.error.message}</p>}
          <Btn type="submit" className="w-full" icon="ph-plus">{create.isPending ? 'Saving...' : 'Create seminar'}</Btn>
        </fieldset>
      </form>
    </div>
  );
}

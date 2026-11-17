import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Btn } from '../components/design-system';
import { api } from '../lib/api';
import { useFacultyMe } from '../hooks/useFacultyMe';
import AttendanceImport from '../components/AttendanceImport';
import Registrants, { RegistrationLink } from '../components/Registrants';
import CertificatePreparation from '../components/CertificatePreparation';
import SeminarEditDialog from '../components/SeminarEditDialog';
import SeminarSelect from '../components/SeminarSelect';

const fmt = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

// Students register through the seminar's link; faculty then tick who attended.
const STEPS = ['Seminar', 'Attendance', 'Review', 'Issue'];
// The page heading names the task of each step.
const TITLES = ['Select seminar', 'Mark attendance', 'Review names', 'Issue certificates'];

// An attendance CSV mid-review (saved by AttendanceImport's session draft) reopens the upload panel.
const hasCsvDraft = seminarID => { try { return !!sessionStorage.getItem('cict-attendance-' + seminarID); } catch { return false; } };

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
  if (!seminar) return index === 0 ? 'Pick a seminar' : '';
  return [
    seminar.seminarTitle,
    seminar.attendanceCount ? `${seminar.attendanceCount} attended` : `${seminar.registrationCount} registered`,
    seminar.awaitingCount ? `${seminar.awaitingCount} awaiting wallet` : 'Check the names',
    seminar.attendanceCount ? `${seminar.issuedCount} of ${seminar.attendanceCount} issued` : 'Mint on Polygon',
  ][index];
}

export default function IssuancePage({ onNavigateRegistry, onNavigateSeminars }) {
  const faculty = useFacultyMe();
  // No seminar is selected by default; ?seminar=<id> (dashboard buttons) preselects one.
  const [selectedId, setSelectedId] = useState(() => Number(new URLSearchParams(window.location.search).get('seminar')) || '');
  const [step, setStep] = useState(null);
  const [attendanceResult, setAttendanceResult] = useState(null);
  const [editing, setEditing] = useState(false);
  const [actionSlot, setActionSlot] = useState(null);
  const [csvOpen, setCsvOpen] = useState(null); // null: open only if a CSV review is in progress
  const heading = useRef(null);
  const seminars = useQuery({
    queryKey: ['faculty-seminars'],
    queryFn: () => api('/api/faculty/seminars'),
    retry: false,
    refetchOnWindowFocus: false,
    // During check-in, other laptops change the counts; keep them current.
    refetchInterval: step === 1 ? 10_000 : false,
  });
  const selected = seminars.data?.find(seminar => seminar.seminarID === selectedId);
  // Open each seminar at its first unfinished step, once; after that the faculty member drives navigation.
  if (step === null && seminars.data) setStep(selected ? firstOpenStep(selected) : 0);
  const current = step ?? 0;
  const csvVisible = !!selected && (csvOpen ?? hasCsvDraft(selected.seminarID));

  // Moving between steps focuses the heading: screen readers announce the new step, and on phones the page
  // scrolls back up from the footer buttons to the top of the step.
  function goTo(index) {
    setStep(index);
    requestAnimationFrame(() => heading.current?.focus());
  }

  function changeSeminar(id, nextStep) {
    setSelectedId(id);
    setAttendanceResult(null);
    setCsvOpen(null);
    setStep(nextStep);
  }

  return (
    <div className="pb-16">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <h1 ref={heading} tabIndex={-1} className="scroll-mt-28 font-serif text-4xl sm:text-5xl md:text-6xl font-medium leading-[1.02] outline-none">
            <span className="text-ink">Step {current + 1}<span className="sr-only"> of {STEPS.length}</span>:</span> <span className="text-ink-muted">{TITLES[current]}</span></h1>
          {selected && <p className="mt-3 break-words text-lg text-ink-soft">{selected.seminarTitle}</p>}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {selected && <Btn variant="line" icon="ph-pencil-simple" onClick={() => setEditing(true)} aria-label={`Edit seminar ${selected.seminarTitle}`}>Edit</Btn>}
          <Btn variant="line" onClick={onNavigateRegistry}>Back to dashboard</Btn>
        </div>
      </header>

      {seminars.isPending ? (
        <div role="status" className="sheet flex items-center gap-3 p-6 text-sm text-ink-soft">
          <i className="ph-bold ph-circle-notch animate-spin text-lg" aria-hidden="true"></i>Loading seminars...
        </div>
      ) : seminars.error ? (
        <div role="alert" className="flex items-start gap-3 rounded-xl bg-revoked-bg px-4 py-3 text-sm text-revoked">
          <i className="ph-bold ph-warning-circle mt-0.5 text-base" aria-hidden="true"></i>
          <div className="space-y-3">
            <p>{seminars.error.message}</p>
            <Btn variant="line" size="sm" onClick={() => seminars.refetch()}>Try again</Btn>
          </div>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[250px_1fr]">
          {/* Stage rail: later steps open once a seminar is picked; step 1 switches seminars. */}
          <nav aria-label="Seminar steps" className="sheet p-2 lg:sticky lg:top-28 lg:self-start lg:p-3">
            <ol className="grid grid-cols-4 gap-1 lg:grid-cols-1">
              {STEPS.map((name, index) => {
                const done = selected && index !== current && stepDone(selected, index);
                const active = index === current;
                return (
                  <li key={name} className="relative">
                    {/* Connector to the next step (desktop rail only); green once this step is finished. */}
                    {index < STEPS.length - 1 && <span aria-hidden="true"
                      className={'absolute left-[33px] top-[57px] -bottom-[13px] hidden w-0.5 rounded-full lg:block ' + (selected && stepDone(selected, index) ?'bg-verified/60' : 'bg-[var(--line)]')} />}
                    <button type="button" disabled={index > 0 && !selected} aria-current={active ? 'step' : undefined}
                      onClick={() => goTo(index)} title={stepHint(selected, index) || undefined}
                      className={'relative w-full flex flex-col lg:flex-row items-center gap-2 lg:gap-4 p-2 lg:p-3 rounded-2xl border text-center lg:text-left transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest '
                        + (active ? 'bg-paper-2 border-[var(--line)]' : 'border-transparent hover:bg-paper-2/70 disabled:hover:bg-transparent')
                        + ' disabled:cursor-not-allowed disabled:opacity-40'}>
                      <span className={'w-10 h-10 rounded-full flex items-center justify-center font-serif text-lg shrink-0 transition-colors '
                        + (done ? 'bg-verified text-white' : active ? 'bg-forest text-white shadow-[0_6px_14px_-8px_rgba(14,59,44,.8)]' : 'border border-[var(--line)] bg-paper text-ink-muted')}>
                        {done ? <><i className="ph-bold ph-check text-base" aria-hidden="true"></i><span className="sr-only">Done:</span></> : index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className={'block font-semibold text-xs lg:text-sm ' + (active || done ? 'text-ink' : 'text-ink-muted')}>{name}</span>
                        <span className="hidden lg:block text-xs text-ink-muted truncate">{stepHint(selected, index)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className={'sheet min-w-0 p-6 md:p-10 flex flex-col ' + (current === 0 ? 'w-full max-w-2xl justify-self-center self-start' : 'md:min-h-[520px]')}>
            {/* Every panel stays mounted (hidden when inactive) so switching steps keeps files and running batches. */}
            <section hidden={current !== 0} className="flex-1 fade-view">
              <SeminarStep seminars={seminars.data} selected={selected} onChange={id => changeSeminar(id, 0)} onNavigateSeminars={onNavigateSeminars} />
            </section>
            {selected && <div key={selected.seminarID} className="flex-1 flex flex-col">
              <section hidden={current !== 1} className="flex-1 fade-view">
                <Registrants seminar={selected} action={
                  // Upload CSV opens the file picker straight away; the panel appears once a file is chosen.
                  csvVisible ? <Btn variant="line" icon="ph-x" onClick={() => setCsvOpen(false)}>Close CSV upload</Btn>
                    : <Btn variant="line" icon="ph-upload-simple" onClick={() => document.getElementById('attendance-file-' + selected.seminarID)?.click()}>Upload CSV</Btn>} />
                {/* shortcut: the CSV import stays as a fallback until link registration has been tried with a small group; then remove it.
                    It stays mounted while hidden: it also renders this step's footer action (Continue / Confirm). */}
                <section id="attendance-csv-panel" hidden={!csvVisible} aria-labelledby="attendance-csv-title"
                  className="mt-8 rounded-2xl border border-[var(--line)] bg-paper p-5 md:p-6">
                  <h3 id="attendance-csv-title" className="mb-3 font-serif text-xl font-medium">Upload attendance CSV</h3>
                  <AttendanceImport seminarID={selected.seminarID} attendanceCount={selected.attendanceCount}
                    onSaved={result => { setAttendanceResult(result); goTo(2); }}
                    actionSlot={current === 1 ? actionSlot : null} onContinue={() => goTo(2)} onFile={() => setCsvOpen(true)} />
                </section>
              </section>
              <section hidden={current !== 2} className="flex-1 fade-view">
                {attendanceResult && <div role="status" className="mb-6 rounded-xl bg-verified-bg p-4 text-sm text-verified">
                  Attendance saved: {attendanceResult.attendance.attended} attended, {attendanceResult.attendance.markedAbsent} marked absent.
                  {attendanceResult.prepared && ` ${attendanceResult.prepared.prepared} certificates prepared; ${attendanceResult.prepared.awaitingWallet} attendees still need a wallet.`}
                  {attendanceResult.prepareError && <span className="block text-revoked">Certificates were not prepared: {attendanceResult.prepareError} Use Prepare certificates below.</span>}
                </div>}
                <CertificatePreparation mode="review" seminarID={selected.seminarID} />
              </section>
              <section hidden={current !== 3} className="flex flex-1 flex-col fade-view">
                <CertificatePreparation mode="issue" seminarID={selected.seminarID} onDone={onNavigateRegistry} actionSlot={current === 3 ? actionSlot : null} />
              </section>
            </div>}

            {(current > 0 || selected) && <div className="hair mt-10 flex items-center justify-between gap-3 pt-6">
              {current > 0 ? <Btn variant="ghost" icon="ph-arrow-left" onClick={() => goTo(current - 1)}>Back to {STEPS[current - 1]}</Btn> : <span />}
              {/* The attendance step puts its own action here (Continue, or Confirm once a file is reviewed); the issue step its Done. */}
              {(current === 1 || current === 3) && selected ? <span ref={setActionSlot} />
                : current < STEPS.length - 1 && selected && <Btn iconRight="ph-arrow-right" onClick={() => goTo(current + 1)}>Continue to {STEPS[current + 1]}</Btn>}
            </div>}
          </div>
        </div>
      )}
      {editing && selected && <SeminarEditDialog key={selected.seminarID} seminar={selected} canDelete={!!faculty.data?.canIssue}
        onClose={() => setEditing(false)} onDeleted={() => { setEditing(false); changeSeminar('', 0); }} />}
    </div>
  );
}

// Step 1: pick the seminar to work on. Seminars are created in the Seminars tab.
function SeminarStep({ seminars, selected, onChange, onNavigateSeminars }) {
  if (!seminars.length) return (
    <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-paper-2 text-ink-muted">
        <i className="ph ph-calendar-blank text-3xl" aria-hidden="true"></i>
      </span>
      <p className="font-serif text-2xl font-medium">No seminars yet</p>
      <p className="max-w-sm text-sm text-ink-muted">Create one in the Seminars tab and share its registration link with students.</p>
      <Btn variant="line" icon="ph-plus" onClick={onNavigateSeminars}>Go to Seminars</Btn>
    </div>
  );
  return (
    <div>
      <label id="issue-seminar-label" htmlFor="issue-seminar" className="eyebrow mb-2 block">Seminar</label>
      <SeminarSelect id="issue-seminar" labelId="issue-seminar-label" seminars={seminars} value={selected?.seminarID ?? ''} format={fmt} onChange={onChange} />
      {!selected ? <p className="mt-4 text-sm text-ink-muted">Pick the seminar to mark attendance for and issue certificates.</p> : (
        <div className="mt-6 space-y-5">
          <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-soft">
            <span><i className="ph-bold ph-calendar-blank mr-1.5" aria-hidden="true"></i>{fmt(selected.seminarDate)}</span>
            {selected.venue && <span className="break-words"><i className="ph-bold ph-map-pin mr-1.5" aria-hidden="true"></i>{selected.venue}</span>}
          </p>
          <dl className="grid grid-cols-3 gap-3">
            {[['Registered', selected.registrationCount], ['Attended', selected.attendanceCount], ['Issued', selected.issuedCount]].map(([label, count]) => (
              <div key={label} className="rounded-xl border border-[var(--line)] bg-paper-2 px-4 py-3">
                <dt className="eyebrow">{label}</dt>
                <dd className="mt-1 font-serif text-3xl leading-none tabular-nums">{count}</dd>
              </div>
            ))}
          </dl>
          <RegistrationLink seminar={selected} />
        </div>
      )}
    </div>
  );
}

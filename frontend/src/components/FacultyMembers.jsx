import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Btn } from './design-system';

const ROLES = [
  [false, 'Attendance & records', 'Check students in, manage seminars and register students. Cannot issue or revoke.'],
  [true, 'Can issue', 'Everything above, plus prepare, issue and revoke certificates, see the audit log and manage faculty accounts.'],
];
const fmtDate = value => new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

// A native modal like the app's other dialogs: focus stays inside, Escape or the backdrop closes it.
function Modal({ icon, tone = 'bg-forest text-white', eyebrow, title, onClose, children }) {
  const dialog = useRef(null);
  const id = useId();
  useEffect(() => { dialog.current.showModal(); }, []);
  return createPortal(
    <dialog ref={dialog} aria-labelledby={id} onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === dialog.current) onClose(); }}
      className="pop m-auto w-[calc(100%_-_2rem)] max-w-md rounded-2xl border border-paper-3 bg-paper p-0 text-ink shadow-xl backdrop:bg-[rgba(22,35,29,.45)] backdrop:backdrop-blur-sm">
      <div className="p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <span className={'flex h-12 w-12 items-center justify-center rounded-full text-xl shadow ' + tone} aria-hidden="true"><i className={'ph-bold ' + icon}></i></span>
          <button type="button" onClick={onClose} aria-label="Close"
            className="-mr-2 -mt-1 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-black/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest">
            <i className="ph-bold ph-x" aria-hidden="true"></i>
          </button>
        </div>
        {eyebrow && <p className="eyebrow mt-5">{eyebrow}</p>}
        <h2 id={id} className={(eyebrow ? 'mt-1' : 'mt-5') + ' font-serif text-3xl font-medium leading-tight'}>{title}</h2>
        {children}
      </div>
    </dialog>,
    document.body,
  );
}

// Shown once after adding an account or resetting a password; only its hash is stored, so it can't be shown again.
function PasswordDialog({ name, email, password, onClose }) {
  const [copied, setCopied] = useState(false);
  const field = useRef(null);
  const copy = () => navigator.clipboard
    ? navigator.clipboard.writeText(`${email}\n${password}`).then(() => setCopied(true), () => field.current?.select())
    : field.current?.select();
  return (
    <Modal icon="ph-key" eyebrow={name} title="Temporary password" onClose={onClose}>
      <p className="mt-2 text-sm text-ink-soft">Give these to {name.split(' ')[0]} in person or through a private message. They sign in on the faculty login page and should set their own password in Account settings.</p>
      <dl className="mt-5 space-y-3 rounded-xl border border-[var(--line)] bg-paper-2 p-4">
        <div><dt className="eyebrow">Email</dt><dd className="mt-1 text-sm font-medium [overflow-wrap:anywhere]">{email}</dd></div>
        <div><dt className="eyebrow">Password</dt><dd className="mt-1">
          <input ref={field} readOnly value={password} aria-label="Temporary password" onFocus={event => event.target.select()}
            className="w-full bg-transparent font-mono text-lg tracking-wider outline-none" /></dd></div>
      </dl>
      <p className="mt-4 flex items-start gap-2 rounded-xl bg-pending-bg px-3 py-2 text-xs font-medium text-ink-soft">
        <i className="ph-bold ph-warning text-sm text-pending mt-0.5" aria-hidden="true"></i>This password won't be shown again. If it's lost, reset it.</p>
      <div className="mt-6 flex gap-3">
        <Btn type="button" variant="line" className="flex-1" icon={copied ? 'ph-check' : 'ph-copy'} onClick={copy}>{copied ? 'Copied' : 'Copy both'}</Btn>
        <Btn type="button" className="flex-1" onClick={onClose}>Done</Btn>
      </div>
      <p role="status" className="sr-only">{copied ? 'Email and password copied.' : ''}</p>
    </Modal>
  );
}

function AddDialog({ onClose, onAdded }) {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', canIssue: false });
  const add = useMutation({ mutationFn: body => api('/api/faculty/members', { method: 'POST', body }), onSuccess: onAdded });
  const field = key => ({ value: form[key], onChange: event => { add.reset(); setForm({ ...form, [key]: event.target.value }); } });
  return (
    <Modal icon="ph-user-plus" title="Add faculty" onClose={onClose}>
      <p className="mt-2 text-sm text-ink-soft">For organizers who help at seminars. The app creates a temporary password for you to pass on.</p>
      <form className="mt-6" onSubmit={event => { event.preventDefault(); if (!add.isPending) add.mutate(form); }}>
        <fieldset disabled={add.isPending} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="member-first" className="mb-2 block text-sm font-medium">First name</label>
              <input id="member-first" className="field" required maxLength={255} autoComplete="off" autoFocus {...field('firstName')} /></div>
            <div><label htmlFor="member-last" className="mb-2 block text-sm font-medium">Last name</label>
              <input id="member-last" className="field" required maxLength={255} autoComplete="off" {...field('lastName')} /></div>
          </div>
          <div><label htmlFor="member-email" className="mb-2 block text-sm font-medium">Email</label>
            <input id="member-email" type="email" className="field" required maxLength={255} autoComplete="off" placeholder="name@ub.edu.ph" {...field('email')} /></div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Permission</legend>
            <div className="space-y-2">{ROLES.map(([value, label, help]) => (
              <label key={label} className={'flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors ' + (form.canIssue === value ? 'border-forest bg-white' : 'border-[var(--line)] hover:border-ink-muted')}>
                <input type="radio" name="member-role" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--forest)]" checked={form.canIssue === value}
                  onChange={() => { add.reset(); setForm({ ...form, canIssue: value }); }} />
                <span><span className="block text-sm font-semibold">{label}</span><span className="block text-xs text-ink-muted">{help}</span></span>
              </label>
            ))}</div>
          </fieldset>
          {add.error && <p role="alert" className="text-sm text-revoked">{add.error.message}</p>}
          <div className="flex gap-3 pt-2">
            <Btn type="button" variant="line" className="flex-1" onClick={onClose}>Cancel</Btn>
            <Btn type="submit" className="flex-1" icon="ph-user-plus">{add.isPending ? 'Adding...' : 'Add account'}</Btn>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

// "Are you sure?" for a permission change, a password reset, or switching an account off or on.
function ConfirmDialog({ action, member, onClose, onDone }) {
  const name = `${member.firstName} ${member.lastName}`;
  const run = useMutation({
    mutationFn: () => action.kind === 'reset'
      ? api(`/api/faculty/members/${member.facultyID}/reset-password`, { method: 'POST' })
      : api(`/api/faculty/members/${member.facultyID}`, { method: 'PATCH', body: action.body }),
    onSuccess: onDone,
  });
  const copy = {
    grant: ['ph-seal-check', 'Give issuing permission?', `${name} will be able to issue and revoke certificates, see the audit log and manage faculty accounts.`, 'Give permission', 'primary'],
    revoke: ['ph-lock-simple', 'Remove issuing permission?', `${name} keeps check-in and records access. It takes effect on their next action.`, 'Remove permission', 'danger'],
    reset: ['ph-key', 'Reset password?', `${name}'s current password stops working. Sessions already open on their devices stay signed in until they expire.`, 'Reset password', 'primary'],
    deactivate: ['ph-user-minus', 'Deactivate account?', `${name} is signed out on their next action and can't sign in. Their name stays on everything they did. You can reactivate it later.`, 'Deactivate', 'danger'],
    activate: ['ph-user-check', 'Reactivate account?', `${name} can sign in again with their current password.`, 'Reactivate', 'primary'],
  }[action.kind];
  const [icon, title, text, label, variant] = copy;
  return (
    <Modal icon={icon} tone={variant === 'danger' ? 'bg-revoked text-white' : undefined} eyebrow={member.email} title={title} onClose={onClose}>
      <p className="mt-2 text-sm text-ink-soft">{text}</p>
      {run.error && <p role="alert" className="mt-4 text-sm text-revoked">{run.error.message}</p>}
      <div className="mt-6 flex gap-3">
        <Btn type="button" variant="line" className="flex-1" disabled={run.isPending} onClick={onClose}>Cancel</Btn>
        <Btn type="button" variant={variant} className="flex-1" icon={icon} disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? 'Saving...' : label}</Btn>
      </div>
    </Modal>
  );
}

function Badge({ tone, icon, children }) {
  return <span className={'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ' + tone}>
    <i className={'ph-bold ' + icon} aria-hidden="true"></i>{children}</span>;
}

// Faculty accounts, for faculty with issuing permission (the server enforces it). Accounts are switched off, never deleted.
export default function FacultyMembers({ myFacultyID }) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState(null); // { type: 'add' } | { type: 'confirm', action, member } | { type: 'password', ... }
  const members = useQuery({ queryKey: ['faculty-members'], queryFn: () => api('/api/faculty/members'), retry: false });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['faculty-members'] });
  const close = () => setDialog(null);
  const active = members.data?.filter(member => !member.deactivatedAt).length ?? 0;

  return (
    <section className="sheet overflow-hidden" aria-labelledby="members-title">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] bg-paper p-5 sm:p-6">
        <div>
          <h2 id="members-title" className="font-serif text-2xl leading-tight">Faculty accounts</h2>
          <p className="mt-1 text-sm text-ink-muted">{members.data ? `${active} active of ${members.data.length}. ` : ''}Accounts are deactivated, never deleted, so their history stays.</p>
        </div>
        <Btn icon="ph-user-plus" onClick={() => setDialog({ type: 'add' })}>Add faculty</Btn>
      </div>

      {members.isPending ? <ul className="divide-y divide-[var(--line)]" aria-hidden="true">{[0, 1, 2].map(index => <li key={index} className="flex gap-4 p-6">
        <span className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-paper-2 motion-reduce:animate-none"></span>
        <span className="flex-1 space-y-2.5 pt-1"><span className="block h-3.5 w-2/5 animate-pulse rounded bg-paper-2 motion-reduce:animate-none"></span>
          <span className="block h-3 w-1/3 animate-pulse rounded bg-paper-2 motion-reduce:animate-none"></span></span></li>)}</ul>
        : members.error ? <div role="alert" className="flex flex-col items-center gap-4 px-6 py-12 text-center">
          <p className="text-sm text-revoked">{members.error.message}</p>
          <Btn variant="line" icon="ph-arrows-clockwise" onClick={() => members.refetch()}>Try again</Btn>
        </div>
        : <ul className="divide-y divide-[var(--line)]">{members.data.map(member => {
          const me = String(member.facultyID) === String(myFacultyID);
          const off = !!member.deactivatedAt;
          const ask = kind => setDialog({ type: 'confirm', member, action: { kind,
            body: { grant: { canIssue: true }, revoke: { canIssue: false }, deactivate: { active: false }, activate: { active: true } }[kind] } });
          return (
            <li key={member.facultyID} className={'flex flex-wrap items-start gap-4 p-5 sm:p-6 ' + (off ? 'bg-paper/60' : '')}>
              <span className={'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold ' + (off ? 'bg-paper-2 text-ink-muted' : 'bg-forest text-white')} aria-hidden="true">
                {member.firstName.slice(0, 1)}{member.lastName.slice(0, 1)}</span>
              <div className="min-w-0 flex-1 basis-56">
                <p className={'font-semibold [overflow-wrap:anywhere] ' + (off ? 'text-ink-muted' : '')}>
                  {member.firstName} {member.lastName}{me && <span className="ml-2 rounded-md bg-paper-2 px-1.5 py-0.5 text-xs font-medium text-ink-soft">You</span>}</p>
                <p className="text-sm text-ink-muted [overflow-wrap:anywhere]">{member.email}</p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {off ? <Badge tone="bg-revoked-bg text-revoked" icon="ph-prohibit">Deactivated {fmtDate(member.deactivatedAt)}</Badge>
                    : member.canIssue ? <Badge tone="bg-verified-bg text-verified" icon="ph-seal-check">Can issue</Badge>
                      : <Badge tone="bg-paper-2 text-ink-soft" icon="ph-user-check">Attendance &amp; records</Badge>}
                  {!off && member.temporaryPassword && <Badge tone="bg-pending-bg text-pending" icon="ph-key">Temporary password</Badge>}
                  <span className="px-1 py-1 text-xs text-ink-muted">Added {fmtDate(member.createdAt)}</span>
                </div>
              </div>
              {/* Your own row has no actions: you can't demote or deactivate yourself, and your password is in My account. */}
              {!me && <div className="flex flex-wrap gap-1.5 sm:justify-end">
                {off ? <Btn variant="line" size="sm" icon="ph-user-check" onClick={() => ask('activate')}>Reactivate</Btn> : <>
                  <Btn variant="ghost" size="sm" icon={member.canIssue ? 'ph-lock-simple' : 'ph-seal-check'} onClick={() => ask(member.canIssue ? 'revoke' : 'grant')}
                    aria-label={`${member.canIssue ? 'Remove issuing permission from' : 'Give issuing permission to'} ${member.firstName} ${member.lastName}`}>
                    {member.canIssue ? 'Remove issuing' : 'Allow issuing'}</Btn>
                  <Btn variant="ghost" size="sm" icon="ph-key" onClick={() => ask('reset')} aria-label={`Reset password for ${member.firstName} ${member.lastName}`}>Reset password</Btn>
                  <Btn variant="ghost" size="sm" icon="ph-user-minus" className="!text-revoked hover:!bg-revoked-bg" onClick={() => ask('deactivate')}
                    aria-label={`Deactivate ${member.firstName} ${member.lastName}`}>Deactivate</Btn>
                </>}
              </div>}
            </li>
          );
        })}</ul>}

      {dialog?.type === 'add' && <AddDialog onClose={close} onAdded={({ member, temporaryPassword }) => {
        refresh();
        setDialog({ type: 'password', name: `${member.firstName} ${member.lastName}`, email: member.email, password: temporaryPassword });
      }} />}
      {dialog?.type === 'confirm' && <ConfirmDialog action={dialog.action} member={dialog.member} onClose={close} onDone={result => {
        refresh();
        const { member } = dialog;
        setDialog(dialog.action.kind === 'reset'
          ? { type: 'password', name: `${member.firstName} ${member.lastName}`, email: member.email, password: result.temporaryPassword } : null);
      }} />}
      {dialog?.type === 'password' && <PasswordDialog name={dialog.name} email={dialog.email} password={dialog.password} onClose={close} />}
    </section>
  );
}

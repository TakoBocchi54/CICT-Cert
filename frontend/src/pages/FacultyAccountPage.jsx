import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Btn } from '../components/design-system';

function Feedback({ value }) {
  if (!value) return null;
  return (
    <p role={value.error ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-xl p-3 text-sm ${value.error ? 'bg-revoked-bg text-revoked' : 'bg-verified-bg text-verified'}`}>
      <i className={'ph-bold mt-0.5 ' + (value.error ? 'ph-warning-circle' : 'ph-check-circle')} aria-hidden="true"></i>{value.text}
    </p>
  );
}

// A form card's title row: a round icon badge, the heading and one line of help.
function CardHeading({ icon, title, help, helpId }) {
  return (
    <div className="mb-6 flex items-start gap-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-paper-2 text-lg text-forest" aria-hidden="true"><i className={'ph-bold ' + icon}></i></span>
      <div>
        <h2 className="font-serif text-2xl leading-tight">{title}</h2>
        <p id={helpId} className="mt-1 text-sm text-ink-muted">{help}</p>
      </div>
    </div>
  );
}

const Bar = ({ className }) => <span className={'block animate-pulse rounded-md bg-paper-2 ' + className} aria-hidden="true" />;

export default function FacultyAccountPage({ onProfileUpdated }) {
  const [account, setAccount] = useState(null);
  const [names, setNames] = useState({ firstName: '', lastName: '' });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showPasswords, setShowPasswords] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [profileFeedback, setProfileFeedback] = useState(null);
  const [passwordFeedback, setPasswordFeedback] = useState(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api('/api/faculty/account', { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      setAccount(data);
      setNames({ firstName: data.firstName, lastName: data.lastName });
    }).catch(err => {
      if (!controller.signal.aborted) setLoadError(err.message);
    });
    return () => controller.abort();
  }, [attempt]);

  async function saveProfile(event) {
    event.preventDefault();
    setProfileFeedback(null);
    if (!names.firstName.trim() || !names.lastName.trim()) {
      setProfileFeedback({ error: true, text: 'Enter both your first and last name.' });
      return;
    }
    setSavingProfile(true);
    try {
      const updated = await api('/api/faculty/account', { method: 'PATCH', body: names });
      setAccount(updated);
      setNames({ firstName: updated.firstName, lastName: updated.lastName });
      onProfileUpdated(updated);
      setProfileFeedback({ text: 'Your profile has been saved.' });
    } catch (err) {
      setProfileFeedback({ error: true, text: err.message });
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(event) {
    event.preventDefault();
    setPasswordFeedback(null);
    if (passwords.newPassword !== passwords.confirmPassword) {
      setPasswordFeedback({ error: true, text: 'New passwords do not match.' });
      return;
    }
    if (new TextEncoder().encode(passwords.newPassword).length > 72) {
      setPasswordFeedback({ error: true, text: 'This password is too long. Use fewer characters, especially emoji or accented characters.' });
      return;
    }
    if (passwords.newPassword === passwords.currentPassword) {
      setPasswordFeedback({ error: true, text: 'Choose a password different from your current password.' });
      return;
    }
    setSavingPassword(true);
    try {
      await api('/api/faculty/account/password', { method: 'POST', body: passwords });
      setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setShowPasswords(false);
      setPasswordFeedback({ text: 'Password updated. Use your new password the next time you sign in.' });
    } catch (err) {
      setPasswordFeedback({ error: true, text: err.message });
    } finally {
      setSavingPassword(false);
    }
  }

  const changed = account && (names.firstName.trim() !== account.firstName || names.lastName.trim() !== account.lastName);
  // Shown under the confirm field as soon as it is filled in, not only on submit.
  const mismatch = passwords.confirmPassword !== '' && passwords.confirmPassword !== passwords.newPassword;
  const newLength = passwords.newPassword.length;

  return (
    <div className="max-w-5xl mx-auto pb-16 md:pb-24">
      <header className="mb-9">
        <div className="eyebrow mb-3 rise">Faculty / My account</div>
        <h1 className="font-serif text-4xl md:text-5xl font-medium rise" style={{ '--d': '.05s' }}>Account settings</h1>
        <p className="text-ink-soft mt-4 rise" style={{ '--d': '.08s' }}>Manage your personal details and keep your account secure.</p>
      </header>
      {loadError ? (
        <section role="alert" className="flex flex-wrap items-center gap-4 rounded-2xl bg-revoked-bg p-5 text-sm text-revoked">
          <i className="ph-bold ph-warning-circle text-xl" aria-hidden="true"></i>
          <span className="flex-1">{loadError}</span>
          <Btn variant="line" size="sm" onClick={() => { setLoadError(''); setAttempt(n => n + 1); }}>Try again</Btn>
        </section>
      ) : !account ? (
        <div role="status" className="grid lg:grid-cols-3 gap-6 items-start">
          <span className="sr-only">Loading your account...</span>
          <div className="sheet p-6 space-y-4"><Bar className="h-14 w-14 !rounded-2xl" /><Bar className="h-7 w-2/3" /><Bar className="h-4 w-1/3" /><Bar className="!mt-8 h-16 w-full" /></div>
          <div className="lg:col-span-2 sheet p-6 md:p-8 space-y-4"><Bar className="h-7 w-1/2" /><Bar className="h-4 w-2/3" /><Bar className="!mt-8 h-12 w-full" /><Bar className="h-12 w-full" /></div>
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-6 items-start">
          <aside className="sheet p-6 rise" style={{ '--d': '.1s' }} aria-labelledby="account-name">
            <div className="w-14 h-14 rounded-2xl bg-forest text-white flex items-center justify-center text-xl font-semibold mb-5 shadow" aria-hidden="true">
              {account.firstName.slice(0, 1)}{account.lastName.slice(0, 1)}
            </div>
            <h2 id="account-name" className="font-serif text-2xl leading-tight break-words">{account.firstName} {account.lastName}</h2>
            <p className="text-sm text-ink-muted mt-1">Faculty</p>
            <dl className="hair mt-6 pt-5 space-y-5 text-sm">
              <div>
                <dt className="eyebrow mb-1.5">Email address</dt>
                <dd className="flex items-start gap-2 font-medium"><i className="ph-bold ph-envelope-simple mt-0.5 text-ink-muted" aria-hidden="true"></i><span className="break-all">{account.email}</span></dd>
              </div>
              <div>
                <dt className="eyebrow mb-1.5">Faculty ID</dt>
                <dd className="font-mono">{account.facultyID}</dd>
              </div>
              <div>
                <dt className="eyebrow mb-1.5">Certificate issuance</dt>
                <dd>
                  <span className={'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold '
                    + (account.canIssue ? 'bg-verified-bg text-verified' : 'bg-paper-2 text-ink-soft')}>
                    <i className={'ph-bold ' + (account.canIssue ? 'ph-seal-check' : 'ph-lock-simple')} aria-hidden="true"></i>
                    {account.canIssue ? 'Authorized to issue' : 'Not authorized to issue'}
                  </span>
                </dd>
              </div>
            </dl>
            <p className="hair mt-6 pt-5 flex items-start gap-2 text-xs text-ink-muted leading-relaxed">
              <i className="ph-bold ph-info mt-0.5" aria-hidden="true"></i>
              Your email, faculty ID, and issuance permission are managed by your administrator.
            </p>
          </aside>
          <div className="lg:col-span-2 space-y-6">
            <form onSubmit={saveProfile} className="sheet p-6 md:p-8 rise" style={{ '--d': '.14s' }} aria-labelledby="profile-title">
              <CardHeading icon="ph-user" title={<span id="profile-title">Personal details</span>} help="Use the name you want displayed in your faculty workspace." />
              <fieldset disabled={savingProfile} className="space-y-5">
                <div className="grid sm:grid-cols-2 gap-4">
                  {[['firstName', 'First name', 'given-name'], ['lastName', 'Last name', 'family-name']].map(([key, label, autoComplete]) => (
                    <div key={key}><label htmlFor={key} className="block text-sm font-medium mb-2">{label}</label>
                      <input id={key} name={key} autoComplete={autoComplete} className="field" required maxLength={255} value={names[key]}
                        onChange={e => { setNames({ ...names, [key]: e.target.value }); setProfileFeedback(null); }} />
                    </div>
                  ))}
                </div>
                <Feedback value={profileFeedback} />
                <div className="hair flex flex-wrap justify-end gap-3 pt-5">
                  <Btn type="button" variant="ghost" disabled={!changed || savingProfile}
                    onClick={() => { setNames({ firstName: account.firstName, lastName: account.lastName }); setProfileFeedback(null); }}>Discard</Btn>
                  <Btn type="submit" icon="ph-floppy-disk" disabled={!changed || savingProfile}>{savingProfile ? 'Saving...' : 'Save changes'}</Btn>
                </div>
              </fieldset>
            </form>
            <form onSubmit={savePassword} className="sheet p-6 md:p-8 rise" style={{ '--d': '.18s' }} aria-labelledby="password-title">
              <CardHeading icon="ph-lock-key" title={<span id="password-title">Change password</span>} helpId="password-help"
                help="Use at least 12 characters. Choose a password you do not use elsewhere." />
              <fieldset disabled={savingPassword} className="space-y-5">
                {[['currentPassword', 'Current password'], ['newPassword', 'New password'], ['confirmPassword', 'Confirm new password']].map(([key, label]) => (
                  <div key={key}>
                    <label htmlFor={key} className="block text-sm font-medium mb-2">{label}</label>
                    <input id={key} name={key} type={showPasswords ? 'text' : 'password'} className={'field' + (key === 'confirmPassword' && mismatch ? ' !border-revoked' : '')}
                      required minLength={key === 'currentPassword' ? undefined : 12}
                      autoComplete={key === 'currentPassword' ? 'current-password' : 'new-password'}
                      aria-invalid={key === 'confirmPassword' && mismatch ? true : undefined}
                      aria-describedby={key === 'newPassword' ? 'password-help new-password-count' : key === 'confirmPassword' && mismatch ? 'password-mismatch' : undefined}
                      value={passwords[key]} onChange={e => { setPasswords({ ...passwords, [key]: e.target.value }); setPasswordFeedback(null); }} />
                    {key === 'newPassword' && newLength > 0 && <p id="new-password-count" className={'mt-1.5 text-xs ' + (newLength >= 12 ? 'text-verified' : 'text-ink-muted')}>
                      {newLength >= 12 ? <><i className="ph-bold ph-check mr-1" aria-hidden="true"></i>Long enough</> : `${newLength} of 12 characters`}</p>}
                    {key === 'confirmPassword' && mismatch && <p id="password-mismatch" className="mt-1.5 text-xs text-revoked">Doesn't match the new password yet.</p>}
                  </div>
                ))}
                <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-ink-soft">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--forest)]" checked={showPasswords} onChange={e => setShowPasswords(e.target.checked)} />
                  Show passwords
                </label>
                <Feedback value={passwordFeedback} />
                <div className="hair flex justify-end pt-5">
                  <Btn type="submit" icon="ph-lock-key" disabled={savingPassword}>{savingPassword ? 'Updating...' : 'Update password'}</Btn>
                </div>
              </fieldset>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

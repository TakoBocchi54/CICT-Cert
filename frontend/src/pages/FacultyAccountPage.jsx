import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Btn } from '../components/design-system';

function Feedback({ value }) {
  if (!value) return null;
  return <p role={value.error ? 'alert' : 'status'} className={`rounded-xl p-3 text-sm ${value.error ? 'bg-revoked-bg text-revoked' : 'bg-verified-bg text-verified'}`}>{value.text}</p>;
}

export default function FacultyAccountPage({ onProfileUpdated }) {
  const [account, setAccount] = useState(null);
  const [names, setNames] = useState({ firstName: '', lastName: '' });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
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
      setPasswordFeedback({ text: 'Password updated. Use your new password the next time you sign in.' });
    } catch (err) {
      setPasswordFeedback({ error: true, text: err.message });
    } finally {
      setSavingPassword(false);
    }
  }

  const changed = account && (names.firstName.trim() !== account.firstName || names.lastName.trim() !== account.lastName);

  return (
    <div className="max-w-5xl mx-auto pb-16">
      <header className="mb-9">
        <div className="eyebrow mb-3">Faculty / My account</div>
        <h1 className="font-serif text-4xl md:text-5xl font-medium">Account settings</h1>
        <p className="text-ink-soft mt-4">Manage your personal details and keep your account secure.</p>
      </header>
      {loadError ? (
        <section className="sheet p-7">
          <p role="alert" className="text-revoked">{loadError}</p>
          <Btn className="mt-4" onClick={() => { setLoadError(''); setAttempt(n => n + 1); }}>Try again</Btn>
        </section>
      ) : !account ? <p role="status" className="sheet p-7">Loading your account?</p> : (
        <div className="grid lg:grid-cols-3 gap-6 items-start">
          <aside className="sheet p-6">
            <div className="w-14 h-14 rounded-2xl bg-forest text-white flex items-center justify-center text-xl font-semibold mb-5" aria-hidden="true">
              {account.firstName.slice(0, 1)}{account.lastName.slice(0, 1)}
            </div>
            <h2 className="font-serif text-2xl break-words">{account.firstName} {account.lastName}</h2>
            <p className="text-sm text-ink-muted mt-1">Faculty</p>
            <dl className="hair mt-6 pt-5 space-y-5 text-sm">
              <div><dt className="text-ink-muted mb-1">Email address</dt><dd className="break-all font-medium">{account.email}</dd></div>
              <div><dt className="text-ink-muted mb-1">Faculty ID</dt><dd className="font-mono">{account.facultyID}</dd></div>
              <div><dt className="text-ink-muted mb-1">Certificate issuance</dt><dd className="font-medium">{account.canIssue ? 'Authorized to issue' : 'Not authorized to issue'}</dd></div>
            </dl>
            <p className="hair mt-6 pt-5 text-xs text-ink-muted leading-relaxed">Your email, faculty ID, and issuance permission are managed by your administrator.</p>
          </aside>
          <div className="lg:col-span-2 space-y-6">
            <form onSubmit={saveProfile} className="sheet p-6 md:p-8">
              <h2 className="font-serif text-2xl">Personal details</h2>
              <p className="text-sm text-ink-muted mt-2 mb-6">Use the name you want displayed in your faculty workspace.</p>
              <fieldset disabled={savingProfile} className="space-y-5">
                <div className="grid sm:grid-cols-2 gap-4">
                  {[['firstName', 'First name', 'given-name'], ['lastName', 'Last name', 'family-name']].map(([key, label, autoComplete]) => (
                    <div key={key}><label htmlFor={key} className="block text-sm font-medium mb-2">{label}</label>
                      <input id={key} name={key} autoComplete={autoComplete} className="field" required maxLength={255} value={names[key]} onChange={e => { setNames({ ...names, [key]: e.target.value }); setProfileFeedback(null); }} />
                    </div>
                  ))}
                </div>
                <Feedback value={profileFeedback} />
                <div className="flex flex-wrap gap-3">
                  <Btn type="submit" disabled={!changed || savingProfile}>{savingProfile ? 'Saving?' : 'Save changes'}</Btn>
                  <Btn type="button" variant="line" disabled={!changed || savingProfile} onClick={() => { setNames({ firstName: account.firstName, lastName: account.lastName }); setProfileFeedback(null); }}>Cancel</Btn>
                </div>
              </fieldset>
            </form>
            <form onSubmit={savePassword} className="sheet p-6 md:p-8">
              <h2 className="font-serif text-2xl">Change password</h2>
              <p id="password-help" className="text-sm text-ink-muted mt-2 mb-6">Use at least 12 characters. Choose a password you do not use elsewhere.</p>
              <fieldset disabled={savingPassword} className="space-y-5">
                {[['currentPassword', 'Current password'], ['newPassword', 'New password'], ['confirmPassword', 'Confirm new password']].map(([key, label]) => (
                  <div key={key}><label htmlFor={key} className="block text-sm font-medium mb-2">{label}</label>
                    <input id={key} name={key} type="password" className="field" required minLength={key === 'currentPassword' ? undefined : 12} autoComplete={key === 'currentPassword' ? 'current-password' : 'new-password'} aria-describedby={key === 'newPassword' ? 'password-help' : undefined} value={passwords[key]} onChange={e => { setPasswords({ ...passwords, [key]: e.target.value }); setPasswordFeedback(null); }} />
                  </div>
                ))}
                <Feedback value={passwordFeedback} />
                <Btn type="submit" disabled={savingPassword}>{savingPassword ? 'Updating?' : 'Update password'}</Btn>
              </fieldset>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

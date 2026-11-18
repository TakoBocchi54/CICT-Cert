import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AUTH_CONNECTION, WALLET_CONNECTORS } from '@web3auth/modal';
import { useWeb3Auth, useWeb3AuthConnect, useWeb3AuthDisconnect } from '@web3auth/modal/react';
import { Lockup, Btn } from '../components/design-system';
import ConsentDialog from '../components/ConsentDialog';
import { useStudentSession } from '../hooks/useStudentSession';
import { api } from '../lib/api';
import { formatDeadline } from '../lib/registrationLink';

const fmt = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

// Public page behind a seminar's registration link: sign in with Google, confirm or enter the name for the
// certificate, register, then link the embedded wallet (the student's consent) like a normal login.
// facultyName: the faculty member signed in in this browser, if any.
export default function RegisterPage({ onLogin, facultyName = null }) {
  const { token } = useParams();
  const { web3Auth, isConnected } = useWeb3Auth();
  const { connectTo, loading: connecting, error: connectError } = useWeb3AuthConnect();
  const { disconnect } = useWeb3AuthDisconnect();
  const [signedInToken, setIdToken] = useState(null);
  const [tokenError, setTokenError] = useState(null);
  const [finishing, setFinishing] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const session = useStudentSession({ enabled: finishing });
  const idToken = isConnected ? signedInToken : null;

  // A Google sign-in (new, or remembered by Web3Auth) gives the ID token the backend verifies.
  useEffect(() => {
    if (!isConnected || !web3Auth) return;
    let cancelled = false;
    web3Auth.getAuthTokenInfo().then(info => { if (!cancelled) setIdToken(info?.idToken ?? null); },
      err => { if (!cancelled) setTokenError(err.message || 'Could not read your Google sign-in.'); });
    return () => { cancelled = true; };
  }, [isConnected, web3Auth]);

  const page = useQuery({
    queryKey: ['register', token, idToken],
    queryFn: ({ signal }) => api(`/api/register/${token}`, { signal, headers: idToken ? { Authorization: 'Bearer ' + idToken } : {} }),
    retry: false, refetchOnWindowFocus: false,
  });
  const register = useMutation({
    mutationFn: body => api(`/api/register/${token}`, { method: 'POST', headers: { Authorization: 'Bearer ' + idToken }, body }),
    onSuccess: () => setFinishing(true),
  });
  const switchAccount = () => { register.reset(); setFinishing(false); setTokenError(null); setIdToken(null); disconnect(); };

  const seminar = page.data;
  let body;
  if (page.isPending) body = <p role="status" className="text-sm text-ink-soft">Loading the seminar...</p>;
  else if (page.error && !seminar) body = <Problem message={page.error.message} onRetry={idToken ? switchAccount : null} />;
  else if (finishing) body = <Finish session={session} result={register.data} onDone={() => onLogin('student', session.student)} onSwitch={switchAccount} />;
  else if (!idToken) body = !seminar.open ? <Problem message="Registration for this seminar is closed." /> : (
    <div>
      {(tokenError || connectError) && <p role="alert" className="mb-4 text-sm text-revoked">{tokenError || connectError.message}</p>}
      <Btn className="w-full !py-3.5 !bg-white !text-ink border-2 border-[var(--line)] hover:!bg-paper-2" icon="ph-google-logo"
        disabled={connecting || (isConnected && !tokenError)}
        onClick={() => { setTokenError(null); connectTo(WALLET_CONNECTORS.AUTH, { authConnection: AUTH_CONNECTION.GOOGLE }).catch(() => {}); }}>
        {connecting || isConnected ? 'Connecting...' : 'Sign in with Google'}</Btn>
    </div>
  );
  else if (seminar.registered) body = (
    <div className="space-y-4">
      <p className="rounded-xl bg-verified-bg p-4 text-sm text-verified">You're already registered for this seminar as <b>{seminar.account.fullName}</b>.</p>
      <Btn className="w-full" iconRight="ph-arrow-right" onClick={() => setFinishing(true)}>Go to my dashboard</Btn>
      <SignedInAs email={seminar.email} onSwitch={switchAccount} />
    </div>
  );
  else if (!seminar.open) body = <Problem message="Registration for this seminar is closed." onRetry={switchAccount} />;
  else body = <ProfileForm key={seminar.email} seminar={seminar} register={register} onSwitch={switchAccount} onShowConsent={() => setShowConsent(true)} />;

  return (
    <main className="min-h-screen bg-paper px-4 py-10">
      <div className="mx-auto w-full max-w-[460px]">
        <div className="mb-10"><Lockup /></div>
        {seminar && <div className="mb-8">
          <h1 className="font-serif text-4xl font-medium leading-tight break-words">{seminar.seminarTitle}</h1>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
            <span><i className="ph-bold ph-calendar-blank mr-1.5" aria-hidden="true"></i>{fmt(seminar.seminarDate)}</span>
            {seminar.venue && <span className="break-words"><i className="ph-bold ph-map-pin mr-1.5" aria-hidden="true"></i>{seminar.venue}</span>}
          </p>
          {seminar.registrationClosesAt && <p className="mt-1 text-sm text-ink-muted">
            Registration {seminar.open ? 'closes' : 'closed'} {formatDeadline(seminar.registrationClosesAt)}</p>}
        </div>}
        {/* One login per browser: registering starts a student session and ends this faculty one in every tab.
            Shown on every step, since a remembered Google sign-in skips straight to the form. */}
        {facultyName && !finishing && <p role="note" className="mb-4 rounded-xl bg-pending-bg p-4 text-sm text-pending">
          You're signed in as faculty (<b>{facultyName}</b>) in this browser. Registering here signs you out of that account.
          To try the link or let a student register on this computer, open it in a private window instead.</p>}
        {body}
      </div>
      {showConsent && <ConsentDialog onClose={() => setShowConsent(false)} />}
    </main>
  );
}

function Problem({ message, onRetry }) {
  return (
    <div role="alert" className="rounded-xl border border-revoked/20 bg-revoked-bg p-4 text-sm text-revoked">
      <p className="font-medium">{message}</p>
      {onRetry && <button type="button" onClick={onRetry} className="mt-2 cursor-pointer text-xs underline">Use a different Google account</button>}
    </div>
  );
}

const SignedInAs = ({ email, onSwitch }) => (
  <p className="text-center text-xs text-ink-muted">Signed in as <b className="break-all">{email}</b> ·{' '}
    <button type="button" onClick={onSwitch} className="cursor-pointer font-semibold text-forest underline">Use a different account</button></p>
);

// Prefill for the two name fields: the last word is the last name. Students correct it if their surname has
// several words.
function splitName(fullName) {
  const name = (fullName ?? '').trim();
  const at = name.lastIndexOf(' ');
  return at < 0 ? [name, ''] : [name.slice(0, at).trim(), name.slice(at + 1)];
}

// New accounts fill in their details; existing ones see theirs prefilled and may correct them.
function ProfileForm({ seminar, register, onSwitch, onShowConsent }) {
  const [initialFirst, initialLast] = splitName(seminar.account?.fullName);
  const [firstName, setFirstName] = useState(initialFirst);
  const [lastName, setLastName] = useState(initialLast);
  const [program, setProgram] = useState(seminar.account?.program ?? '');
  const [contactNumber, setContactNumber] = useState(seminar.account?.contactNumber ?? '');
  return (
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!register.isPending) register.mutate({ fullName: `${firstName.trim()} ${lastName.trim()}`, program, contactNumber }); }}>
      <p className="text-sm text-ink-soft">{seminar.account ? 'Check your details, then confirm your registration.'
        : 'Enter your details to create your CICT-Cert account and register.'}</p>
      <fieldset disabled={register.isPending} className="space-y-4">
        <div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3">
            <div>
              <label htmlFor="register-first-name" className="eyebrow mb-2 block">First name</label>
              <input id="register-first-name" className="field" required maxLength={127} autoComplete="given-name" value={firstName}
                onChange={event => { register.reset(); setFirstName(event.target.value); }} aria-describedby="register-name-hint" />
            </div>
            <div>
              <label htmlFor="register-last-name" className="eyebrow mb-2 block">Last name</label>
              <input id="register-last-name" className="field" required maxLength={127} autoComplete="family-name" value={lastName}
                onChange={event => { register.reset(); setLastName(event.target.value); }} aria-describedby="register-name-hint" />
            </div>
          </div>
          <p id="register-name-hint" className="mt-1.5 text-xs text-ink-muted">Exactly as they should appear on your certificate.</p>
        </div>
        <div>
          <label htmlFor="register-program" className="eyebrow mb-2 block">Program</label>
          <input id="register-program" className="field" required maxLength={255} autoComplete="off" placeholder="e.g. BSIT" value={program}
            onChange={event => { register.reset(); setProgram(event.target.value); }} />
        </div>
        <div>
          <label htmlFor="register-contact" className="eyebrow mb-2 block">Contact number</label>
          <input id="register-contact" type="tel" inputMode="tel" className="field" required maxLength={24} autoComplete="tel"
            placeholder="e.g. 0917 123 4567" value={contactNumber}
            onChange={event => { register.reset(); setContactNumber(event.target.value); }} aria-describedby="register-contact-hint" />
          <p id="register-contact-hint" className="mt-1.5 text-xs text-ink-muted">11 digits, e.g. 09171234567. Only CICT sees it. It never appears on your certificate.</p>
        </div>
        {register.error && <p role="alert" className="text-sm text-revoked">{register.error.message}</p>}
        <Btn type="submit" className="w-full !py-3.5" icon="ph-check">
          {register.isPending ? 'Registering...' : seminar.account ? 'Confirm registration' : 'Register'}</Btn>
        <p className="text-center text-xs text-ink-muted">
          By registering, you agree to{' '}
          <button type="button" onClick={onShowConsent} className="cursor-pointer font-semibold text-forest underline hover:text-ink">CICT-Cert certificate consent and privacy notice</button>.
        </p>
      </fieldset>
      <SignedInAs email={seminar.email} onSwitch={onSwitch} />
    </form>
  );
}

// After registering: sign the wallet-link consent if needed, then confirm.
function Finish({ session, result, onDone, onSwitch }) {
  if (session.status === 'error') return (
    <div className="space-y-3">
      {result && <p className="text-sm text-verified">You're registered. Your wallet still needs to be set up.</p>}
      <Problem message={session.error} onRetry={onSwitch} />
      <Btn variant="line" className="w-full" onClick={session.retry}>Try again</Btn>
    </div>
  );
  if (session.status !== 'ready') return <p role="status" className="text-sm text-ink-soft">Setting up your account and wallet...</p>;
  return (
    <div className="space-y-5 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-verified text-white" aria-hidden="true">
        <i className="ph-bold ph-check text-2xl"></i></span>
      <div>
        <h2 className="font-serif text-3xl font-medium">You're registered</h2>
        <p className="mt-2 text-sm text-ink-soft">Your certificate will be issued to <b>{session.student.fullName}</b> after the seminar,
          once faculty confirm you attended.</p>
      </div>
      <Btn className="w-full" iconRight="ph-arrow-right" onClick={onDone}>Go to my dashboard</Btn>
    </div>
  );
}

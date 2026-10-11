import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWeb3AuthConnect, useWeb3AuthDisconnect } from '@web3auth/modal/react';
import { useStudentSession } from '../hooks/useStudentSession';
import { Lockup, Rosette, Certificate, Btn } from '../components/design-system';
import { api } from '../lib/api';

// Sample certificate for hero display
const SAMPLE_CERT = {
  id: 'SBT-0000-00',
  recipient: 'Student Name',
  email: 'student@ub.edu.ph',
  seminar: 'Sample Seminar Title',
  iso: '2026-01-01',
  status: 'Verified',
  block: 58000000,
  confirmations: 128
};

export default function LoginPage({ onLogin, onNavigateVerifier }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [role, setRole] = useState('student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasLoggedIn, setHasLoggedIn] = useState(false);
  const [manualDisconnect, setManualDisconnect] = useState(false);
  
  // Web3Auth hooks for student login
  const { connect, loading: web3Loading, error: web3Error } = useWeb3AuthConnect();
  const { disconnect } = useWeb3AuthDisconnect();
  const studentAttempt = useRef(0);
  const facultyRequest = useRef(null);
  const studentSession = useStudentSession({
    enabled: role === 'student',
  });

  useEffect(() => {
    return () => {
      studentAttempt.current += 1;
      facultyRequest.current?.abort();
    };
  }, []);

  // Disconnect Web3Auth when switching to faculty role
  useEffect(() => {
    if (role === 'faculty' && studentSession.status !== 'idle') {
      console.log('Switching to faculty - disconnecting Web3Auth');
      disconnect();
    }
  }, [role, studentSession.status, disconnect]);

  // Handle disconnect on mount if disconnect=true in URL
  useEffect(() => {
    const shouldDisconnect = searchParams.get('disconnect') === 'true';
    if (shouldDisconnect) {
      console.log('Disconnecting Web3Auth due to sign out...');
      setManualDisconnect(true);
      setHasLoggedIn(false);
      disconnect();
      // Clear the URL parameter
      setSearchParams({});
    }
  }, [searchParams, disconnect, setSearchParams]);

  // Watch for student session changes and auto-login when ready (only once)
  useEffect(() => {
    
    // NEVER auto-login, only login after explicit button click
    // Just show errors if they occur
    if (studentSession.status === 'error') {
      console.error('Student session error:', studentSession.error);
      setError(studentSession.error || 'Failed to verify your session');
    }
  }, [studentSession.status, studentSession.error]);

  // Handle student Web3Auth login
  const handleStudentLogin = async () => {
    const attemptId = ++studentAttempt.current;
    setError('');
    setManualDisconnect(false);
    setLoading(true);

    if (studentSession.status === 'error') {
      studentSession.retry();
      setLoading(true);
      return;
    }

    try {
      // Connect to Web3Auth
      const connection = await connect();
      
      if(attemptId !== studentAttempt.current) return; // Ignore if a new attempt has started

      if (!connection) {
        setLoading(false);
      }
    } catch (err) {
      if (attemptId !== studentAttempt.current) return;

      console.error('Student login error:', err.message);
      setError(err.message || 'Failed to sign in with Google. Please try again.');
      setLoading(false);
    }
  };

  // Only login after explicit button click AND session is ready
  useEffect(() => {
    // Only process student session if we're on student role and actively logging in
    if (role !== 'student' || !loading) {
      return;
    }
    
    if (studentSession.status === 'ready' && studentSession.student) {
      setLoading(false);
      onLogin('student', studentSession.student);
    }
    if (studentSession.status === 'error') {
      setLoading(false);
    }
  }, [loading, role, studentSession.status, studentSession.student, onLogin]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (role !== 'faculty' || loading) return;

    facultyRequest.current?.abort(); // Abort any ongoing faculty login request

    const controller = new AbortController();
    facultyRequest.current = controller; // Store the controller for potential future aborts

    setError('');
    setLoading(true);

    try {
      // Only faculty login with email/password
      const response = await api('/api/auth/faculty/login', {
        method: 'POST',
        body: { email, password },
        signal: controller.signal,
      });
      
      if (controller.signal.aborted) return; // Ignore if the request was aborted

      onLogin('faculty', response);
    } catch (err) {
        if (controller.signal.aborted) return;

        setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }

        if (facultyRequest.current === controller) {
        facultyRequest.current = null; // Clear the reference if this was the active request
      }
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.15fr_1fr]">
      {/* Left Hero Section - Hidden on mobile */}
      <section className="hidden lg:flex flex-col justify-between p-14 relative overflow-hidden" style={{ background: 'var(--paper2)' }}>
        <Rosette color="#0e3b2c" className="absolute" style={{ width: 760, right: -300, bottom: -280, opacity: .14 }} />
        
        <Lockup />
        
        <div className="relative">
          <div className="eyebrow mb-5">College of Information and Communications Technology</div>
          <h1 className="font-serif text-[64px] leading-[1.02] font-medium max-w-xl">
            Every seminar you attend, <span className="italic text-forest-600">on the record.</span>
          </h1>
          <p className="text-ink-soft text-lg mt-6 max-w-md">
            Tamper-proof seminar certificates, issued by CICT and verifiable by anyone, anywhere.
          </p>
          <div className="mt-12 w-[460px] rotate-[-2.5deg]">
            <Certificate cert={SAMPLE_CERT} />
          </div>
        </div>
        
        <div className="relative text-sm text-ink-muted">
          University of Batangas · Seminar Credential Registry
        </div>
      </section>

      {/* Right Login Section */}
      <section className="flex items-center justify-center p-8 bg-paper">
        <div className="w-full max-w-[400px]">
          <div className="lg:hidden mb-10">
            <Lockup />
          </div>
          
          <div className="eyebrow mb-3">Sign in</div>
          <h2 className="font-serif text-4xl font-medium mb-8">Welcome back.</h2>
          
          {/* Role Toggle */}
          <div className="grid grid-cols-2 gap-2 p-1.5 rounded-2xl bg-paper-2 border border-[var(--line)] mb-7">
            {['student', 'faculty'].map(r => (
              <button
                key={r}
                onClick={() => {
                  if (r === role) return;
                  studentAttempt.current += 1; // Increment attempt to cancel any ongoing student login
                  facultyRequest.current?.abort(); // Abort any ongoing faculty login request
                  facultyRequest.current = null; // Clear the reference to the aborted request
                  
                  setLoading(false);
                  setError('');
                  setRole(r);
                }}
                className={
                  'py-2.5 rounded-xl text-sm font-semibold capitalize transition-all ' +
                  (role === r ? 'bg-white shadow text-ink' : 'text-ink-muted')
                }
              >
                {r}
              </button>
            ))}
          </div>

          {/* Login Form */}
          <form className="space-y-5" onSubmit={handleSubmit}>
            {role === 'faculty' ? (
              <>
                <div>
                  <label className="eyebrow block mb-2">Institutional email</label>
                  <input
                    required
                    type="email"
                    className="field"
                    placeholder={role + '@ub.edu.ph'}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                
                <div>
                  <label className="eyebrow block mb-2">Password</label>
                  <input
                    required
                    type="password"
                    className="field"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>

                {error && (
                  <div className="rounded-xl bg-revoked-bg border border-revoked/20 p-4">
                    <p className="text-sm text-revoked font-medium">{error}</p>
                  </div>
                )}
                
                <Btn type="submit" className="w-full !py-3.5" iconRight="ph-arrow-right" disabled={loading}>
                  {loading ? 'Signing in...' : 'Sign in as faculty'}
                </Btn>
              </>
            ) : (
              <>
                <div className="text-center py-8 px-4 rounded-xl bg-paper-2 border border-[var(--line)]">
                  <i className="ph-duotone ph-wallet text-5xl text-forest mb-4"></i>
                  <h3 className="font-serif text-xl font-medium mb-2">Sign in with your wallet</h3>
                  <p className="text-sm text-ink-soft mb-6">
                    Students use an embedded wallet to access their credentials. Sign in with your Google account to continue.
                  </p>
                  
                  {(error || web3Error || studentSession.error) && (
                    <div className="rounded-xl bg-revoked-bg border border-revoked/20 p-4 mb-4 text-left">
                      <p className="text-sm text-revoked font-medium">
                        {studentSession.error || error || web3Error?.message}
                      </p>
                      {studentSession.error && (
                        <button 
                          type="button" 
                          onClick={() => disconnect()} 
                          className="mt-2 text-xs underline text-revoked"
                        >
                          Use a different account
                        </button>
                      )}
                    </div>
                  )}
                  
                  <Btn 
                    type="button"
                    className="w-full !py-3.5 !bg-white !text-ink border-2 border-[var(--line)] hover:!bg-paper-2" 
                    icon="ph-google-logo"
                    onClick={handleStudentLogin}
                    disabled={web3Loading || studentSession.status === 'working'}
                  >
                    {studentSession.status === 'working'
                      ? 'Verifying your account...'
                      : web3Loading
                      ? 'Connecting...'
                      : studentSession.status === 'error'
                      ? 'Retry sign in'
                      : 'Sign in with Google'}
                  </Btn>
                </div>
              </>
            )}
          </form>

          {/* Public Verifier CTA */}
          <div className="mt-10 pt-8 hair">
            <p className="text-sm text-ink-muted mb-3">
              Checking someone else's certificate? No account needed.
            </p>
            <Btn 
              variant="line" 
              className="w-full" 
              icon="ph-seal-check" 
              onClick={onNavigateVerifier}
            >
              Open public verifier
            </Btn>
          </div>
        </div>
      </section>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { api } from './lib/api';
import { useWeb3Auth } from '@web3auth/modal/react';
import TopNav from './components/TopNav';
import LoginPage from './pages/LoginPage';
import StudentDashboardPage from './pages/StudentDashboardPage';
import StudentCollectionPage from './pages/StudentCollectionPage';
import FacultyDashboardPage from './pages/FacultyDashboardPage';
import IssuancePage from './pages/IssuancePage';
import RevocationPage from './pages/RevocationPage';
import VerifierPortalPage from './pages/VerifierPortalPage';

// Sample certificate data
const hashOf = (s) => { 
  let h = 2166136261; 
  for (const c of s) { 
    h ^= c.charCodeAt(0); 
    h = Math.imul(h, 16777619) >>> 0; 
  } 
  return h; 
};

const hex = (s, n) => { 
  let out = '', h = hashOf(s); 
  while (out.length < n) { 
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; 
    out += h.toString(16).padStart(8, '0'); 
  } 
  return out.slice(0, n); 
};

const mk = (id, recipient, email, seminar, iso, status) => ({
  id, 
  recipient, 
  email, 
  seminar, 
  iso, 
  status,
  hash: '0x' + hex(id, 64), 
  block: 58000000 + (hashOf(id) % 400000), 
  confirmations: status === 'Pending' ? 3 : 128 + (hashOf(id) % 900),
});

const INITIAL_CERTS = [];

// Shell component with TopNav
function Shell({ children }) {
  return (
    <div className="min-h-screen pb-20">
      {children}
      <main className="max-w-[1280px] mx-auto px-4 pt-10 fade-view">
        {children}
      </main>
    </div>
  );
}

// Main app content with routing logic
function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionError, setSessionError] = useState(null);
  const [certificates, setCertificates] = useState(INITIAL_CERTS);
  const [selectedCertId, setSelectedCertId] = useState(null);
  const { web3Auth, isConnected } = useWeb3Auth();


  useEffect(() => {
    const controller = new AbortController();

    async function restoreSession() {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include',
          signal: controller.signal,
          cache: 'no-store',
        });
          
        if (response.status === 401) {
          if (!controller.signal.aborted) {
            setUser(null);
          }
          return;
        }

        if (!response.ok) {
          throw new Error('Could not check your session');
        }

        const currentUser = await response.json();

        if(!controller.signal.aborted) {
          setUser(currentUser);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setCheckingSession(false);
        }
      } finally {
        if (!controller.signal.aborted) {
          setCheckingSession(false);
        }
      }
    }

    restoreSession();

    return () => controller.abort();
  }, []);
  

  // Check if we're on verifier page
  const isVerifierPage = location.pathname.startsWith('/verify');

  const handleLogin = (role, userData) => {    
    // Backend returns different data for faculty and student
    if (role === 'faculty') {
      // Faculty response: { facultyID, firstName, lastName, canIssue }
      setUser({
        role,
        email: userData.email || 'faculty@ub.edu.ph',
        name: `${userData.firstName} ${userData.lastName}`,
        title: 'Faculty',
        facultyID: userData.facultyID,
        canIssue: userData.canIssue
      });
      navigate('/faculty/dashboard');
    } else {
      // Student response: { studentID, firstName, lastName, walletAddress }
      setUser({
        role,
        email: userData.email || 'student@ub.edu.ph',
        name: `${userData.firstName} ${userData.lastName}`,
        title: 'Student',
        studentID: userData.studentID,
        walletAddress: userData.walletAddress
      });
      console.log('Navigating to student dashboard...');
      navigate('/student/dashboard');
    }
  };

  const handleSignOut = async () => {
    try {
      if (isConnected) {
        await web3Auth.logout();
      }

      await api('/api/auth/logout', {
        method: 'POST',
      });

      setUser(null);
      setSelectedCertId(null);

      navigate('/login', {replace: true});
    } catch (err) {
      console.error('Sign-out failed:', err.message);
      window.alert('Sign-out failed. Please try again.');
    }
  };

  const handleNavigate = (view) => {
    const routes = {
      'student-dashboard': '/student/dashboard',
      'student-certificates': '/student/collection',
      'faculty-dashboard': '/faculty/dashboard',
      'faculty-issue': '/faculty/issue',
      'faculty-revocation': '/faculty/revocation',
      'verify': '/verify',
    };
    navigate(routes[view] || '/');
  };

  const handleCertificateClick = (cert) => {
    setSelectedCertId(cert.id);
    // Navigate to certificate detail page (for future implementation)
  };

  const handleShareClick = (cert) => {
    // Share modal logic would go here
  };

  const handleVerifyClick = (certId) => {
    navigate(`/verify?id=${certId}`);
  };

  const handleRevoke = (certId, reason) => {
    setCertificates(certs =>
      certs.map(c => (c.id === certId ? { ...c, status: 'Revoked' } : c))
    );
    console.log('Revoked:', certId, 'Reason:', reason);
  };

  const handleIssueComplete = () => {
    navigate('/faculty/dashboard');
  };

  // Get current view for TopNav active state
  const currentView = location.pathname.split('/').pop() || 
    (location.pathname.includes('student') ? 'student-dashboard' : 
     location.pathname.includes('faculty') ? 'faculty-dashboard' : '');

  // Get student certificates
  const studentCerts = user?.role === 'student' 
    ? certificates.filter(c => c.email === user.email) 
    : [];

  if (!isVerifierPage && checkingSession) {
    return (
      <main classname="max-w-xl mx-auto p-8 text-center">
        <p>Checking your session...</p>
      </main>
    );
  }

  if (!isVerifierPage && sessionError) {
    return (
      <main className="max-w-xl mx-auto p-8 text-center">
        <p role="alert">{sessionError}</p>
        
        <button
          type="button"
          classname="btn btn-primary mt-4"
          onClick={() => window.location.reload()}
        > Try again </button>  
      </main>
    );
  }

  return (
    <>
      <Routes>
        {/* Login */}
        <Route
          path="/login"
          element={
            user ? (
              <Navigate
                to={
                  user.role === 'faculty' ? '/faculty/dashboard' : '/student/dashboard'
                }
                replace
              />
            ) : (
              <LoginPage
                onLogin={handleLogin}
                onNavigateVerifier={() => navigate('/verify')}
                />
            )
          }
        />

        {/* Student Routes */}
        <Route
          path="/student/dashboard"
          element={
            user?.role === 'student' ? (
              <>
                <TopNav
                  role="student"
                  view={currentView}
                  onNavigate={handleNavigate}
                  onSignOut={handleSignOut}
                  userName={user.name}
                  userTitle={user.title}
                />
                <main className="max-w-[1280px] mx-auto px-4 pt-10 fade-view" key={location.pathname}>
                  <StudentDashboardPage
                    certificates={studentCerts}
                    onCertificateClick={handleCertificateClick}
                    onShareClick={handleShareClick}
                    onVerifyClick={handleVerifyClick}
                    onNavigateCollection={() => navigate('/student/collection')}
                    walletAddress={user.walletAddress}
                  />
                </main>
              </>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/student/collection"
          element={
            user?.role === 'student' ? (
              <>
                <TopNav
                  role="student"
                  view={currentView}
                  onNavigate={handleNavigate}
                  onSignOut={handleSignOut}
                  userName={user.name}
                  userTitle={user.title}
                />
                <main className="max-w-[1280px] mx-auto px-4 pt-10 fade-view" key={location.pathname}>
                  <StudentCollectionPage
                    certificates={studentCerts}
                    onCertificateClick={handleCertificateClick}
                  />
                </main>
              </>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        {/* Faculty Routes */}
        <Route
          path="/faculty/dashboard"
          element={
            user?.role === 'faculty' ? (
              <>
                <TopNav
                  role="faculty"
                  view={currentView}
                  onNavigate={handleNavigate}
                  onSignOut={handleSignOut}
                  userName={user.name}
                  userTitle={user.title}
                />
                <main className="max-w-[1280px] mx-auto px-4 pt-10 fade-view" key={location.pathname}>
                  <FacultyDashboardPage
                    certificates={certificates}
                    onIssueClick={() => navigate('/faculty/issue')}
                    onNavigateRevocation={() => navigate('/faculty/revocation')}
                  />
                </main>
              </>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/faculty/issue"
          element={
            user?.role === 'faculty' ? (
              <>
                <TopNav
                  role="faculty"
                  view={currentView}
                  onNavigate={handleNavigate}
                  onSignOut={handleSignOut}
                  userName={user.name}
                  userTitle={user.title}
                />
                <main className="max-w-[1280px] mx-auto px-4 pt-10 fade-view" key={location.pathname}>
                  <IssuancePage 
                    onComplete={handleIssueComplete}
                    onNavigateRegistry={() => navigate('/faculty/dashboard')}
                  />
                </main>
              </>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/faculty/revocation"
          element={
            user?.role === 'faculty' ? (
              <>
                <TopNav
                  role="faculty"
                  view={currentView}
                  onNavigate={handleNavigate}
                  onSignOut={handleSignOut}
                  userName={user.name}
                  userTitle={user.title}
                />
                <main className="max-w-[1280px] mx-auto px-4 pt-10 fade-view" key={location.pathname}>
                  <RevocationPage certificates={certificates} onRevoke={handleRevoke} />
                </main>
              </>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        {/* Public Verifier */}
        <Route
          path="/verify"
          element={
            <VerifierPortalPage
              certificates={certificates}
              initialId={new URLSearchParams(location.search).get('id') || ''}
              onBackToPortal={() => {
                if (user) {
                  navigate(user.role === 'faculty' ? '/faculty/dashboard' : '/student/dashboard');
                } else {
                  navigate('/login');
                }
              }}
              loggedIn={!!user}
            />
          }
        />

        {/* Default redirect */}
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

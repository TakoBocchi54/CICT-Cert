import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { api } from './lib/api';
import { useQuery } from '@tanstack/react-query';
import { useWeb3Auth } from '@web3auth/modal/react';
import TopNav from './components/TopNav';
import LoginPage from './pages/LoginPage';
import StudentDashboardPage from './pages/StudentDashboardPage';
import StudentCollectionPage from './pages/StudentCollectionPage';
import StudentCertificatePage from './pages/StudentCertificatePage';
import CertificateDownload from './components/CertificateDownload';
import FacultyAccountPage from './pages/FacultyAccountPage';
import FacultyDashboardPage from './pages/FacultyDashboardPage';
import IssuancePage from './pages/IssuancePage';
import RevocationPage from './pages/RevocationPage';
import StudentsPage from './pages/StudentsPage';
import RegistryPage from './pages/RegistryPage';
import TemplatesPage from './pages/TemplatesPage';
import SeminarsPage from './pages/SeminarsPage';
import VerifierPortalPage from './pages/VerifierPortalPage';
import RegisterPage from './pages/RegisterPage';

// Main app content with routing logic
function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionError, setSessionError] = useState(null);
  const [selectedCertId, setSelectedCertId] = useState(null);
  const { web3Auth, isConnected } = useWeb3Auth();
  const studentCertificates = useQuery({
    queryKey: ['student-certificates', user?.studentID],
    queryFn: ({ signal }) => api('/api/student/certificates', { signal }),
    enabled: user?.role === 'student', retry: false, refetchOnWindowFocus: false,
  });


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
      } catch {
        if (!controller.signal.aborted) {
          setSessionError('Could not check your session, please try again.');
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
  

  // Public pages render without waiting for the session check.
  const isPublicPage = location.pathname.startsWith('/verify') || location.pathname.startsWith('/register/');

  const needsWalletSetup = user?.role === 'student' && !user.walletAddress;

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
      // Student response: { studentID, email, fullName, walletAddress }
      setUser({
        role,
        email: userData.email,
        name: userData.fullName,
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
      'faculty-seminars': '/faculty/seminars',
      'faculty-issue': '/faculty/issue',
      'faculty-students': '/faculty/students',
      'faculty-registry': '/faculty/registry',
      'faculty-templates': '/faculty/templates',
      'faculty-account': '/faculty/account',
      'verify': '/verify',
    };
    navigate(routes[view] || '/');
  };

  const handleCertificateClick = (cert) => {
    setSelectedCertId(cert.id);
  };

  const openCertificate = (cert) => navigate(`/student/certificates/${cert.id}`);

  const handleVerifyClick = (certId) => {
    navigate(`/verify?id=${certId}`);
  };

  // Get current view for TopNav active state
  const currentView = ({
    '/student/dashboard': 'student-dashboard',
    '/student/collection': 'student-certificates',
    '/faculty/dashboard': 'faculty-dashboard',
    '/faculty/seminars': 'faculty-seminars',
    '/faculty/issue': 'faculty-issue',
    '/faculty/students': 'faculty-students',
    '/faculty/registry': 'faculty-registry',
    '/faculty/templates': 'faculty-templates',
    '/faculty/revocation': 'faculty-registry', // reached from a Registry row
    '/faculty/account': 'faculty-account',
  })[location.pathname] || (location.pathname.startsWith('/student/certificates/') ? 'student-certificates' : '');

  // Get student certificates
  // The student pages render only once the list has loaded; this shows the loading or error state meanwhile.
  const certificatesStatus = studentCertificates.isPending ? <p role="status" className="text-sm text-ink-muted">Loading certificates...</p>
    : studentCertificates.error ? <p role="alert" className="text-sm text-revoked">{studentCertificates.error.message}</p> : null;
  const studentCerts = (studentCertificates.data || []).filter(certificate => ['ISSUED', 'REVOKED'].includes(certificate.status))
    .map(certificate => ({ id: certificate.certificateNo, certificateID: certificate.certificateID, recipient: certificate.recipientName,
      seminar: certificate.seminarTitle, iso: certificate.seminarDate, hash: certificate.certificateHash,
      status: certificate.status === 'ISSUED' ? 'Verified' : 'Revoked', block: certificate.blockNum,
      tokenID: certificate.tokenID, transactionHash: certificate.transactionHash, template: certificate.template }));
  const selectedCertificate = user?.role === 'student' && studentCerts.find(certificate => certificate.id === selectedCertId);

  if (!isPublicPage && checkingSession) {
    return (
      <main className="max-w-xl mx-auto p-8 text-center">
        <p>Checking your session...</p>
      </main>
    );
  }

  if (!isPublicPage && sessionError) {
    return (
      <main className="max-w-xl mx-auto p-8 text-center">
        <p role="alert">{sessionError}</p>
        
        <button
          type="button"
          className="btn btn-primary mt-4"
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
            user && !needsWalletSetup ? (
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
                needsWalletSetup={needsWalletSetup}
                />
            )
          }
        />

        {/* Student Routes */}
        <Route
          path="/student/dashboard"
          element={
            user?.role === 'student' && !needsWalletSetup ? (
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
                  {certificatesStatus}
                  {!studentCertificates.isPending && !studentCertificates.error && <StudentDashboardPage
                    certificates={studentCerts}
                    onCertificateClick={openCertificate}
                    onVerifyClick={handleVerifyClick}
                    onDownloadClick={handleCertificateClick}
                    onNavigateCollection={() => navigate('/student/collection')}
                    walletAddress={user.walletAddress}
                  />}
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
            user?.role === 'student' && !needsWalletSetup ? (
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
                  {certificatesStatus}
                  {!studentCertificates.isPending && !studentCertificates.error && <StudentCollectionPage
                    certificates={studentCerts}
                    onCertificateClick={openCertificate}
                    onDownloadClick={handleCertificateClick}
                  />}
                </main>
              </>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/student/certificates/:certificateNo"
          element={
            user?.role === 'student' && !needsWalletSetup ? (
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
                  {certificatesStatus}
                  {!studentCertificates.isPending && !studentCertificates.error && <StudentCertificatePage
                    certificates={studentCerts}
                    onBack={() => navigate('/student/collection')}
                    onDownload={handleCertificateClick}
                  />}
                </main>
              </>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        {/* Faculty Routes */}
        <Route
          path="/faculty/account"
          element={
            user?.role === 'faculty' ? (
              <>
                <TopNav role="faculty" view={currentView} onNavigate={handleNavigate}
                  onSignOut={handleSignOut} userName={user.name} userTitle={user.title} />
                <main className="max-w-[1280px] mx-auto px-4 pt-10 fade-view" key={location.pathname}>
                  <FacultyAccountPage onProfileUpdated={account => setUser(current => ({
                    ...current,
                    name: account.firstName + ' ' + account.lastName,
                    email: account.email,
                    canIssue: account.canIssue,
                  }))} />
                </main>
              </>
            ) : <Navigate to="/login" replace />
          }
        />
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
                    onIssueClick={seminarID => navigate('/faculty/issue' + (seminarID ? '?seminar=' + encodeURIComponent(seminarID) : ''))}
                    onNavigateRevocation={() => navigate('/faculty/registry?status=REVOKED')}
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
                    onNavigateRegistry={() => navigate('/faculty/dashboard')}
                    onNavigateSeminars={() => navigate('/faculty/seminars')}
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
                  <RevocationPage initialNo={new URLSearchParams(location.search).get('no') || ''} onBack={() => navigate('/faculty/registry')} />
                </main>
              </>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        <Route
          path="/faculty/seminars"
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
                  <SeminarsPage />
                </main>
              </>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        <Route
          path="/faculty/students"
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
                  <StudentsPage />
                </main>
              </>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        <Route
          path="/faculty/registry"
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
                  <RegistryPage initialStatus={new URLSearchParams(location.search).get('status') || ''}
                    onOpenRevocation={no => navigate('/faculty/revocation?no=' + encodeURIComponent(no))} />
                </main>
              </>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        <Route
          path="/faculty/templates"
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
                  <TemplatesPage />
                </main>
              </>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        {/* Public seminar registration (the link faculty share) */}
        <Route path="/register/:token" element={<RegisterPage onLogin={handleLogin} />} />

        {/* Public Verifier */}
        <Route
          path="/verify"
          element={
            <VerifierPortalPage
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
      {selectedCertificate && <CertificateDownload key={selectedCertificate.id} cert={selectedCertificate} onClose={() => setSelectedCertId(null)} />}
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

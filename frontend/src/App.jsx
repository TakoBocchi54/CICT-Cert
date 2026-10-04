import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import RoleSelection from "./pages/auth/roleSelection";
import StudentLogin from "./pages/auth/studentLogin";
import FacultyLogin from "./pages/auth/facultyLogin";
import FacultyDashboard from "./pages/faculty/dashboard";
import StudentDashboard from "./pages/student/dashboard";
import RequireWallet from "./components/requireWallet";
import RequireFaculty from "./components/RequireFaculty";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<RoleSelection />} />

        <Route path="/student/login" element={<StudentLogin />} />
        <Route path="/faculty/login" element={<FacultyLogin />} />

        <Route
          path="/faculty/dashboard"
          element={
            <RequireFaculty>
              <FacultyDashboard />
            </RequireFaculty>
          }
        />
        <Route
          path="/student/dashboard"
          element={
            <RequireWallet>
              <StudentDashboard />
            </RequireWallet>
          }
        />
      </Routes>
    </Router>
  );
}

import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import RoleSelection from "./pages/auth/roleSelection";
import Login from "./pages/auth/login";
import FacultyDashboard from "./pages/faculty/dashboard";
import StudentDashboard from "./pages/student/dashboard";

export default function App() {
  return (
    <Router>
      <Routes>
        {/* Starting page */}
        <Route path="/" element={<RoleSelection />} />
        {/* Login Route */}
        <Route path="/student/login" element={<Login role="student" />} />
        <Route path="/faculty/login" element={<Login role="faculty" />} />
        {/* Dashboard Routes */}
        <Route path="/faculty/dashboard" element={<FacultyDashboard />} />
        <Route path="/student/dashboard" element={<StudentDashboard />} />
      </Routes>
    </Router>
  )
}
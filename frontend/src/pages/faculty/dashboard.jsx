import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useFacultyMe } from "../../hooks/useFacultyMe";
import { api } from "../../lib/api";

export default function FacultyDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: faculty } = useFacultyMe();

  const handleLogout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    queryClient.removeQueries({ queryKey: ["faculty-me"] });
    navigate("/faculty/login", { replace: true });
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Faculty Dashboard</h1>
      <p className="mt-2">Welcome, {faculty.firstName} {faculty.lastName}</p>

      {!faculty.canIssue && (
        <p className="mt-4 rounded-md bg-amber-100 text-amber-800 p-3 text-sm">
          Your account is not yet authorized to issue certificates.
        </p>
      )}

      <button onClick={handleLogout} className="mt-6 bg-black text-white px-4 py-2 rounded-md">
        Log out
      </button>
    </div>
  );
}

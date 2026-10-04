import { Navigate } from "react-router-dom";
import { useFacultyMe } from "../hooks/useFacultyMe";

export default function RequireFaculty({ children }) {
  const { data, isLoading, isError } = useFacultyMe();

  if (isLoading) return <p className="p-8">Loading...</p>;
  if (isError || !data) return <Navigate to="/faculty/login" replace />;
  return children;
}

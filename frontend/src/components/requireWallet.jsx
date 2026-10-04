import { Navigate } from "react-router-dom";
import { useConnection } from "wagmi";
import { useWeb3Auth } from "@web3auth/modal/react";
import { useStudentSession } from "../hooks/useStudentSession";

export default function RequireWallet({ children }) {
  const { isInitializing } = useWeb3Auth();
  const { status } = useConnection();
  const session = useStudentSession();

  if (isInitializing || status === "connecting" || status === "reconnecting") {
    return <p className="p-8">Loading...</p>;
  }
  if (status === "disconnected") return <Navigate to="/student/login" replace />;
  if (session.status === "error") return <p className="p-8 text-red-600">{session.error}</p>;
  if (session.status !== "ready") return <p className="p-8">Loading...</p>;
  return children;
}

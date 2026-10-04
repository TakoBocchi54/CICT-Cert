import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useWeb3AuthConnect, useWeb3AuthDisconnect } from "@web3auth/modal/react";
import { useStudentSession } from "../../hooks/useStudentSession";

export default function StudentLogin() {
  const navigate = useNavigate();
  const { connect, loading, error } = useWeb3AuthConnect();
  const { disconnect } = useWeb3AuthDisconnect();
  const session = useStudentSession();

  useEffect(() => {
    if (session.status === "ready") navigate("/student/dashboard", { replace: true });
  }, [session.status, navigate]);

  const busy = loading || session.status === "working";

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="w-full max-w-md bg-white p-8 rounded-lg shadow-md text-center">
        <h1 className="text-3xl font-bold">CICT-Cert</h1>
        <p className="text-gray-500 mt-2 mb-8">Student Login</p>

        <button
          type="button"
          onClick={() => connect()}
          disabled={busy}
          className="w-full bg-black text-white py-2 rounded-md disabled:opacity-50"
        >
          {session.status === "working"
            ? "Verifying your account..."
            : loading
            ? "Connecting..."
            : "Sign in with your school account"}
        </button>

        {(error || session.error) && (
          <p className="text-red-600 text-sm mt-4">{session.error || error.message}</p>
        )}

        {session.status === "error" && (
          <button type="button" onClick={() => disconnect()} className="mt-4 text-sm underline">
            Use a different account
          </button>
        )}
      </div>
    </div>
  );
}

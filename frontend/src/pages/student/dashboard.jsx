import { useNavigate } from "react-router-dom";
import { useConnection } from "wagmi";
import { useWeb3AuthDisconnect, useWeb3AuthUser } from "@web3auth/modal/react";
import { api } from "../../lib/api";

export default function StudentDashboard() {
  const navigate = useNavigate();
  const { address } = useConnection();
  const { userInfo } = useWeb3AuthUser();
  const { disconnect } = useWeb3AuthDisconnect();

  const handleLogout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    await disconnect();
    navigate("/");
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Student Dashboard</h1>
      <p className="mt-2">Welcome, {userInfo?.name ?? userInfo?.email}</p>
      <p className="mt-2 break-all text-sm text-gray-600">Wallet: {address}</p>
      <button onClick={handleLogout} className="mt-6 bg-black text-white px-4 py-2 rounded-md">
        Log out
      </button>
    </div>
  );
}

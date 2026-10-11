import { useEffect, useRef, useState } from "react";
import { useConnection, useSignMessage } from "wagmi";
import { useWeb3Auth } from "@web3auth/modal/react";
import { api } from "../lib/api";

export function useStudentSession() {
  const { address, isConnected } = useConnection();
  const { web3Auth } = useWeb3Auth();
  const signMessage = useSignMessage();
  const [state, setState] = useState({ status: "idle", student: null, error: null });
  const startedFor = useRef(null);

  useEffect(() => {
    if (!isConnected) {
      startedFor.current = null;
      setState({ status: "idle", student: null, error: null });
      return;
    }
    if (!address || startedFor.current === address) return;
    startedFor.current = address;
    setState({ status: "working", student: null, error: null });

    (async () => {
      try {
        // Get ID token from Web3Auth instance
        if (!web3Auth) {
          throw new Error("Web3Auth not initialized");
        }
        
        let idToken;
        try {
          const tokenInfo = await web3Auth.getAuthTokenInfo();
          idToken = tokenInfo?.idToken;
        } catch (tokenError) {
          console.error("getAuthTokenInfo failed:", tokenError.message);
          // Try alternative method: authenticateUser
          try {
            const userInfo = await web3Auth.authenticateUser();
            idToken = userInfo?.idToken;
          } catch (authError) {
            console.error("authenticateUser also failed:", authError.message);
            throw new Error("Could not retrieve authentication token from Web3Auth");
          }
        }
        
        if (!idToken) {
          throw new Error("Could not get authentication token");
        }

        let student = await api("/api/auth/student/session", {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}` },
        });

        if (!student.walletAddress) {
          const { message, challenge } = await api("/api/wallet/nonce");
          const signature = await signMessage.mutateAsync({ message });
          student = await api("/api/wallet/link", {
            method: "POST",
            body: { address, signature, challenge },
          });
        }
        setState({ status: "ready", student, error: null });
      } catch (err) {
        console.error("Session error:", err.message);
        setState({ status: "error", student: null, error: err.message });
      }
    })();
  }, [isConnected, address, web3Auth]);

  return state;
}

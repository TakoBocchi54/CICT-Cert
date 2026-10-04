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

        console.log("Web3Auth instance:", web3Auth);
        console.log("Attempting to get auth token info...");
        
        let idToken;
        try {
          const tokenInfo = await web3Auth.getAuthTokenInfo();
          console.log("Token info received:", tokenInfo);
          idToken = tokenInfo?.idToken;
        } catch (tokenError) {
          console.error("getAuthTokenInfo failed:", tokenError);
          // Try alternative method: authenticateUser
          try {
            console.log("Trying authenticateUser as fallback...");
            const userInfo = await web3Auth.authenticateUser();
            console.log("authenticateUser result:", userInfo);
            idToken = userInfo?.idToken;
          } catch (authError) {
            console.error("authenticateUser also failed:", authError);
            throw new Error("Could not retrieve authentication token from Web3Auth");
          }
        }
        
        if (!idToken) {
          throw new Error("Could not get authentication token");
        }

        console.log("Got ID token, sending to backend...");

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
        console.error("Session error:", err);
        setState({ status: "error", student: null, error: err.message });
      }
    })();
  }, [isConnected, address, web3Auth]);

  return state;
}

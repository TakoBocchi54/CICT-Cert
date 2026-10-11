import { useEffect, useState } from "react";
import { useConnection, useSignMessage } from "wagmi";
import { useWeb3Auth } from "@web3auth/modal/react";
import { isAddressEqual } from "viem";
import { api } from "../lib/api";

export function useStudentSession( {enabled = true } = {}) {
  const { address, isConnected } = useConnection();
  const { web3Auth } = useWeb3Auth();
  const { mutateAsync: signMessageAsync } = useSignMessage();
  const [state, setState] = useState({ status: "idle", student: null, error: null });
  const [attempt, setAttempt] = useState(0);

  const retry = () => {
    if (!enabled || state.status !== "error") return;

    setState({ status: "idle", student: null, error: null });
    setAttempt(value => value + 1);
  };

  useEffect(() => {
    if (!enabled || !isConnected || !address || !web3Auth) {
      setState({ status: "idle", student: null, error: null });
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;

    setState({ status: "working", student: null, error: null });

    async function verifySession() {
      try {
        const tokenInfo = await web3Auth.getAuthTokenInfo();
        if (signal.aborted) return;
        
        const idToken = tokenInfo?.idToken;
        
        if (!idToken) {
          throw new Error("Could not get authentication token");
        }

        let student = await api("/api/auth/student/session", {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}` },
          signal,
        });

        if (signal.aborted) return;

        if (!student.walletAddress) {
          const { message, challenge } = await api("/api/wallet/nonce", { signal, });
          if (signal.aborted) return;

          const signature = await signMessageAsync({ message, account: address, });
          if (signal.aborted) return;

          student = await api("/api/wallet/link", {
            method: "POST",
            body: { address, signature, challenge }, signal,
          });
          if (signal.aborted) return;
        }

        if (!student.walletAddress) {
          throw new Error("No wallet is linked to this account.");
        }

        if (!isAddressEqual(student.walletAddress, address)) {
          throw new Error("The connected wallet address does not match the wallet saved for your account.");
        }

        setState({ status: "ready", student, error: null });
      } catch (err) {
        if (signal.aborted) return;

        console.error("Session error:", err.message);
        setState({ status: "error", student: null, error: err.message || "Could not verify your session"});
      }
    }
    verifySession();

    return () => controller.abort();
  }, [enabled,isConnected, address, web3Auth, attempt, signMessageAsync]);

  return { ...state, retry };
}

import { WEB3AUTH_NETWORK, CHAIN_NAMESPACES } from "@web3auth/modal";

export const web3AuthContextConfig = {
    web3AuthOptions: {
        clientId: import.meta.env.VITE_WEB3AUTH_CLIENT_ID,
        web3AuthNetwork: WEB3AUTH_NETWORK.SAPPHIRE_DEVNET,
        disableAnalytics: true,
        // Sign in by sending the whole tab to Google and back. In popup mode the first sign-in often failed with
        // "Wallet popup has been closed by the user": the popup closed before Web3Auth heard back from it.
        // The answer comes back in the URL, so App keeps ?query/#hash when it redirects to /login.
        uiConfig: { uxMode: "redirect" },
        // Pin Polygon Amoy with a public RPC; otherwise Web3Auth defaults to Sepolia through its own RPC proxy,
        // and an outage there (503) blocks student sign-in.
        chains: [{
            chainNamespace: CHAIN_NAMESPACES.EIP155,
            chainId: "0x13882",
            // Same RPC as the backend; rpc-amoy.polygon.technology kept failing with "Failed to fetch".
            rpcTarget: "https://polygon-amoy-bor-rpc.publicnode.com",
            displayName: "Polygon Amoy Testnet",
            blockExplorerUrl: "https://amoy.polygonscan.com",
            ticker: "POL",
            tickerName: "Polygon Ecosystem Token",
            logo: "https://cryptologos.cc/logos/polygon-matic-logo.png",
        }],
        defaultChainId: "0x13882",
    },
};

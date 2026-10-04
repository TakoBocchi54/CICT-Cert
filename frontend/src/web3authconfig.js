import { WEB3AUTH_NETWORK } from "@web3auth/modal";

export const web3AuthContextConfig = {
    web3AuthOptions: {
        clientId: import.meta.env.VITE_WEB3AUTH_CLIENT_ID,
        web3AuthNetwork: WEB3AUTH_NETWORK.SAPPHIRE_DEVNET,
    },
};
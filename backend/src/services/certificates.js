import { createPublicClient, getAddress, http } from "viem";
import { polygonAmoy } from "viem/chains";
import abi from "../contracts/CICTCertificate.abi.json" with { type: "json" };

export function certificateContract() {
    // Missing verifier configuration should not prevent account routes from starting.
    const rpcurl = process.env.AMOY_RPC_URL?.trim();
    const contractAddress = process.env.CONTRACT_ADDRESS?.trim();
    if (!rpcurl || !contractAddress) {
        throw new Error("Missing blockchain configuration");
    }

    const address = getAddress(contractAddress);
    const client = createPublicClient({
        chain: polygonAmoy,
        transport: http(rpcurl, { timeout: 10_000, retryCount: 0 }),
    });

    return { client, address };
}

export function verifyCertificate(certHash) {
    const { client, address } = certificateContract();
    return client.readContract({
        address,
        abi,
        functionName: "verify",
        args: [certHash],
    });
}

export async function certificateIssuer() {
    const { client, address } = certificateContract();
    const [chainId, issuer] = await Promise.all([
        client.getChainId(),
        client.readContract({ address, abi, functionName: "issuer" }),
    ]);
    if (chainId !== polygonAmoy.id || /^0x0{40}$/i.test(issuer)) {
        throw new Error("Invalid issuer network or address");
    }
    return { chainId, contractAddress: address.toLowerCase(), issuerAddress: issuer.toLowerCase() };
}


import { createPublicClient, getAddress, http } from "viem";
import { polygonAmoy } from "viem/chains";
import abi from "../contracts/CICTCertificate.abi.json" with { type: "json"};

const rpcurl = process.env.AMOY_RPC_URL?.trim();
const contractAddress = process.env.CONTRACT_ADDRESS?.trim();

if (!rpcurl || !contractAddress) {
    throw new Error("Missing blockchain configuration");
}

const address = getAddress(contractAddress);
const client = createPublicClient({
    chain: polygonAmoy,
    transport: http(rpcurl),
});

export function verifyCertificate (certHash) {
    return client.readContract({
        address,
        abi,
        functionName: "verify",
        args: [certHash],
    });
}


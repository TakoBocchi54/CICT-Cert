import { createPublicClient, formatEther, getAddress, http, parseEther } from "viem";
import { polygonAmoy } from "viem/chains";
import abi from "../contracts/CICTCertificate.abi.json" with { type: "json" };
import { pool } from "../db/pool.js";
import { merkleProof, merkleRoot, smtProof, smtRoot } from "../utils/merkle.js";

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

// Token IDs revoked on this contract: `confirmed` are final, `pending` also counts a revocation batch that is
// signed but not yet final. The on-chain root equals one of the two while such a batch is in flight.
export async function revokedTokenIds(db, contractAddress) {
    const { rows } = await db.query(
        `SELECT "tokenID", "transactionStatus" FROM blockchain_record
         WHERE "transactionType" = 'REVOKE' AND "transactionStatus" IN ('CONFIRMED', 'PENDING') AND lower("contractAddress") = $1`,
        [contractAddress.toLowerCase()],
    );
    return { confirmed: rows.filter(row => row.transactionStatus === "CONFIRMED").map(row => row.tokenID), pending: rows.map(row => row.tokenID) };
}

// A certificate's confirmed mint on this contract with its position in the batch and inclusion proof, or null.
export async function inclusionProof(db, certHash, contractAddress) {
    const { rows } = await db.query(
        `SELECT c."certificateHash", b."tokenID", b."transactionHash", b."blockNum"
         FROM blockchain_record b JOIN certificate c USING ("certificateID")
         WHERE b."transactionType" = 'MINT' AND b."transactionStatus" = 'CONFIRMED' AND lower(b."contractAddress") = $2
           AND b."transactionHash" = (SELECT m."transactionHash" FROM blockchain_record m JOIN certificate mc USING ("certificateID")
             WHERE mc."certificateHash" = $1 AND m."transactionType" = 'MINT' AND m."transactionStatus" = 'CONFIRMED')
         ORDER BY b."tokenID"`, [certHash, contractAddress.toLowerCase()],
    );
    const hashes = rows.map(row => row.certificateHash), index = hashes.indexOf(certHash);
    if (index < 0) return null;
    return { tokenID: rows[index].tokenID, index, merkleRoot: merkleRoot(hashes), merkleProof: merkleProof(hashes, index),
        transactionHash: rows[index].transactionHash, blockNum: rows[index].blockNum };
}

// Builds both proofs from the database and lets the contract judge them. Returns status 0 for a hash this
// contract never issued; throws when the database and the chain cannot be reconciled.
export async function verifyCertificate(certHash) {
    const { client, address } = certificateContract();
    const included = await inclusionProof(pool, certHash, address);
    if (!included) return { status: 0 };

    const [root, revoked] = await Promise.all([
        client.readContract({ address, abi, functionName: "revocationRoot" }),
        revokedTokenIds(pool, address),
    ]);
    const set = [revoked.confirmed, revoked.pending].find(ids => smtRoot(ids) === root);
    if (!set) throw new Error("Revocation root mismatch");

    const { bitmap, siblings } = smtProof(set, included.tokenID);
    const [status, recipient, batchId, , issuedAt] = await client.readContract({ address, abi, functionName: "verify",
        args: [BigInt(included.tokenID), certHash, included.merkleProof, bitmap, siblings] });
    return { status, tokenID: included.tokenID, recipient, batchId, issuedAt };
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

// Default 0.5 POL: about two full 100-certificate batches at 25–35 gwei (≈75k gas per certificate).
export const lowBalanceThreshold = () => {
    const value = process.env.ISSUER_LOW_BALANCE_POL?.trim();
    return /^\d{1,9}(\.\d{1,18})?$/.test(value ?? "") ? value : "0.5";
};

// The contract issuer's POL balance against the low-balance threshold. issuer_wallet."lowBalanceSince" records when
// it was first seen below the threshold (the low-balance notification's time) and is cleared once it is above again.
// Throws when the RPC fails.
export async function issuerBalance() {
    const { issuerAddress } = await certificateIssuer();
    const wei = await certificateContract().client.getBalance({ address: issuerAddress });
    const threshold = lowBalanceThreshold(), low = wei < parseEther(threshold);
    let lowSince = null;
    if (low) {
        const { rows } = await pool.query(`INSERT INTO issuer_wallet ("issuerWalletAddress", label, network, "lowBalanceSince")
            VALUES ($1, 'CICT', 'polygon-amoy', now())
            ON CONFLICT (lower("issuerWalletAddress")) DO UPDATE SET "lowBalanceSince" = coalesce(issuer_wallet."lowBalanceSince", now())
            RETURNING "lowBalanceSince"`, [issuerAddress]);
        lowSince = rows[0].lowBalanceSince;
    } else {
        await pool.query(`UPDATE issuer_wallet SET "lowBalanceSince" = NULL WHERE lower("issuerWalletAddress") = $1 AND "lowBalanceSince" IS NOT NULL`, [issuerAddress]);
    }
    return { address: issuerAddress, balance: formatEther(wei), threshold, low, lowSince };
}

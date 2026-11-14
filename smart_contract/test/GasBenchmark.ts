import { expect } from "chai";
import { network } from "hardhat";
// @ts-ignore untyped JavaScript module from the backend project
import { merkleProof, merkleRoot, smtProof, smtProofBytes, smtRoot, verifyMerkleProof, verifySmtProof } from "../../backend/src/utils/merkle.js";

// Measurements only: prints tables, asserts just enough to prove each run did what it claims.
// Run alone with: npx hardhat test mocha test/GasBenchmark.ts
const { ethers } = await network.create();

const hashesOf = (count: number) => Array.from({ length: count }, (_, i) => ethers.id(`bench-${i}`));
// Fresh addresses, so each mint pays for a new balance slot (a student's first certificate, the costly case).
let nextAddress = 0x100000n;
const recipientsOf = (count: number) => Array.from({ length: count }, () => ethers.getAddress(ethers.toBeHex(nextAddress++, 20)));
const idsTo = (count: number) => Array.from({ length: count }, (_, i) => BigInt(i + 1));
const gasOf = async (tx: Promise<{ wait(): Promise<{ gasUsed: bigint } | null> }>) => (await (await tx).wait())!.gasUsed;
const per = (total: bigint, count: number) => Math.round(Number(total) / count);

function timed<T>(run: () => T, repeats = 20) {
    const start = performance.now();
    let result!: T;
    for (let i = 0; i < repeats; i++) result = run();
    return { result, ms: Number(((performance.now() - start) / repeats).toFixed(3)) };
}

describe("Gas benchmark", function () {
    this.timeout(600_000);

    it("issuance: per-token hash storage vs one Merkle root per batch", async function () {
        const rows = [];
        for (const k of [1, 10, 50, 100, 200]) {
            const [issuer] = await ethers.getSigners();
            const stored = await ethers.deployContract("HashStorageBench");
            const rooted = await ethers.deployContract("CICTCertificate", [issuer.address]);
            const ranged = await ethers.deployContract("RangeBatchBench");
            const hashes = hashesOf(k);

            let single = 0n; // one transaction per certificate, as issuance worked before batching
            for (const hash of hashes) single += await gasOf(stored.issueBatch(recipientsOf(1), [hash]));
            const storedBatch = await gasOf(stored.issueBatch(recipientsOf(k), hashes));
            const merkleBatch = await gasOf(rooted.issueBatch(1n, merkleRoot(hashes), recipientsOf(k), hashes));
            const rangeBatch = await gasOf(ranged.issueBatch(merkleRoot(hashes), recipientsOf(k), hashes));
            expect(await rooted.lastBatchId()).to.equal(1n);

            const saved = (gas: bigint) => `${(100 - Number(gas * 1000n / single) / 10).toFixed(1)}%`;
            rows.push({ certificates: k, "one tx each, hash stored": `${single} (${per(single, k)}/cert)`,
                "one batch, hash stored": `${storedBatch} (${per(storedBatch, k)}/cert)`,
                "CICTCertificate (root + batchId per token)": `${merkleBatch} (${per(merkleBatch, k)}/cert)`, "saved": saved(merkleBatch),
                "root only, no per-token slot": `${rangeBatch} (${per(rangeBatch, k)}/cert)`, "saved ": saved(rangeBatch) });
        }
        console.log("\nIssuance gas");
        console.table(rows);
    });

    it("revocation: burn vs mapping vs packed bitmap vs sparse Merkle root", async function () {
        const rows = [];
        for (const k of [1, 10, 100, 1000]) {
            const [issuer] = await ethers.getSigners();
            const bench = await ethers.deployContract("RevocationBench");
            for (let minted = 0; minted < 1000; minted += 200) await bench.mint(issuer.address, 200);
            const ids = idsTo(k);

            // Per-token methods are split so no transaction passes the 16.7M per-transaction gas cap.
            const chunked = async (send: (chunk: bigint[]) => Promise<any>, size: number) => {
                let gas = 0n, txs = 0;
                for (let i = 0; i < ids.length; i += size, txs++) gas += await gasOf(send(ids.slice(i, i + size)));
                return { gas, txs };
            };
            const burn = await chunked(chunk => bench.revokeByBurn(chunk), 500);
            const mapping = await chunked(chunk => bench.revokeByMapping(chunk), 500);
            const bitmap = await chunked(chunk => bench.revokeByBitmap(chunk), 1000);
            const smt = await chunked(chunk => bench.revokeBySmt(smtRoot(chunk), chunk), 1000);
            expect(await bench.balanceOf(issuer.address)).to.equal(BigInt(1000 - k));
            expect(await bench.revokedFlag(BigInt(k))).to.equal(true);

            const cell = ({ gas, txs }: { gas: bigint; txs: number }) => `${gas} (${per(gas, k)}/cert, ${txs} tx)`;
            rows.push({ revoked: k, burn: cell(burn), mapping: cell(mapping), "packed bitmap": cell(bitmap), "sparse Merkle root": cell(smt) });
        }
        console.log("\nRevocation gas");
        console.table(rows);
    });

    it("proofs: size, build time, verify time and on-chain verify gas", async function () {
        const inclusion = [];
        for (const n of [1, 10, 50, 100, 1000]) {
            const hashes = hashesOf(n), index = n - 1;
            const root = timed(() => merkleRoot(hashes), 5);
            const proof = timed(() => merkleProof(hashes, index), 5);
            const check = timed(() => verifyMerkleProof(root.result, index, hashes[index], proof.result));
            expect(check.result).to.equal(true);
            inclusion.push({ "batch size": n, "proof hashes": proof.result.length, "proof bytes": proof.result.length * 32,
                "build root ms": root.ms, "build proof ms": proof.ms, "verify ms (JS)": check.ms });
        }
        console.log("\nMerkle inclusion proof (off-chain)");
        console.table(inclusion);

        // 1000 tokens in batches of 50, then k of them revoked, spread evenly (the densest case for sibling count).
        const [issuer] = await ethers.getSigners();
        const cert = await ethers.deployContract("CICTCertificate", [issuer.address]);
        const batch = hashesOf(50), batchRoot = merkleRoot(batch);
        for (let i = 0; i < 20; i++) await cert.issueBatch(1n, batchRoot, Array(50).fill(issuer.address), batch);

        const revocation = [];
        for (const k of [0, 1, 10, 100, 1000]) {
            const revoked = Array.from({ length: k }, (_, i) => BigInt(Math.floor(i * 1000 / k) + 1));
            const root = timed(() => smtRoot(revoked), 5);
            if (k) await cert.revokeBatch(root.result, revoked);
            const tokenId = 500n; // token 500 is position 49 of batch 10
            const proof = timed(() => smtProof(revoked, tokenId), 5);
            const check = timed(() => verifySmtProof(root.result, tokenId, proof.result));
            const args = [tokenId, batch[49], merkleProof(batch, 49), proof.result.bitmap, proof.result.siblings] as const;
            const onchain = await cert.verify(...args);
            expect(check.result).to.equal(revoked.includes(tokenId) ? "Revoked" : "Valid");
            expect(onchain.status).to.equal(revoked.includes(tokenId) ? 2n : 1n);
            const size = smtProofBytes(proof.result);
            revocation.push({ "revoked of 1000": k, "siblings sent": proof.result.siblings.length, "compressed bytes": size.compressed,
                "uncompressed bytes": size.uncompressed, "build root ms": root.ms, "build proof ms": proof.ms, "verify ms (JS)": check.ms,
                "on-chain verify gas (free view call)": await cert.verify.estimateGas(...args) });
        }
        console.log("\nSparse Merkle revocation proof (depth 64) + full on-chain verify()");
        console.table(revocation);
    });
});

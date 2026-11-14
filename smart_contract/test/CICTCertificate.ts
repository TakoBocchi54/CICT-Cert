import { expect } from "chai";
import { network } from "hardhat";
// The backend's own tree helpers, so the contract and the server are checked against each other.
// @ts-ignore untyped JavaScript module from the backend project
import { merkleProof, merkleRoot, smtProof, smtRoot } from "../../backend/src/utils/merkle.js";

const { ethers } = await network.create();

const hashesOf = (count: number, label = "certificate") => Array.from({ length: count }, (_, i) => ethers.id(`${label}-${i}`));
const SEMINAR = 7n;

async function deploy() {
    const [issuer, student, other] = await ethers.getSigners();
    const cert = await ethers.deployContract("CICTCertificate", [issuer.address]);
    return { cert, issuer, student, other };
}

// Issues one batch to `student` and returns its hashes.
async function issue(cert: Awaited<ReturnType<typeof deploy>>["cert"], to: string, count: number, label?: string) {
    const hashes = hashesOf(count, label);
    await cert.issueBatch(SEMINAR, merkleRoot(hashes), Array(count).fill(to), hashes);
    return hashes;
}

function proofs(hashes: string[], index: number, revoked: bigint[], tokenId: bigint) {
    const { bitmap, siblings } = smtProof(revoked, tokenId);
    return [merkleProof(hashes, index), bitmap, siblings] as const;
}

describe("CICTCertificate", function () {
    it("issues batches only through the issuer and rejects invalid requests", async function () {
        const { cert, issuer, student } = await deploy();
        const hashes = hashesOf(3);
        const root = merkleRoot(hashes);
        const to = Array(3).fill(student.address);

        await expect(cert.connect(student).issueBatch(SEMINAR, root, to, hashes)).to.be.revertedWithCustomError(cert, "UnauthorizedIssuer");
        await expect(cert.issueBatch(SEMINAR, root, [], [])).to.be.revertedWithCustomError(cert, "InvalidBatch");
        await expect(cert.issueBatch(SEMINAR, root, to, hashes.slice(1))).to.be.revertedWithCustomError(cert, "InvalidBatch");
        await expect(cert.issueBatch(SEMINAR, ethers.ZeroHash, to, hashes)).to.be.revertedWithCustomError(cert, "EmptyHash");
        await expect(cert.issueBatch(SEMINAR, root, to, [hashes[0], ethers.ZeroHash, hashes[2]])).to.be.revertedWithCustomError(cert, "EmptyHash");
        await expect(cert.issueBatch(SEMINAR, root, [student.address, ethers.ZeroAddress, student.address], hashes))
            .to.be.revertedWithCustomError(cert, "ERC721InvalidReceiver");

        await expect(cert.issueBatch(SEMINAR, root, to, hashes))
            .to.emit(cert, "BatchIssued").withArgs(1n, SEMINAR, root, 1n, hashes)
            .and.to.emit(cert, "Issued").withArgs(issuer.address, student.address, 3n, 3n);

        expect(await cert.ownerOf(1n)).to.equal(student.address);
        expect(await cert.balanceOf(student.address)).to.equal(3n);
        expect(await cert.burnAuth(3n)).to.equal(3n);
        expect((await cert.recordOf(2n)).batchId).to.equal(1n);

        const batch = await cert.batchOf(1n);
        expect([batch.root, batch.seminarId, batch.firstTokenId, batch.count]).to.deep.equal([root, SEMINAR, 1n, 3n]);
        expect(batch.issuedAt).to.be.greaterThan(0n);

        await expect(cert.recordOf(4n)).to.be.revertedWithCustomError(cert, "UnknownToken").withArgs(4n);
        await expect(cert.batchOf(2n)).to.be.revertedWithCustomError(cert, "UnknownBatch").withArgs(2n);

        // A second batch continues the token numbering under its own root.
        const later = hashesOf(1, "replacement");
        await cert.issueBatch(SEMINAR, merkleRoot(later), [student.address], later);
        expect((await cert.recordOf(4n)).batchId).to.equal(2n);
        expect((await cert.batchOf(2n)).firstTokenId).to.equal(4n);
    });

    it("verifies inclusion against the token's batch root", async function () {
        const { cert, student } = await deploy();
        const first = await issue(cert, student.address, 5);
        const second = await issue(cert, student.address, 1, "second");

        const unknown = await cert.verify(99n, first[0], [], 0n, []);
        expect(unknown.status).to.equal(0n);
        expect(unknown.batchId).to.equal(0n);

        // Every position, including the unpaired last leaf of an odd batch.
        for (let i = 0; i < first.length; i++) {
            const result = await cert.verify(BigInt(i + 1), first[i], ...proofs(first, i, [], BigInt(i + 1)));
            expect(result.status).to.equal(1n);
            expect(result.recipient).to.equal(student.address);
            expect(result.batchId).to.equal(1n);
            expect(result.seminarId).to.equal(SEMINAR);
            expect(result.issuedAt).to.be.greaterThan(0n);
        }
        expect((await cert.verify(6n, second[0], ...proofs(second, 0, [], 6n))).batchId).to.equal(2n);

        // Wrong hash, another token's hash with its own proof, and a proof from another batch.
        await expect(cert.verify(1n, ethers.id("forged"), ...proofs(first, 0, [], 1n))).to.be.revertedWithCustomError(cert, "InvalidInclusionProof");
        await expect(cert.verify(1n, first[1], ...proofs(first, 1, [], 1n))).to.be.revertedWithCustomError(cert, "InvalidInclusionProof");
        await expect(cert.verify(6n, first[0], ...proofs(first, 0, [], 6n))).to.be.revertedWithCustomError(cert, "InvalidInclusionProof");
    });

    it("revokes through the sparse Merkle root without burning", async function () {
        const { cert, student } = await deploy();
        const hashes = await issue(cert, student.address, 6);
        const empty = await cert.revocationRoot();
        expect(empty).to.equal(smtRoot([]));

        const revoked = [2n, 5n];
        const root = smtRoot(revoked);
        await expect(cert.connect(student).revokeBatch(root, revoked)).to.be.revertedWithCustomError(cert, "UnauthorizedIssuer");
        await expect(cert.revokeBatch(root, [])).to.be.revertedWithCustomError(cert, "InvalidBatch");
        await expect(cert.revokeBatch(root, revoked)).to.emit(cert, "RevocationRootUpdated").withArgs(empty, root, revoked);
        expect(await cert.revocationRoot()).to.equal(root);

        for (let i = 0; i < hashes.length; i++) {
            const tokenId = BigInt(i + 1);
            const result = await cert.verify(tokenId, hashes[i], ...proofs(hashes, i, revoked, tokenId));
            expect(result.status).to.equal(revoked.includes(tokenId) ? 2n : 1n);
            expect(result.recipient).to.equal(student.address);
        }
        expect(await cert.ownerOf(2n)).to.equal(student.address);
        expect(await cert.balanceOf(student.address)).to.equal(6n);

        // A proof built for the previous root, a missing sibling and an extra sibling all fail closed.
        await expect(cert.verify(1n, hashes[0], ...proofs(hashes, 0, [], 1n))).to.be.revertedWithCustomError(cert, "InvalidRevocationProof");
        const [inclusion, bitmap, siblings] = proofs(hashes, 0, revoked, 1n);
        await expect(cert.verify(1n, hashes[0], inclusion, bitmap, siblings.slice(1))).to.be.revertedWithCustomError(cert, "InvalidRevocationProof");
        await expect(cert.verify(1n, hashes[0], inclusion, bitmap, [...siblings, ethers.ZeroHash])).to.be.revertedWithCustomError(cert, "InvalidRevocationProof");

        // A later batch of revocations builds on the earlier one.
        const more = [...revoked, 1n];
        await cert.revokeBatch(smtRoot(more), [1n]);
        expect((await cert.verify(1n, hashes[0], ...proofs(hashes, 0, more, 1n))).status).to.equal(2n);
        expect((await cert.verify(3n, hashes[2], ...proofs(hashes, 2, more, 3n))).status).to.equal(1n);
    });

    it("blocks transfers and approvals", async function () {
        const { cert, issuer, student } = await deploy();
        await issue(cert, student.address, 1);

        const studentCert = cert.connect(student);

        await expect(studentCert.transferFrom(student.address, issuer.address, 1n)).to.be.revertedWithCustomError(cert, "Soulbound");
        await expect(studentCert["safeTransferFrom(address,address,uint256,bytes)"](student.address, issuer.address, 1n, "0x")).to.be.revertedWithCustomError(cert, "Soulbound");
        await expect(studentCert.approve(issuer.address, 1n)).to.be.revertedWithCustomError(cert, "Soulbound");
        await expect(studentCert.setApprovalForAll(issuer.address, true)).to.be.revertedWithCustomError(cert, "Soulbound");

        expect(await cert.ownerOf(1n)).to.equal(student.address);
    });

    it("advertises its interfaces and rejects unknown tokens", async function () {
        const { cert } = await deploy();

        expect(await cert.supportsInterface("0x01ffc9a7")).to.equal(true);
        expect(await cert.supportsInterface("0x80ac58cd")).to.equal(true);
        expect(await cert.supportsInterface("0x0489b56f")).to.equal(true);
        expect(await cert.supportsInterface("0xffffffff")).to.equal(false);

        await expect(cert.burnAuth(99n)).to.be.revertedWithCustomError(cert, "UnknownToken").withArgs(99n);
        await expect(ethers.deployContract("CICTCertificate", [ethers.ZeroAddress])).to.be.revertedWithCustomError(cert, "ZeroAddress");
    });
});

import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

describe("CICTCertificate", function () {
    it("issues only through the issuer and rejects invalid requests", async function () {
        const [issuer, student] = await ethers.getSigners();
        const cert = await ethers.deployContract("CICTCertificate", [
            issuer.address,
        ]);
        const hash = ethers.id("certificate-1");

        await expect(cert.connect(student).issue(student.address, hash)).to.be.revertedWithCustomError(cert, "UnauthorizedIssuer");
        await expect(cert.issue(ethers.ZeroAddress, hash)).to.be.revertedWithCustomError(cert, "ZeroAddress");
        await expect(cert.issue(student.address, ethers.ZeroHash)).to.be.revertedWithCustomError(cert, "EmptyHash");
        await expect(cert.issue(student.address, hash)).to.emit(cert, "Issued").withArgs(issuer.address, student.address, 1n, 0n);

        expect(await cert.ownerOf(1n)).to.equal(student.address);
        expect(await cert.burnAuth(1n)).to.equal(0n);

        await expect(cert.issue(student.address, hash)).to.be.revertedWithCustomError(cert, "AlreadyIssued");
        await expect(cert.connect(student).transferFrom(student.address, issuer.address,1n),).to.be.revertedWithCustomError(cert, "Soulbound");
    });

    it("allows only the issuer to revoke and prevents reissuance", async function () {
        const [issuer, student] = await ethers.getSigners();
        const cert = await ethers.deployContract("CICTCertificate", [issuer.address,]);
        const hash = ethers.id("certificate-1");

        await cert.issue(student.address, hash);
        await expect(cert.connect(student).revoke(1n)).to.be.revertedWithCustomError(cert, "UnauthorizedIssuer");
        await expect(cert.revoke(99n)).to.be.revertedWithCustomError(cert, "UnknownToken").withArgs(99n);
        await expect(cert.revoke(1n)).to.emit(cert, "Revoked");
        await expect(cert.ownerOf(1n)).to.be.revertedWithCustomError(cert, "ERC721NonexistentToken");

        expect(await cert.balanceOf(student.address)).to.equal(0n);
        expect(await cert.burnAuth(1n)).to.equal(0n);

        await expect(cert.revoke(1n)).to.be.revertedWithCustomError(cert, "AlreadyRevoked").withArgs(1n);
        await expect(cert.issue(student.address, hash)).to.be.revertedWithCustomError(cert, "AlreadyIssued").withArgs(hash);
    });

    it("distinguishes unknown, valid and revoked certificates", async function () {
        const [issuer, student] = await ethers.getSigners();
        const cert = await ethers.deployContract("CICTCertificate", [issuer.address,]);
        const hash = ethers.id("certificate-1");
        const unknown = await cert.verify(hash);

        expect(unknown.status).to.equal(0n);
        expect(unknown.tokenId).to.equal(0n);

        await expect(cert.recordOf(99n)).to.be.revertedWithCustomError(cert, "UnknownToken").withArgs(99n);
        await cert.issue(student.address, hash);

        const valid = await cert.connect(student).verify(hash);
        expect(valid.status).to.equal(1n);
        expect(valid.tokenId).to.equal(1n);
        expect(valid.recipient).to.equal(student.address);
        expect(valid.issuedAt).to.be.greaterThan(0n);
        expect(valid.revokedAt).to.equal(0n);

        await cert.revoke(1n);

        const revoked = await cert.connect(student).verify(hash);
        expect(revoked.status).to.equal(2n);
        expect(revoked.tokenId).to.equal(1n);
        expect(revoked.recipient).to.equal(student.address);
        expect(revoked.issuedAt).to.equal(valid.issuedAt);
        expect(revoked.revokedAt).to.be.greaterThan(0n);

        const record = await cert.recordOf(1n);
        expect(record.certHash).to.equal(hash);
        expect(record.recipient).to.equal(student.address);
        expect(record.issuedAt).to.equal(valid.issuedAt);
        expect(record.revokedAt).to.equal(revoked.revokedAt);
    });

    it("blocks safe transfers and approvals", async function () {
        const [issuer, student] = await ethers.getSigners();
        const cert = await ethers.deployContract("CICTCertificate", [issuer.address,]);

        await cert.issue(student.address, ethers.id("certificate-1"));

        const studentCert = cert.connect(student);

        await expect(studentCert["safeTransferFrom(address,address,uint256,bytes)"](student.address, issuer.address, 1n, "0x"),).to.be.revertedWithCustomError(cert, "Soulbound");
        await expect(studentCert.approve(issuer.address, 1n)).to.be.revertedWithCustomError(cert, "Soulbound");
        await expect(studentCert.setApprovalForAll(issuer.address, true)).to.be.revertedWithCustomError(cert, "Soulbound");
        
        expect(await cert.ownerOf(1n)).to.equal(student.address);
    });

    it("advertises its interfaces and rejects unknown burn policies", async function() {
        const [issuer] = await ethers.getSigners();
        const cert = await ethers.deployContract("CICTCertificate", [issuer.address,]);

        expect(await cert.supportsInterface("0x01ffc9a7")).to.equal(true);
        expect(await cert.supportsInterface("0x80ac58cd")).to.equal(true);
        expect(await cert.supportsInterface("0x0489b56f")).to.equal(true);
        expect(await cert.supportsInterface("0xffffffff")).to.equal(false);

        await expect(cert.burnAuth(99n)).to.be.revertedWithCustomError(cert, "UnknownToken").withArgs(99n);
    });
});
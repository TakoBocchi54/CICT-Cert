import assert from "node:assert/strict";
import { network } from "hardhat";

const { ethers } = await network.create();

const chain = await ethers.provider.getNetwork();
assert.equal(chain.chainId, 80002n, "Deployment requires Polygon Amoy");

const [issuer] = await ethers.getSigners();
assert.ok(issuer, "No issuer wallet configured");

const balance = await ethers.provider.getBalance(issuer.address);
assert.ok(balance > 0n, "Issuer wallet needs test POL");

console.log("Issuer:", issuer.address);
console.log("Balance:", ethers.formatEther(balance), "POL");

const certificate = await ethers.deployContract("CICTCertificate", [issuer.address,]);

console.log("Deployment transaction:", certificate.deploymentTransaction()?.hash);

await certificate.waitForDeployment();;

console.log("Contract address:", await certificate.getAddress());
assert.equal(await certificate.issuer(), issuer.address);
import test from "node:test";
import assert from "node:assert/strict";
import { keccak256, toBytes } from "viem";
import { merkleLeaf, merkleProof, merkleRoot, smtProof, smtProofBytes, smtRoot, verifyMerkleProof, verifySmtProof } from "./merkle.js";

// Agreement with the Solidity side is checked in smart_contract/test/CICTCertificate.ts, which runs these helpers against the contract.
const hashes = count => Array.from({ length: count }, (_, i) => keccak256(toBytes(`certificate-${i}`)));

test("every position of a batch has an inclusion proof, for even, odd and single-leaf batches", () => {
  for (const count of [1, 2, 3, 5, 8, 50]) {
    const batch = hashes(count), root = merkleRoot(batch);
    for (let index = 0; index < count; index++) {
      const proof = merkleProof(batch, index);
      assert.ok(proof.length <= Math.ceil(Math.log2(count)), `${count}/${index}`);
      assert.equal(verifyMerkleProof(root, index, batch[index], proof), true, `${count}/${index}`);
    }
  }
  assert.equal(merkleRoot(hashes(1)), merkleLeaf(0, hashes(1)[0]));
});

test("an inclusion proof is bound to the hash, its position and its batch", () => {
  const batch = hashes(5), root = merkleRoot(batch), proof = merkleProof(batch, 2);
  assert.equal(verifyMerkleProof(root, 2, batch[3], proof), false);
  assert.equal(verifyMerkleProof(root, 3, batch[2], proof), false);
  assert.equal(verifyMerkleProof(merkleRoot(hashes(6)), 2, batch[2], proof), false);
  assert.equal(verifyMerkleProof(root, 2, batch[2], proof.slice(1)), false);
  // The same hashes in another order are a different batch.
  assert.notEqual(merkleRoot([...batch].reverse()), root);
});

test("one sparse proof shows a token is revoked or not, against the same root", () => {
  const revoked = [2n, 5n, 300n, 2n ** 40n];
  const root = smtRoot(revoked);
  assert.equal(smtRoot(["5", 2, 300n, 2n ** 40n, 5n]), root, "order, duplicates and number type do not matter");
  for (const id of [1n, 2n, 3n, 5n, 299n, 300n, 2n ** 40n, 2n ** 40n + 1n, 2n ** 63n - 1n]) {
    assert.equal(verifySmtProof(root, id, smtProof(revoked, id)), revoked.includes(id) ? "Revoked" : "Valid", String(id));
  }
});

test("a sparse proof fails closed against another root, another token or altered siblings", () => {
  const revoked = [2n, 5n], root = smtRoot(revoked), proof = smtProof(revoked, 3n);
  assert.equal(verifySmtProof(smtRoot([2n]), 3n, proof), null, "a proof built for an older root");
  assert.equal(verifySmtProof(root, 4n, proof), null);
  assert.equal(verifySmtProof(root, 3n, { ...proof, siblings: proof.siblings.slice(1) }), null);
  assert.equal(verifySmtProof(root, 3n, { ...proof, siblings: [...proof.siblings, proof.siblings[0]] }), null);
  assert.equal(verifySmtProof(root, 3n, { ...proof, bitmap: 0n, siblings: [] }), null);
});

test("an empty tree needs no siblings, and compression only sends the non-empty ones", () => {
  const empty = smtProof([], 7n);
  assert.deepEqual(empty, { bitmap: 0n, siblings: [] });
  assert.equal(verifySmtProof(smtRoot([]), 7n, empty), "Valid");
  const proof = smtProof(Array.from({ length: 100 }, (_, i) => BigInt(i * 10 + 1)), 500n);
  assert.deepEqual(smtProofBytes(proof), { compressed: 8 + proof.siblings.length * 32, uncompressed: 2048 });
  assert.ok(proof.siblings.length <= 10);
});

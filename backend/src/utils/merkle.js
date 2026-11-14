import { concat, encodeAbiParameters, keccak256, pad } from "viem";

// Must stay in step with CICTCertificate.sol: smart_contract/test/CICTCertificate.ts runs these helpers against the contract.
// shortcut: trees are rebuilt from the database on every use; persist nodes if revoked certificates reach tens of thousands.

// ---- Batch tree (inclusion). Leaf binds a certificate hash to its position in the batch. ----

export const merkleLeaf = (index, certHash) =>
  keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [BigInt(index), certHash]));

// Sorted pairs, as OpenZeppelin's MerkleProof expects. Lowercase hex of equal length sorts numerically.
const pair = (a, b) => keccak256(concat(a < b ? [a, b] : [b, a]));

function levels(certHashes) {
  let level = certHashes.map((hash, index) => merkleLeaf(index, hash));
  const all = [level];
  while (level.length > 1) {
    const next = [];
    // An unpaired last node moves up unchanged.
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? pair(level[i], level[i + 1]) : level[i]);
    all.push(level = next);
  }
  return all;
}

export const merkleRoot = certHashes => levels(certHashes).at(-1)[0];

export function merkleProof(certHashes, index) {
  const proof = [];
  for (const level of levels(certHashes).slice(0, -1)) {
    if ((index ^ 1) < level.length) proof.push(level[index ^ 1]);
    index >>= 1;
  }
  return proof;
}

export const verifyMerkleProof = (root, index, certHash, proof) => proof.reduce(pair, merkleLeaf(index, certHash)) === root;

// ---- Revocation tree (sparse, depth 64, keyed by token ID). Leaf is 0 (valid) or 1 (revoked). ----

export const SMT_DEPTH = 64;
const node = (left, right) => keccak256(concat([left, right]));
const VALID = pad("0x00", { size: 32 }), REVOKED = pad("0x01", { size: 32 });
const EMPTY = [VALID];
for (let i = 0; i < SMT_DEPTH; i++) EMPTY.push(node(EMPTY[i], EMPTY[i]));

// Root of the subtree of the given height that holds exactly these revoked keys.
function subtree(keys, height) {
  if (!keys.length) return EMPTY[height];
  if (height === 0) return REVOKED;
  const bit = 1n << BigInt(height - 1);
  return node(subtree(keys.filter(key => !(key & bit)), height - 1), subtree(keys.filter(key => key & bit), height - 1));
}

const keysOf = tokenIds => [...new Set(tokenIds.map(BigInt))];

export const smtRoot = revokedTokenIds => subtree(keysOf(revokedTokenIds), SMT_DEPTH);

// Compressed proof: bit i of bitmap is set when level i (0 = next to the leaf) has a non-empty sibling;
// siblings lists only those, from the leaf upward. The same proof shows membership or non-membership.
export function smtProof(revokedTokenIds, tokenId) {
  const id = BigInt(tokenId), siblings = [];
  let keys = keysOf(revokedTokenIds), bitmap = 0n;
  for (let level = SMT_DEPTH - 1; level >= 0; level--) {
    const bit = 1n << BigInt(level), side = id & bit;
    const sibling = subtree(keys.filter(key => (key & bit) !== side), level);
    keys = keys.filter(key => (key & bit) === side);
    if (sibling !== EMPTY[level]) { bitmap |= bit; siblings.unshift(sibling); }
  }
  return { bitmap, siblings };
}

// Returns "Valid", "Revoked" or null when the proof does not fit the root.
export function verifySmtProof(root, tokenId, { bitmap, siblings }) {
  const id = BigInt(tokenId);
  let valid = VALID, revoked = REVOKED, used = 0;
  for (let level = 0; level < SMT_DEPTH; level++) {
    const bit = 1n << BigInt(level);
    const sibling = bitmap & bit ? siblings[used++] : EMPTY[level];
    if (sibling === undefined) return null;
    [valid, revoked] = id & bit ? [node(sibling, valid), node(sibling, revoked)] : [node(valid, sibling), node(revoked, sibling)];
  }
  return used !== siblings.length ? null : valid === root ? "Valid" : revoked === root ? "Revoked" : null;
}

// The same proof with every level's sibling spelled out (64 x 32 bytes); only used to report the size saved.
export const smtProofBytes = ({ siblings }) => ({ compressed: 8 + siblings.length * 32, uncompressed: SMT_DEPTH * 32 });

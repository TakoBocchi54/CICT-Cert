// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IERC5484} from "./IERC5484.sol";

// Certificates are issued in batches: one transaction stores a Merkle root over the batch's certificate
// hashes and mints one soulbound token per certificate. Revocation is a single Sparse Merkle Tree root
// keyed by token ID; tokens are never burned.
contract CICTCertificate is ERC721, IERC5484 {
    address public immutable issuer;

    uint256 private constant SMT_DEPTH = 64;

    enum Status {
        NotFound, // 0
        Valid,    // 1
        Revoked   // 2
    }

    struct Batch {
        bytes32 root;
        uint64 seminarId;
        uint64 issuedAt;
        uint64 firstTokenId;
        uint32 count;
    }

    struct Record {
        uint64 batchId;
    }

    uint64 public lastBatchId;
    uint64 private _lastTokenId;
    bytes32 public revocationRoot;

    mapping(uint256 batchId => Batch) private _batches;
    mapping(uint256 tokenId => Record) private _records;

    error ZeroAddress();
    error UnauthorizedIssuer();
    error Soulbound();
    error UnknownToken(uint256 tokenId);
    error UnknownBatch(uint256 batchId);
    error EmptyHash();
    error InvalidBatch();
    error InvalidInclusionProof();
    error InvalidRevocationProof();

    // certHashes are logged in token order so every batch tree can be rebuilt from the chain alone.
    event BatchIssued(
        uint64 indexed batchId,
        uint64 indexed seminarId,
        bytes32 root,
        uint64 firstTokenId,
        bytes32[] certHashes
    );

    // tokenIds are the slots newly marked revoked, so the revocation tree can be rebuilt from the chain alone.
    event RevocationRootUpdated(
        bytes32 indexed previousRoot,
        bytes32 indexed newRoot,
        uint256[] tokenIds
    );

    modifier onlyIssuer() {
        if (msg.sender != issuer) revert UnauthorizedIssuer();
        _;
    }

    constructor(address initialIssuer) ERC721("CICT Seminar Certificate", "CICTCERT") {
        if (initialIssuer == address(0)) revert ZeroAddress();

        issuer = initialIssuer;

        bytes32 empty;
        for (uint256 i; i < SMT_DEPTH; ++i) empty = _node(empty, empty);
        revocationRoot = empty;
    }

    // The root is trusted from the issuer, not recomputed: a wrong root only makes that batch unverifiable.
    function issueBatch(
        uint64 seminarId,
        bytes32 root,
        address[] calldata recipients,
        bytes32[] calldata certHashes
    ) external onlyIssuer returns (uint64 batchId) {
        uint256 count = recipients.length;
        if (count == 0 || count != certHashes.length || count > type(uint32).max) revert InvalidBatch();
        if (root == bytes32(0)) revert EmptyHash();

        batchId = ++lastBatchId;
        uint64 firstTokenId = _lastTokenId + 1;
        _lastTokenId += uint64(count);

        _batches[batchId] = Batch({
            root: root,
            seminarId: seminarId,
            issuedAt: uint64(block.timestamp),
            firstTokenId: firstTokenId,
            count: uint32(count)
        });

        for (uint256 i; i < count; ++i) {
            if (certHashes[i] == bytes32(0)) revert EmptyHash();

            uint256 tokenId = firstTokenId + i;
            _records[tokenId].batchId = batchId;
            // _mint, not _safeMint: one recipient contract must not be able to revert the whole batch.
            _mint(recipients[i], tokenId);

            emit Issued(issuer, recipients[i], tokenId, BurnAuth.Neither);
        }

        emit BatchIssued(batchId, seminarId, root, firstTokenId, certHashes);
    }

    function revokeBatch(bytes32 newRoot, uint256[] calldata tokenIds) external onlyIssuer {
        if (tokenIds.length == 0) revert InvalidBatch();

        emit RevocationRootUpdated(revocationRoot, newRoot, tokenIds);
        revocationRoot = newRoot;
    }

    // Inclusion proof against the token's batch root, revocation proof against the current revocation root,
    // and the token's current owner. Reverts when a proof does not fit, so a status is never guessed.
    function verify(
        uint256 tokenId,
        bytes32 certHash,
        bytes32[] calldata merkleProof,
        uint64 smtBitmap,
        bytes32[] calldata smtSiblings
    ) external view returns (Status status, address recipient, uint64 batchId, uint64 seminarId, uint64 issuedAt) {
        batchId = _records[tokenId].batchId;
        if (batchId == 0) return (Status.NotFound, address(0), 0, 0, 0);

        Batch storage batch = _batches[batchId];
        bytes32 leaf = keccak256(abi.encode(tokenId - batch.firstTokenId, certHash));
        if (!MerkleProof.verifyCalldata(merkleProof, batch.root, leaf)) revert InvalidInclusionProof();

        status = _revocationStatus(tokenId, smtBitmap, smtSiblings);
        return (status, ownerOf(tokenId), batchId, batch.seminarId, batch.issuedAt);
    }

    function recordOf(uint256 tokenId) external view returns (Record memory) {
        if (_records[tokenId].batchId == 0) revert UnknownToken(tokenId);

        return _records[tokenId];
    }

    function batchOf(uint256 batchId) external view returns (Batch memory) {
        if (_batches[batchId].count == 0) revert UnknownBatch(batchId);

        return _batches[batchId];
    }

    function burnAuth(uint256 tokenId) external view override returns (BurnAuth) {
        if (_records[tokenId].batchId == 0) revert UnknownToken(tokenId);

        return BurnAuth.Neither;
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IERC5484).interfaceId || super.supportsInterface(interfaceId);
    }

    // Compressed proof: bit i of smtBitmap says level i has a non-empty sibling, taken in order from
    // smtSiblings; every other level uses that level's empty-subtree hash. Leaf is 0 (valid) or 1 (revoked).
    function _revocationStatus(uint256 tokenId, uint64 smtBitmap, bytes32[] calldata smtSiblings) private view returns (Status) {
        if (tokenId >> SMT_DEPTH != 0) revert InvalidRevocationProof();

        bytes32 valid;
        bytes32 revoked = bytes32(uint256(1));
        bytes32 empty;
        uint256 used;

        for (uint256 i; i < SMT_DEPTH; ++i) {
            bytes32 sibling = empty;
            if ((smtBitmap >> i) & 1 == 1) {
                if (used == smtSiblings.length) revert InvalidRevocationProof();
                sibling = smtSiblings[used++];
            }

            if ((tokenId >> i) & 1 == 1) {
                valid = _node(sibling, valid);
                revoked = _node(sibling, revoked);
            } else {
                valid = _node(valid, sibling);
                revoked = _node(revoked, sibling);
            }

            empty = _node(empty, empty);
        }

        if (used != smtSiblings.length) revert InvalidRevocationProof();
        if (valid == revocationRoot) return Status.Valid;
        if (revoked == revocationRoot) return Status.Revoked;
        revert InvalidRevocationProof();
    }

    function _node(bytes32 left, bytes32 right) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(left, right));
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);

        if (from != address(0) && to != address(0)) revert Soulbound();

        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }
}

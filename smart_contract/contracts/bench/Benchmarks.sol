// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

// Benchmark only (test/GasBenchmark.ts). Never deployed: these are the alternatives CICTCertificate is measured against.

// Four ways to record that k tokens are revoked.
contract RevocationBench is ERC721 {
    uint256 public lastTokenId;
    bytes32 public revocationRoot;
    mapping(uint256 tokenId => bool) public revokedFlag;
    mapping(uint256 word => uint256) public revokedBits;

    event RevokedBatch(uint256[] tokenIds);

    constructor() ERC721("Bench", "BENCH") {}

    function mint(address to, uint256 count) external {
        for (uint256 i; i < count; ++i) _mint(to, ++lastTokenId);
    }

    // What the previous contract did, minus its one-transaction-per-token overhead.
    function revokeByBurn(uint256[] calldata tokenIds) external {
        for (uint256 i; i < tokenIds.length; ++i) _burn(tokenIds[i]);
    }

    function revokeByMapping(uint256[] calldata tokenIds) external {
        for (uint256 i; i < tokenIds.length; ++i) revokedFlag[tokenIds[i]] = true;
        emit RevokedBatch(tokenIds);
    }

    // One storage word holds 256 token flags.
    function revokeByBitmap(uint256[] calldata tokenIds) external {
        for (uint256 i; i < tokenIds.length; ++i) revokedBits[tokenIds[i] >> 8] |= 1 << (tokenIds[i] & 0xff);
        emit RevokedBatch(tokenIds);
    }

    // Same writes as CICTCertificate.revokeBatch.
    function revokeBySmt(bytes32 newRoot, uint256[] calldata tokenIds) external {
        revocationRoot = newRoot;
        emit RevokedBatch(tokenIds);
    }
}

// Batch minting that stores each certificate hash on its token, instead of one Merkle root per batch.
contract HashStorageBench is ERC721 {
    uint256 public lastTokenId;
    mapping(uint256 tokenId => bytes32) public certHashOf;

    event Issued(address indexed from, address indexed to, uint256 indexed tokenId, uint8 burnAuth);

    constructor() ERC721("Bench", "BENCH") {}

    function issueBatch(address[] calldata recipients, bytes32[] calldata certHashes) external {
        for (uint256 i; i < recipients.length; ++i) {
            uint256 tokenId = ++lastTokenId;
            certHashOf[tokenId] = certHashes[i];
            _mint(recipients[i], tokenId);
            emit Issued(msg.sender, recipients[i], tokenId, 3);
        }
    }
}

// CICTCertificate.issueBatch without the per-token batchId slot: a token's batch would be found from the
// batch's token range instead. Shows what that one slot per token costs.
contract RangeBatchBench is ERC721 {
    struct Batch {
        bytes32 root;
        uint64 firstTokenId;
        uint32 count;
    }

    uint64 public lastBatchId;
    uint64 private _lastTokenId;
    mapping(uint256 batchId => Batch) public batches;

    event Issued(address indexed from, address indexed to, uint256 indexed tokenId, uint8 burnAuth);
    event BatchIssued(uint64 indexed batchId, bytes32 root, uint64 firstTokenId, bytes32[] certHashes);

    constructor() ERC721("Bench", "BENCH") {}

    function issueBatch(bytes32 root, address[] calldata recipients, bytes32[] calldata certHashes) external {
        uint64 batchId = ++lastBatchId;
        uint64 firstTokenId = _lastTokenId + 1;
        _lastTokenId += uint64(recipients.length);
        batches[batchId] = Batch(root, firstTokenId, uint32(recipients.length));

        for (uint256 i; i < recipients.length; ++i) {
            _mint(recipients[i], firstTokenId + i);
            emit Issued(msg.sender, recipients[i], firstTokenId + i, 3);
        }

        emit BatchIssued(batchId, root, firstTokenId, certHashes);
    }
}

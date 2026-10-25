// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC5484} from "./IERC5484.sol";

contract CICTCertificate is ERC721, IERC5484 {
    address public immutable issuer;

    enum Status {
        NotFound, // 0
        Valid,    // 1  
        Revoked   // 2
    }

    struct Record {
        bytes32 certHash;
        address recipient;
        uint64 issuedAt;
        uint64 revokedAt;
    }

    uint256 private _lastTokenId;

    mapping(uint256 tokenId => Record) private _records;
    mapping(bytes32 certHash => uint256 tokenId) private _tokenIdByHash;

    error ZeroAddress();
    error UnauthorizedIssuer();
    error Soulbound();
    error UnknownToken(uint256 tokenId);
    error EmptyHash();
    error AlreadyIssued(bytes32 certHash);
    error AlreadyRevoked(uint256 tokenId);

    event Revoked (
        uint256 indexed tokenId,
        bytes32 indexed certHash,
        address indexed recipient,
        uint64 revokedAt
    );

    modifier onlyIssuer () {
        if (msg.sender != issuer) revert UnauthorizedIssuer();
        _;
    }

        constructor(address initialIssuer) ERC721("CICT Seminar Certificate", "CICTCERT") {
            if (initialIssuer == address(0)) revert ZeroAddress();

            issuer = initialIssuer;
        }

        function issue(address to, bytes32 certHash) external onlyIssuer returns (uint256 tokenId) {
            if (to == address(0)) revert ZeroAddress();
            if (certHash == bytes32(0)) revert EmptyHash();
            if (_tokenIdByHash[certHash] != 0) revert AlreadyIssued(certHash);

            tokenId = ++_lastTokenId;

            _records[tokenId] = Record ({
                certHash: certHash,
                recipient: to,
                issuedAt: uint64(block.timestamp),
                revokedAt: 0
            });

            _tokenIdByHash[certHash] = tokenId;
            _safeMint(to, tokenId);
            
            emit Issued(issuer, to, tokenId, BurnAuth.IssuerOnly);
        }

        function revoke(uint256 tokenId) external onlyIssuer {
            Record storage record = _records[tokenId];

            if (record.recipient == address(0)) revert UnknownToken(tokenId);
            if (record.revokedAt != 0) revert AlreadyRevoked(tokenId);

            record.revokedAt = uint64(block.timestamp);

            _burn(tokenId);

            emit Revoked (
                tokenId,
                record.certHash,
                record.recipient,
                record.revokedAt
            );
        }

        function verify(bytes32 certHash) external view returns (Status status, uint256 tokenId, address recipient, uint64 issuedAt, uint64 revokedAt) {
            tokenId = _tokenIdByHash[certHash];

            if (tokenId == 0) {
                return(Status.NotFound, 0, address(0), 0, 0);
            }

            Record storage record = _records[tokenId];

            status = record.revokedAt == 0 ? Status.Valid : Status.Revoked;

            return (
                status,
                tokenId,
                record.recipient,
                record.issuedAt,
                record.revokedAt
            );
        }

        function recordOf(uint256 tokenId)  external view returns (Record memory) {
            if (_records[tokenId].recipient == address(0)) {
                revert UnknownToken(tokenId);
            }

            return _records[tokenId];
        }

        function burnAuth(uint256 tokenId) external view override returns (BurnAuth) {
            if (_records[tokenId].recipient == address(0)) {
                revert UnknownToken(tokenId);
            }

            return BurnAuth.IssuerOnly;
        }

        function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
            return interfaceId == type(IERC5484).interfaceId || super.supportsInterface(interfaceId);
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
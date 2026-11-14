// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ProjectEscrow} from "../src/ProjectEscrow.sol";

/// @dev An independent builder for the V2 Merkle-sum tree, written from the documented rules: a leaf is
/// keccak256(0x00, actorId, gross, sourceDigest) with total gross; a node is
/// keccak256(0x01, leftHash, leftTotal, rightHash, rightTotal); an odd last node moves up unchanged.
library MonthlyTree {
    function leaf(ProjectEscrow.MonthlyAward memory e) internal pure returns (ProjectEscrow.AllocationNode memory) {
        return ProjectEscrow.AllocationNode(
            keccak256(abi.encodePacked(uint8(0), e.actorId, e.gross, e.sourceDigest)), e.gross
        );
    }

    function parent(ProjectEscrow.AllocationNode memory a, ProjectEscrow.AllocationNode memory b)
        internal
        pure
        returns (ProjectEscrow.AllocationNode memory)
    {
        return ProjectEscrow.AllocationNode(
            keccak256(abi.encodePacked(uint8(1), a.hash, a.total, b.hash, b.total)), a.total + b.total
        );
    }

    /// @return root The tree root. @return proof The siblings of `index`, bottom up.
    function build(ProjectEscrow.MonthlyAward[] memory entries, uint256 index)
        internal
        pure
        returns (ProjectEscrow.AllocationNode memory root, ProjectEscrow.AllocationNode[] memory proof)
    {
        uint256 width = entries.length;
        ProjectEscrow.AllocationNode[] memory level = new ProjectEscrow.AllocationNode[](width);
        for (uint256 i; i < width; ++i) {
            level[i] = leaf(entries[i]);
        }
        ProjectEscrow.AllocationNode[] memory path = new ProjectEscrow.AllocationNode[](64);
        uint256 depth;
        while (width > 1) {
            if ((index ^ 1) < width) path[depth++] = level[index ^ 1];
            uint256 next = (width + 1) / 2;
            for (uint256 i; i < next; ++i) {
                level[i] = 2 * i + 1 < width ? parent(level[2 * i], level[2 * i + 1]) : level[2 * i];
            }
            index /= 2;
            width = next;
        }
        root = level[0];
        proof = new ProjectEscrow.AllocationNode[](depth);
        for (uint256 i; i < depth; ++i) {
            proof[i] = path[i];
        }
    }
}

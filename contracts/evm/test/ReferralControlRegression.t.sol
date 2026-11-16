// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ReferralDistributor, IReferralToken} from "../src/ReferralDistributor.sol";
import {ReferralBase} from "./ReferralDistributor.t.sol";

contract ReferralControlRegression is ReferralBase {
    function test_VoidPreservesHighestNonVoidedTotal() public {
        ReferralDistributor current = new ReferralDistributor(IReferralToken(address(token)), OWNER, POSTER, 100, 0);
        token.mint(address(current), 1_000);
        vm.startPrank(POSTER);
        current.postRoot(0, bytes32(uint256(1)), 100);
        current.postRoot(1, bytes32(uint256(2)), 90);
        current.postRoot(2, bytes32(uint256(3)), 95);
        vm.stopPrank();
        require(current.highWaterTotal() == 100, "highest total before void");
        vm.prank(OWNER);
        current.voidRoot(2);
        require(current.highWaterTotal() == 100, "void must keep highest non-voided total");
        vm.prank(POSTER);
        current.postRoot(3, bytes32(uint256(4)), 200);
        require(current.highWaterTotal() == 200, "full permitted growth remains available");
    }

    function test_RepeatedVoidRestoresPriorMaximumAndPostTime() public {
        ReferralDistributor current =
            new ReferralDistributor(IReferralToken(address(token)), OWNER, POSTER, 100, 1 days);
        token.mint(address(current), 1_000);
        uint64 first = uint64(block.timestamp);
        vm.prank(POSTER);
        current.postRoot(0, bytes32(uint256(1)), 100);
        vm.warp(block.timestamp + 1 days);
        vm.prank(POSTER);
        current.postRoot(1, bytes32(uint256(2)), 90);
        uint64 latestLive = uint64(block.timestamp);
        vm.warp(block.timestamp + 1 days);
        vm.prank(POSTER);
        current.postRoot(2, bytes32(uint256(3)), 195);
        vm.prank(OWNER);
        current.voidRoot(2);
        require(current.highWaterTotal() == 100, "void removes only its new high");
        require(current.lastLivePostedAt() == latestLive, "latest live time preserved");
        vm.prank(POSTER);
        current.postRoot(3, bytes32(uint256(4)), 95);
        vm.prank(OWNER);
        current.voidRoot(3);
        require(current.highWaterTotal() == 100, "repeated void keeps older maximum");
        require(
            current.lastLivePostedAt() == latestLive && latestLive > first, "time is latest, not highest-total epoch"
        );
        vm.prank(POSTER);
        current.postRoot(4, bytes32(uint256(5)), 200);
        require(current.highWaterTotal() == 200, "repeated rollback keeps full growth allowance");
    }
}

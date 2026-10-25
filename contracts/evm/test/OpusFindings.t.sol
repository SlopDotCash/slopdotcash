// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {DeployFactory} from "./DeployFactory.sol";

import "./OpusBase.sol";

contract OpusFindingsTest is OpusBase {
    uint64 constant ALICE = 4242;

    function setUp() public {
        deployWithDelay(DELAY);
        fund(10_000e6);
    }

    /// F-1 (fixed, review M-1): a binding placed before the actor has an award no longer pays in the block
    /// the award is committed. The award waits its own bindingDelay, and the owner can cancel the unpaid
    /// binding inside that window.
    function test_F1_preArmedBindingWaitsForCommitDelay() public {
        // Compromised authority pre-binds a future contributor's actor id to the attacker.
        uint64 v = bindAs(ALICE, ATTACKER);
        vm.warp(block.timestamp + DELAY);
        // With no award there is nothing to protect, so the owner has no cancel window yet.
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        escrow.cancelBinding(ALICE, v);
        // Weeks later the owner approves Alice's monthly award.
        vm.warp(block.timestamp + 30 days);
        bytes32 id = commit(keccak256("eliza/2026-11/alice"), ALICE, 1_000e6);
        // Same block, the relayer's pay waits for the commit delay.
        vm.prank(RELAYER);
        vm.expectRevert(ProjectEscrow.AwardPending.selector);
        escrow.pay(id, v);
        vm.warp(block.timestamp + DELAY - 1);
        vm.prank(RELAYER);
        vm.expectRevert(ProjectEscrow.AwardPending.selector);
        escrow.pay(id, v);
        // The owner reviews the binding attached to the money and cancels it inside the window.
        vm.prank(OWNER);
        escrow.cancelBinding(ALICE, v);
        vm.warp(block.timestamp + 1);
        vm.prank(RELAYER);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        escrow.pay(id, v);
        check(usdc.balanceOf(ATTACKER) == 0, "attacker received nothing");
        check(escrow.reservedPrincipal() == 980e6, "award still reserved for alice");
    }

    /// F-2 (fixed, review M-2): the owner's cancel is capped at MAX_CANCELS_BETWEEN_PAYMENTS between two
    /// payments to an actor, so the owner can delay the first payment by at most three more delays.
    function test_F2_ownerCancelIsCappedBeforeFirstPayment() public {
        bytes32 id = commit(keccak256("eliza/2026-11/alice"), ALICE, 1_000e6);
        uint64 v;
        for (uint256 i = 0; i < escrow.MAX_CANCELS_BETWEEN_PAYMENTS(); i++) {
            v = bindAs(ALICE, ALICE_WALLET);
            vm.prank(OWNER);
            escrow.cancelBinding(ALICE, v);
            vm.warp(block.timestamp + DELAY + 1);
            vm.prank(RELAYER);
            vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
            escrow.pay(id, v);
        }
        v = bindAs(ALICE, ALICE_WALLET);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.CancelLimit.selector);
        escrow.cancelBinding(ALICE, v);
        (,,,,, bool paid) = escrow.awards(id);
        check(!paid, "not paid yet");
        vm.warp(block.timestamp + DELAY);
        vm.prank(RELAYER);
        escrow.pay(id, v);
        check(usdc.balanceOf(ALICE_WALLET) == 980e6, "alice paid after the cap");
    }

    /// F-4 (fixed, review L-1): the factory rejects a delay below one hour or above 30 days, so a zero
    /// delay cannot make the cancel unreachable and an oversized delay cannot overflow every binding.
    function test_F4_delayIsBounded() public {
        DeployFactory.create(REGISTRAR, FEE, AUTHORITY, 0);
        DeployFactory.create(REGISTRAR, FEE, AUTHORITY, 1 hours - 1);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        DeployFactory.create(REGISTRAR, FEE, AUTHORITY, 30 days + 1);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        DeployFactory.create(REGISTRAR, FEE, AUTHORITY, type(uint64).max - 1_000);
        deployWithDelay(1 hours);
        check(escrow.bindingDelay() == 1 hours, "floor accepted");
        deployWithDelay(30 days);
        check(escrow.bindingDelay() == 30 days, "ceiling accepted");
    }

    /// F-5 (fixed, review L-5): cancelBinding on an already-cancelled binding reverts, so BindingCancelled
    /// is emitted once per version.
    function test_F5_cancelIsNotRepeatable() public {
        uint64 v = bindAs(ALICE, ALICE_WALLET);
        vm.recordLogs();
        vm.startPrank(OWNER);
        escrow.cancelBinding(ALICE, v);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        escrow.cancelBinding(ALICE, v);
        vm.warp(block.timestamp + 365 days);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        escrow.cancelBinding(ALICE, v);
        vm.stopPrank();
        OpusVmLog[] memory logs = vm.getRecordedLogs();
        check(logs.length == 1, "one BindingCancelled event for one binding");
    }

    /// Info: the 2% withdrawal fee rounds down once per withdrawal, so a withdrawal under 50 base units pays
    /// no fee and a split saves under one base unit per transaction.
    function test_withdrawFeeRoundsUpPerWithdrawal() public {
        vm.startPrank(OWNER);
        uint256 before = usdc.balanceOf(OWNER);
        escrow.withdrawUnused(49);
        check(usdc.balanceOf(OWNER) - before == 48 && escrow.totalWithdrawalFees() == 1, "49 pays a fee of 1");
        escrow.withdrawUnused(50);
        vm.stopPrank();
        check(usdc.balanceOf(OWNER) - before == 48 + 49, "50 refunds 49");
        check(escrow.totalWithdrawalFees() == 2, "fee 1 on gross 50");
    }

    /// Red-team fix: splitting a withdrawal into pieces under 50 base units no longer avoids the fee.
    function test_splitWithdrawalsUnderFiftyStillPayTheFee() public {
        uint256 before = usdc.balanceOf(OWNER);
        vm.startPrank(OWNER);
        for (uint256 i = 0; i < 100; i++) {
            escrow.withdrawUnused(49);
        }
        vm.stopPrank();
        check(escrow.totalGrossWithdrawn() == 4_900, "all pieces withdrawn");
        check(escrow.totalWithdrawalFees() == 100 && escrow.accruedFees() == 100, "each piece pays 1");
        check(usdc.balanceOf(OWNER) - before == 100 * 48, "owner refund is net of every fee");
    }

    /// Red-team fix: an award under 50 base units, including a self-award, pays a fee of 1.
    function test_awardUnderFiftyPaysTheFee() public {
        bytes32 id = commit(keccak256("small"), ALICE, 49);
        (, uint128 gross, uint128 fee,,,) = escrow.awards(id);
        check(gross == 49 && fee == 1, "award fee is ceil(49 / 50)");
        check(escrow.reservedFees() == 1 && escrow.reservedPrincipal() == 48, "reserved net and fee");
        uint64 v = bindAs(ALICE, ALICE_WALLET);
        vm.warp(block.timestamp + DELAY);
        escrow.pay(id, v);
        check(usdc.balanceOf(ALICE_WALLET) == 48, "contributor gets 48");
        check(escrow.totalPayoutFees() == 1 && escrow.accruedFees() == 1, "payout fee 1");
    }

    /// Sound: a cancelled binding never pays, even far in the future, and a verified replacement pays immediately.
    function test_sound_cancelledNeverPaysAndReplacementPaysImmediately() public {
        bytes32 id = commit(keccak256("s"), ALICE, 100e6);
        uint64 v = bindAs(ALICE, ATTACKER);
        vm.prank(OWNER);
        escrow.cancelBinding(ALICE, v);
        vm.warp(block.timestamp + 3650 days);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        escrow.pay(id, v);
        uint64 v2 = bindAs(ALICE, ALICE_WALLET);
        escrow.pay(id, v2);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        escrow.pay(id, v2);
        // Owner cannot pre-cancel a version that does not exist yet.
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        escrow.cancelBinding(ALICE, v2 + 1);
    }

    /// Sound: award IDs are vault-bound; another vault cannot commit this vault's ID.
    function test_sound_awardIdIsVaultBound() public {
        vm.prank(OWNER);
        ProjectEscrow other =
            ProjectEscrow(factory.create(keccak256("project-2"), IERC20(address(usdc)), Purpose.Ordinary));
        bytes32 src = keccak256("same-source");
        bytes32 idHere = escrow.awardId(src);
        check(other.awardId(src) != idHere, "distinct");
        usdc.mint(OWNER, 0);
        vm.prank(OWNER);
        usdc.approve(address(other), type(uint256).max);
        vm.prank(OWNER);
        other.deposit(10e6);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        other.commitAward(idHere, ALICE, 1e6, src);
        vm.prank(OWNER);
        vm.expectRevert(EscrowFactory.DuplicateVault.selector);
        factory.create(keccak256("project"), IERC20(address(usdc)), Purpose.Ordinary);
    }
}

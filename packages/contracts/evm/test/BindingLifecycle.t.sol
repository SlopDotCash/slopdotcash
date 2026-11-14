// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {DeployFactory} from "./DeployFactory.sol";

import "./OpusBase.sol";

/// Immediate verified wallet activation preserves award review, latest-version payment, bounded
/// owner cancellation, and permanent reservations.
contract BindingLifecycleTest is OpusBase {
    uint64 constant ALICE = 4242;

    function setUp() public {
        deployWithDelay(DELAY);
        fund(10_000e6);
    }

    function payAs(bytes32 id, uint64 version) internal {
        vm.prank(RELAYER);
        escrow.pay(id, version);
    }

    function cancelAs(uint64 actor, uint64 version) internal {
        vm.prank(OWNER);
        escrow.cancelBinding(actor, version);
    }

    /// M-1: a binding armed long before any award waits bindingDelay from the commit, and the owner can
    /// cancel it in that window even though its own delay passed weeks ago.
    function test_preArmedBindingWaitsForCommitDelayAndOwnerCanCancel() public {
        uint64 v = bindAs(ALICE, ATTACKER);
        vm.warp(block.timestamp + 30 days);
        bytes32 id = commit(keccak256("award"), ALICE, 1_000e6);
        uint64 committedAt = uint64(block.timestamp);
        (,,,, uint64 stored,) = escrow.awards(id);
        check(stored == committedAt && escrow.lastCommittedAt(ALICE) == committedAt, "commit time recorded");
        vm.prank(RELAYER);
        vm.expectRevert(ProjectEscrow.AwardPending.selector);
        escrow.pay(id, v);
        vm.warp(committedAt + DELAY - 1);
        vm.prank(RELAYER);
        vm.expectRevert(ProjectEscrow.AwardPending.selector);
        escrow.pay(id, v);
        cancelAs(ALICE, v);
        vm.warp(committedAt + DELAY);
        vm.prank(RELAYER);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        escrow.pay(id, v);
        check(usdc.balanceOf(ATTACKER) == 0 && escrow.reservedPrincipal() == 980e6, "nothing left the vault");
    }

    /// M-1: at exactly committedAt + delay the owner's window closes and pay opens; no instant allows both.
    function test_commitWindowClosesWhenPayOpens() public {
        uint64 v = bindAs(ALICE, ALICE_WALLET);
        vm.warp(block.timestamp + DELAY);
        bytes32 id = commit(keccak256("award"), ALICE, 100e6);
        vm.warp(block.timestamp + DELAY);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        escrow.cancelBinding(ALICE, v);
        payAs(id, v);
        check(usdc.balanceOf(ALICE_WALLET) == 98e6, "paid at the boundary");
    }

    /// M-1 and M-2 together: a later award to an actor with a paid binding still waits its commit delay,
    /// but the owner cannot cancel the binding that has already paid.
    function test_laterAwardWaitsButPaidBindingIsNotCancellable() public {
        bytes32 first = commit(keccak256("first"), ALICE, 100e6);
        uint64 v = bindAs(ALICE, ALICE_WALLET);
        vm.warp(block.timestamp + DELAY);
        payAs(first, v);
        bytes32 second = commit(keccak256("second"), ALICE, 100e6);
        vm.prank(RELAYER);
        vm.expectRevert(ProjectEscrow.AwardPending.selector);
        escrow.pay(second, v);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        escrow.cancelBinding(ALICE, v);
        vm.warp(block.timestamp + DELAY);
        payAs(second, v);
        check(usdc.balanceOf(ALICE_WALLET) == 196e6, "both paid to the paid binding");
    }

    /// A verified successor immediately receives eligible awards. Stale versions never pay.
    function test_rotationImmediatelyPaysOnlyTheNewWallet() public {
        bytes32 first = commit(keccak256("first"), ALICE, 100e6);
        bytes32 second = commit(keccak256("second"), ALICE, 100e6);
        uint64 v1 = bindAs(ALICE, ALICE_WALLET);
        vm.warp(block.timestamp + DELAY);
        payAs(first, v1);
        address newWallet = vm.addr(OpusWallets.NEW_WALLET_KEY);
        uint64 v2 = bindAs(ALICE, newWallet);
        (address destination, uint64 version) = escrow.payableBinding(ALICE);
        check(destination == newWallet && version == v2, "successor immediately payable");
        vm.prank(RELAYER);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        escrow.pay(second, v1);
        payAs(second, v2);
        check(usdc.balanceOf(ALICE_WALLET) == 98e6 && usdc.balanceOf(newWallet) == 98e6, "second award followed v2");
        check(escrow.paidVersion(ALICE) == v2, "v2 is now the paid version");
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        escrow.cancelBinding(ALICE, v2);
    }

    /// Rotation: an owner cancel of the newer binding does not reopen payment to the previous wallet. Only
    /// a fresh authority binding can pay.
    function test_cancelledRotationDoesNotPayPreviousWallet() public {
        bytes32 first = commit(keccak256("first"), ALICE, 100e6);
        bytes32 second = commit(keccak256("second"), ALICE, 100e6);
        uint64 v1 = bindAs(ALICE, ALICE_WALLET);
        vm.warp(block.timestamp + DELAY);
        payAs(first, v1);
        uint64 v2 = bindAs(ALICE, ATTACKER);
        cancelAs(ALICE, v2);
        vm.warp(block.timestamp + 10 * DELAY);
        vm.prank(RELAYER);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        escrow.pay(second, v2);
        vm.prank(RELAYER);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        escrow.pay(second, v1);
        uint64 v3 = bindAs(ALICE, ALICE_WALLET);
        vm.warp(block.timestamp + DELAY);
        payAs(second, v3);
        check(usdc.balanceOf(ALICE_WALLET) == 196e6 && usdc.balanceOf(ATTACKER) == 0, "paid only after rebind");
        check(escrow.cancelCount(ALICE) == 0, "a payment resets the cancel count");
    }

    /// Cap after a payment: the owner can again cancel at most MAX_CANCELS_BETWEEN_PAYMENTS rotations, so
    /// the owner cannot cancel an unbounded sequence of new bindings.
    function test_cancelCapAppliesBetweenPayments() public {
        bytes32 first = commit(keccak256("first"), ALICE, 100e6);
        bytes32 second = commit(keccak256("second"), ALICE, 100e6);
        uint64 v1 = bindAs(ALICE, ALICE_WALLET);
        vm.warp(block.timestamp + DELAY);
        payAs(first, v1);
        uint8 cap = escrow.MAX_CANCELS_BETWEEN_PAYMENTS();
        for (uint8 i = 0; i < cap; i++) {
            uint64 v = bindAs(ALICE, ALICE_WALLET);
            cancelAs(ALICE, v);
        }
        uint64 last = bindAs(ALICE, ALICE_WALLET);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.CancelLimit.selector);
        escrow.cancelBinding(ALICE, last);
        vm.warp(block.timestamp + DELAY);
        payAs(second, last);
        check(usdc.balanceOf(ALICE_WALLET) == 196e6, "second award paid after the cap");
    }

    /// M-2 cap: before the first payment the owner can cancel at most MAX_CANCELS_BETWEEN_PAYMENTS times.
    function test_cancelCapBeforeFirstPayment() public {
        bytes32 id = commit(keccak256("award"), ALICE, 100e6);
        uint8 cap = escrow.MAX_CANCELS_BETWEEN_PAYMENTS();
        for (uint8 i = 0; i < cap; i++) {
            uint64 v = bindAs(ALICE, ATTACKER);
            cancelAs(ALICE, v);
            check(escrow.cancelCount(ALICE) == i + 1, "cancel counted");
        }
        uint64 last = bindAs(ALICE, ALICE_WALLET);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.CancelLimit.selector);
        escrow.cancelBinding(ALICE, last);
        vm.warp(block.timestamp + DELAY);
        payAs(id, last);
        check(usdc.balanceOf(ALICE_WALLET) == 98e6, "fourth binding pays");
    }

    /// L-1: the factory bounds the delay to [1 hour, 30 days]; vaults are created only by the factory,
    /// so the vault constructor cannot be reached with any other delay.
    function test_delayBounds() public {
        uint64[2] memory bad = [uint64(30 days + 1), type(uint64).max];
        for (uint256 i = 0; i < bad.length; i++) {
            vm.expectRevert(ProjectEscrow.InvalidInput.selector);
            DeployFactory.create(REGISTRAR, FEE, AUTHORITY, bad[i]);
        }
        vm.expectRevert();
        escrow.initialize(keccak256("p"), IERC20(address(usdc)), OWNER, Purpose.Ordinary, FEE, 1 hours);
        deployWithDelay(1 hours);
        ProjectEscrow low = escrow;
        deployWithDelay(30 days);
        check(low.bindingDelay() == 1 hours && escrow.bindingDelay() == 30 days, "bounds inclusive");
    }

    /// L-5: cancel reverts on a missing binding, a cancelled binding, and a binding that has paid.
    function test_cancelOnCancelledOrMissingBindingReverts() public {
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        escrow.cancelBinding(ALICE, 1);
        uint64 v = bindAs(ALICE, ALICE_WALLET);
        cancelAs(ALICE, v);
        (,,,, bool cancelled) = escrow.bindings(ALICE);
        check(cancelled, "flag set");
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        escrow.cancelBinding(ALICE, v);
        check(escrow.cancelCount(ALICE) == 1, "second attempt not counted");
        // A fresh binding replaces the cancelled one and can be cancelled once.
        uint64 next = bindAs(ALICE, ALICE_WALLET);
        (,,,, cancelled) = escrow.bindings(ALICE);
        check(!cancelled && next == v + 1, "replacement is live");
    }
}

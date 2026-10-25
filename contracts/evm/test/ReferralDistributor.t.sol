// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ReferralDistributor, IReferralToken} from "../src/ReferralDistributor.sol";
import {MockReferralToken} from "../integration/MockReferralToken.sol";

interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function warp(uint256) external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
    function expectEmit(bool, bool, bool, bool) external;
    function addr(uint256) external pure returns (address);
    function assume(bool) external;
}

/// @dev Minimal harness: no forge-std is vendored in this project. Trees are built by hand for two and three
/// leaves, which covers an even level, an odd promoted node, and the sorted-pair rule.
abstract contract ReferralBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant OWNER = address(0xA11CE);
    address internal constant POSTER = address(0x9057);
    address internal constant ALICE = 0x1111111111111111111111111111111111111111;
    address internal constant BOB = 0x2222222222222222222222222222222222222222;
    address internal constant CAROL = 0x3333333333333333333333333333333333333333;
    address internal constant ATTACKER = address(0xBAD);

    uint256 internal constant ONE = 1e18;
    uint256 internal constant CAP = 100_000 * ONE;
    uint64 internal constant DELAY = 7 days;

    MockReferralToken internal token;
    ReferralDistributor internal distributor;

    function setUp() public virtual {
        vm.warp(1_762_000_000); // 1 Nov 2026 UTC
        token = new MockReferralToken();
        distributor = new ReferralDistributor(IReferralToken(address(token)), OWNER, POSTER, CAP, DELAY);
        token.mint(address(distributor), 1_000_000 * ONE);
    }

    function pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a <= b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function leafOf(address account, uint256 cumulative) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, cumulative))));
    }

    /// @dev Two leaves: root = pair(a, b); each proof is the other leaf.
    function tree2(uint256 aliceTotal, uint256 bobTotal)
        internal
        pure
        returns (bytes32 root, bytes32[] memory aliceProof, bytes32[] memory bobProof)
    {
        bytes32 a = leafOf(ALICE, aliceTotal);
        bytes32 b = leafOf(BOB, bobTotal);
        root = pair(a, b);
        aliceProof = new bytes32[](1);
        aliceProof[0] = b;
        bobProof = new bytes32[](1);
        bobProof[0] = a;
    }

    /// @dev Three leaves sorted by address: root = pair(pair(a, b), c), with c promoted at the first level.
    function tree3(uint256 aliceTotal, uint256 bobTotal, uint256 carolTotal)
        internal
        pure
        returns (bytes32 root, bytes32[] memory aliceProof, bytes32[] memory carolProof)
    {
        bytes32 a = leafOf(ALICE, aliceTotal);
        bytes32 b = leafOf(BOB, bobTotal);
        bytes32 c = leafOf(CAROL, carolTotal);
        bytes32 ab = pair(a, b);
        root = pair(ab, c);
        aliceProof = new bytes32[](2);
        aliceProof[0] = b;
        aliceProof[1] = c;
        carolProof = new bytes32[](1);
        carolProof[0] = ab;
    }

    function post(uint256 index, bytes32 root, uint256 total) internal {
        vm.prank(POSTER);
        distributor.postRoot(index, root, total);
    }

    function claimAs(address who, uint256 cumulative, bytes32[] memory proof) internal {
        vm.prank(who);
        distributor.claim(cumulative, proof);
    }
}

contract ReferralDistributorTest is ReferralBase {
    event Claimed(address indexed account, uint256 indexed epoch, uint256 amount, uint256 cumulative);
    event RootVoided(uint256 indexed epoch, bytes32 root);

    // ------------------------------------------------------------------
    // R-0: the leaf and root bytes match workers/referral-accrual/merkle.ts
    // (vectors asserted in referral-accrual.test.ts), so a file built off
    // chain verifies here.
    // ------------------------------------------------------------------
    function test_R0_vectorsMatchAccrualJob() public view {
        require(
            distributor.leaf(ALICE, 100 * ONE) == 0x923a571f712ff2d205bc7da76152ab30459ae47d04647ff145ba9ad746468fc6,
            "alice leaf"
        );
        require(
            leafOf(BOB, 250 * ONE) == 0x961b65b12221d8db52e43da798be51b873abf56862b42a2bc18e831faf7fbbd8, "bob leaf"
        );
        (bytes32 root2,,) = tree2(100 * ONE, 250 * ONE);
        require(root2 == 0x03f9627eb9aef1752099688f5bdd8bc3326fb0dfcafef85aab3c1482acfcdf9d, "two-leaf root");
        (bytes32 root3,, bytes32[] memory carolProof) = tree3(100 * ONE, 250 * ONE, 7 * ONE);
        require(root3 == 0x026d73c7c26605e67a53ae9cdc94e997f7828802e7947676fd52c3f1463877c9, "three-leaf root");
        require(carolProof[0] == root2, "carol proof is the ab node");
    }

    // ------------------------------------------------------------------
    // R-1: a posted root pays nothing until CLAIM_DELAY, then pays each
    // leaf its cumulative amount exactly once.
    // ------------------------------------------------------------------
    function test_R1_claimAfterDelay() public {
        (bytes32 root, bytes32[] memory aliceProof, bytes32[] memory bobProof) = tree2(100 * ONE, 250 * ONE);
        post(0, root, 350 * ONE);
        require(distributor.hasPendingRoot(), "pending");
        require(distributor.claimable(ALICE, 100 * ONE, aliceProof) == 0, "nothing before the delay");
        vm.prank(ALICE);
        vm.expectRevert(ReferralDistributor.NoActiveRoot.selector);
        distributor.claim(100 * ONE, aliceProof);
        vm.warp(block.timestamp + DELAY - 1);
        vm.prank(ALICE);
        vm.expectRevert(ReferralDistributor.NoActiveRoot.selector);
        distributor.claim(100 * ONE, aliceProof);
        vm.warp(block.timestamp + 1);
        require(!distributor.hasPendingRoot(), "live");
        require(distributor.claimable(ALICE, 100 * ONE, aliceProof) == 100 * ONE, "claimable after the delay");
        vm.expectEmit(true, true, false, true);
        emit Claimed(ALICE, 0, 100 * ONE, 100 * ONE);
        claimAs(ALICE, 100 * ONE, aliceProof);
        claimAs(BOB, 250 * ONE, bobProof);
        require(token.balanceOf(ALICE) == 100 * ONE && token.balanceOf(BOB) == 250 * ONE, "paid once");
        require(distributor.totalClaimed() == 350 * ONE, "total claimed");
        require(distributor.activeRoot() == root && distributor.activeTotal() == 350 * ONE, "active root");
    }

    // ------------------------------------------------------------------
    // R-2: a second claim against the same cumulative pays nothing; a later
    // epoch pays only the difference, and a stale lower cumulative is refused.
    // ------------------------------------------------------------------
    function test_R2_doubleClaimRefusedAndCumulativePaysTheDifference() public {
        (bytes32 root, bytes32[] memory aliceProof,) = tree2(100 * ONE, 250 * ONE);
        post(0, root, 350 * ONE);
        vm.warp(block.timestamp + DELAY);
        claimAs(ALICE, 100 * ONE, aliceProof);
        vm.prank(ALICE);
        vm.expectRevert(ReferralDistributor.NothingToClaim.selector);
        distributor.claim(100 * ONE, aliceProof);
        // Epoch 1 raises Alice to 160 and Bob stays at 250.
        (bytes32 root1, bytes32[] memory aliceProof1, bytes32[] memory bobProof1) = tree2(160 * ONE, 250 * ONE);
        post(1, root1, 410 * ONE);
        vm.warp(block.timestamp + DELAY);
        claimAs(ALICE, 160 * ONE, aliceProof1);
        require(token.balanceOf(ALICE) == 160 * ONE, "paid the 60 difference");
        // The old proof no longer verifies against the new root.
        vm.prank(ALICE);
        vm.expectRevert(ReferralDistributor.InvalidProof.selector);
        distributor.claim(100 * ONE, aliceProof);
        claimAs(BOB, 250 * ONE, bobProof1);
        vm.prank(BOB);
        vm.expectRevert(ReferralDistributor.NothingToClaim.selector);
        distributor.claim(250 * ONE, bobProof1);
        require(distributor.totalClaimed() == 410 * ONE, "all paid exactly once");
    }

    // ------------------------------------------------------------------
    // R-3: the owner can void a root inside the window; the previous live
    // root stays claimable, the voided epoch keeps its index, and the next
    // post carries the corrected totals.
    // ------------------------------------------------------------------
    function test_R3_voidInsideWindow() public {
        (bytes32 root0, bytes32[] memory aliceProof0,) = tree2(100 * ONE, 250 * ONE);
        post(0, root0, 350 * ONE);
        vm.warp(block.timestamp + DELAY);
        claimAs(ALICE, 100 * ONE, aliceProof0);
        // A wrong epoch 1 is posted and voided a day later.
        (bytes32 root1, bytes32[] memory aliceProof1,) = tree2(900 * ONE, 250 * ONE);
        post(1, root1, 1_150 * ONE);
        vm.warp(block.timestamp + 1 days);
        vm.prank(ATTACKER);
        vm.expectRevert(ReferralDistributor.NotOwner.selector);
        distributor.voidRoot(1);
        vm.prank(OWNER);
        vm.expectEmit(true, false, false, true);
        emit RootVoided(1, root1);
        distributor.voidRoot(1);
        require(distributor.epochAt(1).voided, "voided");
        vm.prank(OWNER);
        vm.expectRevert(ReferralDistributor.AlreadyVoided.selector);
        distributor.voidRoot(1);
        // Nothing from the voided root is ever claimable, even after its delay.
        vm.warp(block.timestamp + DELAY);
        vm.prank(ALICE);
        vm.expectRevert(ReferralDistributor.InvalidProof.selector);
        distributor.claim(900 * ONE, aliceProof1);
        require(distributor.activeRoot() == root0 && distributor.activeTotal() == 350 * ONE, "epoch 0 stays live");
        // The corrected post uses index 2, not 1, and is capped against epoch 0's total.
        (bytes32 root2, bytes32[] memory aliceProof2,) = tree2(130 * ONE, 250 * ONE);
        vm.prank(POSTER);
        vm.expectRevert(abi.encodeWithSelector(ReferralDistributor.EpochOutOfOrder.selector, 2));
        distributor.postRoot(1, root2, 380 * ONE);
        post(2, root2, 380 * ONE);
        vm.warp(block.timestamp + DELAY);
        claimAs(ALICE, 130 * ONE, aliceProof2);
        require(token.balanceOf(ALICE) == 130 * ONE, "paid the corrected difference");
    }

    // ------------------------------------------------------------------
    // R-4: a root cannot be voided once its window has closed.
    // ------------------------------------------------------------------
    function test_R4_voidAfterWindowRefused() public {
        (bytes32 root,,) = tree2(100 * ONE, 250 * ONE);
        post(0, root, 350 * ONE);
        vm.warp(block.timestamp + DELAY);
        vm.prank(OWNER);
        vm.expectRevert(ReferralDistributor.WindowClosed.selector);
        distributor.voidRoot(0);
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(ReferralDistributor.EpochOutOfOrder.selector, 1));
        distributor.voidRoot(1);
    }

    // ------------------------------------------------------------------
    // R-5: the epoch cap bounds the growth of the cumulative total, the
    // total never shrinks, and the balance must cover every unclaimed unit.
    // ------------------------------------------------------------------
    function test_R5_capMonotonicAndFundingEnforced() public {
        (bytes32 root,,) = tree2(CAP, 1);
        vm.prank(POSTER);
        vm.expectRevert(ReferralDistributor.CapExceeded.selector);
        distributor.postRoot(0, root, CAP + 1);
        post(0, root, CAP);
        vm.warp(block.timestamp + DELAY);
        vm.prank(POSTER);
        vm.expectRevert(ReferralDistributor.InvalidInput.selector);
        distributor.postRoot(1, bytes32(0), CAP);
        // A smaller total is accepted while nothing above it was claimed, and
        // the cap is measured from the highest total ever posted, so shrinking
        // buys no extra room.
        (bytes32 root1,,) = tree2(CAP - 1, 0);
        post(1, root1, CAP - 1);
        vm.warp(block.timestamp + DELAY);
        vm.prank(POSTER);
        vm.expectRevert(ReferralDistributor.CapExceeded.selector);
        distributor.postRoot(2, root, 2 * CAP + 1);
        post(2, root, 2 * CAP);
        require(distributor.highWaterTotal() == 2 * CAP, "high water follows the largest total");
        // A fresh contract with a small balance refuses a total it cannot pay.
        ReferralDistributor poor = new ReferralDistributor(IReferralToken(address(token)), OWNER, POSTER, CAP, DELAY);
        token.mint(address(poor), 10 * ONE);
        vm.prank(POSTER);
        vm.expectRevert(ReferralDistributor.Underfunded.selector);
        poor.postRoot(0, root, 10 * ONE + 1);
        vm.prank(POSTER);
        poor.postRoot(0, root, 10 * ONE);
        // Claimed amounts count toward coverage: after paying out, the same
        // total still posts even though the balance fell.
        (bytes32 r, bytes32[] memory aliceProof,) = tree2(10 * ONE, 0);
        vm.warp(block.timestamp + DELAY);
        vm.prank(POSTER);
        poor.postRoot(1, r, 10 * ONE);
        vm.warp(block.timestamp + DELAY);
        vm.prank(ALICE);
        poor.claim(10 * ONE, aliceProof);
        require(token.balanceOf(address(poor)) == 0, "drained by claims");
        vm.prank(POSTER);
        poor.postRoot(2, r, 10 * ONE);
        vm.prank(POSTER);
        vm.expectRevert(ReferralDistributor.RootPending.selector);
        poor.postRoot(3, r, 10 * ONE);
    }

    // ------------------------------------------------------------------
    // R-6: only one root is pending at a time, and indexes are strict.
    // ------------------------------------------------------------------
    function test_R6_onePendingRootAndStrictIndexes() public {
        (bytes32 root,,) = tree2(1, 1);
        vm.prank(POSTER);
        vm.expectRevert(abi.encodeWithSelector(ReferralDistributor.EpochOutOfOrder.selector, 0));
        distributor.postRoot(1, root, 2);
        post(0, root, 2);
        vm.prank(POSTER);
        vm.expectRevert(ReferralDistributor.RootPending.selector);
        distributor.postRoot(1, root, 2);
        vm.warp(block.timestamp + DELAY);
        post(1, root, 2);
        require(distributor.nextEpoch() == 2 && distributor.epochCount() == 2, "two epochs");
    }

    // ------------------------------------------------------------------
    // R-7: roles. Only the poster posts; only the owner voids, pauses,
    // changes the poster and hands over ownership in two steps.
    // ------------------------------------------------------------------
    function test_R7_roles() public {
        (bytes32 root,,) = tree2(1, 1);
        vm.prank(OWNER);
        vm.expectRevert(ReferralDistributor.NotPoster.selector);
        distributor.postRoot(0, root, 2);
        vm.prank(ATTACKER);
        vm.expectRevert(ReferralDistributor.NotOwner.selector);
        distributor.setPoster(ATTACKER);
        vm.prank(OWNER);
        vm.expectRevert(ReferralDistributor.InvalidInput.selector);
        distributor.setPoster(address(0));
        vm.prank(OWNER);
        vm.expectRevert(ReferralDistributor.InvalidInput.selector);
        distributor.setPoster(OWNER);
        vm.prank(OWNER);
        distributor.setPoster(ATTACKER);
        vm.prank(OWNER);
        vm.expectRevert(ReferralDistributor.InvalidInput.selector);
        distributor.transferOwnership(ATTACKER);
        vm.prank(POSTER);
        vm.expectRevert(ReferralDistributor.NotPoster.selector);
        distributor.postRoot(0, root, 2);
        vm.prank(ATTACKER);
        distributor.postRoot(0, root, 2);
        // Two-step ownership: the pending owner must accept; nobody else can.
        vm.prank(OWNER);
        distributor.transferOwnership(CAROL);
        require(distributor.owner() == OWNER && distributor.pendingOwner() == CAROL, "still the old owner");
        vm.prank(ATTACKER);
        vm.expectRevert(ReferralDistributor.NotPendingOwner.selector);
        distributor.acceptOwnership();
        vm.prank(CAROL);
        distributor.acceptOwnership();
        require(distributor.owner() == CAROL && distributor.pendingOwner() == address(0), "handed over");
        vm.prank(OWNER);
        vm.expectRevert(ReferralDistributor.NotOwner.selector);
        distributor.pause();
    }

    // ------------------------------------------------------------------
    // R-8: pause blocks posts, claims and rescue, and freezes the objection
    // window of a pending root, so the owner can still void it after any
    // length of pause and claimants keep the time that was left.
    // ------------------------------------------------------------------
    function test_R8_pauseBlocksPostsAndClaimsAndFreezesTheWindow() public {
        (bytes32 root, bytes32[] memory aliceProof,) = tree2(100 * ONE, 250 * ONE);
        post(0, root, 350 * ONE);
        vm.warp(block.timestamp + 6 days);
        vm.prank(OWNER);
        distributor.pause();
        vm.prank(OWNER);
        vm.expectRevert(ReferralDistributor.InvalidInput.selector);
        distributor.pause();
        vm.warp(block.timestamp + 30 days);
        require(distributor.hasPendingRoot(), "still pending while paused");
        vm.prank(ALICE);
        vm.expectRevert(ReferralDistributor.IsPaused.selector);
        distributor.claim(100 * ONE, aliceProof);
        vm.prank(POSTER);
        vm.expectRevert(ReferralDistributor.IsPaused.selector);
        distributor.postRoot(1, root, 350 * ONE);
        vm.prank(OWNER);
        vm.expectRevert(ReferralDistributor.IsPaused.selector);
        distributor.rescue(OWNER);
        vm.prank(OWNER);
        distributor.unpause();
        // One day of the window was left at the pause; it is still left now.
        require(distributor.claimableAt(0) == uint64(block.timestamp) + 1 days, "window resumed where it stopped");
        vm.prank(ALICE);
        vm.expectRevert(ReferralDistributor.NoActiveRoot.selector);
        distributor.claim(100 * ONE, aliceProof);
        vm.prank(OWNER);
        distributor.voidRoot(0);
        vm.warp(block.timestamp + 1 days);
        vm.prank(ALICE);
        vm.expectRevert(ReferralDistributor.NoActiveRoot.selector);
        distributor.claim(100 * ONE, aliceProof);
        // A second pending root can be voided during a pause, however long.
        post(1, root, 350 * ONE);
        vm.prank(OWNER);
        distributor.pause();
        vm.warp(block.timestamp + 400 days);
        vm.prank(OWNER);
        distributor.voidRoot(1);
        vm.prank(OWNER);
        distributor.unpause();
        post(2, root, 350 * ONE);
        vm.warp(block.timestamp + DELAY);
        claimAs(ALICE, 100 * ONE, aliceProof);
        require(token.balanceOf(ALICE) == 100 * ONE, "claims resume");
    }

    // ------------------------------------------------------------------
    // R-9: rescue is refused before RESCUE_DELAY since the last post, then
    // sweeps the whole balance to the named address.
    // ------------------------------------------------------------------
    function test_R9_rescueOnlyAfterExpiry() public {
        uint64 deployed = uint64(block.timestamp);
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(ReferralDistributor.RescueTooEarly.selector, deployed + 365 days));
        distributor.rescue(OWNER);
        (bytes32 root,,) = tree2(100 * ONE, 250 * ONE);
        vm.warp(block.timestamp + 300 days);
        post(0, root, 350 * ONE);
        // Rescue waits while the root is pending, and the clock restarts when
        // the root goes live: 365 days after deployment is not enough.
        vm.prank(OWNER);
        vm.expectRevert(ReferralDistributor.RootPending.selector);
        distributor.rescue(OWNER);
        uint64 liveAt = distributor.claimableAt(0);
        vm.warp(deployed + 365 days);
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(ReferralDistributor.RescueTooEarly.selector, liveAt + 365 days));
        distributor.rescue(OWNER);
        // A voided post does not move the clock; an unpause does.
        vm.warp(liveAt + 100 days);
        post(1, root, 350 * ONE);
        vm.prank(OWNER);
        distributor.voidRoot(1);
        require(distributor.rescueAvailableAt() == liveAt + 365 days, "voided post ignored");
        vm.prank(OWNER);
        distributor.pause();
        vm.warp(block.timestamp + 1 days);
        vm.prank(OWNER);
        distributor.unpause();
        uint64 unpausedAt = uint64(block.timestamp);
        require(distributor.rescueAvailableAt() == unpausedAt + 365 days, "unpause restarts the clock");
        vm.warp(unpausedAt + 365 days - 1);
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(ReferralDistributor.RescueTooEarly.selector, unpausedAt + 365 days));
        distributor.rescue(OWNER);
        vm.warp(unpausedAt + 365 days);
        vm.prank(ATTACKER);
        vm.expectRevert(ReferralDistributor.NotOwner.selector);
        distributor.rescue(ATTACKER);
        vm.prank(OWNER);
        vm.expectRevert(ReferralDistributor.InvalidInput.selector);
        distributor.rescue(address(0));
        uint256 balance = token.balanceOf(address(distributor));
        vm.prank(OWNER);
        distributor.rescue(CAROL);
        require(token.balanceOf(CAROL) == balance && token.balanceOf(address(distributor)) == 0, "swept");
    }

    // ------------------------------------------------------------------
    // R-10: a proof is bound to msg.sender. Another account cannot spend
    // Alice's proof, and a forged amount does not verify.
    // ------------------------------------------------------------------
    function test_R10_proofBoundToSender() public {
        (bytes32 root, bytes32[] memory aliceProof,) = tree2(100 * ONE, 250 * ONE);
        post(0, root, 350 * ONE);
        vm.warp(block.timestamp + DELAY);
        vm.prank(ATTACKER);
        vm.expectRevert(ReferralDistributor.InvalidProof.selector);
        distributor.claim(100 * ONE, aliceProof);
        vm.prank(ALICE);
        vm.expectRevert(ReferralDistributor.InvalidProof.selector);
        distributor.claim(101 * ONE, aliceProof);
        bytes32[] memory empty = new bytes32[](0);
        vm.prank(ALICE);
        vm.expectRevert(ReferralDistributor.InvalidProof.selector);
        distributor.claim(100 * ONE, empty);
        require(token.balanceOf(ATTACKER) == 0 && token.balanceOf(ALICE) == 0, "nothing paid");
    }

    // ------------------------------------------------------------------
    // R-11: a transfer that returns false reverts the claim and leaves the
    // claimed record unchanged, so the claimant can retry.
    // ------------------------------------------------------------------
    function test_R11_failedTransferRevertsClaim() public {
        (bytes32 root, bytes32[] memory aliceProof,) = tree2(100 * ONE, 250 * ONE);
        post(0, root, 350 * ONE);
        vm.warp(block.timestamp + DELAY);
        token.setFailNext(true);
        vm.prank(ALICE);
        vm.expectRevert(ReferralDistributor.TransferFailed.selector);
        distributor.claim(100 * ONE, aliceProof);
        require(distributor.claimed(ALICE) == 0 && distributor.totalClaimed() == 0, "state unwound");
        // The revert also unwound the mock's one-shot flag, so clear it explicitly.
        token.setFailNext(false);
        claimAs(ALICE, 100 * ONE, aliceProof);
        require(token.balanceOf(ALICE) == 100 * ONE, "retry pays");
    }

    // ------------------------------------------------------------------
    // R-12: a three-leaf tree pays the promoted odd leaf and the paired ones.
    // ------------------------------------------------------------------
    function test_R12_threeLeafTree() public {
        (bytes32 root, bytes32[] memory aliceProof, bytes32[] memory carolProof) = tree3(100 * ONE, 250 * ONE, 7 * ONE);
        post(0, root, 357 * ONE);
        vm.warp(block.timestamp + DELAY);
        claimAs(ALICE, 100 * ONE, aliceProof);
        claimAs(CAROL, 7 * ONE, carolProof);
        require(token.balanceOf(ALICE) == 100 * ONE && token.balanceOf(CAROL) == 7 * ONE, "both paid");
    }

    // ------------------------------------------------------------------
    // R-13: constructor input checks.
    // ------------------------------------------------------------------
    function test_R13_constructorRefusesZeroes() public {
        vm.expectRevert(ReferralDistributor.InvalidInput.selector);
        new ReferralDistributor(IReferralToken(address(0)), OWNER, POSTER, CAP, DELAY);
        vm.expectRevert(ReferralDistributor.InvalidInput.selector);
        new ReferralDistributor(IReferralToken(address(token)), address(0), POSTER, CAP, DELAY);
        vm.expectRevert(ReferralDistributor.InvalidInput.selector);
        new ReferralDistributor(IReferralToken(address(token)), OWNER, address(0), CAP, DELAY);
        vm.expectRevert(ReferralDistributor.InvalidInput.selector);
        new ReferralDistributor(IReferralToken(address(token)), OWNER, OWNER, CAP, DELAY);
        vm.expectRevert(ReferralDistributor.InvalidInput.selector);
        new ReferralDistributor(IReferralToken(address(token)), OWNER, POSTER, 0, DELAY);
        vm.expectRevert(ReferralDistributor.InvalidInput.selector);
        new ReferralDistributor(IReferralToken(address(token)), OWNER, POSTER, CAP, 366 days);
    }

    // ------------------------------------------------------------------
    // R-14 (review A-1, B-01, C-1): the declared total bounds what a root can
    // pay. A root whose leaves add up to more than its total pays out at most
    // the total, so a poster key alone cannot drain the balance.
    // ------------------------------------------------------------------
    function test_R14_claimsNeverExceedTheDeclaredTotal() public {
        uint256 pool = token.balanceOf(address(distributor));
        // A single-leaf tree: the root is the leaf and the proof is empty.
        bytes32 root = distributor.leaf(ATTACKER, pool);
        post(0, root, 1);
        vm.warp(block.timestamp + DELAY);
        bytes32[] memory empty = new bytes32[](0);
        require(distributor.claimable(ATTACKER, pool, empty) == 0, "nothing claimable above the total");
        vm.prank(ATTACKER);
        vm.expectRevert(ReferralDistributor.TotalExceeded.selector);
        distributor.claim(pool, empty);
        require(token.balanceOf(ATTACKER) == 0, "nothing paid");
        // An honest two-leaf tree declared at the sum of its leaves pays in full,
        // and a third claimant whose leaf was never counted cannot push past it.
        (bytes32 root1, bytes32[] memory aliceProof, bytes32[] memory bobProof) = tree2(100 * ONE, 250 * ONE);
        vm.warp(block.timestamp + DELAY);
        post(1, root1, 351 * ONE);
        vm.warp(block.timestamp + DELAY);
        claimAs(ALICE, 100 * ONE, aliceProof);
        claimAs(BOB, 250 * ONE, bobProof);
        require(distributor.totalClaimed() == 350 * ONE, "sum of leaves");
        // Single-leaf honest tree, empty proof, pays its own account.
        bytes32 root2 = distributor.leaf(CAROL, 7 * ONE);
        vm.warp(block.timestamp + DELAY);
        post(2, root2, 357 * ONE);
        vm.warp(block.timestamp + DELAY);
        claimAs(CAROL, 7 * ONE, empty);
        require(token.balanceOf(CAROL) == 7 * ONE, "single leaf pays");
    }

    // ------------------------------------------------------------------
    // R-15 (review A-2, B-05, C-3): a total may shrink to what was already
    // claimed, never below it, so a per-account decrease fails closed.
    // ------------------------------------------------------------------
    function test_R15_totalMayShrinkOnlyToWhatWasClaimed() public {
        (bytes32 root0, bytes32[] memory aliceProof0,) = tree2(100 * ONE, 250 * ONE);
        post(0, root0, 350 * ONE);
        vm.warp(block.timestamp + DELAY);
        claimAs(ALICE, 100 * ONE, aliceProof0);
        // Bob's wallet is dropped: the honest tree is Alice alone at 100.
        bytes32 root1 = distributor.leaf(ALICE, 100 * ONE);
        vm.prank(POSTER);
        vm.expectRevert(ReferralDistributor.BelowClaimed.selector);
        distributor.postRoot(1, root1, 99 * ONE);
        post(1, root1, 100 * ONE);
        vm.warp(block.timestamp + DELAY);
        // Moving Alice's claimed 100 to Bob cannot be paid twice: the sum of
        // leaves equals the total, but the total is already fully claimed.
        (bytes32 root2,, bytes32[] memory bobProof2) = tree2(0, 350 * ONE);
        post(2, root2, 350 * ONE);
        vm.warp(block.timestamp + DELAY);
        vm.prank(BOB);
        vm.expectRevert(ReferralDistributor.TotalExceeded.selector);
        distributor.claim(350 * ONE, bobProof2);
        // Bob can take what the total still covers once the total grows.
        vm.warp(block.timestamp + DELAY);
        post(3, root2, 450 * ONE);
        vm.warp(block.timestamp + DELAY);
        claimAs(BOB, 350 * ONE, bobProof2);
        require(distributor.totalClaimed() == 450 * ONE, "never above the declared total");
    }

    // ------------------------------------------------------------------
    // R-16 (review A-5, C-4): live posts are at least postSpacing apart; a
    // voided post neither consumes the spacing nor raises the high-water mark.
    // ------------------------------------------------------------------
    function test_R16_postSpacing() public {
        ReferralDistributor spaced =
            new ReferralDistributor(IReferralToken(address(token)), OWNER, POSTER, CAP, 27 days);
        token.mint(address(spaced), 1_000_000 * ONE);
        (bytes32 root,,) = tree2(1, 1);
        vm.prank(POSTER);
        spaced.postRoot(0, root, 2);
        uint64 first = uint64(block.timestamp);
        vm.warp(block.timestamp + DELAY);
        vm.prank(POSTER);
        vm.expectRevert(abi.encodeWithSelector(ReferralDistributor.TooSoon.selector, first + 27 days));
        spaced.postRoot(1, root, 2);
        vm.warp(first + 27 days);
        vm.prank(POSTER);
        spaced.postRoot(1, root, 3);
        // Void it a day later: the next post may follow at once, measured from epoch 0.
        vm.warp(block.timestamp + 1 days);
        vm.prank(OWNER);
        spaced.voidRoot(1);
        require(spaced.lastLivePostedAt() == first && spaced.highWaterTotal() == 2, "marks follow the live post");
        vm.prank(POSTER);
        spaced.postRoot(2, root, 3);
    }

    // ------------------------------------------------------------------
    // R-17 (review A-6, A-7): claims against the live root keep working while
    // a newer root is pending, and currentRoot() reports the live one before
    // any transaction promotes it.
    // ------------------------------------------------------------------
    function test_R17_previousRootStaysLiveWhileTheNextIsPending() public {
        (bytes32 root0, bytes32[] memory aliceProof0,) = tree2(100 * ONE, 250 * ONE);
        post(0, root0, 350 * ONE);
        vm.warp(block.timestamp + DELAY);
        (bytes32 live, uint256 total, uint256 index) = distributor.currentRoot();
        require(live == root0 && total == 350 * ONE && index == 0, "live before promotion");
        require(distributor.activeRoot() == bytes32(0), "getter is lazy until a transaction");
        (bytes32 root1, bytes32[] memory aliceProof1,) = tree2(160 * ONE, 250 * ONE);
        post(1, root1, 410 * ONE);
        claimAs(ALICE, 100 * ONE, aliceProof0);
        vm.prank(ALICE);
        vm.expectRevert(ReferralDistributor.InvalidProof.selector);
        distributor.claim(160 * ONE, aliceProof1);
        vm.warp(block.timestamp + DELAY);
        claimAs(ALICE, 160 * ONE, aliceProof1);
        require(token.balanceOf(ALICE) == 160 * ONE, "topped up");
    }

    // ------------------------------------------------------------------
    // Fuzz: across two epochs with non-decreasing cumulatives, a claimant is
    // paid exactly its final cumulative and the contract never pays more
    // than the posted total.
    // ------------------------------------------------------------------
    function testFuzz_cumulativePaysExactlyOnce(uint96 first, uint96 second, uint96 bob) public {
        vm.assume(first <= second);
        vm.assume(uint256(second) + uint256(bob) <= CAP);
        (bytes32 root0, bytes32[] memory aliceProof0,) = tree2(first, bob);
        post(0, root0, uint256(first) + uint256(bob));
        vm.warp(block.timestamp + DELAY);
        if (first > 0) claimAs(ALICE, first, aliceProof0);
        (bytes32 root1, bytes32[] memory aliceProof1, bytes32[] memory bobProof1) = tree2(second, bob);
        post(1, root1, uint256(second) + uint256(bob));
        vm.warp(block.timestamp + DELAY);
        if (second > first) claimAs(ALICE, second, aliceProof1);
        if (bob > 0) claimAs(BOB, bob, bobProof1);
        require(token.balanceOf(ALICE) == second && token.balanceOf(BOB) == bob, "exact");
        require(distributor.totalClaimed() == uint256(second) + uint256(bob), "total");
        require(distributor.totalClaimed() <= distributor.activeTotal(), "never over the posted total");
    }
}

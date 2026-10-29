// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {DeployFactory} from "./DeployFactory.sol";
import {MonthlyTree} from "./MonthlyTree.sol";

import {EscrowFactory, IERC20, ProjectEscrow, Purpose} from "../src/ProjectEscrow.sol";
import {TestDollar} from "../integration/TestDollar.sol";

interface ReserveVm {
    function prank(address) external;
    function warp(uint256) external;
    function expectRevert(bytes4) external;
    function expectEmit(bool, bool, bool, bool, address) external;
    function addr(uint256) external pure returns (address);
    function sign(uint256, bytes32) external pure returns (uint8, bytes32, bytes32);
}

/// @dev V2 bounded admission, leaf execution and preservation of funded recipients.
contract MonthlyReserveV2Test {
    ReserveVm internal constant vm = ReserveVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant AUTHORITY_KEY = 0xA07;
    address internal constant OWNER = address(0xA11CE);
    address internal constant SUBMITTER = address(0x5B);
    address internal constant FEE = address(0xFEE);
    address internal constant REGISTRAR = address(0x5E6);
    uint64 internal constant DELAY = 48 hours;
    uint128 internal constant CAP = 1_000e6;
    uint32 internal constant PERIOD = 202611;
    uint32 internal constant NEXT_PERIOD = 202612;
    /// @dev 00:00 UTC on 4 December 2026 and on 4 January 2027.
    uint64 internal constant NOVEMBER_OPENS = 1_796_342_400;
    uint64 internal constant NOVEMBER_CLOSES = 1_799_020_800;

    TestDollar internal usdc;
    EscrowFactory internal factory;
    ProjectEscrow internal vault;

    function setUp() public {
        vm.warp(NOVEMBER_OPENS - 30 days);
        usdc = new TestDollar();
        factory = DeployFactory.create(REGISTRAR, FEE, vm.addr(AUTHORITY_KEY), DELAY);
        vault = newVault(keccak256("project"));
        vm.warp(NOVEMBER_OPENS);
    }

    function newVault(bytes32 project) internal returns (ProjectEscrow created) {
        vm.prank(OWNER);
        created = ProjectEscrow(factory.create(project, IERC20(address(usdc)), Purpose.Ordinary));
        usdc.mint(OWNER, 10_000e6);
        vm.prank(OWNER);
        usdc.approve(address(created), type(uint256).max);
        vm.prank(OWNER);
        created.deposit(10_000e6);
        vm.prank(OWNER);
        created.setMonthlyCommitment(CAP, true);
    }

    function entries(uint256 count, uint256 salt) internal pure returns (ProjectEscrow.MonthlyAward[] memory e) {
        e = new ProjectEscrow.MonthlyAward[](count);
        for (uint256 i; i < count; ++i) {
            e[i] = ProjectEscrow.MonthlyAward(
                uint64(100 + i), uint128(1e6 + i * 7 + salt), keccak256(abi.encode("source", salt, i))
            );
        }
    }

    function plan(ProjectEscrow target, ProjectEscrow.MonthlyAward[] memory e, uint128 wholeGross)
        internal
        view
        returns (ProjectEscrow.MonthlyReservation memory)
    {
        (ProjectEscrow.AllocationNode memory root,) = MonthlyTree.build(e, 0);
        return ProjectEscrow.MonthlyReservation(
            keccak256("frozen allocation"),
            root.hash,
            wholeGross,
            root.total,
            uint32(e.length),
            target.ordinarySourceSequence()
        );
    }

    function sign(ProjectEscrow target, uint32 period, ProjectEscrow.MonthlyReservation memory r)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(AUTHORITY_KEY, target.monthlyReserveDigest(period, r));
        return abi.encodePacked(rr, s, v);
    }

    function reserve(ProjectEscrow target, uint32 period, ProjectEscrow.MonthlyReservation memory r) internal {
        bytes memory signature = sign(target, period, r);
        vm.prank(SUBMITTER);
        target.reserveMonthly(period, r, signature);
    }

    function leaf(ProjectEscrow target, uint32 period, ProjectEscrow.MonthlyAward[] memory e, uint256 i) internal {
        (, ProjectEscrow.AllocationNode[] memory proof) = MonthlyTree.build(e, i);
        vm.prank(SUBMITTER);
        target.commitMonthlyLeaf(period, e[i], uint32(i), proof);
    }

    function sum(ProjectEscrow.MonthlyAward[] memory e) internal pure returns (uint128 total) {
        for (uint256 i; i < e.length; ++i) {
            total += e[i].gross;
        }
    }

    // ------------------------------------------------------------------
    // Tree shape and proof binding
    // ------------------------------------------------------------------

    function test_everyLeafOfOddAndEvenWidthTreesCommitsOnce() public {
        for (uint256 n = 1; n <= 9; ++n) {
            ProjectEscrow target = newVault(keccak256(abi.encode("width", n)));
            ProjectEscrow.MonthlyAward[] memory e = entries(n, n);
            uint128 total = sum(e);
            reserve(target, PERIOD, plan(target, e, total));
            require(target.freeBalance() == 10_000e6 - total, "reserve moves the remainder once");
            require(target.pendingMonthlyGross() == total, "pending equals the remainder");
            // Reverse order: no leaf depends on another leaf committing first.
            for (uint256 i = n; i > 0; --i) {
                leaf(target, PERIOD, e, i - 1);
            }
            require(target.pendingMonthlyGross() == 0, "every leaf settles");
            require(target.freeBalance() == 10_000e6 - total, "a leaf never charges free funds again");
            require(target.reservedPrincipal() + target.reservedFees() == total, "leaves become awards");
            (,, uint128 remaining,,) = target.monthlyReserves(PERIOD);
            require(remaining == 0, "reserve fully settled");
        }
    }

    function test_aLeafProvesOnlyAtItsOwnIndex() public {
        ProjectEscrow.MonthlyAward[] memory e = entries(5, 0);
        reserve(vault, PERIOD, plan(vault, e, sum(e)));
        (, ProjectEscrow.AllocationNode[] memory proof4) = MonthlyTree.build(e, 4);
        (, ProjectEscrow.AllocationNode[] memory proof2) = MonthlyTree.build(e, 2);
        // Beyond the signed count, even with a valid path shape.
        for (uint32 index = 5; index < 8; ++index) {
            vm.expectRevert(ProjectEscrow.InvalidAllocationProof.selector);
            vault.commitMonthlyLeaf(PERIOD, e[4], index, proof4);
        }
        // Another leaf's position, with this leaf's or that position's path.
        vm.expectRevert(ProjectEscrow.InvalidAllocationProof.selector);
        vault.commitMonthlyLeaf(PERIOD, e[4], 2, proof4);
        vm.expectRevert(ProjectEscrow.InvalidAllocationProof.selector);
        vault.commitMonthlyLeaf(PERIOD, e[4], 2, proof2);
        vm.expectRevert(ProjectEscrow.InvalidAllocationProof.selector);
        vault.commitMonthlyLeaf(PERIOD, e[2], 3, proof2);
        // An extra trailing sibling is not ignored.
        ProjectEscrow.AllocationNode[] memory longer = new ProjectEscrow.AllocationNode[](proof4.length + 1);
        for (uint256 i; i < proof4.length; ++i) {
            longer[i] = proof4[i];
        }
        longer[proof4.length] = proof2[0];
        vm.expectRevert(ProjectEscrow.InvalidAllocationProof.selector);
        vault.commitMonthlyLeaf(PERIOD, e[4], 4, longer);
        require(vault.pendingMonthlyGross() == sum(e), "failed proofs change nothing");
        leaf(vault, PERIOD, e, 4);
        leaf(vault, PERIOD, e, 2);
    }

    function test_forgedSiblingTotalsFail() public {
        ProjectEscrow.MonthlyAward[] memory e = entries(4, 0);
        reserve(vault, PERIOD, plan(vault, e, sum(e)));
        (, ProjectEscrow.AllocationNode[] memory proof) = MonthlyTree.build(e, 0);
        // A changed sibling total changes the parent hash.
        proof[0].total += 1;
        vm.expectRevert(ProjectEscrow.InvalidAllocationProof.selector);
        vault.commitMonthlyLeaf(PERIOD, e[0], 0, proof);
        proof[0].total -= 2;
        vm.expectRevert(ProjectEscrow.InvalidAllocationProof.selector);
        vault.commitMonthlyLeaf(PERIOD, e[0], 0, proof);
        // Moving gross from the sibling into this leaf keeps the root total but not the hashes.
        proof[0].total = proof[0].total + 1 - 5e5;
        ProjectEscrow.MonthlyAward memory inflated =
            ProjectEscrow.MonthlyAward(e[0].actorId, e[0].gross + 5e5, e[0].sourceDigest);
        vm.expectRevert(ProjectEscrow.InvalidAllocationProof.selector);
        vault.commitMonthlyLeaf(PERIOD, inflated, 0, proof);
        require(vault.pendingMonthlyGross() == sum(e), "nothing moved");
    }

    function test_aReplayedLeafFailsWithoutChangingAccounting() public {
        ProjectEscrow.MonthlyAward[] memory e = entries(3, 0);
        reserve(vault, PERIOD, plan(vault, e, sum(e)));
        leaf(vault, PERIOD, e, 1);
        uint128 pending = vault.pendingMonthlyGross();
        uint128 principal = vault.reservedPrincipal();
        (, ProjectEscrow.AllocationNode[] memory proof) = MonthlyTree.build(e, 1);
        vm.expectRevert(ProjectEscrow.DuplicateAward.selector);
        vault.commitMonthlyLeaf(PERIOD, e[1], 1, proof);
        require(vault.pendingMonthlyGross() == pending && vault.reservedPrincipal() == principal, "unchanged");
    }

    function test_aStaleSourceSequenceFailsBeforeFundsMove() public {
        ProjectEscrow.MonthlyAward[] memory e = entries(2, 0);
        ProjectEscrow.MonthlyReservation memory r = plan(vault, e, sum(e));
        bytes memory signature = sign(vault, PERIOD, r);
        bytes32 source = keccak256("manual award");
        bytes32 id = vault.awardId(source);
        vm.prank(OWNER);
        vault.commitAward(id, 7, 5e6, source);
        uint128 free = vault.freeBalance();
        vm.prank(SUBMITTER);
        vm.expectRevert(ProjectEscrow.MonthlySourceChanged.selector);
        vault.reserveMonthly(PERIOD, r, signature);
        require(vault.freeBalance() == free && vault.monthlyRoots(PERIOD) == bytes32(0), "nothing reserved");
    }

    function test_newMonthAdmissionMustPrecedeOlderLeaves() public {
        vm.warp(NOVEMBER_OPENS - 30 days);
        ProjectEscrow ordered = newVault(keccak256("ordered monthly dispatch"));
        vm.warp(NOVEMBER_OPENS);
        ProjectEscrow.MonthlyAward[] memory oldEntries = entries(2, 1);
        ProjectEscrow.MonthlyAward[] memory newEntries = entries(2, 2);
        reserve(vault, PERIOD, plan(vault, oldEntries, sum(oldEntries)));
        reserve(ordered, PERIOD, plan(ordered, oldEntries, sum(oldEntries)));
        vm.warp(NOVEMBER_CLOSES);

        ProjectEscrow.MonthlyReservation memory stale = plan(vault, newEntries, sum(newEntries));
        bytes memory signature = sign(vault, NEXT_PERIOD, stale);
        leaf(vault, PERIOD, oldEntries, 0);
        uint128 free = vault.freeBalance();
        vm.prank(SUBMITTER);
        vm.expectRevert(ProjectEscrow.MonthlySourceChanged.selector);
        vault.reserveMonthly(NEXT_PERIOD, stale, signature);
        require(
            vault.monthlyRoots(NEXT_PERIOD) == bytes32(0) && vault.freeBalance() == free, "old leaf invalidated root"
        );

        reserve(ordered, NEXT_PERIOD, plan(ordered, newEntries, sum(newEntries)));
        leaf(ordered, PERIOD, oldEntries, 0);
        leaf(ordered, NEXT_PERIOD, newEntries, 0);
        require(ordered.monthlyRoots(NEXT_PERIOD) != bytes32(0), "new month admitted first");
        require(ordered.pendingMonthlyGross() == oldEntries[1].gross + newEntries[1].gross, "both months progress");
    }

    function test_aZeroCountReservationSealsTheMonth() public {
        ProjectEscrow.MonthlyReservation memory r = ProjectEscrow.MonthlyReservation(
            keccak256("all funded"), keccak256("sealed"), 900e6, 0, 0, vault.ordinarySourceSequence()
        );
        uint128 free = vault.freeBalance();
        reserve(vault, PERIOD, r);
        require(vault.freeBalance() == free && vault.pendingMonthlyGross() == 0, "no funds move");
        require(vault.monthlyRoots(PERIOD) == r.allocationRoot, "period sealed");
        ProjectEscrow.MonthlyAward[] memory e = entries(1, 0);
        vm.expectRevert(ProjectEscrow.InvalidAllocationProof.selector);
        vault.commitMonthlyLeaf(PERIOD, e[0], 0, new ProjectEscrow.AllocationNode[](0));
        ProjectEscrow.MonthlyReservation memory again = plan(vault, e, sum(e));
        bytes memory signature = sign(vault, PERIOD, again);
        vm.expectRevert(ProjectEscrow.MonthlyAlreadyCommitted.selector);
        vault.reserveMonthly(PERIOD, again, signature);
        // A count must agree with a positive remainder.
        ProjectEscrow.MonthlyReservation memory mismatched = ProjectEscrow.MonthlyReservation(
            keccak256("all funded"), keccak256("sealed"), 900e6, 1e6, 0, vault.ordinarySourceSequence()
        );
        signature = sign(vault, NEXT_PERIOD, mismatched);
        vm.warp(NOVEMBER_CLOSES);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        vault.reserveMonthly(NEXT_PERIOD, mismatched, signature);
    }

    function test_theCapAppliesToTheWholeFrozenGross() public {
        ProjectEscrow.MonthlyAward[] memory e = entries(1, 0);
        ProjectEscrow.MonthlyReservation memory r = plan(vault, e, CAP + 1);
        bytes memory signature = sign(vault, PERIOD, r);
        vm.expectRevert(ProjectEscrow.MonthlyCapExceeded.selector);
        vault.reserveMonthly(PERIOD, r, signature);
        r.wholeGross = CAP;
        reserve(vault, PERIOD, r);
    }

    function test_timeCannotPermitAnotherAwardToTakeAFundedLeafSource() public {
        ProjectEscrow.MonthlyAward[] memory e = entries(1, 987);
        reserve(vault, PERIOD, plan(vault, e, sum(e)));
        uint128 free = vault.freeBalance();
        vm.prank(OWNER);
        vault.setMonthlyCommitment(CAP, false);
        vm.warp(NOVEMBER_CLOSES + 30 days);

        // The removed time-based bypass must not enable reuse of a funded source.
        (bool bypass,) = address(vault).call(abi.encodeWithSignature("expireMonthlyReserve(uint32)", PERIOD));
        require(!bypass, "time cannot bypass funded source protection");
        bytes32 id = vault.awardId(e[0].sourceDigest);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.MonthlyLeavesPending.selector);
        vault.commitAward(id, 999, e[0].gross, e[0].sourceDigest);
        require(vault.pendingMonthlyGross() == e[0].gross && vault.freeBalance() == free, "reserve preserved");
        leaf(vault, PERIOD, e, 0);
        (uint64 actor, uint128 gross, uint128 fee,,,) = vault.awards(id);
        require(actor == e[0].actorId && gross == e[0].gross, "original funded obligation preserved");
        require(vault.pendingMonthlyGross() == 0 && vault.freeBalance() == free, "leaf does not debit twice");

        // Once the funded leaf exists, ordinary owner commitments resume.
        bytes32 other = keccak256("unrelated award after completion");
        bytes32 otherId = vault.awardId(other);
        vm.prank(OWNER);
        vault.commitAward(otherId, 999, 1e6, other);

        address wallet = bindAndPay(id, actor);
        require(usdc.balanceOf(wallet) == gross - fee, "original recipient paid exactly once");
        (,,,,, bool paid) = vault.awards(id);
        require(paid, "funded award completed");
    }

    function bindAndPay(bytes32 id, uint64 actor) internal returns (address wallet) {
        uint256 walletKey = 0xD357;
        wallet = vm.addr(walletKey);
        bytes32 claim = keccak256("original contributor wallet");
        uint64 expiresAt = uint64(block.timestamp + 1 days);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(walletKey, vault.bindingDigest(actor, wallet, 0, claim, expiresAt));
        vm.prank(vm.addr(AUTHORITY_KEY));
        vault.bindDestination(actor, wallet, 0, claim, expiresAt, abi.encodePacked(r, s, v));
        vm.warp(block.timestamp + DELAY + 1);
        vm.prank(SUBMITTER);
        vault.pay(id, 1);
    }

    function test_theNextMonthAdmitsWhileTheLastReserveIsStuck() public {
        uint32[2] memory stuck = [uint32(202612), 202702];
        for (uint256 k; k < 2; ++k) {
            ProjectEscrow target = newVault(keccak256(abi.encode("stuck", k)));
            uint32 period = stuck[k];
            uint32 next = period % 100 == 12 ? period + 89 : period + 1;
            (uint64 opensAt, uint64 closesAt) = target.monthlyWindow(period);
            vm.warp(opensAt);
            reserve(
                target,
                period,
                ProjectEscrow.MonthlyReservation(
                    keccak256("random"), keccak256("random root"), CAP, CAP, 1, target.ordinarySourceSequence()
                )
            );
            (uint64 nextOpens, uint64 nextCloses) = target.monthlyWindow(next);
            require(nextOpens == closesAt && nextCloses <= closesAt + 30 days, "expiry comes too late for next");
            // The next month can use free funds while the earlier reserve stays funded.
            vm.warp(nextCloses - 1);
            ProjectEscrow.MonthlyAward[] memory e = entries(3, k);
            reserve(target, next, plan(target, e, sum(e)));
            require(target.pendingMonthlyGross() == CAP + sum(e), "both reserves held");
            require(target.freeBalance() == 10_000e6 - CAP - sum(e), "each reserved once");
            leaf(target, next, e, 0);
            leaf(target, next, e, 1);
            leaf(target, next, e, 2);
            require(target.pendingMonthlyGross() == CAP, "the stuck remainder stays reserved");
            // Manual awards still wait, so no unproven leaf's source can be consumed by hand.
            bytes32 id = target.awardId(keccak256("manual"));
            vm.prank(OWNER);
            vm.expectRevert(ProjectEscrow.MonthlyLeavesPending.selector);
            target.commitAward(id, 7, 1e6, keccak256("manual"));
        }
    }

    function test_aLegacyMonthlyCommitmentIsNotBlockedByAStuckReserve() public {
        reserve(
            vault,
            PERIOD,
            ProjectEscrow.MonthlyReservation(
                keccak256("random"), keccak256("random root"), CAP, CAP, 1, vault.ordinarySourceSequence()
            )
        );
        vm.warp(NOVEMBER_CLOSES);
        ProjectEscrow.MonthlyAward[] memory e = entries(2, 7);
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(AUTHORITY_KEY, vault.monthlyDigest(NEXT_PERIOD, vault.allocationRoot(e)));
        vm.prank(SUBMITTER);
        vault.commitMonthly(NEXT_PERIOD, e, abi.encodePacked(r, s, v));
        require(vault.freeBalance() == 10_000e6 - CAP - sum(e), "legacy month funded from free balance");
        require(vault.pendingMonthlyGross() == CAP, "stuck reserve unchanged");
    }

    // ------------------------------------------------------------------
    // Signed release of an unsettleable remainder
    // ------------------------------------------------------------------

    function signRelease(ProjectEscrow target, uint256 key, uint32 period, uint128 remaining, uint128 released)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, target.monthlyReleaseDigest(period, remaining, released));
        return abi.encodePacked(r, s, v);
    }

    function stuck(ProjectEscrow target) internal {
        reserve(
            target,
            PERIOD,
            ProjectEscrow.MonthlyReservation(
                keccak256("random"), keccak256("random root"), CAP, CAP, 1, target.ordinarySourceSequence()
            )
        );
    }

    function test_theOwnerReleasesAnUnsettleableReserveOnlyWithAFreshAttestation() public {
        stuck(vault);
        ProjectEscrow other = newVault(keccak256("other"));
        stuck(other);
        bytes32 manual = keccak256("manual");
        bytes32 id = vault.awardId(manual);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.MonthlyLeavesPending.selector);
        vault.commitAward(id, 7, 1e6, manual);
        // Time alone never releases the reserve.
        vm.warp(NOVEMBER_CLOSES + 365 days);
        bytes memory signature = signRelease(vault, AUTHORITY_KEY, PERIOD, CAP, CAP);
        // Only the owner, with the identity authority's signature over this exact state.
        vm.prank(SUBMITTER);
        vm.expectRevert(ProjectEscrow.Unauthorized.selector);
        vault.releaseMonthlyReserve(PERIOD, CAP, CAP, signature);
        vm.prank(vm.addr(AUTHORITY_KEY));
        vm.expectRevert(ProjectEscrow.Unauthorized.selector);
        vault.releaseMonthlyReserve(PERIOD, CAP, CAP, signature);
        bytes memory forged = signRelease(vault, 0xBAD, PERIOD, CAP, CAP);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidAttestation.selector);
        vault.releaseMonthlyReserve(PERIOD, CAP, CAP, forged);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidAttestation.selector);
        vault.releaseMonthlyReserve(PERIOD, CAP, CAP - 1, signature);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.MonthlyReserveChanged.selector);
        vault.releaseMonthlyReserve(PERIOD, CAP - 1, CAP, signature);
        bytes memory excess = signRelease(vault, AUTHORITY_KEY, PERIOD, CAP, CAP + 1);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        vault.releaseMonthlyReserve(PERIOD, CAP, CAP + 1, excess);
        bytes memory unreserved = signRelease(vault, AUTHORITY_KEY, NEXT_PERIOD, 0, 1);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        vault.releaseMonthlyReserve(NEXT_PERIOD, 0, 1, unreserved);
        // Another vault's signature for the same period and amounts does not verify here.
        bytes memory elsewhere = signRelease(other, AUTHORITY_KEY, PERIOD, CAP, CAP);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidAttestation.selector);
        vault.releaseMonthlyReserve(PERIOD, CAP, CAP, elsewhere);
        require(vault.pendingMonthlyGross() == CAP && vault.freeBalance() == 10_000e6 - CAP, "failures move nothing");

        (bytes32 allocationDigest,,,,) = vault.monthlyReserves(PERIOD);
        vm.expectEmit(true, false, false, true, address(vault));
        emit ProjectEscrow.MonthlyReserveReleased(PERIOD, allocationDigest, CAP, CAP);
        vm.prank(OWNER);
        vault.releaseMonthlyReserve(PERIOD, CAP, CAP, signature);
        require(vault.pendingMonthlyGross() == 0 && vault.freeBalance() == 10_000e6, "gross returns to free balance");
        require(vault.monthlyReleased(PERIOD) == CAP, "release recorded");
        (,, uint128 remaining,,) = vault.monthlyReserves(PERIOD);
        require(remaining == 0, "nothing left to settle");
        require(vault.reservedPrincipal() == 0 && vault.reservedFees() == 0 && vault.accruedFees() == 0, "no fee");
        // The same signature cannot release twice, and the period stays committed.
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.MonthlyReserveChanged.selector);
        vault.releaseMonthlyReserve(PERIOD, CAP, CAP, signature);
        require(vault.monthlyRoots(PERIOD) == keccak256("random root"), "period stays committed");
        // Manual awards work again.
        vm.prank(OWNER);
        vault.commitAward(id, 7, 1e6, manual);
    }

    function test_aPartialReleaseKeepsSettleableLeavesPayable() public {
        // The attester signed a tree whose last leaf can never commit (actor 0).
        ProjectEscrow.MonthlyAward[] memory e = entries(3, 0);
        e[2].actorId = 0;
        reserve(vault, PERIOD, plan(vault, e, sum(e)));
        (, ProjectEscrow.AllocationNode[] memory proof) = MonthlyTree.build(e, 2);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        vault.commitMonthlyLeaf(PERIOD, e[2], 2, proof);
        uint128 whole = sum(e);
        bytes memory faulty = signRelease(vault, AUTHORITY_KEY, PERIOD, whole, e[2].gross);
        vm.prank(OWNER);
        vault.releaseMonthlyReserve(PERIOD, whole, e[2].gross, faulty);
        require(vault.pendingMonthlyGross() == e[0].gross + e[1].gross, "settleable leaves stay reserved");
        require(vault.freeBalance() == 10_000e6 - e[0].gross - e[1].gross, "only the faulty gross returns");
        // A release signed before a leaf settles is stale afterwards.
        uint128 left = e[0].gross + e[1].gross;
        bytes memory early = signRelease(vault, AUTHORITY_KEY, PERIOD, left, e[1].gross);
        leaf(vault, PERIOD, e, 0);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.MonthlyReserveChanged.selector);
        vault.releaseMonthlyReserve(PERIOD, left, e[1].gross, early);
        leaf(vault, PERIOD, e, 1);
        require(vault.pendingMonthlyGross() == 0, "every settleable leaf settled");
        require(vault.reservedPrincipal() + vault.reservedFees() == e[0].gross + e[1].gross, "awards reserved");
        bytes32 id = vault.awardId(e[1].sourceDigest);
        address wallet = bindAndPay(id, e[1].actorId);
        require(usdc.balanceOf(wallet) == e[1].gross - vault.payoutFee(e[1].gross), "settled leaf pays exactly");
    }

    function test_aRotatedIdentityAuthoritySignsTheRelease() public {
        stuck(vault);
        bytes memory stale = signRelease(vault, AUTHORITY_KEY, PERIOD, CAP, CAP);
        uint256 nextKey = 0xA08;
        vm.prank(REGISTRAR);
        factory.proposeIdentityAuthority(vm.addr(nextKey));
        factory.executeIdentityAuthorityRotation();
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidAttestation.selector);
        vault.releaseMonthlyReserve(PERIOD, CAP, CAP, stale);
        bytes memory fresh = signRelease(vault, nextKey, PERIOD, CAP, CAP);
        vm.prank(OWNER);
        vault.releaseMonthlyReserve(PERIOD, CAP, CAP, fresh);
        require(vault.pendingMonthlyGross() == 0 && vault.freeBalance() == 10_000e6, "released");
    }
}

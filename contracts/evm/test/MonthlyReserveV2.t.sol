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

/// @dev V2 bounded admission (reserveMonthly), leaf execution (commitMonthlyLeaf) and the stale-reserve
/// expiry (expireMonthlyReserve).
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
    uint64 internal constant NOVEMBER_EXPIRES = NOVEMBER_CLOSES + 30 days;

    event MonthlyReserveExpired(uint32 indexed period, uint128 unsettled);

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
            (,, uint128 remaining,,,) = target.monthlyReserves(PERIOD);
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

    // ------------------------------------------------------------------
    // Stale-reserve expiry
    // ------------------------------------------------------------------

    /// @dev A signed reserve that no leaf can prove (an attester fault or a stolen attester key).
    function unprovable() internal returns (ProjectEscrow.MonthlyReservation memory r) {
        r = ProjectEscrow.MonthlyReservation(
            keccak256("random"), keccak256("random root"), CAP, CAP, 1, vault.ordinarySourceSequence()
        );
        reserve(vault, PERIOD, r);
    }

    function test_anUnprovableReserveBlocksUntilItsGraceThenExpiresOnce() public {
        unprovable();
        uint128 free = vault.freeBalance();
        bytes32 source = keccak256("manual award");
        bytes32 id = vault.awardId(source);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.MonthlyLeavesPending.selector);
        vault.commitAward(id, 7, 5e6, source);
        // Opt-out does not remove the block, and nobody, the owner included, can expire a live reserve.
        vm.prank(OWNER);
        vault.setMonthlyCommitment(CAP, false);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.MonthlyLeavesPending.selector);
        vault.commitAward(id, 7, 5e6, source);
        vm.warp(NOVEMBER_EXPIRES - 1);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.MonthlyWindowClosed.selector);
        vault.expireMonthlyReserve(PERIOD);

        vm.warp(NOVEMBER_EXPIRES);
        vm.expectEmit(true, false, false, true, address(vault));
        emit MonthlyReserveExpired(PERIOD, CAP);
        vm.prank(SUBMITTER);
        vault.expireMonthlyReserve(PERIOD);
        (,,,,, bool expired) = vault.monthlyReserves(PERIOD);
        require(expired, "expired");
        // Time alone never refunds a funded reserve (PRD funded-award expiry).
        require(vault.freeBalance() == free, "remainder stays reserved");
        require(vault.pendingMonthlyGross() == CAP && vault.expiredMonthlyGross() == CAP, "still accounted");
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InsufficientFreeBalance.selector);
        vault.withdrawUnused(free + 1);
        vm.prank(OWNER);
        vault.commitAward(id, 7, 5e6, source);
        // A repeat changes nothing.
        vm.expectRevert(ProjectEscrow.MonthExpired.selector);
        vault.expireMonthlyReserve(PERIOD);
        require(vault.expiredMonthlyGross() == CAP, "counted once");
    }

    function test_expiryNeverReleasesProvenValueAndLeavesStillCommit() public {
        ProjectEscrow.MonthlyAward[] memory e = entries(3, 0);
        uint128 total = sum(e);
        reserve(vault, PERIOD, plan(vault, e, total));
        uint128 free = vault.freeBalance();
        leaf(vault, PERIOD, e, 0);
        uint128 principal = vault.reservedPrincipal();
        vm.warp(NOVEMBER_EXPIRES);
        vault.expireMonthlyReserve(PERIOD);
        require(vault.expiredMonthlyGross() == total - e[0].gross, "only the unproven remainder");
        require(vault.reservedPrincipal() == principal && vault.freeBalance() == free, "proven award unchanged");
        // A later month may admit while the expired remainder waits for its leaves.
        ProjectEscrow.MonthlyAward[] memory next = entries(2, 99);
        reserve(vault, NEXT_PERIOD, plan(vault, next, sum(next)));
        require(vault.pendingMonthlyGross() == total - e[0].gross + sum(next), "both reserves held");
        bytes32 id = vault.awardId(keccak256("x"));
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.MonthlyLeavesPending.selector);
        vault.commitAward(id, 7, 1e6, keccak256("x"));
        // Expired leaves still commit and leave the expired count.
        leaf(vault, PERIOD, e, 1);
        leaf(vault, PERIOD, e, 2);
        require(vault.expiredMonthlyGross() == 0, "expired remainder settled");
        leaf(vault, NEXT_PERIOD, next, 0);
        leaf(vault, NEXT_PERIOD, next, 1);
        require(vault.pendingMonthlyGross() == 0, "all settled");
        require(vault.freeBalance() == free - sum(next), "no gross reserved twice or refunded");
    }

    function test_onlyAV2ReserveExpires() public {
        vm.warp(NOVEMBER_EXPIRES);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        vault.expireMonthlyReserve(PERIOD);
    }
}

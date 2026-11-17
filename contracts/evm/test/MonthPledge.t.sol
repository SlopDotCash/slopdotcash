// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {DeployFactory} from "./DeployFactory.sol";
import {MonthlyTree} from "./MonthlyTree.sol";

import {EscrowFactory, IERC20, ProjectEscrow, Purpose} from "../src/ProjectEscrow.sol";
import {TestDollar} from "../integration/TestDollar.sol";

interface PledgeVm {
    function prank(address) external;
    function warp(uint256) external;
    function expectRevert(bytes4) external;
    function expectEmit(bool, bool, bool, bool, address) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (PledgeVmLog[] memory);
    function load(address, bytes32) external view returns (bytes32);
    function store(address, bytes32, bytes32) external;
    function addr(uint256) external pure returns (address);
    function sign(uint256, bytes32) external pure returns (uint8, bytes32, bytes32);
}

struct PledgeVmLog {
    bytes32[] topics;
    bytes data;
    address emitter;
}

/// @dev The owner's irrevocable month pledge: what it holds, what it unlocks, and how it ends. Each test of a
/// route that worked before pledges shows the same call failing once the month is pledged.
contract MonthPledgeTest {
    PledgeVm internal constant vm = PledgeVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant AUTHORITY_KEY = 0xA07;
    address internal constant OWNER = address(0xA11CE);
    address internal constant ANYONE = address(0x5B);
    address internal constant FEE = address(0xFEE);
    address internal constant REGISTRAR = address(0x5E6);
    uint64 internal constant DELAY = 0;
    uint128 internal constant CAP = 1_000e6;
    uint128 internal constant FUNDS = 10_000e6;

    uint32 internal constant OCT = 202610;
    uint32 internal constant NOV = 202611;
    uint32 internal constant DEC = 202612;
    uint32 internal constant JAN = 202701;
    uint32 internal constant FEB = 202702;
    uint32 internal constant OCT_2027 = 202710;
    uint32 internal constant NOV_2027 = 202711;

    /// @dev 00:00 UTC on 1 November 2026, 1 December 2026 and 1 January 2027.
    uint64 internal constant NOV_START = 1_793_491_200;
    uint64 internal constant DEC_START = 1_796_083_200;
    uint64 internal constant JAN_START = 1_798_761_600;
    /// @dev November's commit window: 00:00 UTC on 4 December 2026 to 00:00 UTC on 4 January 2027.
    uint64 internal constant NOV_OPENS = DEC_START + 72 hours;
    uint64 internal constant NOV_CLOSES = JAN_START + 72 hours;

    event MonthPledged(uint32 indexed period, uint128 amount);
    event PledgeClosed(uint32 indexed period, uint128 amount, bool reserved);

    TestDollar internal usdc;
    EscrowFactory internal factory;
    ProjectEscrow internal vault;

    function setUp() public {
        vm.warp(NOV_START + 9 days);
        usdc = new TestDollar();
        factory = DeployFactory.create(REGISTRAR, FEE, vm.addr(AUTHORITY_KEY), DELAY);
        vault = newVault(keccak256("project"), Purpose.Ordinary);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function newVault(bytes32 project, Purpose purpose) internal returns (ProjectEscrow created) {
        vm.prank(OWNER);
        created = ProjectEscrow(factory.create(project, IERC20(address(usdc)), purpose));
        usdc.mint(OWNER, FUNDS);
        vm.prank(OWNER);
        usdc.approve(address(created), type(uint256).max);
        vm.prank(OWNER);
        created.deposit(FUNDS);
        if (purpose == Purpose.Ordinary) {
            vm.prank(OWNER);
            created.setMonthlyCommitment(CAP, true);
        }
    }

    function pledge(uint32 fromPeriod, uint8 count, uint128 amount) internal {
        vm.prank(OWNER);
        vault.pledgeMonths(fromPeriod, count, amount);
    }

    function pledged(uint32 period) internal view returns (uint128 amount, bool open) {
        return vault.monthPledges(period);
    }

    function entries(uint128 gross, uint256 count, uint256 salt)
        internal
        pure
        returns (ProjectEscrow.MonthlyAward[] memory e)
    {
        e = new ProjectEscrow.MonthlyAward[](count);
        for (uint256 i; i < count; ++i) {
            e[i] = ProjectEscrow.MonthlyAward(uint64(100 + i), gross, keccak256(abi.encode("source", salt, i)));
        }
    }

    function plan(ProjectEscrow target, ProjectEscrow.MonthlyAward[] memory e, uint128 wholeGross)
        internal
        view
        returns (ProjectEscrow.MonthlyReservation memory)
    {
        (ProjectEscrow.AllocationNode memory root,) = MonthlyTree.build(e, 0);
        return ProjectEscrow.MonthlyReservation(
            keccak256(abi.encode("frozen allocation", e.length)),
            root.hash,
            wholeGross,
            root.total,
            uint32(e.length),
            target.ordinarySourceSequence()
        );
    }

    function reservation(ProjectEscrow target, uint128 gross)
        internal
        view
        returns (ProjectEscrow.MonthlyReservation memory)
    {
        ProjectEscrow.MonthlyAward[] memory e = entries(gross, 1, gross);
        return plan(target, e, gross);
    }

    function signReserve(ProjectEscrow target, uint32 period, ProjectEscrow.MonthlyReservation memory r)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(AUTHORITY_KEY, target.monthlyReserveDigest(period, r));
        return abi.encodePacked(rr, s, v);
    }

    function reserve(ProjectEscrow target, uint32 period, uint128 gross) internal {
        ProjectEscrow.MonthlyReservation memory r = reservation(target, gross);
        bytes memory signature = signReserve(target, period, r);
        vm.prank(ANYONE);
        target.reserveMonthly(period, r, signature);
    }

    function expectReserveRevert(ProjectEscrow target, uint32 period, uint128 gross, bytes4 selector) internal {
        ProjectEscrow.MonthlyReservation memory r = reservation(target, gross);
        bytes memory signature = signReserve(target, period, r);
        vm.prank(ANYONE);
        vm.expectRevert(selector);
        target.reserveMonthly(period, r, signature);
    }

    function signLegacy(ProjectEscrow target, uint32 period, ProjectEscrow.MonthlyAward[] memory e)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(AUTHORITY_KEY, target.monthlyDigest(period, target.allocationRoot(e)));
        return abi.encodePacked(r, s, v);
    }

    function withdraw(uint128 gross) internal {
        vm.prank(OWNER);
        vault.withdrawUnused(gross);
    }

    function expectWithdrawRevert(uint128 gross, bytes4 selector) internal {
        vm.prank(OWNER);
        vm.expectRevert(selector);
        vault.withdrawUnused(gross);
    }

    function check(bool ok, string memory why) internal pure {
        require(ok, why);
    }

    // ------------------------------------------------------------------
    // currentPeriod
    // ------------------------------------------------------------------

    function test_currentPeriodAtMonthBoundaries() public {
        vm.warp(NOV_START - 1);
        check(vault.currentPeriod() == OCT, "last second of October");
        vm.warp(NOV_START);
        check(vault.currentPeriod() == NOV, "first second of November");
        vm.warp(JAN_START - 1);
        check(vault.currentPeriod() == DEC, "last second of 2026");
        vm.warp(JAN_START);
        check(vault.currentPeriod() == JAN, "first second of 2027");
        // 29 February 2028 and 1 March 2028.
        vm.warp(1_835_395_200);
        check(vault.currentPeriod() == 202802, "leap day");
        vm.warp(1_835_481_600 - 1);
        check(vault.currentPeriod() == 202802, "last second of a leap February");
        vm.warp(1_835_481_600);
        check(vault.currentPeriod() == 202803, "first second of March after a leap day");
        // 1 March 2100 is not preceded by a leap day.
        vm.warp(4_107_542_400);
        check(vault.currentPeriod() == 210003, "1 March 2100");
        vm.warp(4_107_542_400 - 1);
        check(vault.currentPeriod() == 210002, "28 February 2100");
    }

    /// @dev currentPeriod is the inverse of the month starts that monthlyWindow already uses.
    function testFuzz_currentPeriodMatchesMonthlyWindow(uint64 timestamp) public {
        // From 1 March 2000 to the end of 9997, so the period two months back and one ahead are valid.
        timestamp = uint64(951_868_800 + uint256(timestamp) % (253_339_200_000 - 951_868_800));
        vm.warp(timestamp);
        uint32 period = vault.currentPeriod();
        uint32 twoBack = period % 100 > 2 ? period - 2 : period - 100 + 10;
        (, uint64 startPlus72) = vault.monthlyWindow(twoBack);
        (uint64 nextStartPlus72,) = vault.monthlyWindow(period);
        check(startPlus72 - 72 hours <= timestamp, "period started");
        check(timestamp < nextStartPlus72 - 72 hours, "next period not started");
    }

    // ------------------------------------------------------------------
    // pledgeMonths
    // ------------------------------------------------------------------

    function test_pledgeSeveralMonthsInOneCallAcrossTheYearEnd() public {
        vm.expectEmit(true, false, false, true, address(vault));
        emit MonthPledged(DEC, 1_000e6);
        vm.expectEmit(true, false, false, true, address(vault));
        emit MonthPledged(JAN, 1_000e6);
        vm.expectEmit(true, false, false, true, address(vault));
        emit MonthPledged(FEB, 1_000e6);
        pledge(DEC, 3, 1_000e6);
        check(vault.openPledgedGross() == 3_000e6, "three months open");
        uint32[3] memory months = [DEC, JAN, FEB];
        for (uint256 i; i < 3; ++i) {
            (uint128 amount, bool open) = pledged(months[i]);
            check(amount == 1_000e6 && open, "each month pledged");
        }
        (uint128 none, bool novOpen) = pledged(NOV);
        check(none == 0 && !novOpen, "November untouched");
        check(vault.freeBalance() == FUNDS, "a pledge moves no funds");
    }

    function test_pledgeOnlyWhatIsThere() public {
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InsufficientFreeBalance.selector);
        vault.pledgeMonths(NOV, 11, 1_000e6);
        pledge(NOV, 10, 1_000e6);
        check(vault.openPledgedGross() == FUNDS, "every free unit pledged");
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InsufficientFreeBalance.selector);
        vault.pledgeMonths(NOV_2027 - 1, 1, 1);
        // A deposit from anyone makes room for more.
        usdc.mint(ANYONE, 1);
        vm.prank(ANYONE);
        usdc.approve(address(vault), 1);
        vm.prank(ANYONE);
        vault.deposit(1);
        pledge(OCT_2027, 1, 1);
        check(vault.openPledgedGross() == FUNDS + 1, "deposit pledged");
    }

    function test_pledgeIsRaiseOnly() public {
        pledge(DEC, 1, 1_000e6);
        // Equal: unchanged and silent.
        vm.recordLogs();
        pledge(DEC, 1, 1_000e6);
        check(vm.getRecordedLogs().length == 0, "an equal pledge emits nothing");
        check(vault.openPledgedGross() == 1_000e6, "an equal pledge adds nothing");
        // Lower: refused, for this and any later month in the same call.
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.PledgeTooLow.selector);
        vault.pledgeMonths(DEC, 1, 999e6);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.PledgeTooLow.selector);
        vault.pledgeMonths(NOV, 3, 500e6);
        // Raise December and open January in one call: only the differences are added.
        vm.expectEmit(true, false, false, true, address(vault));
        emit MonthPledged(DEC, 1_200e6);
        vm.expectEmit(true, false, false, true, address(vault));
        emit MonthPledged(JAN, 1_200e6);
        pledge(DEC, 2, 1_200e6);
        check(vault.openPledgedGross() == 2_400e6, "raised by the difference only");
        (uint128 amount, bool open) = pledged(DEC);
        check(amount == 1_200e6 && open, "December raised");
    }

    function test_pledgeRefusesBadInputs() public {
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        vault.pledgeMonths(OCT, 1, 1); // the past
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        vault.pledgeMonths(NOV, 0, 1);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        vault.pledgeMonths(NOV, 13, 1);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        vault.pledgeMonths(NOV, 1, 0);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        vault.pledgeMonths(202613, 1, 1); // not a month
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        vault.pledgeMonths(NOV_2027, 1, 1); // twelve months ahead
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        vault.pledgeMonths(OCT_2027, 2, 1); // runs into the twelfth month ahead
        // The whole span from the current month to eleven months ahead is accepted.
        pledge(NOV, 12, 1);
        (, bool lastOpen) = pledged(OCT_2027);
        check(lastOpen && vault.openPledgedGross() == 12, "twelve months from now");
    }

    function test_onlyTheOwnerPledges() public {
        address[3] memory others = [ANYONE, vm.addr(AUTHORITY_KEY), FEE];
        for (uint256 i; i < others.length; ++i) {
            vm.prank(others[i]);
            vm.expectRevert(ProjectEscrow.Unauthorized.selector);
            vault.pledgeMonths(DEC, 1, 1);
        }
    }

    function test_bountyVaultRefusesPledges() public {
        ProjectEscrow bounty = newVault(keccak256("bounty"), Purpose.Bounty);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.WrongPurpose.selector);
        bounty.pledgeMonths(DEC, 1, 1);
        vm.expectRevert(ProjectEscrow.WrongPurpose.selector);
        bounty.expirePledge(DEC);
        // A bounty award still commits as before.
        bytes32 bountyId = bounty.awardId(keccak256("b"));
        vm.prank(OWNER);
        bounty.commitBountyAward(bountyId, 7, 400e6, keccak256("b"));
        check(bounty.openPledgedGross() == 0 && bounty.freeBalance() == FUNDS - 400e6, "bounty unchanged");
    }

    /// @dev Unreachable through the window rules (a period reserves only after it ends), kept as a guard.
    function test_aReservedPeriodCannotBePledged() public {
        // monthlyRoots is slot 17 (forge inspect ProjectEscrow storage-layout).
        vm.store(address(vault), keccak256(abi.encode(uint256(DEC), uint256(17))), bytes32(uint256(1)));
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.MonthlyAlreadyCommitted.selector);
        vault.pledgeMonths(NOV, 2, 1);
        check(vault.openPledgedGross() == 0, "nothing pledged");
    }

    // ------------------------------------------------------------------
    // Off-chain route closed: direct withdrawal during the month
    // ------------------------------------------------------------------

    function test_withdrawalCannotReachPledgedFunds() public {
        // Without a pledge the owner can empty the vault mid-month, as before.
        ProjectEscrow unpledged = newVault(keccak256("unpledged"), Purpose.Ordinary);
        vm.prank(OWNER);
        unpledged.withdrawUnused(FUNDS);
        check(unpledged.freeBalance() == 0, "unpledged vault empties");

        pledge(NOV, 2, 4_000e6);
        expectWithdrawRevert(FUNDS, ProjectEscrow.PledgedFunds.selector);
        expectWithdrawRevert(2_000e6 + 1, ProjectEscrow.PledgedFunds.selector);
        expectWithdrawRevert(FUNDS + 1, ProjectEscrow.InsufficientFreeBalance.selector);
        withdraw(2_000e6);
        check(vault.freeBalance() == 8_000e6 && vault.openPledgedGross() == 8_000e6, "only unpledged funds left");
        expectWithdrawRevert(1, ProjectEscrow.PledgedFunds.selector);
    }

    // ------------------------------------------------------------------
    // Off-chain route closed: monthly turned off or the cap cut before the reserve
    // ------------------------------------------------------------------

    function test_turningMonthlyOffCannotStopAPledgedMonth() public {
        ProjectEscrow unpledged = newVault(keccak256("unpledged"), Purpose.Ordinary);
        pledge(NOV, 2, 1_000e6);
        vm.prank(OWNER);
        vault.setMonthlyCommitment(CAP, false);
        vm.prank(OWNER);
        unpledged.setMonthlyCommitment(CAP, false);

        vm.warp(NOV_OPENS);
        expectReserveRevert(unpledged, NOV, 900e6, ProjectEscrow.MonthlyDisabled.selector);
        vm.expectEmit(true, false, false, true, address(vault));
        emit PledgeClosed(NOV, 1_000e6, true);
        reserve(vault, NOV, 900e6);
        check(vault.pendingMonthlyGross() == 900e6, "pledged November reserved with monthly off");
        check(vault.openPledgedGross() == 1_000e6, "only December stays pledged");
        (uint128 amount, bool open) = pledged(NOV);
        check(amount == 1_000e6 && !open, "November's pledge closed");
        // The 100e6 pledged above the reserve returns to unpledged free funds.
        check(vault.freeBalance() == FUNDS - 900e6, "reserve leaves free funds");
        withdraw(FUNDS - 900e6 - 1_000e6);
        expectWithdrawRevert(1, ProjectEscrow.PledgedFunds.selector);
    }

    function test_cuttingTheCapCannotShrinkAPledgedMonth() public {
        pledge(NOV, 1, 1_000e6);
        vm.prank(OWNER);
        vault.setMonthlyCommitment(100e6, true);
        vm.warp(NOV_OPENS);
        // The pledge, not the lowered cap, bounds the pledged month.
        expectReserveRevert(vault, NOV, 1_000e6 + 1, ProjectEscrow.MonthlyCapExceeded.selector);
        reserve(vault, NOV, 1_000e6);
        check(vault.pendingMonthlyGross() == 1_000e6 && vault.openPledgedGross() == 0, "full pledge reserved");
    }

    function test_aPledgeBelowTheCapKeepsTheCap() public {
        pledge(NOV, 1, 500e6);
        vm.warp(NOV_OPENS);
        expectReserveRevert(vault, NOV, CAP + 1, ProjectEscrow.MonthlyCapExceeded.selector);
        reserve(vault, NOV, CAP);
        check(vault.pendingMonthlyGross() == CAP && vault.openPledgedGross() == 0, "cap applies above the pledge");
    }

    function test_unpledgedMonthsStillFollowTheSwitch() public {
        pledge(NOV, 1, 1_000e6);
        vm.prank(OWNER);
        vault.setMonthlyCommitment(CAP, false);
        vm.warp(NOV_CLOSES);
        // November lapsed unreserved; December was never pledged, so monthly off stops it.
        expectReserveRevert(vault, DEC, 500e6, ProjectEscrow.MonthlyDisabled.selector);
    }

    function test_legacyMonthlyCommitHonoursThePledge() public {
        pledge(NOV, 1, 2_000e6);
        vm.prank(OWNER);
        vault.setMonthlyCommitment(0, false);
        vm.warp(NOV_OPENS);
        ProjectEscrow.MonthlyAward[] memory e = entries(750e6, 2, 1);
        bytes memory signature = signLegacy(vault, NOV, e);
        vm.expectEmit(true, false, false, true, address(vault));
        emit PledgeClosed(NOV, 2_000e6, true);
        vm.prank(ANYONE);
        vault.commitMonthly(NOV, e, signature);
        check(vault.freeBalance() == FUNDS - 1_500e6 && vault.openPledgedGross() == 0, "committed from the pledge");
        check(vault.reservedPrincipal() + vault.reservedFees() == 1_500e6, "awards recorded");
    }

    function test_legacyMonthlyCommitStaysWithinItsPledge() public {
        pledge(NOV, 1, 1_000e6);
        vm.prank(OWNER);
        vault.setMonthlyCommitment(0, false);
        vm.warp(NOV_OPENS);
        ProjectEscrow.MonthlyAward[] memory e = entries(600e6, 2, 2);
        bytes memory signature = signLegacy(vault, NOV, e);
        vm.prank(ANYONE);
        vm.expectRevert(ProjectEscrow.MonthlyCapExceeded.selector);
        vault.commitMonthly(NOV, e, signature);
    }

    // ------------------------------------------------------------------
    // Off-chain route closed: one month's reserve eating another month's pledge
    // ------------------------------------------------------------------

    function test_aReserveNeverEatsAnotherMonthsPledge() public {
        vm.prank(OWNER);
        vault.setMonthlyCommitment(2_000e6, true);
        pledge(NOV, 1, 1_000e6);
        pledge(DEC, 1, 9_000e6);
        vm.warp(NOV_OPENS);
        // November may reserve its own pledge, not December's.
        expectReserveRevert(vault, NOV, 1_000e6 + 1, ProjectEscrow.PledgedFunds.selector);
        reserve(vault, NOV, 1_000e6);
        check(vault.freeBalance() == 9_000e6 && vault.openPledgedGross() == 9_000e6, "December intact");
    }

    function test_anUnpledgedMonthNeverEatsAPledge() public {
        pledge(DEC, 1, 9_500e6);
        vm.warp(NOV_OPENS);
        expectReserveRevert(vault, NOV, 501e6, ProjectEscrow.PledgedFunds.selector);
        reserve(vault, NOV, 500e6);
        check(vault.freeBalance() == 9_500e6 && vault.openPledgedGross() == 9_500e6, "December intact");
    }

    function test_legacyCommitNeverEatsAnotherMonthsPledge() public {
        pledge(DEC, 1, 9_500e6);
        vm.warp(NOV_OPENS);
        ProjectEscrow.MonthlyAward[] memory e = entries(300e6, 2, 3);
        bytes memory signature = signLegacy(vault, NOV, e);
        vm.prank(ANYONE);
        vm.expectRevert(ProjectEscrow.PledgedFunds.selector);
        vault.commitMonthly(NOV, e, signature);
        e = entries(250e6, 2, 4);
        signature = signLegacy(vault, NOV, e);
        vm.prank(ANYONE);
        vault.commitMonthly(NOV, e, signature);
        check(vault.freeBalance() == 9_500e6, "only unpledged funds committed");
    }

    // ------------------------------------------------------------------
    // Owner awards by hand use only unpledged funds
    // ------------------------------------------------------------------

    function test_ownerCommitAwardUsesOnlyUnpledgedFunds() public {
        pledge(NOV, 3, 3_000e6);
        bytes32 source = keccak256("by hand");
        bytes32 id = vault.awardId(source);
        vm.prank(OWNER);
        vault.commitAward(id, 9, 1_000e6, source);
        bytes32 over = keccak256("over");
        bytes32 overId = vault.awardId(over);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.PledgedFunds.selector);
        vault.commitAward(overId, 9, 1, over);
        check(vault.freeBalance() == 9_000e6 && vault.openPledgedGross() == 9_000e6, "pledges intact");
    }

    // ------------------------------------------------------------------
    // Owner awards cannot make a pledged reservation stale
    // ------------------------------------------------------------------

    /// @dev Review finding: each owner award moved ordinarySourceSequence, so an owner could refresh it
    /// before every signed reservation landed until the pledge lapsed, then withdraw everything.
    function test_ownerCannotStarveAPledgedMonth() public {
        pledge(NOV, 1, FUNDS);
        vm.prank(OWNER);
        vault.setMonthlyCommitment(CAP, false);
        vm.warp(NOV_OPENS);
        ProjectEscrow.MonthlyReservation memory r = reservation(vault, 900e6);
        bytes memory signature = signReserve(vault, NOV, r);
        usdc.mint(OWNER, 1);
        vm.prank(OWNER);
        vault.deposit(1);
        bytes32 source = keccak256("owner bump");
        bytes32 id = vault.awardId(source);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.PledgedMonthOpen.selector);
        vault.commitAward(id, 777, 1, source);
        // The reservation signed before the attempt still lands.
        vm.prank(ANYONE);
        vault.reserveMonthly(NOV, r, signature);
        check(vault.pendingMonthlyGross() == 900e6 && vault.openPledgedGross() == 0, "pledged month reserved");
        // Once the month is reserved and its leaf proven, awards by hand work again.
        ProjectEscrow.MonthlyAward[] memory e = entries(900e6, 1, 900e6);
        (, ProjectEscrow.AllocationNode[] memory proof) = MonthlyTree.build(e, 0);
        vault.commitMonthlyLeaf(NOV, e[0], 0, proof);
        vm.prank(OWNER);
        vault.commitAward(id, 777, 1, source);
    }

    function test_ownerAwardsOnlyStopWhileThePledgedWindowIsOpen() public {
        pledge(NOV, 2, 1_000e6);
        // During November the open window is October's, which has no pledge.
        bytes32 first = keccak256("in november");
        bytes32 firstId = vault.awardId(first);
        vm.prank(OWNER);
        vault.commitAward(firstId, 9, 1e6, first);
        // Last second before November's window opens, then the first second inside it.
        vm.warp(NOV_OPENS - 1);
        bytes32 second = keccak256("before the window");
        bytes32 secondId = vault.awardId(second);
        vm.prank(OWNER);
        vault.commitAward(secondId, 9, 1e6, second);
        vm.warp(NOV_OPENS);
        bytes32 third = keccak256("inside the window");
        bytes32 thirdId = vault.awardId(third);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.PledgedMonthOpen.selector);
        vault.commitAward(thirdId, 9, 1e6, third);
        // An unpledged vault is unaffected at the same moment.
        ProjectEscrow unpledged = newVault(keccak256("unpledged"), Purpose.Ordinary);
        bytes32 otherId = unpledged.awardId(third);
        vm.prank(OWNER);
        unpledged.commitAward(otherId, 9, 1e6, third);
        // November lapses unreserved; December's window is then open and December is pledged.
        vm.warp(NOV_CLOSES);
        vault.expirePledge(NOV);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.PledgedMonthOpen.selector);
        vault.commitAward(thirdId, 9, 1e6, third);
    }

    // ------------------------------------------------------------------
    // With monthly off, the pledge alone is the cap
    // ------------------------------------------------------------------

    /// @dev Review finding: with monthly off, a 1-unit pledge reopened the whole stale monthlyCap.
    function test_withMonthlyOffThePledgeAloneIsTheCap() public {
        vm.prank(OWNER);
        vault.setMonthlyCommitment(CAP, false);
        pledge(NOV, 1, 1);
        vm.warp(NOV_OPENS);
        expectReserveRevert(vault, NOV, CAP, ProjectEscrow.MonthlyCapExceeded.selector);
        expectReserveRevert(vault, NOV, 2, ProjectEscrow.MonthlyCapExceeded.selector);
        reserve(vault, NOV, 1);
        check(vault.pendingMonthlyGross() == 1 && vault.openPledgedGross() == 0, "one unit reserved");
    }

    function test_withMonthlyOffTheLegacyCommitIsCappedAtThePledge() public {
        vm.prank(OWNER);
        vault.setMonthlyCommitment(CAP, false);
        pledge(NOV, 1, 400e6);
        vm.warp(NOV_OPENS);
        ProjectEscrow.MonthlyAward[] memory e = entries(201e6, 2, 6);
        bytes memory signature = signLegacy(vault, NOV, e);
        vm.prank(ANYONE);
        vm.expectRevert(ProjectEscrow.MonthlyCapExceeded.selector);
        vault.commitMonthly(NOV, e, signature);
    }

    // ------------------------------------------------------------------
    // Lapse
    // ------------------------------------------------------------------

    function test_aPledgeLapsesOnlyAfterTheWindowCloses() public {
        pledge(NOV, 1, 4_000e6);
        vm.warp(NOV_CLOSES - 1);
        vm.prank(ANYONE);
        vm.expectRevert(ProjectEscrow.PledgeNotLapsed.selector);
        vault.expirePledge(NOV);
        expectWithdrawRevert(FUNDS, ProjectEscrow.PledgedFunds.selector);

        vm.warp(NOV_CLOSES);
        expectReserveRevert(vault, NOV, 100e6, ProjectEscrow.MonthlyWindowClosed.selector);
        vm.expectEmit(true, false, false, true, address(vault));
        emit PledgeClosed(NOV, 4_000e6, false);
        vm.prank(ANYONE);
        vault.expirePledge(NOV);
        check(vault.openPledgedGross() == 0, "nothing pledged");
        (uint128 amount, bool open) = pledged(NOV);
        check(amount == 4_000e6 && !open, "pledge closed, amount kept for the record");
        vm.prank(ANYONE);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        vault.expirePledge(NOV);
        withdraw(FUNDS);
        check(vault.freeBalance() == 0, "lapsed funds back to the owner");
    }

    function test_onlyAnOpenPledgeExpires() public {
        vm.warp(NOV_CLOSES);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        vault.expirePledge(NOV);
    }

    function test_aReservedPledgeCannotExpire() public {
        pledge(NOV, 1, 1_000e6);
        vm.warp(NOV_OPENS);
        reserve(vault, NOV, 1_000e6);
        vm.warp(NOV_CLOSES);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        vault.expirePledge(NOV);
    }

    function test_aLapsedPeriodCannotBePledgedAgain() public {
        pledge(NOV, 1, 1);
        vm.warp(NOV_CLOSES);
        vault.expirePledge(NOV);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        vault.pledgeMonths(NOV, 1, 2);
    }

    // ------------------------------------------------------------------
    // Paths a pledge does not touch
    // ------------------------------------------------------------------

    function test_pledgesLeaveDepositsLeavesPaymentsAndReleasesAlone() public {
        pledge(NOV, 1, 1_000e6);
        vm.warp(NOV_OPENS);
        ProjectEscrow.MonthlyAward[] memory e = entries(400e6, 2, 5);
        ProjectEscrow.MonthlyReservation memory r = plan(vault, e, 800e6);
        bytes memory signature = signReserve(vault, NOV, r);
        vm.prank(ANYONE);
        vault.reserveMonthly(NOV, r, signature);
        // Pledge every remaining free unit for later months.
        pledge(DEC, 2, 4_600e6);
        check(vault.freeBalance() == vault.openPledgedGross(), "fully pledged");
        // A leaf, a release and a fee claim still work: none of them draws on free funds.
        (, ProjectEscrow.AllocationNode[] memory proof) = MonthlyTree.build(e, 0);
        vault.commitMonthlyLeaf(NOV, e[0], 0, proof);
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(AUTHORITY_KEY, vault.monthlyReleaseDigest(NOV, 400e6, 400e6));
        vm.prank(OWNER);
        vault.releaseMonthlyReserve(NOV, 400e6, 400e6, abi.encodePacked(rr, s, v));
        check(vault.freeBalance() == 9_600e6 && vault.openPledgedGross() == 9_200e6, "release adds free funds");
        withdraw(400e6);
        expectWithdrawRevert(1, ProjectEscrow.PledgedFunds.selector);
        vault.claimFees();
    }

    // ------------------------------------------------------------------
    // Upgrade compatibility
    // ------------------------------------------------------------------

    /// @dev The new fields are appended after monthlyReleased (slot 21): monthPledges is slot 22 and
    /// openPledgedGross slot 23, so an upgraded vault reads zero for both and behaves as before.
    function test_pledgeStorageIsAppended() public {
        check(vm.load(address(vault), bytes32(uint256(23))) == bytes32(0), "a vault starts with nothing pledged");
        pledge(DEC, 1, 7e6);
        check(uint256(vm.load(address(vault), bytes32(uint256(23)))) == 7e6, "openPledgedGross in slot 23");
        bytes32 entry = keccak256(abi.encode(uint256(DEC), uint256(22)));
        check(uint256(vm.load(address(vault), entry)) == (uint256(1) << 128) | 7e6, "monthPledges in slot 22");
        // freeBalance keeps slot 5, low half.
        check(uint128(uint256(vm.load(address(vault), bytes32(uint256(5))))) == FUNDS, "freeBalance slot unchanged");
    }

    function test_withNoPledgeEveryOldRuleHolds() public {
        vm.prank(OWNER);
        vault.setMonthlyCommitment(CAP, false);
        vm.warp(NOV_OPENS);
        expectReserveRevert(vault, NOV, 1, ProjectEscrow.MonthlyDisabled.selector);
        vm.prank(OWNER);
        vault.setMonthlyCommitment(CAP, true);
        expectReserveRevert(vault, NOV, CAP + 1, ProjectEscrow.MonthlyCapExceeded.selector);
        reserve(vault, NOV, CAP);
        withdraw(FUNDS - CAP);
        check(vault.freeBalance() == 0 && vault.openPledgedGross() == 0, "free funds fully withdrawable");
    }
}

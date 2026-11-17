// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {DeployFactory} from "./DeployFactory.sol";
import {MonthlyTree} from "./MonthlyTree.sol";

import {EscrowFactory, IERC20, ProjectEscrow, Purpose} from "../src/ProjectEscrow.sol";
import {TestDollar} from "../integration/TestDollar.sol";

interface PledgeInvariantVm {
    function prank(address) external;
    function warp(uint256) external;
    function addr(uint256) external pure returns (address);
    function sign(uint256, bytes32) external pure returns (uint8, bytes32, bytes32);
}

/// @dev Random owner, depositor, executor and passer-by sequences against one vault with pledges. Calls that
/// the contract refuses are allowed; the invariants check every state a successful call leaves behind.
contract PledgeHandler {
    PledgeInvariantVm internal constant vm = PledgeInvariantVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant MAX = 50_000e6;

    ProjectEscrow public escrow;
    TestDollar public usdc;
    address public owner;
    uint256 internal authorityKey;
    uint256 internal nonce;

    /// @dev Every period that ever held a pledge.
    uint32[] public touched;
    mapping(uint32 => bool) internal seen;
    /// @dev Set when the executor's reserve of an open pledge, within the pledge, was refused.
    bool public pledgedReserveRefused;
    uint256 public ghostUnsettled;
    /// @dev Successful calls, so a campaign can show it reached the pledged paths.
    uint256 public pledges;
    uint256 public pledgedReserves;
    uint256 public expiries;

    constructor(ProjectEscrow escrow_, TestDollar usdc_, address owner_, uint256 authorityKey_) {
        escrow = escrow_;
        usdc = usdc_;
        owner = owner_;
        authorityKey = authorityKey_;
    }

    function touchedLength() external view returns (uint256) {
        return touched.length;
    }

    function deposit(uint256 amount) external {
        amount = 1 + amount % MAX;
        usdc.mint(owner, amount);
        vm.prank(owner);
        escrow.deposit(uint128(amount));
    }

    function pledge(uint256 offset, uint256 count, uint256 amount) external {
        uint256 index = toIndex(escrow.currentPeriod()) + offset % 13;
        count = 1 + count % 12;
        // Mostly within the unpledged free funds; one call in four tries any amount and is usually refused.
        uint256 room = (escrow.freeBalance() - escrow.openPledgedGross()) / count;
        amount = amount % 4 == 0 || room == 0 ? 1 + amount % MAX : 1 + (amount >> 2) % room;
        vm.prank(owner);
        try escrow.pledgeMonths(fromIndex(index), uint8(count), uint128(amount)) {
            for (uint256 i; i < count; ++i) {
                uint32 period = fromIndex(index + i);
                if (!seen[period]) {
                    seen[period] = true;
                    touched.push(period);
                }
            }
            ++pledges;
        } catch {}
    }

    function withdraw(uint256 gross) external {
        uint128 free = escrow.freeBalance();
        if (free == 0) return;
        vm.prank(owner);
        try escrow.withdrawUnused(uint128(1 + gross % free)) {} catch {}
    }

    function commitAward(uint256 gross) external {
        uint128 free = escrow.freeBalance();
        if (free == 0) return;
        bytes32 source = keccak256(abi.encode("hand", nonce++));
        bytes32 id = escrow.awardId(source);
        vm.prank(owner);
        try escrow.commitAward(id, uint64(1 + nonce % 5), uint128(1 + gross % free), source) {} catch {}
    }

    function setMonthly(uint256 cap, bool enabled) external {
        cap = cap % (MAX * 2);
        if (enabled && cap == 0) cap = 1;
        vm.prank(owner);
        escrow.setMonthlyCommitment(uint128(cap), enabled);
    }

    /// @dev The executor reserves the open period. Within an open pledge it must always succeed.
    function reserve(uint256 gross, uint256 width) external {
        uint32 period = openPeriod();
        if (period == 0 || escrow.monthlyRoots(period) != bytes32(0)) return;
        (uint128 pledgeAmount, bool open) = escrow.monthPledges(period);
        uint256 n = 1 + width % 4;
        uint256 each = 1 + gross % (open ? pledgeAmount / n + 1 : MAX);
        if (open && each * n > pledgeAmount) each = pledgeAmount / n;
        if (each == 0) return;
        ProjectEscrow.MonthlyAward[] memory entries = new ProjectEscrow.MonthlyAward[](n);
        for (uint256 i; i < n; ++i) {
            entries[i] =
                ProjectEscrow.MonthlyAward(uint64(1 + i), uint128(each), keccak256(abi.encode("reserve", nonce++)));
        }
        (ProjectEscrow.AllocationNode memory root,) = MonthlyTree.build(entries, 0);
        ProjectEscrow.MonthlyReservation memory r = ProjectEscrow.MonthlyReservation(
            keccak256(abi.encode("allocation", period)),
            root.hash,
            root.total,
            root.total,
            uint32(n),
            escrow.ordinarySourceSequence()
        );
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(authorityKey, escrow.monthlyReserveDigest(period, r));
        try escrow.reserveMonthly(period, r, abi.encodePacked(rr, s, v)) {
            ghostUnsettled += root.total;
            if (open) ++pledgedReserves;
        } catch {
            if (open) pledgedReserveRefused = true;
        }
    }

    /// @dev The legacy V1 commitment of the open period.
    function commitMonthly(uint256 gross) external {
        uint32 period = openPeriod();
        if (period == 0 || escrow.monthlyRoots(period) != bytes32(0)) return;
        ProjectEscrow.MonthlyAward[] memory entries = new ProjectEscrow.MonthlyAward[](2);
        for (uint256 i; i < 2; ++i) {
            entries[i] = ProjectEscrow.MonthlyAward(
                uint64(1 + i), uint128(1 + gross % MAX), keccak256(abi.encode("legacy", nonce++))
            );
        }
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(authorityKey, escrow.monthlyDigest(period, escrow.allocationRoot(entries)));
        try escrow.commitMonthly(period, entries, abi.encodePacked(r, s, v)) {} catch {}
    }

    function expire(uint256 seed) external {
        if (touched.length == 0) return;
        try escrow.expirePledge(touched[seed % touched.length]) {
            ++expiries;
        } catch {}
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + dt % 20 days);
    }

    /// @dev The period whose commit window is open now, or zero.
    function openPeriod() internal view returns (uint32) {
        uint256 current = toIndex(escrow.currentPeriod());
        for (uint256 back = 1; back <= 2; ++back) {
            uint32 period = fromIndex(current - back);
            (uint64 opensAt, uint64 closesAt) = escrow.monthlyWindow(period);
            if (block.timestamp >= opensAt && block.timestamp < closesAt) return period;
        }
        return 0;
    }

    function toIndex(uint32 period) internal pure returns (uint256) {
        return uint256(period / 100) * 12 + period % 100 - 1;
    }

    function fromIndex(uint256 index) internal pure returns (uint32) {
        return uint32((index / 12) * 100 + index % 12 + 1);
    }
}

contract MonthPledgeInvariantTest {
    PledgeInvariantVm internal constant vm = PledgeInvariantVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant AUTHORITY_KEY = 0xA07;
    address internal constant OWNER = address(0xA11CE);

    ProjectEscrow internal escrow;
    PledgeHandler internal handler;

    function setUp() public {
        // 10 November 2026.
        vm.warp(1_794_268_800);
        TestDollar usdc = new TestDollar();
        EscrowFactory factory = DeployFactory.create(address(0x5E6), address(0xFEE), vm.addr(AUTHORITY_KEY), 0);
        vm.prank(OWNER);
        escrow = ProjectEscrow(factory.create(keccak256("project"), IERC20(address(usdc)), Purpose.Ordinary));
        vm.prank(OWNER);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(OWNER);
        escrow.setMonthlyCommitment(20_000e6, true);
        handler = new PledgeHandler(escrow, usdc, OWNER, AUTHORITY_KEY);
    }

    function targetContracts() public view returns (address[] memory t) {
        t = new address[](1);
        t[0] = address(handler);
    }

    /// @dev A fixed sequence through the handler reaches every pledged path the campaign relies on.
    function test_handlerReachesThePledgedPaths() public {
        handler.deposit(9_999e6);
        handler.pledge(0, 1, 1); // November and December, within the free funds
        require(handler.pledges() == 1 && handler.touchedLength() == 2, "pledged");
        handler.setMonthly(0, false);
        handler.warp(19 days + 1); // 29 November
        handler.warp(5 days); // 4 December: November's window is open
        handler.reserve(0, 0);
        require(handler.pledgedReserves() == 1, "pledged November reserved with monthly off");
        for (uint256 i; i < 4; ++i) {
            handler.warp(19 days);
        }
        handler.expire(1); // December lapsed unreserved
        require(handler.expiries() == 1 && escrow.openPledgedGross() == 0, "December lapsed");
        invariant_openPledgedGrossIsTheSumOfOpenPledges();
        invariant_aPledgedMonthAlwaysReserves();
        invariant_supplyIdentity();
    }

    /// @dev The rule the whole feature rests on.
    function invariant_freeBalanceCoversOpenPledges() public view {
        require(escrow.freeBalance() >= escrow.openPledgedGross(), "free balance below open pledges");
    }

    function invariant_openPledgedGrossIsTheSumOfOpenPledges() public view {
        uint256 sum;
        uint256 n = handler.touchedLength();
        for (uint256 i; i < n; ++i) {
            uint32 period = handler.touched(i);
            (uint128 amount, bool open) = escrow.monthPledges(period);
            if (open) sum += amount;
            // A reserved period never keeps an open pledge.
            if (escrow.monthlyRoots(period) != bytes32(0)) require(!open, "reserved period still pledged");
        }
        require(escrow.openPledgedGross() == sum, "openPledgedGross equals the open pledges");
    }

    /// @dev Turning monthly off, cutting the cap or another month's pledge never stops a pledged month.
    function invariant_aPledgedMonthAlwaysReserves() public view {
        require(!handler.pledgedReserveRefused(), "a reserve within an open pledge was refused");
    }

    function invariant_supplyIdentity() public view {
        uint256 rhs = uint256(escrow.freeBalance()) + escrow.reservedPrincipal() + escrow.reservedFees()
            + escrow.pendingMonthlyGross() + escrow.totalPaid() + escrow.totalPayoutFees()
            + escrow.totalGrossWithdrawn();
        require(escrow.totalDeposited() == rhs, "totalDeposited identity");
        require(escrow.pendingMonthlyGross() == handler.ghostUnsettled(), "pending equals reserved remainders");
    }
}

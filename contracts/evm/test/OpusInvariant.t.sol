// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./OpusBase.sol";
import {WideToken} from "./WideToken.sol";
import {MonthlyTree} from "./MonthlyTree.sol";

interface MintableToken {
    function mint(address to, uint256 amount) external;
    function approve(address who, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

/// Drives random owner / depositor / authority / payer / anyone sequences against one vault and tracks ghost
/// totals. maxDeposit sets the amount scale, so the 18-decimal run moves amounts beyond uint64.
contract OpusHandler {
    OpusVm internal constant vm = OpusVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    ProjectEscrow public escrow;
    MintableToken public usdc;
    uint256 public maxDeposit;
    address public owner;
    address public authority;
    uint256 internal authorityKey;
    /// @dev The next period a monthly allocation may use; it only moves forward.
    uint32 public period = 202612;

    bytes32[] public ids;
    uint64[] public actorOf;
    mapping(bytes32 => bool) public ghostPaid;
    uint256 public ghostClaimed;
    uint256 public ghostDonated;
    uint256 public ghostNetToContributors;
    uint256 public ghostPayCount;
    uint256 public ghostWithdrawalFees;
    uint256 public nonce;
    mapping(bytes32 => uint256) public timesPaid;
    // Track that a paid award went to the binding that was active at that instant.
    bool public paidToWrongDestination;
    bool public paidBeforeActivation;
    /// @dev V2 reserves in admission order, their leaves, and the gross no leaf has proven yet.
    uint256 public reserveCount;
    mapping(uint256 => uint32) internal reservePeriod;
    mapping(uint256 => ProjectEscrow.MonthlyAward[]) internal reserveEntries;
    mapping(uint256 => mapping(uint256 => bool)) internal leafCommitted;
    uint256 public ghostUnsettled;

    constructor(ProjectEscrow e, MintableToken t, address o, uint256 authorityKey_, uint256 maxDeposit_) {
        escrow = e;
        usdc = t;
        owner = o;
        authorityKey = authorityKey_;
        authority = vm.addr(authorityKey_);
        maxDeposit = maxDeposit_;
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function _actor(uint256 s) internal pure returns (uint64) {
        return uint64(1 + (s % 5));
    }

    function _destKey(uint256 s) internal pure returns (uint256) {
        return OpusWallets.HANDLER_KEY_BASE + (s % 7);
    }

    function _dest(uint256 s) internal pure returns (address) {
        return vm.addr(_destKey(s));
    }

    /// @dev Any address may deposit; the owner is one of the depositors.
    function deposit(uint256 amount, uint256 depositorSeed) external {
        amount = 1 + (amount % maxDeposit);
        address depositor = depositorSeed % 3 == 0 ? owner : address(uint160(0xD000 + (depositorSeed % 5)));
        usdc.mint(depositor, amount);
        vm.startPrank(depositor);
        usdc.approve(address(escrow), amount);
        escrow.deposit(uint128(amount));
        vm.stopPrank();
    }

    function commit(uint256 actorSeed, uint256 gross) external {
        uint128 free = escrow.freeBalance();
        if (free == 0) return;
        gross = 1 + (gross % free);
        bytes32 src = keccak256(abi.encode("src", nonce++));
        bytes32 id = escrow.awardId(src);
        uint64 actor = _actor(actorSeed);
        vm.prank(owner);
        escrow.commitAward(id, actor, uint128(gross), src);
        ids.push(id);
        actorOf.push(actor);
    }

    function bind(uint256 actorSeed, uint256 destSeed) external {
        uint64 actor = _actor(actorSeed);
        (, uint64 v,,,) = escrow.bindings(actor);
        address dest = _dest(destSeed);
        bytes32 claim = keccak256(abi.encode(nonce++));
        uint64 expiresAt = uint64(block.timestamp);
        bytes memory signature = OpusWallets.sign(vm, escrow, _destKey(destSeed), actor, dest, v, claim, expiresAt);
        vm.prank(authority);
        escrow.bindDestination(actor, dest, v, claim, expiresAt, signature);
    }

    function cancel(uint256 actorSeed) external {
        uint64 actor = _actor(actorSeed);
        (, uint64 v,,,) = escrow.bindings(actor);
        vm.prank(owner);
        escrow.cancelBinding(actor, v);
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + (dt % 4 days));
    }

    function pay(uint256 idx, address caller) external {
        if (ids.length == 0) return;
        bytes32 id = ids[idx % ids.length];
        (uint64 actor, uint128 gross, uint128 fee,, uint64 committedAt,) = escrow.awards(id);
        (address dest, uint64 v) = escrow.payableBinding(actor);
        (, uint64 latest,, uint64 activatesAt, bool cancelled) = escrow.bindings(actor);
        uint256 before = usdc.balanceOf(dest);
        vm.prank(caller);
        escrow.pay(id, v);
        if (block.timestamp < committedAt + escrow.bindingDelay()) paidBeforeActivation = true;
        if (v == latest && (block.timestamp < activatesAt || cancelled)) paidBeforeActivation = true;
        if (usdc.balanceOf(dest) - before != gross - fee) paidToWrongDestination = true;
        timesPaid[id] += 1;
        ghostNetToContributors += gross - fee;
        ghostPayCount++;
    }

    function payStaleVersion(uint256 idx, uint64 version) external {
        if (ids.length == 0) return;
        bytes32 id = ids[idx % ids.length];
        (uint64 actor,,,,,) = escrow.awards(id);
        (, uint64 v) = escrow.payableBinding(actor);
        if (version == v) return;
        try escrow.pay(id, version) {
            paidToWrongDestination = true; // a non-current version must never pay
        } catch {}
    }

    function withdraw(uint256 gross) external {
        uint128 free = escrow.freeBalance();
        if (free == 0) return;
        gross = 1 + (gross % free);
        vm.prank(owner);
        escrow.withdrawUnused(uint128(gross));
        ghostWithdrawalFees += (gross + 49) / 50;
    }

    /// @dev Anyone commits a signed two-award allocation for the next open period, within the owner's cap.
    function commitMonthly(uint256 actorSeed, uint256 gross, address caller) external {
        uint128 free = escrow.freeBalance();
        if (free < 2) return;
        _openPeriod();
        gross = 1 + (gross % (free / 2));
        ProjectEscrow.MonthlyAward[] memory entries = new ProjectEscrow.MonthlyAward[](2);
        for (uint256 i; i < 2; ++i) {
            entries[i] = ProjectEscrow.MonthlyAward(
                _actor(actorSeed + i), uint128(gross), keccak256(abi.encode("monthly", nonce++))
            );
        }
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(authorityKey, escrow.monthlyDigest(period, escrow.allocationRoot(entries)));
        vm.prank(caller);
        escrow.commitMonthly(period, entries, abi.encodePacked(r, s, v));
        for (uint256 i; i < 2; ++i) {
            ids.push(escrow.awardId(entries[i].sourceDigest));
            actorOf.push(entries[i].actorId);
        }
        period = period % 100 == 12 ? period + 89 : period + 1;
    }

    /// @dev Anyone reserves a signed V2 remainder of one to six leaves for the next open period.
    function reserveMonthly(uint256 actorSeed, uint256 gross, uint256 width, address caller) external {
        uint256 n = 1 + (width % 6);
        uint128 free = escrow.freeBalance();
        if (free < n) return;
        _openPeriod();
        gross = 1 + (gross % (free / n));
        ProjectEscrow.MonthlyAward[] memory entries = new ProjectEscrow.MonthlyAward[](n);
        for (uint256 i; i < n; ++i) {
            entries[i] = ProjectEscrow.MonthlyAward(
                _actor(actorSeed + i), uint128(gross), keccak256(abi.encode("monthly-v2", nonce++))
            );
            reserveEntries[reserveCount].push(entries[i]);
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
        vm.prank(caller);
        escrow.reserveMonthly(period, r, abi.encodePacked(rr, s, v));
        reservePeriod[reserveCount++] = period;
        ghostUnsettled += root.total;
        period = period % 100 == 12 ? period + 89 : period + 1;
    }

    /// @dev Anyone proves one leaf of any admitted reserve.
    function commitMonthlyLeaf(uint256 reserveSeed, uint256 leafSeed, address caller) external {
        if (reserveCount == 0) return;
        uint256 r = reserveSeed % reserveCount;
        ProjectEscrow.MonthlyAward[] memory entries = reserveEntries[r];
        uint256 i = leafSeed % entries.length;
        if (leafCommitted[r][i]) return;
        (, ProjectEscrow.AllocationNode[] memory proof) = MonthlyTree.build(entries, i);
        vm.prank(caller);
        escrow.commitMonthlyLeaf(reservePeriod[r], entries[i], uint32(i), proof);
        leafCommitted[r][i] = true;
        ids.push(escrow.awardId(entries[i].sourceDigest));
        actorOf.push(entries[i].actorId);
        ghostUnsettled -= entries[i].gross;
    }

    /// @dev The owner releases the whole unsettled remainder of one reserve with the authority's signature.
    /// Its unproven leaves can no longer settle, so the handler stops proving them.
    function releaseMonthlyReserve(uint256 reserveSeed) external {
        if (reserveCount == 0) return;
        uint256 r = reserveSeed % reserveCount;
        uint32 reserved = reservePeriod[r];
        (,, uint128 remaining,,) = escrow.monthlyReserves(reserved);
        if (remaining == 0) return;
        (uint8 v, bytes32 rr, bytes32 s) =
            vm.sign(authorityKey, escrow.monthlyReleaseDigest(reserved, remaining, remaining));
        vm.prank(owner);
        escrow.releaseMonthlyReserve(reserved, remaining, remaining, abi.encodePacked(rr, s, v));
        for (uint256 i; i < reserveEntries[r].length; ++i) {
            leafCommitted[r][i] = true;
        }
        ghostUnsettled -= remaining;
    }

    function _openPeriod() internal {
        if (!escrow.monthlyEnabled()) {
            vm.prank(owner);
            escrow.setMonthlyCommitment(type(uint128).max, true);
        }
        (uint64 opensAt, uint64 closesAt) = escrow.monthlyWindow(period);
        while (block.timestamp >= closesAt) {
            period = period % 100 == 12 ? period + 89 : period + 1;
            (opensAt, closesAt) = escrow.monthlyWindow(period);
        }
        if (block.timestamp < opensAt) vm.warp(opensAt);
    }

    function claim() external {
        uint128 amt = escrow.accruedFees();
        escrow.claimFees();
        ghostClaimed += amt;
    }

    function donate(uint256 amount) external {
        amount = amount % (maxDeposit / 50);
        usdc.mint(address(escrow), amount);
        ghostDonated += amount;
    }
}

contract OpusInvariantTest is OpusBase {
    OpusHandler internal handler;

    function setUp() public virtual {
        deployWithDelay(DELAY);
        handler = new OpusHandler(escrow, MintableToken(address(usdc)), OWNER, AUTHORITY_KEY, 50_000e6);
    }

    function token() internal view virtual returns (address) {
        return address(usdc);
    }

    function targetContracts() public view returns (address[] memory t) {
        t = new address[](1);
        t[0] = address(handler);
    }

    function invariant_supplyIdentity() public view {
        uint256 lhs = escrow.totalDeposited();
        uint256 rhs = uint256(escrow.freeBalance()) + escrow.reservedPrincipal() + escrow.reservedFees()
            + escrow.pendingMonthlyGross() + escrow.totalPaid() + escrow.totalPayoutFees()
            + escrow.totalGrossWithdrawn();
        require(lhs == rhs, "totalDeposited identity");
    }

    function invariant_balanceIdentity() public view {
        uint256 accounted = uint256(escrow.freeBalance()) + escrow.reservedPrincipal() + escrow.reservedFees()
            + escrow.pendingMonthlyGross() + escrow.accruedFees();
        require(
            IERC20(token()).balanceOf(address(escrow)) == accounted + handler.ghostDonated(), "vault balance identity"
        );
    }

    /// @dev Pending gross is exactly what no leaf has proven.
    function invariant_monthlyReserveAccounting() public view {
        require(escrow.pendingMonthlyGross() == handler.ghostUnsettled(), "pending equals unproven leaves");
    }

    function invariant_feeIdentity() public view {
        require(
            uint256(escrow.accruedFees()) + handler.ghostClaimed()
                == uint256(escrow.totalPayoutFees()) + escrow.totalWithdrawalFees(),
            "fee identity"
        );
        require(IERC20(token()).balanceOf(FEE) == handler.ghostClaimed(), "fee recipient balance");
    }

    function invariant_withdrawalFeeIsTwoPercentPerWithdrawal() public view {
        require(escrow.totalWithdrawalFees() == handler.ghostWithdrawalFees(), "withdrawal fee");
        require(escrow.totalWithdrawalFees() >= (escrow.totalGrossWithdrawn() + 49) / 50, "never below 2%");
    }

    function invariant_totalsMatchGetters() public view {
        (
            uint128 deposited,
            uint128 paid,
            uint128 payoutFees,
            uint128 grossWithdrawn,
            uint128 withdrawalFees,
            uint128 free,
            uint128 principalReserved,
            uint128 feesReserved,
            uint128 feesAccrued,
            uint256 balance
        ) = escrow.totals();
        require(
            deposited == escrow.totalDeposited() && paid == escrow.totalPaid() && payoutFees == escrow.totalPayoutFees()
                && grossWithdrawn == escrow.totalGrossWithdrawn() && withdrawalFees == escrow.totalWithdrawalFees()
                && free == escrow.freeBalance() && principalReserved == escrow.reservedPrincipal()
                && feesReserved == escrow.reservedFees() && feesAccrued == escrow.accruedFees()
                && balance == IERC20(token()).balanceOf(address(escrow)),
            "totals() equals the getters"
        );
    }

    function invariant_paymentsExactOnceAndRouted() public view {
        require(!handler.paidToWrongDestination(), "payment routed wrongly or stale version paid");
        require(!handler.paidBeforeActivation(), "paid before activation");
        require(escrow.totalPaid() == handler.ghostNetToContributors(), "totalPaid tracks contributor receipts");
        uint256 n = handler.idsLength();
        uint256 reservedP;
        uint256 reservedF;
        for (uint256 i = 0; i < n; i++) {
            bytes32 id = handler.ids(i);
            (, uint128 gross, uint128 fee,,, bool paid) = escrow.awards(id);
            require(handler.timesPaid(id) <= 1, "paid twice");
            require(paid == (handler.timesPaid(id) == 1), "paid flag");
            require(fee == (gross + 49) / 50, "fee formula");
            if (!paid) {
                reservedP += gross - fee;
                reservedF += fee;
            }
        }
        require(reservedP == escrow.reservedPrincipal(), "reservedPrincipal equals unpaid net");
        require(reservedF == escrow.reservedFees(), "reservedFees equals unpaid fees");
    }
}

/// @notice The same invariants with an 18-decimal token and amounts up to 1e30 base units, far beyond uint64.
contract OpusInvariant18DecimalsTest is OpusInvariantTest {
    WideToken internal wide;

    function setUp() public override {
        deployWithDelay(DELAY);
        wide = new WideToken(18);
        vm.prank(OWNER);
        escrow = ProjectEscrow(factory.create(keccak256("project"), IERC20(address(wide)), Purpose.Ordinary));
        handler = new OpusHandler(escrow, MintableToken(address(wide)), OWNER, AUTHORITY_KEY, 1e30);
    }

    function token() internal view override returns (address) {
        return address(wide);
    }
}

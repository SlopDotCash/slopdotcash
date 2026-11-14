// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {DeployFactory} from "./DeployFactory.sol";

import {ProjectEscrow, EscrowFactory, IERC20, Purpose} from "../src/ProjectEscrow.sol";
import {TestDollar} from "../integration/TestDollar.sol";

interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function warp(uint256) external;
    function expectRevert(bytes4) external;
    function expectRevert() external;
    function assume(bool) external;
    function addr(uint256) external pure returns (address);
    function sign(uint256, bytes32) external pure returns (uint8, bytes32, bytes32);
}

/// @dev Minimal harness: no forge-std is vendored in the scratch project.
contract FableBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    // Destinations are keyed wallets: every binding carries the destination's own signature.
    uint256 internal constant OWNER_KEY = 0xA11CE;
    uint256 internal constant FEE_KEY = 0xFEE;
    uint256 internal constant CONTRIBUTOR_KEY = 0xC0DE;
    uint256 internal constant ATTACKER_KEY = 0xBAD;
    address internal OWNER = vm.addr(OWNER_KEY);
    address internal constant AUTHORITY = address(0xA07);
    address internal FEE = vm.addr(FEE_KEY);
    address internal constant REGISTRAR = address(0x5E6);
    address internal CONTRIBUTOR = vm.addr(CONTRIBUTOR_KEY);
    address internal ATTACKER = vm.addr(ATTACKER_KEY);
    uint64 internal constant DELAY = 48 hours;
    bytes32 internal constant PROJECT = keccak256("project");

    TestDollar internal usdc;
    EscrowFactory internal factory;
    ProjectEscrow internal vault;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        usdc = new TestDollar();
        vm.prank(REGISTRAR);
        factory = DeployFactory.create(REGISTRAR, FEE, AUTHORITY, DELAY);
        vm.prank(OWNER);
        vault = ProjectEscrow(factory.create(PROJECT, IERC20(address(usdc)), Purpose.Ordinary));
        usdc.mint(OWNER, 1_000_000_000e6);
        vm.prank(OWNER);
        usdc.approve(address(vault), type(uint256).max);
    }

    function depositAs(uint128 amount) internal {
        vm.prank(OWNER);
        vault.deposit(amount);
    }

    function commit(bytes32 source, uint64 actor, uint64 gross) internal returns (bytes32 id) {
        id = vault.awardId(source);
        vm.prank(OWNER);
        vault.commitAward(id, actor, gross, source);
    }

    function keyOf(address wallet) internal view returns (uint256) {
        if (wallet == OWNER) return OWNER_KEY;
        if (wallet == FEE) return FEE_KEY;
        if (wallet == CONTRIBUTOR) return CONTRIBUTOR_KEY;
        if (wallet == ATTACKER) return ATTACKER_KEY;
        revert("unknown wallet key");
    }

    /// @dev The destination wallet signs the exact binding; the authority submits it.
    function bind(uint64 actor, address dest, uint64 expected) internal {
        bytes32 claim = keccak256(abi.encode(actor, dest, expected));
        uint64 expiresAt = uint64(block.timestamp + 1 hours);
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(keyOf(dest), vault.bindingDigest(actor, dest, expected, claim, expiresAt));
        vm.prank(AUTHORITY);
        vault.bindDestination(actor, dest, expected, claim, expiresAt, abi.encodePacked(r, s, v));
    }

    function conservationHolds() internal view returns (bool) {
        uint256 lhs = vault.totalDeposited();
        uint256 rhs = uint256(vault.freeBalance()) + vault.reservedPrincipal() + vault.reservedFees()
            + vault.totalPaid() + vault.totalPayoutFees() + vault.totalGrossWithdrawn();
        uint256 bal = usdc.balanceOf(address(vault));
        uint256 held =
            uint256(vault.freeBalance()) + vault.reservedPrincipal() + vault.reservedFees() + vault.accruedFees();
        return lhs == rhs && bal == held;
    }
}

contract FableEscrowTest is FableBase {
    // ------------------------------------------------------------------
    // F-1: an award to an actor with no binding cannot be paid, and its
    // reserve is not available to the owner as free balance.
    // ------------------------------------------------------------------
    function test_F1_unboundAwardStaysReserved() public {
        depositAs(1_000e6);
        bytes32 id = commit(keccak256("src-1"), 42, 100e6);
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        vault.pay(id, 1);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        vault.pay(id, 0);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InsufficientFreeBalance.selector);
        vault.withdrawUnused(900e6 + 1);
        require(vault.reservedPrincipal() == 98e6 && vault.reservedFees() == 2e6, "reserve still locked");
        require(conservationHolds(), "conservation");
    }

    // ------------------------------------------------------------------
    // F-2 (fixed, review M-2): a binding that has paid cannot be cancelled,
    // and a rotation or its cancel never reopens payment to the earlier
    // wallet. The owner's cancels between payments are capped.
    // ------------------------------------------------------------------
    function test_F2_paidBindingIsFinalAndRotationFreezesPayment() public {
        depositAs(1_000e6);
        bytes32 first = commit(keccak256("src-2"), 7, 50e6);
        bytes32 second = commit(keccak256("src-2b"), 7, 50e6);
        bind(7, CONTRIBUTOR, 0);
        vm.warp(block.timestamp + DELAY);
        vault.pay(first, 1);
        // v1 has paid: the owner cannot cancel it.
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        vault.cancelBinding(7, 1);
        // The authority rotates; the owner cancels v2. Neither v1 nor v2 can pay.
        bind(7, ATTACKER, 1);
        vm.prank(OWNER);
        vault.cancelBinding(7, 2);
        vm.warp(block.timestamp + 10 * DELAY);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        vault.pay(second, 2);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        vault.pay(second, 1);
        // The owner can cancel at most MAX_CANCELS_BETWEEN_PAYMENTS rotations before the next payment.
        uint64 cap = vault.MAX_CANCELS_BETWEEN_PAYMENTS();
        for (uint64 v = 2; v < cap + 1; v++) {
            bind(7, CONTRIBUTOR, v);
            vm.prank(OWNER);
            vault.cancelBinding(7, v + 1);
        }
        bind(7, CONTRIBUTOR, cap + 1);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.CancelLimit.selector);
        vault.cancelBinding(7, cap + 2);
        vm.warp(block.timestamp + DELAY);
        vault.pay(second, cap + 2);
        require(usdc.balanceOf(CONTRIBUTOR) == 98e6 && usdc.balanceOf(ATTACKER) == 0, "both awards to the contributor");
        require(vault.paidVersion(7) == cap + 2, "latest paid version recorded");
    }

    // ------------------------------------------------------------------
    // F-3 (fixed, review L-1): the factory bounds bindingDelay, so a delay
    // near uint64 max cannot overflow every binding and the former cancel
    // sentinel is gone. A cancel is now an explicit flag.
    // ------------------------------------------------------------------
    function test_F3_delayIsBoundedAndCancelIsAFlag() public {
        vm.prank(REGISTRAR);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        DeployFactory.create(REGISTRAR, FEE, AUTHORITY, type(uint64).max);
        vm.prank(REGISTRAR);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        DeployFactory.create(REGISTRAR, FEE, AUTHORITY, type(uint64).max - uint64(block.timestamp));
        bind(1, CONTRIBUTOR, 0);
        (,,, uint64 activatesAt, bool cancelled) = vault.bindings(1);
        require(activatesAt == uint64(block.timestamp) && !cancelled, "active, not cancelled");
        vm.prank(OWNER);
        vault.cancelBinding(1, 1);
        (,,, uint64 later, bool cancelledAfter) = vault.bindings(1);
        require(later == activatesAt && cancelledAfter, "cancel sets the flag and leaves the time");
    }

    // ------------------------------------------------------------------
    // F-4 (fixed, review L-5): cancelBinding reverts on a version that is
    // already cancelled, so BindingCancelled cannot be re-emitted.
    // ------------------------------------------------------------------
    event BindingCancelled(uint64 indexed actorId, uint64 version);

    function test_F4_cancelIsNotIdempotent() public {
        bind(9, CONTRIBUTOR, 0);
        vm.prank(OWNER);
        vault.cancelBinding(9, 1);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        vault.cancelBinding(9, 1);
        vm.warp(block.timestamp + 10 * DELAY);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        vault.cancelBinding(9, 1);
        (, uint64 version,,, bool cancelled) = vault.bindings(9);
        require(version == 1 && cancelled, "still cancelled");
    }

    // ------------------------------------------------------------------
    // Soundness checks (expected to pass, documenting what resists attack).
    // ------------------------------------------------------------------
    function test_sound_cancelledBindingNeverPays_andBoundaryInstants() public {
        depositAs(1_000e6);
        bytes32 id = commit(keccak256("src-s1"), 3, 100e6);
        bind(3, CONTRIBUTOR, 0);
        (,,, uint64 activatesAt,) = vault.bindings(3);
        // One second before the award commitment period ends: pay fails, cancel remains allowed.
        vm.warp(activatesAt + DELAY - 1);
        vm.expectRevert(ProjectEscrow.AwardPending.selector);
        vault.pay(id, 1);
        // At the shared review boundary: cancel fails, pay succeeds.
        vm.warp(activatesAt + DELAY);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        vault.cancelBinding(3, 1);
        vault.pay(id, 1);
        require(usdc.balanceOf(CONTRIBUTOR) == 98e6, "net 98");
        require(vault.accruedFees() == 2e6, "fee 2");
        // Replay fails.
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        vault.pay(id, 1);
        // Same source cannot be re-committed.
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.DuplicateAward.selector);
        vault.commitAward(id, 3, 1e6, keccak256("src-s1"));
        require(conservationHolds(), "conservation");
    }

    function test_sound_rotationInvalidatesStalePay() public {
        depositAs(1_000e6);
        bytes32 id = commit(keccak256("src-s2"), 5, 100e6);
        bind(5, CONTRIBUTOR, 0);
        vm.warp(block.timestamp + DELAY);
        bind(5, ATTACKER, 1); // rotation by authority, immediately active; v1 never paid, so it is replaced
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        vault.pay(id, 1);
        vm.prank(OWNER);
        vault.cancelBinding(5, 2);
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        vault.pay(id, 2);
        require(usdc.balanceOf(ATTACKER) == 0, "attacker got nothing");
    }

    function test_sound_cannotCancelNonexistentOrFutureVersion() public {
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        vault.cancelBinding(77, 1);
        bind(77, CONTRIBUTOR, 0);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        vault.cancelBinding(77, 2);
    }

    function test_sound_destinationEqualsFeeRecipientOrOwner() public {
        depositAs(1_000e6);
        bytes32 a = commit(keccak256("src-fee"), 11, 100e6);
        bytes32 b = commit(keccak256("src-own"), 12, 100e6);
        bind(11, FEE, 0);
        bind(12, OWNER, 0);
        vm.warp(block.timestamp + DELAY);
        uint256 feeBefore = usdc.balanceOf(FEE);
        uint256 ownerBefore = usdc.balanceOf(OWNER);
        vault.pay(a, 1);
        vault.pay(b, 1);
        require(usdc.balanceOf(FEE) == feeBefore + 98e6, "fee dest net");
        require(usdc.balanceOf(OWNER) == ownerBefore + 98e6, "owner dest net");
        require(vault.accruedFees() == 4e6, "fees still accrued, not swept");
        vault.claimFees();
        require(usdc.balanceOf(FEE) == feeBefore + 98e6 + 4e6, "claimed");
        require(conservationHolds(), "conservation");
    }

    function test_sound_withdrawalFeeSplitInvariant(uint8 parts, uint128 total) public {
        vm.assume(parts > 0 && parts < 50);
        vm.assume(total > 0 && total <= 1_000_000e6);
        depositAs(total);
        uint128 remaining = total;
        uint128 fees;
        for (uint8 i = 0; i < parts && remaining > 0; i++) {
            uint128 g = i == parts - 1 ? remaining : remaining / (parts - i);
            if (g == 0) g = remaining;
            vm.prank(OWNER);
            vault.withdrawUnused(g);
            fees += (g + 49) / 50;
            remaining -= g;
        }
        require(vault.totalGrossWithdrawn() == total, "all out");
        require(vault.totalWithdrawalFees() == fees, "fee == sum of ceil(piece/50)");
        require(fees >= (total + 49) / 50 && fees - total / 50 <= parts, "a split never lowers the fee");
        require(vault.accruedFees() == fees, "accrued");
        require(usdc.balanceOf(OWNER) == 1_000_000_000e6 - total + (total - fees), "owner net");
        require(conservationHolds(), "conservation");
    }

    function test_sound_withdrawalFeeIsTwoPercentRoundedUp() public {
        depositAs(1_000);
        uint256 before = usdc.balanceOf(OWNER);
        vm.prank(OWNER);
        vault.withdrawUnused(860); // ceil(860 / 50) = 18
        require(usdc.balanceOf(OWNER) - before == 842, "net 842");
        require(vault.totalWithdrawalFees() == 18 && vault.accruedFees() == 18, "fee 18");
        require(conservationHolds(), "conservation");
    }

    function test_sound_factoryDuplicateAndCreate2() public {
        vm.prank(OWNER);
        vm.expectRevert(EscrowFactory.DuplicateVault.selector);
        factory.create(PROJECT, IERC20(address(usdc)), Purpose.Ordinary);
        // Another account's vault for the same project is its own vault, never the owner's.
        vm.prank(ATTACKER);
        ProjectEscrow squat = ProjectEscrow(factory.create(PROJECT, IERC20(address(usdc)), Purpose.Ordinary));
        require(squat.owner() == ATTACKER && address(squat) != address(vault), "caller owns its own vault");
        require(
            factory.vaults(factory.vaultKey(OWNER, PROJECT, IERC20(address(usdc)), Purpose.Ordinary)) == address(vault),
            "owner's vault unchanged"
        );
        // Second factory, same project id, different vault address, different award ids.
        vm.prank(REGISTRAR);
        EscrowFactory f2 = DeployFactory.create(REGISTRAR, FEE, AUTHORITY, DELAY);
        vm.prank(OWNER);
        ProjectEscrow v2 = ProjectEscrow(f2.create(PROJECT, IERC20(address(usdc)), Purpose.Ordinary));
        require(address(v2) != address(vault), "distinct");
        require(v2.awardId(keccak256("x")) != vault.awardId(keccak256("x")), "ids differ");
    }

    function test_sound_constructorGuards() public {
        vm.prank(AUTHORITY);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        factory.create(keccak256("g2"), IERC20(address(usdc)), Purpose.Ordinary); // owner == authority
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        factory.create(bytes32(0), IERC20(address(usdc)), Purpose.Ordinary);
    }

    function test_sound_bindRejectsVaultAndExpired() public {
        vm.prank(AUTHORITY);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        vault.bindDestination(1, address(vault), 0, keccak256("c"), uint64(block.timestamp), "");
        vm.prank(AUTHORITY);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        vault.bindDestination(1, CONTRIBUTOR, 0, keccak256("c"), uint64(block.timestamp - 1), "");
        vm.prank(AUTHORITY);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        vault.bindDestination(1, CONTRIBUTOR, 1, keccak256("c"), uint64(block.timestamp), ""); // wrong expected version
    }

    function test_sound_blockedDestinationLeavesReserve() public {
        depositAs(1_000e6);
        bytes32 id = commit(keccak256("src-b"), 31, 100e6);
        bind(31, CONTRIBUTOR, 0);
        vm.warp(block.timestamp + DELAY);
        usdc.blockAddress(CONTRIBUTOR);
        vm.expectRevert(); // token revert propagates as TransferFailed via callToken
        vault.pay(id, 1);
        (,,,,, bool paidB) = vault.awards(id);
        require(vault.reservedPrincipal() == 98e6 && !paidB, "reserve intact");
        usdc.blockAddress(FEE);
        vm.prank(OWNER);
        vault.withdrawUnused(100e6); // refunds continue while fee recipient blocked
        vm.expectRevert(ProjectEscrow.TransferFailed.selector);
        vault.claimFees();
    }
}

/// @dev Non-standard token return data: nothing returned, 32-byte true, 64 bytes, non-bool word.
contract OddToken {
    uint8 public mode; // 0 = returns nothing, 1 = returns 64 bytes, 2 = returns word 2
    mapping(address => uint256) public balanceOf;

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setMode(uint8 m) external {
        mode = m;
    }

    function transferFrom(address from, address to, uint256 amount) external {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emitReturn();
    }

    function transfer(address to, uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emitReturn();
    }

    function emitReturn() private view {
        uint8 m = mode;
        assembly {
            switch m
            case 0 { return(0, 0) }
            case 1 {
                mstore(0, 1)
                mstore(32, 1)
                return(0, 64)
            }
            case 2 {
                mstore(0, 2)
                return(0, 32)
            }
        }
    }
}

contract FableOddTokenTest is FableBase {
    OddToken internal odd;
    ProjectEscrow internal oddVault;

    function setUp() public override {
        vm.warp(1_800_000_000);
        odd = new OddToken();
        vm.prank(REGISTRAR);
        EscrowFactory f = DeployFactory.create(REGISTRAR, FEE, AUTHORITY, DELAY);
        vm.prank(OWNER);
        oddVault = ProjectEscrow(f.create(PROJECT, IERC20(address(odd)), Purpose.Ordinary));
        odd.mint(OWNER, 1_000e6);
    }

    function test_sound_callTokenReturnData() public {
        odd.setMode(0); // no return data: accepted (USDT-style)
        vm.prank(OWNER);
        oddVault.deposit(100e6);
        require(oddVault.freeBalance() == 100e6, "deposited");
        odd.setMode(1); // 64 bytes: rejected
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.TransferFailed.selector);
        oddVault.deposit(1e6);
        odd.setMode(2); // 32-byte word that is not a bool: abi.decode reverts (generic revert)
        vm.prank(OWNER);
        vm.expectRevert();
        oddVault.deposit(1e6);
        require(oddVault.freeBalance() == 100e6, "no drift");
    }
}

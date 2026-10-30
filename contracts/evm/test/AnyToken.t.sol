// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ERC1967Proxy} from "../src/ProjectEscrow.sol";
import {DeployFactory} from "./DeployFactory.sol";

import "./OpusBase.sol";
import {WideToken} from "./WideToken.sol";

interface AnyTokenVm {
    function expectEmit(bool, bool, bool, bool, address) external;
    function computeCreate2Address(bytes32 salt, bytes32 initCodeHash, address deployer) external pure returns (address);
}

/// @dev Takes 1% of each transfer, so the vault receives less than the amount it asked for.
contract FeeOnTransferToken is WideToken {
    constructor() WideToken(18) {}

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - amount / 100;
        return true;
    }
}

/// @dev ERC-20 without the optional decimals() function.
contract NoDecimalsToken {
    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }
}

/// @dev decimals() returns a word that is not a uint8.
contract HugeDecimalsToken {
    function decimals() external pure returns (uint256) {
        return 300;
    }
}

/// Escrow v2: any standard ERC-20 with any decimals, uint128 amounts, permissionless deposit and the 2%
/// unused-fund withdrawal fee, equal to the payout fee (#907).
contract AnyTokenTest is OpusBase {
    AnyTokenVm internal constant vm2 = AnyTokenVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant DONOR = address(0xD0D0);
    uint64 internal constant ACTOR = 77;

    event Deposited(address indexed depositor, uint128 amount);
    event VaultCreated(
        bytes32 indexed projectId,
        address indexed token,
        address indexed vault,
        address owner,
        Purpose purpose,
        uint8 decimals
    );

    function setUp() public {
        deployWithDelay(DELAY);
    }

    function vaultFor(bytes32 projectId, WideToken token) internal returns (ProjectEscrow vault) {
        vm.prank(OWNER);
        vault = ProjectEscrow(factory.create(projectId, IERC20(address(token)), Purpose.Ordinary));
    }

    function depositFrom(ProjectEscrow vault, WideToken token, address from, uint256 amount) internal {
        token.mint(from, amount);
        vm.startPrank(from);
        token.approve(address(vault), amount);
        vault.deposit(uint128(amount));
        vm.stopPrank();
    }

    function bindIn(ProjectEscrow vault, uint64 actor, address dest) internal returns (uint64 version) {
        (, uint64 current,,,) = vault.bindings(actor);
        bytes32 claim = keccak256(abi.encode(actor, dest, current));
        uint64 expiresAt = uint64(block.timestamp + 1 hours);
        bytes memory signature = OpusWallets.sign(vm, vault, walletKeys[dest], actor, dest, current, claim, expiresAt);
        vm.prank(AUTHORITY);
        vault.bindDestination(actor, dest, current, claim, expiresAt, signature);
        version = current + 1;
    }

    function conserved(ProjectEscrow vault, WideToken token, uint256 claimed) internal view returns (bool) {
        uint256 deposited = vault.totalDeposited();
        uint256 parts = uint256(vault.freeBalance()) + vault.reservedPrincipal() + vault.reservedFees()
            + vault.totalPaid() + vault.totalPayoutFees() + vault.totalGrossWithdrawn();
        uint256 held =
            uint256(vault.freeBalance()) + vault.reservedPrincipal() + vault.reservedFees() + vault.accruedFees();
        uint256 fees = uint256(vault.accruedFees()) + claimed;
        return deposited == parts && token.balanceOf(address(vault)) == held
            && fees == uint256(vault.totalPayoutFees()) + vault.totalWithdrawalFees();
    }

    /// Full lifecycle with one award, one withdrawal and a fee claim, at a given scale.
    function lifecycle(uint8 decimals_, uint256 deposit, uint128 gross, uint128 withdrawal) internal {
        WideToken token = new WideToken(decimals_);
        ProjectEscrow vault = vaultFor(keccak256(abi.encode("p", decimals_)), token);
        check(vault.decimals() == decimals_, "decimals stored");
        depositFrom(vault, token, OWNER, deposit);
        bytes32 source = keccak256(abi.encode("award", decimals_));
        bytes32 id = vault.awardId(source);
        vm.prank(OWNER);
        vault.commitAward(id, ACTOR, gross, source);
        uint64 version = bindIn(vault, ACTOR, ALICE_WALLET);
        vm.warp(block.timestamp + DELAY);
        vault.pay(id, version);
        uint128 payout = (gross + 49) / 50;
        check(token.balanceOf(ALICE_WALLET) == gross - payout, "contributor gets gross minus 2%");
        uint256 ownerBefore = token.balanceOf(OWNER);
        vm.prank(OWNER);
        vault.withdrawUnused(withdrawal);
        uint128 withdrawalFee = (withdrawal + 49) / 50;
        check(vault.withdrawalFee(withdrawal) == withdrawalFee, "withdrawalFee view");
        check(vault.withdrawalFee(withdrawal) == vault.payoutFee(withdrawal), "withdrawal fee equals payout fee");
        check(token.balanceOf(OWNER) - ownerBefore == withdrawal - withdrawalFee, "refund minus 2%");
        check(vault.totalWithdrawalFees() == withdrawalFee, "withdrawal fee is 2%");
        uint128 accrued = vault.accruedFees();
        check(accrued == payout + withdrawalFee, "fees accrue");
        vault.claimFees();
        check(token.balanceOf(FEE) == accrued, "fee recipient paid in the reward token");
        check(conserved(vault, token, accrued), "conservation");
    }

    function test_eighteenDecimalsBeyondUint64() public {
        // 10 million tokens at 18 decimals is 1e25 base units, far above type(uint64).max (about 1.8e19).
        uint256 deposit = 10_000_000e18;
        lifecycle(18, deposit, 4_000_000e18 + 49, 1_000_000e18 + 7);
    }

    function test_zeroDecimals() public {
        lifecycle(0, 1_000, 149, 50);
    }

    function test_nineDecimals() public {
        lifecycle(9, 50_000e9, 12_345e9 + 1, 777e9);
    }

    function test_twoDecimals() public {
        lifecycle(2, 100_000, 4_999, 2_501);
    }

    function test_feeRoundsUpPerAwardAtAnyScale() public view {
        check(escrow.payoutFee(1) == 1 && escrow.payoutFee(49) == 1 && escrow.payoutFee(50) == 1, "ceil(gross/50)");
        check(escrow.payoutFee(51) == 2 && escrow.payoutFee(100) == 2, "ceil(gross/50) above 50");
        check(escrow.payoutFee(type(uint128).max) == type(uint128).max / 50 + 1, "no overflow at uint128 max");
    }

    function test_countersRevertOnUint128Overflow() public {
        WideToken token = new WideToken(18);
        ProjectEscrow vault = vaultFor(keccak256("max"), token);
        depositFrom(vault, token, OWNER, type(uint128).max);
        token.mint(OWNER, 1);
        vm.startPrank(OWNER);
        token.approve(address(vault), 1);
        vm.expectRevert();
        vault.deposit(1);
        vm.stopPrank();
    }

    function test_anyoneDepositsAndOnlyOwnerRefunds() public {
        usdc.mint(DONOR, 500e6);
        vm.startPrank(DONOR);
        usdc.approve(address(escrow), 500e6);
        vm2.expectEmit(true, false, false, true, address(escrow));
        emit Deposited(DONOR, 500e6);
        escrow.deposit(500e6);
        vm.stopPrank();
        check(escrow.freeBalance() == 500e6 && escrow.totalDeposited() == 500e6, "credited to free balance");
        vm.prank(DONOR);
        vm.expectRevert(ProjectEscrow.Unauthorized.selector);
        escrow.withdrawUnused(1);
        bytes32 id = escrow.awardId(bytes32(uint256(1)));
        vm.prank(DONOR);
        vm.expectRevert(ProjectEscrow.Unauthorized.selector);
        escrow.commitAward(id, ACTOR, 1, bytes32(uint256(1)));
        uint256 before = usdc.balanceOf(OWNER);
        vm.prank(OWNER);
        escrow.withdrawUnused(500e6);
        check(usdc.balanceOf(OWNER) - before == 490e6, "owner refund destination gets 98%");
        check(usdc.balanceOf(DONOR) == 0, "donor gets no refund");
        check(escrow.accruedFees() == 10e6, "2% withdrawal fee");
    }

    function test_withdrawalFeeIsTwoPercentPerWithdrawal() public {
        // PRD section 18 example: 850 USDC free gives a 17 USDC fee and 833 USDC to the refund destination.
        fund(1_000e6);
        uint256 before = usdc.balanceOf(OWNER);
        vm.prank(OWNER);
        escrow.withdrawUnused(850e6);
        check(escrow.totalWithdrawalFees() == 17_000_000, "ceil(850e6 / 50)");
        check(usdc.balanceOf(OWNER) - before == 833_000_000, "833 USDC refunded");
        // Rounded up once per withdrawal.
        vm.startPrank(OWNER);
        escrow.withdrawUnused(99);
        escrow.withdrawUnused(49);
        vm.stopPrank();
        check(escrow.totalWithdrawalFees() == 17_000_000 + 2 + 1, "99 pays 2, 49 pays 1");
        check(escrow.withdrawalFee(type(uint128).max) == type(uint128).max / 50 + 1, "no overflow at uint128 max");
    }

    function test_feeOnTransferDepositReverts() public {
        FeeOnTransferToken token = new FeeOnTransferToken();
        ProjectEscrow vault = vaultFor(keccak256("fot"), token);
        token.mint(DONOR, 1e18);
        vm.startPrank(DONOR);
        token.approve(address(vault), 1e18);
        vm.expectRevert(ProjectEscrow.TransferFailed.selector);
        vault.deposit(1e18);
        vm.stopPrank();
        check(vault.totalDeposited() == 0, "nothing credited");
    }

    function test_tokenWithoutValidDecimalsIsRejected() public {
        address noDecimals = address(new NoDecimalsToken());
        address hugeDecimals = address(new HugeDecimalsToken());
        vm.startPrank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        factory.create(keccak256("nd"), IERC20(noDecimals), Purpose.Ordinary);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        factory.create(keccak256("hd"), IERC20(hugeDecimals), Purpose.Ordinary);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        factory.create(keccak256("eoa"), IERC20(address(0xBEEF)), Purpose.Ordinary);
        vm.stopPrank();
    }

    function test_oneFactoryOneVaultPerProjectAndToken() public {
        bytes32 project = keccak256("project");
        WideToken other = new WideToken(18);
        vm2.expectEmit(true, true, false, false, address(factory));
        emit VaultCreated(project, address(other), address(0), OWNER, Purpose.Ordinary, 18);
        ProjectEscrow second = vaultFor(project, other);
        check(address(second) != address(escrow), "a second token gets its own vault");
        bytes32 firstKey = factory.vaultKey(OWNER, project, IERC20(address(usdc)), Purpose.Ordinary);
        bytes32 secondKey = factory.vaultKey(OWNER, project, IERC20(address(other)), Purpose.Ordinary);
        check(factory.vaults(firstKey) == address(escrow), "first vault indexed");
        check(factory.vaults(secondKey) == address(second), "second vault indexed");
        check(address(second.token()) == address(other) && address(escrow.token()) == address(usdc), "token");
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(ERC1967Proxy).creationCode,
                abi.encode(
                    factory.vaultImplementation(),
                    abi.encodeCall(
                        ProjectEscrow.initialize, (project, IERC20(address(other)), OWNER, Purpose.Ordinary, FEE, DELAY)
                    )
                )
            )
        );
        check(
            vm2.computeCreate2Address(secondKey, initCodeHash, address(factory)) == address(second),
            "CREATE2 address from vaultKey"
        );
        vm.prank(OWNER);
        vm.expectRevert(EscrowFactory.DuplicateVault.selector);
        factory.create(project, IERC20(address(other)), Purpose.Ordinary);
    }

    function test_factoryTakesExplicitRoles() public {
        EscrowFactory f = DeployFactory.create(REGISTRAR, FEE, AUTHORITY, DELAY);
        check(f.registrar() == REGISTRAR && f.feeRecipient() == FEE && f.identityAuthority() == AUTHORITY, "roles");
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        DeployFactory.create(address(0), FEE, AUTHORITY, DELAY);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        DeployFactory.create(REGISTRAR, address(0), AUTHORITY, DELAY);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        DeployFactory.create(REGISTRAR, FEE, address(0), DELAY);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        DeployFactory.create(REGISTRAR, FEE, REGISTRAR, DELAY);
        // Creation is permissionless and the caller is always the owner, whoever deployed the factory.
        vm.prank(DONOR);
        ProjectEscrow own = ProjectEscrow(f.create(keccak256("x"), IERC20(address(usdc)), Purpose.Ordinary));
        check(own.owner() == DONOR && own.purpose() == Purpose.Ordinary, "caller owns the vault");
    }

    function test_totalsMatchGetters() public {
        fund(1_000e6);
        bytes32 id = commit(keccak256("t"), ACTOR, 300e6);
        uint64 version = bindAs(ACTOR, ALICE_WALLET);
        vm.warp(block.timestamp + DELAY);
        escrow.pay(id, version);
        vm.prank(OWNER);
        escrow.withdrawUnused(100e6);
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
        check(deposited == 1_000e6 && paid == 294e6 && payoutFees == 6e6, "award totals");
        check(grossWithdrawn == 100e6 && withdrawalFees == 2e6, "withdrawal totals");
        check(free == 600e6 && principalReserved == 0 && feesReserved == 0, "balances");
        check(feesAccrued == 8e6 && balance == 608e6, "vault holds free plus accrued fees");
    }
}

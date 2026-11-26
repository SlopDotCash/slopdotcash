// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SubmissionDeposits} from "../src/SubmissionDeposits.sol";
import {TestDollar} from "../integration/TestDollar.sol";
import {WideToken} from "./WideToken.sol";

interface DepositsVm {
    function prank(address) external;
    function warp(uint256) external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
    function expectEmit(bool, bool, bool, bool, address) external;
    function assume(bool) external;
}

/// @dev A token whose behavior is set per test: missing or false return values, short or excess delivery,
/// and one call back into a target while a transfer is in flight. It can also act as a caller, so the token
/// itself can be a payer or the resolver.
contract DepositOddToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    /// @dev 0 standard, 1 returns nothing, 2 returns false and moves nothing, 3 delivers one unit less,
    /// 4 delivers one unit more, 5 delivers one unit less on `transfer` only, 6 moves the exact amount but
    /// returns false, 7 delivers the exact amount on `transfer` but takes one unit more from the sender.
    uint8 public mode;
    address public hookTarget;
    bytes public hookData;
    bool public hookBubbles;
    bool public hookRan;
    bool public hookOk;
    bytes public hookResult;

    function setMode(uint8 mode_) external {
        mode = mode_;
    }

    function setHook(address target, bytes calldata data, bool bubbles) external {
        hookTarget = target;
        hookData = data;
        hookBubbles = bubbles;
        hookRan = false;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address who, uint256 amount) external returns (bool) {
        allowance[msg.sender][who] = amount;
        return true;
    }

    /// @dev Calls `target` as this token.
    function act(address target, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory result) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        return result;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (mode == 2) return false;
        move(msg.sender, to, amount, mode == 3 || mode == 5);
        return finish();
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (mode == 2) return false;
        allowance[from][msg.sender] -= amount;
        move(from, to, amount, mode == 3);
        return finish();
    }

    function move(address from, address to, uint256 amount, bool short) private {
        balanceOf[from] -= mode == 7 && from == msg.sender ? amount + 1 : amount;
        balanceOf[to] += short ? amount - 1 : mode == 4 ? amount + 1 : amount;
        if (hookTarget == address(0)) return;
        address target = hookTarget;
        hookTarget = address(0);
        (hookOk, hookResult) = target.call(hookData);
        hookRan = true;
        if (!hookOk && hookBubbles) {
            bytes memory result = hookResult;
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    function finish() private view returns (bool) {
        if (mode == 1) {
            assembly {
                return(0, 0)
            }
        }
        return mode != 6;
    }
}

/// @dev Minimal harness: no forge-std is vendored in this project.
abstract contract SubmissionDepositsBase {
    DepositsVm internal constant vm = DepositsVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant OWNER = address(0xA11CE);
    address internal constant RESOLVER = address(0x5E501);
    address internal constant PAYER = 0x1111111111111111111111111111111111111111;
    address internal constant OTHER = 0x2222222222222222222222222222222222222222;
    address internal constant STRANGER = address(0xBAD);
    address internal constant FEE_WALLET = 0x8f77C37D8650776bFe73c9b12B15209eE15D9b86;
    address internal constant BURN = 0x000000000000000000000000000000000000dEaD;

    uint64 internal constant DELAY = 30 days;
    uint256 internal constant START = 1_794_960_000; // 18 November 2026 UTC
    bytes32 internal constant ITEM = keccak256("item one");
    uint128 internal constant FEE = 2_000_000;

    SubmissionDeposits internal box;
    TestDollar internal usd;

    function setUp() public virtual {
        vm.warp(START);
        box = new SubmissionDeposits(OWNER, RESOLVER, DELAY);
        usd = new TestDollar();
        fund(PAYER, 1_000e6);
        fund(OTHER, 1_000e6);
    }

    function fund(address who, uint256 amount) internal {
        usd.mint(who, amount);
        vm.prank(who);
        usd.approve(address(box), type(uint256).max);
    }

    function pay(address payer, uint128 amount, address keptTo) internal returns (uint256 id) {
        vm.prank(payer);
        id = box.deposit(ITEM, address(usd), amount, keptTo);
    }

    function stateOf(uint256 id) internal view returns (SubmissionDeposits.State) {
        return box.deposits(id).state;
    }

    function payoutFailed(uint256 id) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(SubmissionDeposits.PayoutFailed.selector, id);
    }

    function notOpen(uint256 id) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(SubmissionDeposits.NotOpen.selector, id);
    }

    function isOpen(uint256 id) internal view returns (bool) {
        return stateOf(id) == SubmissionDeposits.State.Open;
    }
}

contract SubmissionDepositsTest is SubmissionDepositsBase {
    event Deposited(
        uint256 indexed id, bytes32 indexed item, address indexed payer, address token, uint128 amount, address keptTo
    );
    event Resolved(uint256 indexed id, bool refunded);
    event Reclaimed(uint256 indexed id);
    event ResolverChanged(address indexed previousResolver, address indexed newResolver);
    event DepositsPaused(bool paused);

    // ------------------------------------------------------------------
    // Construction
    // ------------------------------------------------------------------

    function test_ConstructorFixesRolesAndDelay() public view {
        require(box.owner() == OWNER && box.resolver() == RESOLVER, "roles");
        require(box.pendingOwner() == address(0), "no pending owner");
        require(box.reclaimDelay() == DELAY, "delay");
        require(box.depositCount() == 0 && !box.depositsPaused(), "empty and open");
    }

    function test_ConstructorRefusesMissingOrSharedRolesAndBadDelays() public {
        vm.expectRevert(SubmissionDeposits.InvalidInput.selector);
        new SubmissionDeposits(address(0), RESOLVER, DELAY);
        vm.expectRevert(SubmissionDeposits.InvalidInput.selector);
        new SubmissionDeposits(OWNER, address(0), DELAY);
        vm.expectRevert(SubmissionDeposits.InvalidInput.selector);
        new SubmissionDeposits(OWNER, OWNER, DELAY);
        vm.expectRevert(SubmissionDeposits.InvalidInput.selector);
        new SubmissionDeposits(OWNER, RESOLVER, 0);
        vm.expectRevert(SubmissionDeposits.InvalidInput.selector);
        new SubmissionDeposits(OWNER, RESOLVER, 365 days + 1);
        new SubmissionDeposits(OWNER, RESOLVER, 365 days);
    }

    // ------------------------------------------------------------------
    // Deposit
    // ------------------------------------------------------------------

    function test_DepositRecordsEveryFieldAndEmits() public {
        vm.expectEmit(true, true, true, true, address(box));
        emit Deposited(1, ITEM, PAYER, address(usd), FEE, FEE_WALLET);
        uint256 id = pay(PAYER, FEE, FEE_WALLET);
        require(id == 1 && box.depositCount() == 1, "ids count up from 1");
        SubmissionDeposits.Deposit memory record = box.deposits(1);
        require(record.payer == PAYER, "payer");
        require(record.token == address(usd), "token");
        require(record.amount == FEE, "amount");
        require(record.keptTo == FEE_WALLET, "keptTo");
        require(record.item == ITEM, "item");
        require(record.depositedAt == START, "depositedAt");
        require(record.state == SubmissionDeposits.State.Open, "open");
        require(usd.balanceOf(address(box)) == FEE && usd.balanceOf(PAYER) == 1_000e6 - FEE, "exact pull");
        require(box.openTotal(address(usd)) == FEE, "open total");
        require(box.reclaimableAt(1) == START + DELAY, "reclaim time");

        vm.warp(START + 5);
        bytes32 second = keccak256("item two");
        vm.expectEmit(true, true, true, true, address(box));
        emit Deposited(2, second, OTHER, address(usd), 7, BURN);
        vm.prank(OTHER);
        require(box.deposit(second, address(usd), 7, BURN) == 2, "second id");
        require(box.deposits(2).depositedAt == START + 5 && box.deposits(2).keptTo == BURN, "second record");
        require(box.openTotal(address(usd)) == FEE + 7, "open total grows");
        // The first record did not move.
        require(box.deposits(1).payer == PAYER && box.deposits(1).amount == FEE, "first record unchanged");
    }

    function test_UnusedIdReadsAsNone() public view {
        SubmissionDeposits.Deposit memory record = box.deposits(1);
        require(record.state == SubmissionDeposits.State.None && record.payer == address(0), "none");
        require(box.reclaimableAt(1) == 0, "no reclaim time");
    }

    /// @dev The item of a pull request, as section 1 of the interface defines it. The expected value was
    /// computed outside Solidity (`cast keccak` over the packed bytes), so it is a fixed vector for the
    /// off-chain builders of the same hash.
    function test_ItemHashVector() public pure {
        bytes32 item = keccak256(abi.encodePacked("slop-fee-v1", uint64(1_210_000_000), uint64(2445)));
        require(item == 0x1f6198c86b378a76af270760a9d191109ca1b3305e2918f11113f15ea8e5861c, "item vector");
    }

    function test_DepositRefusesZeroAmountAndUnusableKeptTo() public {
        vm.prank(PAYER);
        vm.expectRevert(SubmissionDeposits.InvalidInput.selector);
        box.deposit(ITEM, address(usd), 0, FEE_WALLET);
        vm.prank(PAYER);
        vm.expectRevert(SubmissionDeposits.InvalidInput.selector);
        box.deposit(ITEM, address(usd), FEE, address(0));
        vm.prank(PAYER);
        vm.expectRevert(SubmissionDeposits.InvalidInput.selector);
        box.deposit(ITEM, address(usd), FEE, address(box));
        require(box.depositCount() == 0 && usd.balanceOf(address(box)) == 0, "nothing recorded or pulled");
    }

    function test_DepositRefusesATokenThatDeliversLess() public {
        DepositOddToken odd = oddToken(3);
        vm.prank(PAYER);
        vm.expectRevert(SubmissionDeposits.TransferFailed.selector);
        box.deposit(ITEM, address(odd), FEE, FEE_WALLET);
        require(box.depositCount() == 0 && odd.balanceOf(address(box)) == 0, "nothing recorded or kept");
        require(odd.balanceOf(PAYER) == 1_000e6, "payer keeps everything");
    }

    function test_DepositRefusesATokenThatDeliversMore() public {
        DepositOddToken odd = oddToken(4);
        vm.prank(PAYER);
        vm.expectRevert(SubmissionDeposits.TransferFailed.selector);
        box.deposit(ITEM, address(odd), FEE, FEE_WALLET);
        require(box.depositCount() == 0, "nothing recorded");
    }

    function test_DepositRefusesAFalseReturnAMissingAllowanceAndANonToken() public {
        DepositOddToken odd = oddToken(2);
        vm.prank(PAYER);
        vm.expectRevert(SubmissionDeposits.TransferFailed.selector);
        box.deposit(ITEM, address(odd), FEE, FEE_WALLET);

        // No allowance: the token reverts and the contract reports a failed transfer.
        usd.mint(STRANGER, FEE);
        vm.prank(STRANGER);
        vm.expectRevert(SubmissionDeposits.TransferFailed.selector);
        box.deposit(ITEM, address(usd), FEE, FEE_WALLET);

        // An address without code is not a token.
        vm.prank(PAYER);
        vm.expectRevert(SubmissionDeposits.InvalidInput.selector);
        box.deposit(ITEM, address(0xC0DE1E55), FEE, FEE_WALLET);
        vm.prank(PAYER);
        vm.expectRevert(SubmissionDeposits.InvalidInput.selector);
        box.deposit(ITEM, address(0), FEE, FEE_WALLET);
        require(box.depositCount() == 0, "nothing recorded");
    }

    /// @dev A false return is a failure even when the balances moved exactly.
    function test_AFalseReturnIsRefusedEvenWhenTheTokensMoved() public {
        DepositOddToken odd = oddToken(6);
        vm.prank(PAYER);
        vm.expectRevert(SubmissionDeposits.TransferFailed.selector);
        box.deposit(ITEM, address(odd), FEE, FEE_WALLET);

        odd.setMode(0);
        vm.prank(PAYER);
        box.deposit(ITEM, address(odd), FEE, FEE_WALLET);
        odd.setMode(6);
        vm.prank(RESOLVER);
        vm.expectRevert(payoutFailed(1));
        box.resolve(1, true);
        vm.prank(RESOLVER);
        vm.expectRevert(payoutFailed(1));
        box.resolve(1, false);
        require(isOpen(1) && odd.balanceOf(address(box)) == FEE, "still open and held");
    }

    /// @dev A payout that would cost the contract more than the deposit's amount is refused, so one deposit
    /// can never be paid out of another's tokens.
    function test_APayoutThatTakesMoreThanTheAmountFromTheContractIsRefused() public {
        DepositOddToken odd = oddToken(0);
        vm.prank(PAYER);
        box.deposit(ITEM, address(odd), FEE, FEE_WALLET);
        vm.prank(PAYER);
        box.deposit(ITEM, address(odd), FEE, FEE_WALLET);
        odd.setMode(7);
        vm.prank(RESOLVER);
        vm.expectRevert(payoutFailed(1));
        box.resolve(1, false);
        require(odd.balanceOf(address(box)) == 2 * FEE && odd.balanceOf(FEE_WALLET) == 0, "nothing left the contract");
        require(isOpen(1) && isOpen(2), "both still open");
    }

    function test_ATokenThatReturnsNothingRoundTrips() public {
        DepositOddToken odd = oddToken(1);
        vm.prank(PAYER);
        box.deposit(ITEM, address(odd), FEE, FEE_WALLET);
        vm.prank(PAYER);
        box.deposit(ITEM, address(odd), 5, FEE_WALLET);
        vm.prank(RESOLVER);
        box.resolve(1, true);
        vm.prank(RESOLVER);
        box.resolve(2, false);
        require(odd.balanceOf(PAYER) == 1_000e6 - 5 && odd.balanceOf(FEE_WALLET) == 5, "both outcomes paid");
        require(odd.balanceOf(address(box)) == 0, "empty");
    }

    function test_AmountsBeyondUint64AndTheLargestAmount() public {
        WideToken wide = new WideToken(18);
        uint128 big = type(uint128).max;
        wide.mint(PAYER, big);
        vm.prank(PAYER);
        wide.approve(address(box), type(uint256).max);
        vm.prank(PAYER);
        box.deposit(ITEM, address(wide), big, BURN);
        require(box.deposits(1).amount == big && box.openTotal(address(wide)) == big, "full width recorded");
        vm.prank(RESOLVER);
        box.resolve(1, false);
        require(wide.balanceOf(BURN) == big && wide.balanceOf(address(box)) == 0, "full width sent");
    }

    // ------------------------------------------------------------------
    // Resolve
    // ------------------------------------------------------------------

    function test_RefundGoesOnlyToThePayer() public {
        pay(PAYER, FEE, FEE_WALLET);
        vm.expectEmit(true, false, false, true, address(box));
        emit Resolved(1, true);
        vm.prank(RESOLVER);
        box.resolve(1, true);
        require(usd.balanceOf(PAYER) == 1_000e6, "payer whole again");
        require(usd.balanceOf(FEE_WALLET) == 0 && usd.balanceOf(RESOLVER) == 0, "nobody else received");
        require(usd.balanceOf(address(box)) == 0 && box.openTotal(address(usd)) == 0, "nothing left");
        require(stateOf(1) == SubmissionDeposits.State.Refunded, "refunded");
        require(box.reclaimableAt(1) == 0, "no reclaim after a refund");
    }

    function test_KeptGoesOnlyToKeptTo() public {
        pay(PAYER, FEE, FEE_WALLET);
        pay(OTHER, 75, BURN);
        vm.expectEmit(true, false, false, true, address(box));
        emit Resolved(1, false);
        vm.prank(RESOLVER);
        box.resolve(1, false);
        vm.prank(RESOLVER);
        box.resolve(2, false);
        require(usd.balanceOf(FEE_WALLET) == FEE && usd.balanceOf(BURN) == 75, "each kept address received its own");
        require(usd.balanceOf(PAYER) == 1_000e6 - FEE && usd.balanceOf(OTHER) == 1_000e6 - 75, "payers not repaid");
        require(usd.balanceOf(RESOLVER) == 0 && usd.balanceOf(OWNER) == 0, "roles received nothing");
        require(stateOf(1) == SubmissionDeposits.State.Kept && stateOf(2) == SubmissionDeposits.State.Kept, "kept");
    }

    function test_ADepositResolvesOnce() public {
        pay(PAYER, FEE, FEE_WALLET);
        pay(PAYER, FEE, FEE_WALLET);
        vm.prank(RESOLVER);
        box.resolve(1, true);
        vm.prank(RESOLVER);
        box.resolve(2, false);
        for (uint256 id = 1; id <= 2; id++) {
            vm.prank(RESOLVER);
            vm.expectRevert(notOpen(id));
            box.resolve(id, true);
            vm.prank(RESOLVER);
            vm.expectRevert(notOpen(id));
            box.resolve(id, false);
            vm.warp(START + DELAY);
            vm.prank(PAYER);
            vm.expectRevert(notOpen(id));
            box.reclaim(id);
        }
        vm.prank(RESOLVER);
        vm.expectRevert(notOpen(3));
        box.resolve(3, true);
        vm.prank(RESOLVER);
        vm.expectRevert(notOpen(0));
        box.resolve(0, true);
        require(usd.balanceOf(PAYER) == 1_000e6 - FEE && usd.balanceOf(FEE_WALLET) == FEE, "each paid once");
    }

    function test_OnlyTheResolverResolves() public {
        pay(PAYER, FEE, FEE_WALLET);
        address[4] memory callers = [OWNER, PAYER, FEE_WALLET, STRANGER];
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        bool[] memory refunds = new bool[](1);
        for (uint256 i = 0; i < callers.length; i++) {
            vm.prank(callers[i]);
            vm.expectRevert(SubmissionDeposits.NotResolver.selector);
            box.resolve(1, true);
            vm.prank(callers[i]);
            vm.expectRevert(SubmissionDeposits.NotResolver.selector);
            box.resolve(1, false);
            vm.prank(callers[i]);
            vm.expectRevert(SubmissionDeposits.NotResolver.selector);
            box.resolveMany(ids, refunds);
        }
        require(isOpen(1) && usd.balanceOf(address(box)) == FEE, "untouched");
    }

    function test_ABlockedPayerCannotBeRefundedButTheDepositCanStillBeKept() public {
        pay(PAYER, FEE, FEE_WALLET);
        pay(OTHER, FEE, FEE_WALLET);
        usd.blockAddress(PAYER);
        vm.prank(RESOLVER);
        vm.expectRevert(payoutFailed(1));
        box.resolve(1, true);
        require(isOpen(1), "still open after the failed refund");
        // Another payer's deposit is unaffected.
        vm.prank(RESOLVER);
        box.resolve(2, true);
        vm.prank(RESOLVER);
        box.resolve(1, false);
        require(usd.balanceOf(FEE_WALLET) == FEE && usd.balanceOf(address(box)) == 0, "kept");
    }

    function test_ATokenThatShortsOutgoingTransfersCannotLeaveAndStaysOpen() public {
        DepositOddToken odd = oddToken(0);
        vm.prank(PAYER);
        box.deposit(ITEM, address(odd), FEE, FEE_WALLET);
        odd.setMode(5);
        vm.prank(RESOLVER);
        vm.expectRevert(payoutFailed(1));
        box.resolve(1, true);
        vm.warp(START + DELAY);
        vm.prank(PAYER);
        vm.expectRevert(payoutFailed(1));
        box.reclaim(1);
        require(isOpen(1) && box.openTotal(address(odd)) == FEE, "still open, still counted");
        odd.setMode(0);
        vm.prank(PAYER);
        box.reclaim(1);
        require(odd.balanceOf(PAYER) == 1_000e6, "paid in full once the token behaves");
    }

    // ------------------------------------------------------------------
    // Resolve many
    // ------------------------------------------------------------------

    function test_ResolveManySettlesEachDepositItsOwnWay() public {
        DepositOddToken odd = oddToken(0);
        pay(PAYER, FEE, FEE_WALLET); // 1 refund
        pay(OTHER, 3_000_000, FEE_WALLET); // 2 kept
        vm.prank(PAYER);
        box.deposit(ITEM, address(odd), 75, BURN); // 3 kept, another token
        pay(OTHER, 11, BURN); // 4 stays open
        uint256[] memory ids = new uint256[](3);
        (ids[0], ids[1], ids[2]) = (3, 1, 2);
        bool[] memory refunds = new bool[](3);
        (refunds[0], refunds[1], refunds[2]) = (false, true, false);
        vm.expectEmit(true, false, false, true, address(box));
        emit Resolved(3, false);
        vm.expectEmit(true, false, false, true, address(box));
        emit Resolved(1, true);
        vm.expectEmit(true, false, false, true, address(box));
        emit Resolved(2, false);
        vm.prank(RESOLVER);
        box.resolveMany(ids, refunds);
        require(usd.balanceOf(PAYER) == 1_000e6, "one refunded");
        require(usd.balanceOf(FEE_WALLET) == 3_000_000 && odd.balanceOf(BURN) == 75, "two kept");
        require(usd.balanceOf(address(box)) == 11 && box.openTotal(address(usd)) == 11, "one still held");
        require(odd.balanceOf(address(box)) == 0 && box.openTotal(address(odd)) == 0, "other token empty");
        require(isOpen(4), "fourth untouched");
    }

    function test_ResolveManyIsAllOrNothing() public {
        pay(PAYER, FEE, FEE_WALLET);
        pay(OTHER, FEE, FEE_WALLET);
        uint256[] memory ids = new uint256[](2);
        bool[] memory refunds = new bool[](2);

        (ids[0], ids[1]) = (1, 1); // the same deposit twice
        vm.prank(RESOLVER);
        vm.expectRevert(notOpen(1));
        box.resolveMany(ids, refunds);

        (ids[0], ids[1]) = (2, 9); // one id never used
        vm.prank(RESOLVER);
        vm.expectRevert(notOpen(9));
        box.resolveMany(ids, refunds);

        usd.blockAddress(OTHER); // one refund that cannot be delivered
        (ids[0], ids[1]) = (1, 2);
        (refunds[0], refunds[1]) = (true, true);
        vm.prank(RESOLVER);
        vm.expectRevert(payoutFailed(2)); // the error names the deposit that could not be paid
        box.resolveMany(ids, refunds);

        require(isOpen(1) && isOpen(2) && usd.balanceOf(address(box)) == 2 * FEE, "nothing settled");
    }

    function test_ResolveManyRefusesEmptyAndMismatchedLists() public {
        pay(PAYER, FEE, FEE_WALLET);
        vm.prank(RESOLVER);
        vm.expectRevert(SubmissionDeposits.InvalidInput.selector);
        box.resolveMany(new uint256[](0), new bool[](0));
        vm.prank(RESOLVER);
        vm.expectRevert(SubmissionDeposits.InvalidInput.selector);
        box.resolveMany(new uint256[](1), new bool[](2));
        vm.prank(RESOLVER);
        vm.expectRevert(SubmissionDeposits.InvalidInput.selector);
        box.resolveMany(new uint256[](2), new bool[](1));
    }

    // ------------------------------------------------------------------
    // Reclaim
    // ------------------------------------------------------------------

    function test_ReclaimOnlyByThePayerOnlyAfterTheDelayOnlyWhileOpen() public {
        pay(PAYER, FEE, FEE_WALLET);
        bytes memory early = abi.encodeWithSelector(SubmissionDeposits.ReclaimTooEarly.selector, uint64(START + DELAY));
        vm.prank(PAYER);
        vm.expectRevert(early);
        box.reclaim(1);
        vm.warp(START + DELAY - 1);
        vm.prank(PAYER);
        vm.expectRevert(early);
        box.reclaim(1);

        vm.warp(START + DELAY);
        address[5] memory others = [OWNER, RESOLVER, FEE_WALLET, OTHER, STRANGER];
        for (uint256 i = 0; i < others.length; i++) {
            vm.prank(others[i]);
            vm.expectRevert(SubmissionDeposits.NotPayer.selector);
            box.reclaim(1);
        }

        vm.expectEmit(true, false, false, true, address(box));
        emit Reclaimed(1);
        vm.prank(PAYER);
        box.reclaim(1);
        require(usd.balanceOf(PAYER) == 1_000e6 && usd.balanceOf(address(box)) == 0, "payer whole again");
        require(stateOf(1) == SubmissionDeposits.State.Reclaimed && box.openTotal(address(usd)) == 0, "reclaimed");

        vm.prank(PAYER);
        vm.expectRevert(notOpen(1));
        box.reclaim(1);
        vm.prank(RESOLVER);
        vm.expectRevert(notOpen(1));
        box.resolve(1, false);
        vm.prank(PAYER);
        vm.expectRevert(notOpen(2));
        box.reclaim(2);
    }

    function test_TheResolverMayStillSettleAfterTheDelay() public {
        pay(PAYER, FEE, FEE_WALLET);
        vm.warp(START + DELAY + 1 days);
        vm.prank(RESOLVER);
        box.resolve(1, false);
        vm.prank(PAYER);
        vm.expectRevert(notOpen(1));
        box.reclaim(1);
        require(usd.balanceOf(FEE_WALLET) == FEE, "kept");
    }

    function test_EachDepositHasItsOwnReclaimClock() public {
        pay(PAYER, FEE, FEE_WALLET);
        vm.warp(START + 10 days);
        pay(PAYER, FEE, FEE_WALLET);
        vm.warp(START + DELAY);
        vm.prank(PAYER);
        box.reclaim(1);
        vm.prank(PAYER);
        vm.expectRevert(
            abi.encodeWithSelector(SubmissionDeposits.ReclaimTooEarly.selector, uint64(START + 10 days + DELAY))
        );
        box.reclaim(2);
    }

    // ------------------------------------------------------------------
    // Pause
    // ------------------------------------------------------------------

    function test_PausingDepositsNeverBlocksResolveOrReclaim() public {
        pay(PAYER, FEE, FEE_WALLET); // 1
        pay(PAYER, FEE, FEE_WALLET); // 2
        pay(PAYER, FEE, FEE_WALLET); // 3
        pay(OTHER, FEE, FEE_WALLET); // 4
        vm.expectEmit(false, false, false, true, address(box));
        emit DepositsPaused(true);
        vm.prank(OWNER);
        box.pauseDeposits(true);
        require(box.depositsPaused(), "paused");

        vm.prank(PAYER);
        vm.expectRevert(SubmissionDeposits.DepositsArePaused.selector);
        box.deposit(ITEM, address(usd), FEE, FEE_WALLET);

        vm.prank(RESOLVER);
        box.resolve(1, true);
        vm.prank(RESOLVER);
        box.resolve(2, false);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 3;
        vm.prank(RESOLVER);
        box.resolveMany(ids, new bool[](1));
        vm.warp(START + DELAY);
        vm.prank(OTHER);
        box.reclaim(4);
        require(usd.balanceOf(address(box)) == 0 && usd.balanceOf(FEE_WALLET) == 2 * FEE, "all four settled");

        vm.prank(OWNER);
        box.pauseDeposits(false);
        require(pay(PAYER, FEE, FEE_WALLET) == 5, "deposits resume with the next id");
    }

    function test_OnlyTheOwnerPausesAndARepeatedSettingIsRefused() public {
        address[3] memory callers = [RESOLVER, PAYER, STRANGER];
        for (uint256 i = 0; i < callers.length; i++) {
            vm.prank(callers[i]);
            vm.expectRevert(SubmissionDeposits.NotOwner.selector);
            box.pauseDeposits(true);
        }
        vm.prank(OWNER);
        vm.expectRevert(SubmissionDeposits.InvalidInput.selector);
        box.pauseDeposits(false);
        vm.prank(OWNER);
        box.pauseDeposits(true);
        vm.prank(OWNER);
        vm.expectRevert(SubmissionDeposits.InvalidInput.selector);
        box.pauseDeposits(true);
    }

    // ------------------------------------------------------------------
    // Owner and resolver
    // ------------------------------------------------------------------

    /// @dev Everything the owner can call, with a deposit open: none of it resolves the deposit, moves its
    /// tokens or changes where they can go.
    function test_TheOwnerCannotResolveMoveOrRedirectADeposit() public {
        pay(PAYER, FEE, FEE_WALLET);
        bytes32 before = keccak256(abi.encode(box.deposits(1)));
        address nextResolver = address(0x5E502);
        address nextOwner = address(0xA11CF);

        vm.prank(OWNER);
        vm.expectRevert(SubmissionDeposits.NotResolver.selector);
        box.resolve(1, true);
        vm.prank(OWNER);
        vm.expectRevert(SubmissionDeposits.NotResolver.selector);
        box.resolve(1, false);
        vm.warp(START + DELAY);
        vm.prank(OWNER);
        vm.expectRevert(SubmissionDeposits.NotPayer.selector);
        box.reclaim(1);

        vm.prank(OWNER);
        box.pauseDeposits(true);
        vm.prank(OWNER);
        box.setResolver(nextResolver);
        vm.prank(OWNER);
        box.transferOwnership(nextOwner);
        vm.prank(nextOwner);
        box.acceptOwnership();
        require(keccak256(abi.encode(box.deposits(1))) == before, "the record did not change");
        require(usd.balanceOf(address(box)) == FEE && usd.balanceOf(OWNER) == 0, "the tokens did not move");

        // The replaced resolver has no power; the new one still has only the two fixed outcomes.
        vm.prank(RESOLVER);
        vm.expectRevert(SubmissionDeposits.NotResolver.selector);
        box.resolve(1, false);
        vm.prank(nextResolver);
        box.resolve(1, false);
        require(usd.balanceOf(FEE_WALLET) == FEE && usd.balanceOf(nextResolver) == 0, "kept went to the fixed address");
        require(usd.balanceOf(nextOwner) == 0 && usd.balanceOf(OWNER) == 0, "owners received nothing");
    }

    function test_TheResolverIsNeverTheOwnerOrThePendingOwner() public {
        address nextOwner = address(0xA11CF);
        vm.prank(OWNER);
        vm.expectRevert(SubmissionDeposits.InvalidInput.selector);
        box.setResolver(OWNER);
        vm.prank(OWNER);
        vm.expectRevert(SubmissionDeposits.InvalidInput.selector);
        box.transferOwnership(RESOLVER);

        vm.prank(OWNER);
        box.transferOwnership(nextOwner);
        vm.prank(OWNER);
        vm.expectRevert(SubmissionDeposits.InvalidInput.selector);
        box.setResolver(nextOwner);
        vm.prank(nextOwner);
        box.acceptOwnership();
        vm.prank(nextOwner);
        vm.expectRevert(SubmissionDeposits.InvalidInput.selector);
        box.setResolver(nextOwner);
        // The former owner holds no role any more, so it may become the resolver.
        vm.prank(nextOwner);
        box.setResolver(OWNER);
        require(box.resolver() == OWNER && box.owner() == nextOwner, "roles stay apart");
        vm.prank(nextOwner);
        vm.expectRevert(SubmissionDeposits.InvalidInput.selector);
        box.transferOwnership(OWNER);
    }

    function test_SetResolverRefusesZeroTheSameAddressAndOtherCallers() public {
        address nextResolver = address(0x5E502);
        vm.prank(OWNER);
        vm.expectRevert(SubmissionDeposits.InvalidInput.selector);
        box.setResolver(address(0));
        vm.prank(OWNER);
        vm.expectRevert(SubmissionDeposits.InvalidInput.selector);
        box.setResolver(RESOLVER);
        address[3] memory callers = [RESOLVER, PAYER, STRANGER];
        for (uint256 i = 0; i < callers.length; i++) {
            vm.prank(callers[i]);
            vm.expectRevert(SubmissionDeposits.NotOwner.selector);
            box.setResolver(nextResolver);
        }
        vm.expectEmit(true, true, false, true, address(box));
        emit ResolverChanged(RESOLVER, nextResolver);
        vm.prank(OWNER);
        box.setResolver(nextResolver);
        require(box.resolver() == nextResolver, "replaced");
    }

    function test_OwnershipMovesInTwoSteps() public {
        address nextOwner = address(0xA11CF);
        vm.prank(STRANGER);
        vm.expectRevert(SubmissionDeposits.NotOwner.selector);
        box.transferOwnership(STRANGER);
        vm.prank(OWNER);
        box.transferOwnership(nextOwner);
        require(box.owner() == OWNER && box.pendingOwner() == nextOwner, "pending only");
        vm.prank(nextOwner);
        vm.expectRevert(SubmissionDeposits.NotOwner.selector);
        box.pauseDeposits(true);
        vm.prank(STRANGER);
        vm.expectRevert(SubmissionDeposits.NotPendingOwner.selector);
        box.acceptOwnership();

        // Cancelled: nobody can accept, the zero address included.
        vm.prank(OWNER);
        box.transferOwnership(address(0));
        vm.prank(nextOwner);
        vm.expectRevert(SubmissionDeposits.NotPendingOwner.selector);
        box.acceptOwnership();
        vm.prank(address(0));
        vm.expectRevert(SubmissionDeposits.NotPendingOwner.selector);
        box.acceptOwnership();

        vm.prank(OWNER);
        box.transferOwnership(nextOwner);
        vm.prank(nextOwner);
        box.acceptOwnership();
        require(box.owner() == nextOwner && box.pendingOwner() == address(0), "moved");
        vm.prank(OWNER);
        vm.expectRevert(SubmissionDeposits.NotOwner.selector);
        box.pauseDeposits(true);
    }

    // ------------------------------------------------------------------
    // Stray tokens
    // ------------------------------------------------------------------

    function test_TokensSentWithoutADepositBelongToNoDeposit() public {
        pay(PAYER, FEE, FEE_WALLET);
        usd.mint(address(box), 500);
        require(box.openTotal(address(usd)) == FEE && usd.balanceOf(address(box)) == FEE + 500, "stray not counted");
        vm.prank(RESOLVER);
        box.resolve(1, true);
        require(usd.balanceOf(PAYER) == 1_000e6, "the deposit pays its own amount only");
        require(usd.balanceOf(address(box)) == 500 && box.openTotal(address(usd)) == 0, "the stray tokens stay");
    }

    // ------------------------------------------------------------------
    // Reentrancy through a hostile token
    // ------------------------------------------------------------------

    function test_AHostileTokenCannotReenterDepositDuringADeposit() public {
        DepositOddToken odd = oddToken(0);
        odd.mint(address(odd), FEE);
        odd.act(address(odd), abi.encodeCall(odd.approve, (address(box), type(uint256).max)));
        odd.setHook(address(box), abi.encodeCall(box.deposit, (ITEM, address(odd), FEE, BURN)), false);
        vm.prank(PAYER);
        box.deposit(ITEM, address(odd), FEE, FEE_WALLET);
        requireRefusedReentry(odd);
        require(box.depositCount() == 1 && odd.balanceOf(address(box)) == FEE, "one deposit, one amount");
        require(odd.balanceOf(address(odd)) == FEE, "the inner deposit pulled nothing");
    }

    function test_AHostilePayerTokenCannotReclaimTwice() public {
        DepositOddToken odd = oddToken(0);
        odd.mint(address(odd), 2 * FEE);
        odd.act(address(odd), abi.encodeCall(odd.approve, (address(box), type(uint256).max)));
        odd.act(address(box), abi.encodeCall(box.deposit, (ITEM, address(odd), FEE, FEE_WALLET))); // 1, payer token
        odd.act(address(box), abi.encodeCall(box.deposit, (ITEM, address(odd), FEE, FEE_WALLET))); // 2, payer token
        vm.warp(START + DELAY);

        // While deposit 1 is being paid out, the token tries to reclaim it again, then deposit 2.
        odd.setHook(address(box), abi.encodeCall(box.reclaim, (1)), false);
        odd.act(address(box), abi.encodeCall(box.reclaim, (1)));
        requireRefusedReentry(odd);
        require(odd.balanceOf(address(odd)) == FEE && odd.balanceOf(address(box)) == FEE, "paid once");

        odd.setHook(address(box), abi.encodeCall(box.reclaim, (1)), false);
        odd.act(address(box), abi.encodeCall(box.reclaim, (2)));
        requireRefusedReentry(odd);
        require(odd.balanceOf(address(odd)) == 2 * FEE && odd.balanceOf(address(box)) == 0, "each paid once");
        require(box.openTotal(address(odd)) == 0, "nothing open");
    }

    function test_AHostileResolverTokenCannotSettleASecondDepositMidTransfer() public {
        DepositOddToken odd = oddToken(0);
        vm.prank(PAYER);
        box.deposit(ITEM, address(odd), FEE, FEE_WALLET);
        vm.prank(PAYER);
        box.deposit(ITEM, address(odd), FEE, FEE_WALLET);
        vm.prank(OWNER);
        box.setResolver(address(odd));

        uint256[] memory ids = new uint256[](1);
        ids[0] = 2;
        odd.setHook(address(box), abi.encodeCall(box.resolveMany, (ids, new bool[](1))), false);
        odd.act(address(box), abi.encodeCall(box.resolve, (1, true)));
        requireRefusedReentry(odd);
        require(stateOf(1) == SubmissionDeposits.State.Refunded && isOpen(2), "only the outer call settled");
        require(odd.balanceOf(address(box)) == FEE && odd.balanceOf(FEE_WALLET) == 0, "the second deposit is held");

        // A deposit made from inside a payout is refused the same way.
        odd.setHook(address(box), abi.encodeCall(box.deposit, (ITEM, address(odd), 1, BURN)), false);
        odd.act(address(box), abi.encodeCall(box.resolve, (2, false)));
        requireRefusedReentry(odd);
        require(box.depositCount() == 2, "no deposit from inside a payout");
    }

    function test_AReentryThatBubblesFailsTheOuterCallAndChangesNothing() public {
        DepositOddToken odd = oddToken(0);
        vm.prank(PAYER);
        box.deposit(ITEM, address(odd), FEE, FEE_WALLET);
        odd.setHook(address(box), abi.encodeCall(box.reclaim, (1)), true);
        vm.prank(RESOLVER);
        vm.expectRevert(payoutFailed(1));
        box.resolve(1, true);
        require(isOpen(1) && odd.balanceOf(address(box)) == FEE, "nothing changed");
        // The failed call left the lock released: the same deposit settles normally afterwards.
        odd.setHook(address(0), "", false);
        vm.prank(RESOLVER);
        box.resolve(1, true);
        require(odd.balanceOf(PAYER) == 1_000e6, "refunded");
    }

    // ------------------------------------------------------------------
    // Fuzz
    // ------------------------------------------------------------------

    /// @dev Any amounts, any outcome for each of three deposits: the balance held always equals the open
    /// deposits, and every token ends with its payer or its kept address.
    function testFuzz_BalanceEqualsOpenDeposits(uint128 a, uint128 b, uint128 c, uint8 outcomes, uint32 wait) public {
        WideToken wide = new WideToken(18);
        uint128[3] memory amounts = [a, b, c];
        address[3] memory payers = [PAYER, OTHER, PAYER];
        uint256 held;
        for (uint256 i = 0; i < 3; i++) {
            vm.assume(amounts[i] > 0 && uint256(held) + amounts[i] <= type(uint128).max);
            wide.mint(payers[i], amounts[i]);
            vm.prank(payers[i]);
            wide.approve(address(box), amounts[i]);
            vm.prank(payers[i]);
            box.deposit(bytes32(i), address(wide), amounts[i], FEE_WALLET);
            held += amounts[i];
            require(wide.balanceOf(address(box)) == held && box.openTotal(address(wide)) == held, "after deposit");
        }
        vm.warp(START + wait);
        uint256 kept;
        for (uint256 i = 0; i < 3; i++) {
            uint256 outcome = (outcomes >> (2 * i)) & 3; // 0 stays open, 1 refund, 2 kept, 3 reclaim when allowed
            uint256 id = i + 1;
            if (outcome == 1 || outcome == 2) {
                vm.prank(RESOLVER);
                box.resolve(id, outcome == 1);
                held -= amounts[i];
                if (outcome == 2) kept += amounts[i];
            } else if (outcome == 3 && wait >= DELAY) {
                vm.prank(payers[i]);
                box.reclaim(id);
                held -= amounts[i];
            }
            require(wide.balanceOf(address(box)) == held && box.openTotal(address(wide)) == held, "after outcome");
        }
        require(wide.balanceOf(FEE_WALLET) == kept, "kept total");
        require(
            wide.balanceOf(PAYER) + wide.balanceOf(OTHER) + kept + held == uint256(a) + b + c, "nothing lost or made"
        );
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function oddToken(uint8 mode) internal returns (DepositOddToken odd) {
        odd = new DepositOddToken();
        odd.setMode(mode);
        odd.mint(PAYER, 1_000e6);
        vm.prank(PAYER);
        odd.approve(address(box), type(uint256).max);
    }

    function requireRefusedReentry(DepositOddToken odd) internal view {
        require(odd.hookRan(), "the token called back");
        require(!odd.hookOk(), "the call back was refused");
        require(bytes4(odd.hookResult()) == SubmissionDeposits.ReentrantCall.selector, "refused by the lock");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {DeployFactory} from "./DeployFactory.sol";
import {EscrowFactory, IERC20, ProjectEscrow, Purpose} from "../src/ProjectEscrow.sol";
import {TestDollar} from "../integration/TestDollar.sol";

interface Vm {
    function warp(uint256) external;
    function prank(address) external;
    function expectRevert() external;
    function addr(uint256) external pure returns (address);
    function sign(uint256, bytes32) external pure returns (uint8, bytes32, bytes32);
}

contract SonnetParity {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    TestDollar t;
    ProjectEscrow e;
    address owner = address(0xA11CE);
    address auth = address(0xA07);
    address feeR = address(0xFEE);
    uint256 constant KEY1 = 0xD1;
    uint256 constant KEY2 = 0xD2;
    address dest1 = vm.addr(KEY1);
    address dest2 = vm.addr(KEY2);
    uint128 ghostWithdrawalFees;
    uint64 constant D = 1 hours;

    function setUp() public {
        t = new TestDollar();
        // This contract is the registrar; the owner creates its own vault.
        EscrowFactory f = DeployFactory.create(address(this), feeR, auth, D);
        vm.prank(owner);
        e = ProjectEscrow(f.create(bytes32(uint256(1)), IERC20(address(t)), Purpose.Ordinary));
        t.mint(owner, 1e15);
        vm.prank(owner);
        t.approve(address(e), type(uint256).max);
    }

    /// @dev The destination wallet signs the exact binding; the authority submits it.
    function _bind(uint64 actor, address dest, uint64 expected, bytes32 claim) internal {
        uint64 expiresAt = type(uint64).max;
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(dest == dest1 ? KEY1 : KEY2, e.bindingDigest(actor, dest, expected, claim, expiresAt));
        vm.prank(auth);
        e.bindDestination(actor, dest, expected, claim, expiresAt, abi.encodePacked(r, s, v));
    }

    function _dep(uint128 a) internal {
        vm.prank(owner);
        e.deposit(a);
    }

    function _wd(uint128 g) internal {
        vm.prank(owner);
        e.withdrawUnused(g);
        ghostWithdrawalFees += (g + 49) / 50;
    }

    function _inv() internal view {
        require(
            e.totalDeposited()
                == uint256(e.freeBalance()) + e.reservedPrincipal() + e.reservedFees() + e.totalPaid()
                    + e.totalPayoutFees() + e.totalGrossWithdrawn(),
            "id1"
        );
        require(
            t.balanceOf(address(e))
                == uint256(e.freeBalance()) + e.reservedPrincipal() + e.reservedFees() + e.accruedFees(),
            "id2"
        );
        require(e.totalWithdrawalFees() == ghostWithdrawalFees, "wfee");
    }

    // payout fee table
    function test_payoutFeeTable() public view {
        uint64[9] memory g = [uint64(1), 49, 50, 51, 99, 100, 149, 150, 1e6];
        for (uint256 i; i < g.length; i++) {
            uint128 f = e.payoutFee(g[i]);
            require(f == (g[i] + 49) / 50, "ceil(gross/50)");
            // A one-unit award is all fee; every larger award pays the contributor something.
            require(g[i] == 1 ? f == 1 : g[i] - f >= 1, "bad");
        }
    }

    // withdrawal: record fee for each piece; fuzz splitting
    function testFuzz_splitTotalEqual(uint8[12] memory parts) public {
        _dep(1e12);
        uint128 total;
        uint128 feeSum;
        for (uint256 i; i < 12; i++) {
            uint128 g = uint128(parts[i]) + 1;
            uint128 beforeAcc = e.accruedFees();
            _wd(g);
            uint128 fee = e.accruedFees() - beforeAcc;
            require(fee <= g, "fee>gross");
            feeSum += fee;
            total += g;
            _inv();
        }
        require(feeSum == ghostWithdrawalFees && feeSum >= (total + 49) / 50, "fee per withdrawal");
    }

    function test_unitWithdrawals() public {
        _dep(1000);
        uint128 feeSum;
        for (uint256 i; i < 20; i++) {
            uint128 b = e.accruedFees();
            _wd(50);
            feeSum += e.accruedFees() - b;
        }
        require(feeSum == 20, "1 per 50-unit withdrawal");
        _inv();
    }

    function test_interleavedPaymentsAndWithdrawals() public {
        _dep(10000);
        // commit award 149 and 50, bind, pay between withdrawals
        bytes32 s1 = bytes32(uint256(11));
        bytes32 s2 = bytes32(uint256(12));
        bytes32 id1 = e.awardId(s1);
        bytes32 id2 = e.awardId(s2);
        vm.prank(owner);
        e.commitAward(id1, 7, 149, s1);
        vm.prank(owner);
        e.commitAward(id2, 8, 99, s2);
        _inv();
        _wd(9);
        _inv();
        _bind(7, dest1, 0, bytes32(uint256(1)));
        _bind(8, dest2, 0, bytes32(uint256(1)));
        vm.warp(block.timestamp + D);
        e.pay(id1, 1);
        _inv();
        _wd(1);
        _inv();
        e.pay(id2, 1);
        _inv();
        _wd(5);
        _inv();
        _wd(55);
        _inv();
        require(t.balanceOf(dest1) == 146 && t.balanceOf(dest2) == 97, "net");
        // 3 + 2 payout, +5 withdraw (9, 1 and 5 pay 1 each; 55 pays 2)
        require(e.accruedFees() == 3 + 2 + 5, "fees");
        e.claimFees();
        _inv();
        require(t.balanceOf(feeR) == 10, "claimed");
    }

    // direct transfer doesn't break accounting identities (2) other than vault >= sum
    function test_directTransfer() public {
        _dep(1000);
        t.mint(address(e), 777);
        require(t.balanceOf(address(e)) == 1777, "x");
        _wd(1000);
        require(t.balanceOf(address(e)) == 777 + 20, "stuck");
        require(e.freeBalance() == 0, "free");
    }

    // blocked destination reverts whole pay and leaves state
    function test_blockedPayLeavesState() public {
        _dep(1000);
        bytes32 s1 = bytes32(uint256(11));
        bytes32 id1 = e.awardId(s1);
        vm.prank(owner);
        e.commitAward(id1, 7, 100, s1);
        _bind(7, dest1, 0, bytes32(uint256(1)));
        vm.warp(block.timestamp + D);
        t.blockAddress(dest1);
        vm.expectRevert();
        e.pay(id1, 1);
        _inv();
        require(e.reservedPrincipal() == 98 && e.reservedFees() == 2, "state");
    }

    // cancel then rebind then pay
    function test_cancelThenRebind() public {
        _dep(1000);
        bytes32 s1 = bytes32(uint256(11));
        bytes32 id1 = e.awardId(s1);
        vm.prank(owner);
        e.commitAward(id1, 7, 100, s1);
        _bind(7, dest1, 0, bytes32(uint256(1)));
        vm.prank(owner);
        e.cancelBinding(7, 1);
        vm.warp(block.timestamp + D + 1);
        vm.expectRevert();
        e.pay(id1, 1);
        _bind(7, dest1, 1, bytes32(uint256(1)));
        vm.warp(block.timestamp + D);
        e.pay(id1, 2);
        _inv();
    }

    // Fixed (review M-2): before the first payment the owner gets three cancels, then the binding pays.
    function test_repeatedCancelIsCapped() public {
        _dep(1000);
        bytes32 s1 = bytes32(uint256(11));
        bytes32 id1 = e.awardId(s1);
        vm.prank(owner);
        e.commitAward(id1, 7, 100, s1);
        uint64 v;
        for (uint256 i; i < 3; i++) {
            _bind(7, dest1, v, bytes32(uint256(1)));
            v++;
            vm.prank(owner);
            e.cancelBinding(7, v);
            vm.warp(block.timestamp + D + 1);
            vm.expectRevert();
            e.pay(id1, v);
        }
        require(e.reservedPrincipal() == 98 && e.freeBalance() == 900, "still reserved");
        _bind(7, dest1, v, bytes32(uint256(1)));
        v++;
        vm.prank(owner);
        vm.expectRevert();
        e.cancelBinding(7, v);
        vm.warp(block.timestamp + D);
        e.pay(id1, v);
        _inv();
        require(t.balanceOf(dest1) == 98, "paid after the cap");
    }

    // Fixed (review M-2): a rotation or its cancel never reopens payment to the earlier destination.
    function test_rotationAndCancelFreezePreviousDestination() public {
        _dep(1000);
        bytes32 s1 = bytes32(uint256(11));
        bytes32 id1 = e.awardId(s1);
        bytes32 s2 = bytes32(uint256(12));
        bytes32 id2 = e.awardId(s2);
        bytes32 s3 = bytes32(uint256(13));
        bytes32 id3 = e.awardId(s3);
        vm.prank(owner);
        e.commitAward(id1, 7, 100, s1);
        vm.prank(owner);
        e.commitAward(id2, 7, 100, s2);
        vm.prank(owner);
        e.commitAward(id3, 7, 100, s3);
        _bind(7, dest1, 0, bytes32(uint256(1)));
        vm.warp(block.timestamp + D + 1); // v1 payable
        e.pay(id1, 1);
        // authority rotates to a new destination; v1 can no longer pay
        _bind(7, dest2, 1, bytes32(uint256(2)));
        vm.expectRevert();
        e.pay(id2, 1);
        // v2 pays immediately; v1 never pays again
        e.pay(id2, 2);
        // a cancelled v3 does not reopen v2
        _bind(7, dest1, 2, bytes32(uint256(3)));
        vm.prank(owner);
        e.cancelBinding(7, 3);
        vm.warp(block.timestamp + D + 1);
        vm.expectRevert();
        e.pay(id3, 3);
        vm.expectRevert();
        e.pay(id3, 2);
        _inv();
        require(t.balanceOf(dest1) == 98 && t.balanceOf(dest2) == 98, "one to each ready binding, none stale");
    }

    function test_selfPayoutExitFeeAndFragments() public {
        // 49-unit awards each pay a fee of 1; splitting never avoids the fee
        _dep(1000);
        for (uint256 i; i < 3; i++) {
            bytes32 s = bytes32(uint256(100 + i));
            bytes32 id = e.awardId(s);
            vm.prank(owner);
            e.commitAward(id, 9, 49, s);
        }
        require(e.reservedFees() == 3 && e.reservedPrincipal() == 144, "fragments");
    }
}

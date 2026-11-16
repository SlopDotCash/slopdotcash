// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {DeployFactory} from "./DeployFactory.sol";

import "./OpusBase.sol";

contract OpusOddToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint8 public mode; // 0 no-return, 1 return false, 2 return 64 bytes, 3 fee-on-transfer, 4 reenter
    address public reenterTarget;
    bytes public reenterData;

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function setMode(uint8 m) external {
        mode = m;
    }

    function setReenter(address t, bytes calldata d) external {
        reenterTarget = t;
        reenterData = d;
    }

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function _move(address f, address t, uint256 a) internal {
        balanceOf[f] -= a;
        uint256 got = mode == 3 ? a - a / 100 : a;
        balanceOf[t] += got;
        if (mode == 4 && reenterTarget != address(0)) {
            (bool ok, bytes memory r) = reenterTarget.call(reenterData);
            if (!ok) assembly { revert(add(r, 32), mload(r)) }
        }
    }

    function _ret() internal view {
        if (mode == 0 || mode == 3 || mode == 4) assembly { return(0, 0) }
        if (mode == 1) {
            assembly {
                mstore(0, 0)
                return(0, 32)
            }
        }
        if (mode == 2) {
            assembly {
                mstore(0, 1)
                mstore(32, 1)
                return(0, 64)
            }
        }
    }

    fallback() external {
        bytes4 sel = msg.sig;
        if (sel == bytes4(keccak256("transfer(address,uint256)"))) {
            (address t, uint256 a) = abi.decode(msg.data[4:], (address, uint256));
            _move(msg.sender, t, a);
            _ret();
        } else if (sel == bytes4(keccak256("transferFrom(address,address,uint256)"))) {
            (address f, address t, uint256 a) = abi.decode(msg.data[4:], (address, address, uint256));
            allowance[f][msg.sender] -= a;
            _move(f, t, a);
            _ret();
        } else {
            revert("unknown");
        }
    }
}

contract OpusTokensTest is OpusBase {
    OpusOddToken odd;

    function setUpOdd(uint8 m) internal {
        vm.warp(1_800_000_000);
        odd = new OpusOddToken();
        walletKeys[ALICE_WALLET] = OpusWallets.ALICE_KEY;
        vm.prank(REGISTRAR);
        factory = DeployFactory.create(REGISTRAR, FEE, AUTHORITY, DELAY);
        vm.prank(OWNER);
        escrow = ProjectEscrow(factory.create(keccak256("p"), IERC20(address(odd)), Purpose.Ordinary));
        odd.mint(OWNER, 1_000e6);
        vm.prank(OWNER);
        odd.approve(address(escrow), type(uint256).max);
        odd.setMode(m);
    }

    function test_noReturnTokenWorks() public {
        setUpOdd(0);
        vm.prank(OWNER);
        escrow.deposit(100e6);
        check(escrow.freeBalance() == 100e6, "deposit ok");
    }

    function test_returnFalseReverts() public {
        setUpOdd(1);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.TransferFailed.selector);
        escrow.deposit(100e6);
    }

    function test_return64BytesReverts() public {
        setUpOdd(2);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.TransferFailed.selector);
        escrow.deposit(100e6);
    }

    function test_feeOnTransferRevertsCleanly() public {
        setUpOdd(3);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.TransferFailed.selector);
        escrow.deposit(100e6);
    }

    function test_reentryDuringPayIsBlocked() public {
        setUpOdd(0);
        vm.prank(OWNER);
        escrow.deposit(100e6);
        bytes32 src = keccak256("s");
        bytes32 id = escrow.awardId(src);
        vm.prank(OWNER);
        escrow.commitAward(id, 7, 50e6, src);
        bindAs(7, ALICE_WALLET);
        vm.warp(block.timestamp + DELAY);
        odd.setMode(4);
        odd.setReenter(address(escrow), abi.encodeCall(ProjectEscrow.claimFees, ()));
        vm.expectRevert(ProjectEscrow.TransferFailed.selector);
        escrow.pay(id, 1);
        (,,,,, bool paid) = escrow.awards(id);
        check(!paid, "state rolled back");
    }
}

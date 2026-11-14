// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IERC20} from "../src/ProjectEscrow.sol";

/// @dev Executable six-decimal test asset for local-chain integration runs;
/// failures model blocked USDC destinations.
contract TestDollar is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public blocked;

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function blockAddress(address who) external {
        blocked = who;
    }

    function approve(address who, uint256 amount) external returns (bool) {
        allowance[msg.sender][who] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        move(from, to, amount);
        return true;
    }

    function move(address from, address to, uint256 amount) private {
        require(to != blocked, "blocked");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

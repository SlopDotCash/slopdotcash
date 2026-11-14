// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IERC20} from "../src/ProjectEscrow.sol";

/// @dev Exact-transfer test token with any decimals and uint256 balances, so tests can use amounts that
/// do not fit in uint64.
contract WideToken is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint8 public immutable decimals;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address who, uint256 amount) external returns (bool) {
        allowance[msg.sender][who] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external virtual returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

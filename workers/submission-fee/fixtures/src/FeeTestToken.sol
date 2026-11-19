// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev Mintable test token for the submission-fee Worker's local-chain run. It emits the standard
/// Transfer event, as USDC, USDG and SLOP do, because the Worker proves each refund and kept fee from
/// that event in the finalized receipt. Anyone can block an account, after which every transfer to or
/// from it reverts, as a stablecoin's blacklist does. It stands in for those tokens only; it is never a
/// real asset.
contract FeeTestToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function setBlocked(address account, bool value) external {
        blocked[account] = value;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
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
        require(!blocked[from] && !blocked[to], "blocked");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

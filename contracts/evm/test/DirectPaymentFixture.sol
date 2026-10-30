// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// Disposable local proof that Transfer events cannot establish token delivery.
contract DirectPaymentAdversary {
    mapping(address => uint256) public balanceOf;
    uint256 public mode;
    event Transfer(address indexed from, address indexed to, uint256 value);

    function setMode(uint256 value) external {
        mode = value;
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        if (mode == 2) {
            require(balanceOf[msg.sender] >= value);
            balanceOf[msg.sender] -= value;
            balanceOf[to] += value - 1;
        }
        emit Transfer(msg.sender, to, value);
        return true;
    }
}

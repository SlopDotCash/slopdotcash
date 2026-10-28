// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Synthetic local qualification only. Never deploy with real funds.
contract DemoVault {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(address account, uint256 amount) public virtual {
        require(balances[account] >= amount, "balance");
        balances[account] -= amount;
        (bool sent,) = payable(msg.sender).call{value: amount}("");
        require(sent, "transfer");
    }
}

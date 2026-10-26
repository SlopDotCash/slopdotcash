// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IReferralToken} from "../src/ReferralDistributor.sol";

/// @dev Eighteen-decimal mintable test token for the referral distributor's Foundry tests and the Robinhood
/// Chain Testnet rehearsal. It stands in for the program token only; it is never a real asset. `failNext`
/// models a transfer that returns false so the distributor's transfer check is exercised.
contract MockReferralToken is IReferralToken {
    string public constant name = "Slop Test Referral Token";
    string public constant symbol = "tSLOP";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    bool public failNext;

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function setFailNext(bool value) external {
        failNext = value;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (failNext) {
            failNext = false;
            return false;
        }
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

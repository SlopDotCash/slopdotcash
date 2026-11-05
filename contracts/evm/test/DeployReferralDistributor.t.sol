// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {DeployReferralDistributorRobinhoodTestnet} from "../script/DeployReferralDistributorRobinhoodTestnet.s.sol";

contract DeployReferralDistributorTest {
    function test_postSpacingRefusesUint64Overflow() public {
        DeployReferralDistributorRobinhoodTestnet script = new DeployReferralDistributorRobinhoodTestnet();
        (bool ok,) = address(script).call(abi.encodeCall(script.checkedPostSpacing, (uint256(type(uint64).max) + 1)));
        require(!ok, "accepted overflow");
        require(script.checkedPostSpacing(type(uint64).max) == type(uint64).max, "max rejected");
    }
}

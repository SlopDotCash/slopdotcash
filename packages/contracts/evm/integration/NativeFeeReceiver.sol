// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev Exercises a reverting and reentrant native fee receiver on a real local chain.
contract NativeFeeReceiver {
    bool public reject = true;
    address public reenterVault;
    bytes4 public reentryError;

    function acceptAndReenter(address vault) external {
        reject = false;
        reenterVault = vault;
    }

    receive() external payable {
        require(!reject, "receiver rejected ETH");
        (bool success, bytes memory result) = reenterVault.call(abi.encodeWithSignature("claimFees()"));
        require(!success && result.length >= 4, "reentry was not refused");
        reentryError = bytes4(result);
    }
}

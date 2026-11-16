// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Local fork fixture only. It stands in for deBridge's CallProxy while a cancellation message
/// from Robinhood Chain is delivered, so the real DlnSource runs its own refund path. The message
/// transport between chains is the one part a local fork cannot reproduce.
contract BuybackCallProxyStub {
    function submissionNativeSender() external pure returns (bytes memory) {
        return abi.encodePacked(address(0xE7351Fd770A37282b91D153Ee690B63579D6dd7f));
    }

    function submissionChainIdFrom() external pure returns (uint256) {
        return 4663;
    }
}

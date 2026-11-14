// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ReferralDistributor, IReferralToken} from "../src/ReferralDistributor.sol";
import {MockReferralToken} from "../integration/MockReferralToken.sol";

interface ReferralDeploymentVm {
    function envAddress(string calldata key) external returns (address);
    function envUint(string calldata key) external returns (uint256);
    function envOr(string calldata key, uint256 defaultValue) external returns (uint256);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Robinhood Chain Testnet (46630) rehearsal deployment of the referral distributor with a mock token.
/// Signing comes from Foundry's keystore or external signer; the signer pays gas and holds no role unless it is
/// named by the environment. Required public addresses: REFERRAL_OWNER (void, pause, poster changes, rescue) and
/// REFERRAL_POSTER (posts roots). REFERRAL_EPOCH_CAP is the most the cumulative total may grow per epoch, in
/// base units. REFERRAL_POST_SPACING (seconds, default 27 days) is the least time between two live posts.
/// REFERRAL_MOCK_SUPPLY (default 2,000,000 tokens) is minted to the distributor so the rehearsal can post and
/// claim. This script is for the testnet only: it mints a test token and must never run on 4663.
/// See docs/referral-distributor-testnet-runbook.md.
contract DeployReferralDistributorRobinhoodTestnet {
    ReferralDeploymentVm internal constant vm =
        ReferralDeploymentVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    event ReferralDistributorDeployed(
        uint256 indexed chainId,
        address indexed distributor,
        address token,
        address owner,
        address poster,
        uint256 epochCap,
        uint64 postSpacing
    );

    function run() external returns (ReferralDistributor distributor, MockReferralToken token) {
        require(block.chainid == 46630, "wrong chain");
        address owner = vm.envAddress("REFERRAL_OWNER");
        address poster = vm.envAddress("REFERRAL_POSTER");
        uint256 epochCap = vm.envUint("REFERRAL_EPOCH_CAP");
        uint256 supply = vm.envOr("REFERRAL_MOCK_SUPPLY", 2_000_000 ether);
        // Least time between two live posts; the off-chain job files monthly, so 27 days leaves room for a
        // late run without allowing two posts in one month. Rehearsals may set it lower.
        uint64 postSpacing = uint64(vm.envOr("REFERRAL_POST_SPACING", uint256(27 days)));
        require(owner != poster, "owner and poster must differ");
        vm.startBroadcast();
        token = new MockReferralToken();
        distributor = new ReferralDistributor(IReferralToken(address(token)), owner, poster, epochCap, postSpacing);
        token.mint(address(distributor), supply);
        vm.stopBroadcast();
        emit ReferralDistributorDeployed(
            block.chainid, address(distributor), address(token), owner, poster, epochCap, postSpacing
        );
    }
}

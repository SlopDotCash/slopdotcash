// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ReferralDistributor, IReferralToken} from "../src/ReferralDistributor.sol";

interface ReferralMainnetDeploymentVm {
    function envAddress(string calldata key) external returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

interface ProgramTokenFacts {
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (uint256);
    function symbol() external view returns (string memory);
}

/// @notice Robinhood Chain mainnet (4663) deployment of the referral distributor for the program token.
/// The deployment moves no tokens and activates nothing: the contract starts empty, and the program stays
/// inactive until a passed treasury proposal funds it and the owner activates posting (PRD section 11,
/// "Referral program"). Signing comes from Foundry's keystore or an external signer; the signer pays gas and
/// holds no role unless the environment names it. Required public addresses: REFERRAL_OWNER (void, pause,
/// poster changes, rescue; transferable in two steps) and REFERRAL_POSTER (posts roots; the owner can replace
/// it). The token, growth limit and post spacing are immutable and fixed here, not read from the environment:
/// the token is the deployed program token, the growth limit is the approved whole-root limit of 2,000,000
/// tokens, and 27 days between live posts fits one monthly file. This script must never run on any other chain.
contract DeployReferralDistributorRobinhood {
    ReferralMainnetDeploymentVm internal constant vm =
        ReferralMainnetDeploymentVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address public constant PROGRAM_TOKEN = 0xfeb4E36FA4a2A494FF25ae4a63491e4c584A67AE;
    uint256 public constant PROGRAM_TOKEN_SUPPLY = 100_000_000 ether;
    uint256 public constant EPOCH_CAP = 2_000_000 ether;
    uint64 public constant POST_SPACING = 27 days;

    event ReferralDistributorDeployed(
        uint256 indexed chainId,
        address indexed distributor,
        address token,
        address owner,
        address poster,
        uint256 epochCap,
        uint64 postSpacing
    );

    function run() external returns (ReferralDistributor) {
        return deploy(vm.envAddress("REFERRAL_OWNER"), vm.envAddress("REFERRAL_POSTER"));
    }

    /// @dev Separate from run() so the checks are testable without process-wide environment values.
    function deploy(address owner, address poster) public returns (ReferralDistributor distributor) {
        require(block.chainid == 4663, "wrong chain");
        require(owner != address(0) && poster != address(0), "owner and poster are required");
        require(owner != poster, "owner and poster must differ");
        require(owner != PROGRAM_TOKEN && poster != PROGRAM_TOKEN, "a role cannot be the token");
        requireProgramToken();
        vm.startBroadcast();
        distributor = new ReferralDistributor(IReferralToken(PROGRAM_TOKEN), owner, poster, EPOCH_CAP, POST_SPACING);
        vm.stopBroadcast();
        require(address(distributor.token()) == PROGRAM_TOKEN, "token mismatch");
        require(distributor.owner() == owner && distributor.poster() == poster, "role mismatch");
        require(distributor.epochCap() == EPOCH_CAP && distributor.postSpacing() == POST_SPACING, "limit mismatch");
        require(distributor.epochCount() == 0 && !distributor.paused(), "unexpected initial state");
        emit ReferralDistributorDeployed(
            block.chainid, address(distributor), PROGRAM_TOKEN, owner, poster, EPOCH_CAP, POST_SPACING
        );
    }

    /// @dev Refuses to deploy against anything but the recorded program token.
    function requireProgramToken() internal view {
        require(PROGRAM_TOKEN.code.length != 0, "program token has no code");
        ProgramTokenFacts facts = ProgramTokenFacts(PROGRAM_TOKEN);
        require(facts.decimals() == 18, "program token decimals");
        require(facts.totalSupply() == PROGRAM_TOKEN_SUPPLY, "program token supply");
        require(keccak256(bytes(facts.symbol())) == keccak256("SLOP"), "program token symbol");
    }
}

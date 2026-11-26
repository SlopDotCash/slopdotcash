// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SubmissionDeposits} from "../src/SubmissionDeposits.sol";

interface StandingDepositsDeploymentVm {
    function envAddress(string calldata key) external returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Robinhood Chain mainnet (4663) deployment of the standing deposit contract: a second, unchanged
/// SubmissionDeposits whose payer can take a deposit back after 365 days instead of 30 (operator decision,
/// 23 November 2026; PRD section 5, "Standing deposit"). Signing comes from Foundry's keystore or an external
/// signer; the signer pays gas and holds no role unless the environment names it. Required public addresses:
/// STANDING_DEPOSITS_OWNER (replaces the resolver, pauses new deposits; transferable in two steps) and
/// STANDING_DEPOSITS_RESOLVER (settles each deposit to its payer or its kept address; the owner can replace
/// it). The resolver is passed in, never fixed here. The reclaim delay is immutable and fixed at 365 days, the
/// contract's maximum. The deployment moves no tokens and activates nothing: no Slop service reads it until its
/// address and start block are recorded in `src/lib/standing-deposit.mjs` in a separate reviewed change. This
/// script must never run on any other chain.
contract DeployStandingDeposits {
    StandingDepositsDeploymentVm internal constant vm =
        StandingDepositsDeploymentVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 public constant CHAIN_ID = 4663;
    uint64 public constant RECLAIM_DELAY = 365 days;

    event StandingDepositsDeployed(
        uint256 indexed chainId, address indexed deposits, address owner, address resolver, uint64 reclaimDelay
    );

    function run() external returns (SubmissionDeposits) {
        return deploy(vm.envAddress("STANDING_DEPOSITS_OWNER"), vm.envAddress("STANDING_DEPOSITS_RESOLVER"));
    }

    /// @dev Separate from run() so the checks are testable without process-wide environment values.
    function deploy(address owner, address resolver) public returns (SubmissionDeposits deposits) {
        require(block.chainid == CHAIN_ID, "wrong chain");
        require(owner != address(0) && resolver != address(0), "owner and resolver are required");
        require(owner != resolver, "owner and resolver must differ");
        vm.startBroadcast();
        deposits = new SubmissionDeposits(owner, resolver, RECLAIM_DELAY);
        vm.stopBroadcast();
        require(deposits.owner() == owner && deposits.resolver() == resolver, "role mismatch");
        require(deposits.pendingOwner() == address(0), "unexpected pending owner");
        require(deposits.reclaimDelay() == RECLAIM_DELAY, "delay mismatch");
        require(deposits.depositCount() == 0 && !deposits.depositsPaused(), "unexpected initial state");
        emit StandingDepositsDeployed(block.chainid, address(deposits), owner, resolver, RECLAIM_DELAY);
    }
}

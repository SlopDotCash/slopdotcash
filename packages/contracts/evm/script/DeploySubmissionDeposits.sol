// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SubmissionDeposits} from "../src/SubmissionDeposits.sol";

interface SubmissionDepositsDeploymentVm {
    function envAddress(string calldata key) external returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Shared deployment of the submission deposit contract. Signing comes from Foundry's keystore or an
/// external signer; the signer pays gas and holds no role unless the environment names it. Required public
/// addresses: SUBMISSION_DEPOSITS_OWNER (replaces the resolver, pauses new deposits; transferable in two
/// steps) and SUBMISSION_DEPOSITS_RESOLVER (settles each deposit to its payer or its kept address; the owner
/// can replace it). The reclaim delay is immutable and fixed here at 30 days, not read from the environment.
/// The deployment moves no tokens and activates nothing: the contract starts empty, keeps no token list, and
/// no Slop service reads it until its address is recorded in a separate reviewed change.
abstract contract DeploySubmissionDeposits {
    SubmissionDepositsDeploymentVm internal constant vm =
        SubmissionDepositsDeploymentVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint64 public constant RECLAIM_DELAY = 30 days;

    event SubmissionDepositsDeployed(
        uint256 indexed chainId, address indexed deposits, address owner, address resolver, uint64 reclaimDelay
    );

    /// @notice The only chain this script deploys on.
    function chainId() public pure virtual returns (uint256);

    function run() external returns (SubmissionDeposits) {
        return deploy(vm.envAddress("SUBMISSION_DEPOSITS_OWNER"), vm.envAddress("SUBMISSION_DEPOSITS_RESOLVER"));
    }

    /// @dev Separate from run() so the checks are testable without process-wide environment values.
    function deploy(address owner, address resolver) public returns (SubmissionDeposits deposits) {
        require(block.chainid == chainId(), "wrong chain");
        require(owner != address(0) && resolver != address(0), "owner and resolver are required");
        require(owner != resolver, "owner and resolver must differ");
        vm.startBroadcast();
        deposits = new SubmissionDeposits(owner, resolver, RECLAIM_DELAY);
        vm.stopBroadcast();
        require(deposits.owner() == owner && deposits.resolver() == resolver, "role mismatch");
        require(deposits.pendingOwner() == address(0), "unexpected pending owner");
        require(deposits.reclaimDelay() == RECLAIM_DELAY, "delay mismatch");
        require(deposits.depositCount() == 0 && !deposits.depositsPaused(), "unexpected initial state");
        emit SubmissionDepositsDeployed(block.chainid, address(deposits), owner, resolver, RECLAIM_DELAY);
    }
}

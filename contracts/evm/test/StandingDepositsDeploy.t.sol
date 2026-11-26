// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SubmissionDeposits} from "../src/SubmissionDeposits.sol";
import {DeployStandingDeposits} from "../script/DeployStandingDeposits.sol";

interface StandingDeployVm {
    function chainId(uint256) external;
    function expectRevert(bytes calldata) external;
    function expectEmit(bool, bool, bool, bool, address) external;
    function getNonce(address) external view returns (uint64);
    function computeCreateAddress(address, uint256) external pure returns (address);
}

/// @dev The standing deposit deployment script: Robinhood Chain only, the fixed 365-day reclaim delay, the
/// named roles, and refusals.
contract StandingDepositsDeployTest {
    StandingDeployVm internal constant vm = StandingDeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant OWNER = address(0xA11CE);
    address internal constant RESOLVER = address(0x5E501);

    event StandingDepositsDeployed(
        uint256 indexed chainId, address indexed deposits, address owner, address resolver, uint64 reclaimDelay
    );

    DeployStandingDeposits internal script;

    function setUp() public {
        script = new DeployStandingDeposits();
    }

    function refusal(string memory reason) internal pure returns (bytes memory) {
        return abi.encodeWithSignature("Error(string)", reason);
    }

    function test_NamesRobinhoodChainAnd365Days() public view {
        require(script.CHAIN_ID() == 4663, "chain id");
        require(script.RECLAIM_DELAY() == 365 days, "365-day delay");
    }

    function test_DeploysEmptyWithTheNamedRolesAnd365Days() public {
        vm.chainId(4663);
        SubmissionDeposits deposits = script.deploy(OWNER, RESOLVER);
        require(deposits.owner() == OWNER && deposits.resolver() == RESOLVER, "roles");
        require(deposits.pendingOwner() == address(0), "no pending owner");
        require(deposits.reclaimDelay() == 365 days, "delay");
        require(deposits.reclaimDelay() == deposits.MAX_RECLAIM_DELAY(), "the contract's maximum");
        require(deposits.depositCount() == 0 && !deposits.depositsPaused(), "empty and open");
        require(address(deposits).balance == 0, "holds no ETH");
    }

    function test_ReportsTheDeployedAddressAndValues() public {
        vm.chainId(4663);
        address next = vm.computeCreateAddress(tx.origin, vm.getNonce(tx.origin));
        vm.expectEmit(true, true, false, true, address(script));
        emit StandingDepositsDeployed(4663, next, OWNER, RESOLVER, 365 days);
        require(address(script.deploy(OWNER, RESOLVER)) == next, "reported address is the deployment");
    }

    function test_RefusesEveryOtherChain() public {
        uint256[5] memory others = [uint256(1), 31337, 46630, 84532, 8453];
        for (uint256 i = 0; i < others.length; i++) {
            vm.chainId(others[i]);
            vm.expectRevert(refusal("wrong chain"));
            script.deploy(OWNER, RESOLVER);
        }
    }

    function test_RefusesMissingOrSharedRoles() public {
        vm.chainId(4663);
        vm.expectRevert(refusal("owner and resolver are required"));
        script.deploy(address(0), RESOLVER);
        vm.expectRevert(refusal("owner and resolver are required"));
        script.deploy(OWNER, address(0));
        vm.expectRevert(refusal("owner and resolver must differ"));
        script.deploy(OWNER, OWNER);
    }
}

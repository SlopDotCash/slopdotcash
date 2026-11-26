// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SubmissionDeposits} from "../src/SubmissionDeposits.sol";
import {DeploySubmissionDeposits} from "../script/DeploySubmissionDeposits.sol";
import {DeploySubmissionDepositsBase} from "../script/DeploySubmissionDepositsBase.s.sol";
import {DeploySubmissionDepositsRobinhood} from "../script/DeploySubmissionDepositsRobinhood.s.sol";

interface DepositsDeployVm {
    function chainId(uint256) external;
    function expectRevert(bytes calldata) external;
    function expectEmit(bool, bool, bool, bool, address) external;
    function getNonce(address) external view returns (uint64);
    function computeCreateAddress(address, uint256) external pure returns (address);
}

/// @dev The two mainnet deployment scripts: one fixed chain each, the fixed 30-day delay, refusals, and an
/// empty result with the named roles.
contract SubmissionDepositsDeployTest {
    DepositsDeployVm internal constant vm = DepositsDeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant OWNER = address(0xA11CE);
    address internal constant RESOLVER = address(0x5E501);

    event SubmissionDepositsDeployed(
        uint256 indexed chainId, address indexed deposits, address owner, address resolver, uint64 reclaimDelay
    );

    DeploySubmissionDeposits internal base;
    DeploySubmissionDeposits internal robinhood;

    function setUp() public {
        base = new DeploySubmissionDepositsBase();
        robinhood = new DeploySubmissionDepositsRobinhood();
    }

    function refusal(string memory reason) internal pure returns (bytes memory) {
        return abi.encodeWithSignature("Error(string)", reason);
    }

    function test_EachScriptNamesItsOwnChain() public view {
        require(base.chainId() == 8453 && robinhood.chainId() == 4663, "chain ids");
        require(base.RECLAIM_DELAY() == 30 days && robinhood.RECLAIM_DELAY() == 30 days, "30-day delay");
    }

    function test_DeploysEmptyWithTheNamedRolesAndTheFixedDelay() public {
        checkDeploys(base, 8453);
        checkDeploys(robinhood, 4663);
    }

    function checkDeploys(DeploySubmissionDeposits script, uint256 chain) internal {
        vm.chainId(chain);
        SubmissionDeposits deposits = script.deploy(OWNER, RESOLVER);
        require(deposits.owner() == OWNER && deposits.resolver() == RESOLVER, "roles");
        require(deposits.pendingOwner() == address(0), "no pending owner");
        require(deposits.reclaimDelay() == 30 days, "delay");
        require(deposits.depositCount() == 0 && !deposits.depositsPaused(), "empty and open");
        require(deposits.deposits(1).state == SubmissionDeposits.State.None, "no deposit");
        require(address(deposits).balance == 0, "holds no ETH");
    }

    function test_ReportsTheDeployedAddressAndValues() public {
        vm.chainId(4663);
        // The broadcast inside the script deploys from the transaction sender, not from this test contract.
        address next = vm.computeCreateAddress(tx.origin, vm.getNonce(tx.origin));
        vm.expectEmit(true, true, false, true, address(robinhood));
        emit SubmissionDepositsDeployed(4663, next, OWNER, RESOLVER, 30 days);
        require(address(robinhood.deploy(OWNER, RESOLVER)) == next, "reported address is the deployment");
    }

    function test_EachScriptRefusesEveryOtherChain() public {
        uint256[5] memory others = [uint256(1), 31337, 46630, 84532, 4663];
        for (uint256 i = 0; i < others.length; i++) {
            vm.chainId(others[i]);
            vm.expectRevert(refusal("wrong chain"));
            base.deploy(OWNER, RESOLVER);
        }
        others[4] = 8453;
        for (uint256 i = 0; i < others.length; i++) {
            vm.chainId(others[i]);
            vm.expectRevert(refusal("wrong chain"));
            robinhood.deploy(OWNER, RESOLVER);
        }
    }

    function test_RefusesMissingOrSharedRoles() public {
        vm.chainId(8453);
        vm.expectRevert(refusal("owner and resolver are required"));
        base.deploy(address(0), RESOLVER);
        vm.expectRevert(refusal("owner and resolver are required"));
        base.deploy(OWNER, address(0));
        vm.expectRevert(refusal("owner and resolver must differ"));
        base.deploy(OWNER, OWNER);
    }
}

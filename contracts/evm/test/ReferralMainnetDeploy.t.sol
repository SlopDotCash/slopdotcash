// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ReferralDistributor} from "../src/ReferralDistributor.sol";
import {DeployReferralDistributorRobinhood} from "../script/DeployReferralDistributorRobinhood.s.sol";

interface DeployVm {
    function chainId(uint256) external;
    function etch(address, bytes calldata) external;
    function expectRevert(bytes calldata) external;
}

/// @dev Stands in for the program token at its recorded address. Facts are settable so each refusal is reachable.
contract ProgramTokenStandIn {
    uint8 public decimals;
    uint256 public totalSupply;
    string public symbol;
    mapping(address => uint256) public balanceOf;

    function set(uint8 decimals_, uint256 totalSupply_, string calldata symbol_) external {
        decimals = decimals_;
        totalSupply = totalSupply_;
        symbol = symbol_;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }
}

/// @dev The mainnet deployment script: fixed token and limits, refusals, and an empty inactive result.
contract ReferralMainnetDeployTest {
    DeployVm internal constant vm = DeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant OWNER = address(0xA11CE);
    address internal constant POSTER = address(0x9057);

    DeployReferralDistributorRobinhood internal script;
    address internal programToken;

    function setUp() public {
        script = new DeployReferralDistributorRobinhood();
        programToken = script.PROGRAM_TOKEN();
        vm.chainId(4663);
        vm.etch(programToken, address(new ProgramTokenStandIn()).code);
        ProgramTokenStandIn(programToken).set(18, 100_000_000 ether, "SLOP");
    }

    function refusal(string memory reason) internal pure returns (bytes memory) {
        return abi.encodeWithSignature("Error(string)", reason);
    }

    function test_DeploysEmptyAndInactiveWithFixedTokenAndLimits() public {
        ReferralDistributor distributor = script.deploy(OWNER, POSTER);
        require(address(distributor.token()) == programToken, "token");
        require(distributor.owner() == OWNER && distributor.poster() == POSTER, "roles");
        require(distributor.pendingOwner() == address(0), "no pending owner");
        require(distributor.epochCap() == 2_000_000 ether, "growth limit is the approved 2,000,000");
        require(distributor.postSpacing() == 27 days, "post spacing");
        require(distributor.epochCount() == 0 && distributor.activeRoot() == bytes32(0), "no root");
        require(!distributor.paused(), "not paused");
        require(ProgramTokenStandIn(programToken).balanceOf(address(distributor)) == 0, "deployment moves no tokens");
    }

    function test_RefusesEveryOtherChain() public {
        vm.chainId(46630);
        vm.expectRevert(refusal("wrong chain"));
        script.deploy(OWNER, POSTER);
        vm.chainId(1);
        vm.expectRevert(refusal("wrong chain"));
        script.deploy(OWNER, POSTER);
    }

    function test_RefusesMissingSharedOrTokenRoles() public {
        vm.expectRevert(refusal("owner and poster are required"));
        script.deploy(address(0), POSTER);
        vm.expectRevert(refusal("owner and poster are required"));
        script.deploy(OWNER, address(0));
        vm.expectRevert(refusal("owner and poster must differ"));
        script.deploy(OWNER, OWNER);
        vm.expectRevert(refusal("a role cannot be the token"));
        script.deploy(programToken, POSTER);
        vm.expectRevert(refusal("a role cannot be the token"));
        script.deploy(OWNER, programToken);
    }

    function test_RefusesWhenTheRecordedTokenIsAbsent() public {
        vm.etch(programToken, "");
        vm.expectRevert(refusal("program token has no code"));
        script.deploy(OWNER, POSTER);
    }

    function test_RefusesATokenWithOtherFacts() public {
        ProgramTokenStandIn(programToken).set(6, 100_000_000 ether, "SLOP");
        vm.expectRevert(refusal("program token decimals"));
        script.deploy(OWNER, POSTER);
        ProgramTokenStandIn(programToken).set(18, 100_000_001 ether, "SLOP");
        vm.expectRevert(refusal("program token supply"));
        script.deploy(OWNER, POSTER);
        ProgramTokenStandIn(programToken).set(18, 100_000_000 ether, "tSLOP");
        vm.expectRevert(refusal("program token symbol"));
        script.deploy(OWNER, POSTER);
    }
}

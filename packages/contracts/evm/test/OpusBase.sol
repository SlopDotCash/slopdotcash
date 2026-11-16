// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {DeployFactory} from "./DeployFactory.sol";

import {ProjectEscrow, EscrowFactory, IERC20, Purpose} from "../src/ProjectEscrow.sol";
import {TestDollar} from "../integration/TestDollar.sol";

struct OpusVmLog {
    bytes32[] topics;
    bytes data;
    address emitter;
}

interface OpusVm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function warp(uint256) external;
    function expectRevert(bytes4) external;
    function expectRevert() external;
    function assume(bool) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (OpusVmLog[] memory);
    function addr(uint256) external pure returns (address);
    function sign(uint256, bytes32) external pure returns (uint8, bytes32, bytes32);
}

/// @dev Destination wallets are keyed so they can sign their bindings; the authority alone cannot bind.
library OpusWallets {
    uint256 internal constant ALICE_KEY = 0xA1;
    uint256 internal constant NEW_WALLET_KEY = 0xA2;
    uint256 internal constant ATTACKER_KEY = 0xBAD;
    /// @dev Keys for the invariant handler's seven destinations.
    uint256 internal constant HANDLER_KEY_BASE = 0x1000;

    function sign(
        OpusVm vm,
        ProjectEscrow escrow,
        uint256 key,
        uint64 actor,
        address dest,
        uint64 expected,
        bytes32 claim,
        uint64 expiresAt
    ) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, escrow.bindingDigest(actor, dest, expected, claim, expiresAt));
        return abi.encodePacked(r, s, v);
    }
}

abstract contract OpusBase {
    OpusVm internal constant vm = OpusVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint64 internal constant DELAY = 48 hours;
    address internal constant OWNER = address(0xA11CE);
    /// @dev The identity authority signs monthly allocations, so it has a key.
    uint256 internal constant AUTHORITY_KEY = 0xA77E;
    address internal AUTHORITY = vm.addr(AUTHORITY_KEY);
    address internal constant FEE = address(0xFEE);
    address internal constant REGISTRAR = address(0x4E6);
    address internal ALICE_WALLET = vm.addr(OpusWallets.ALICE_KEY);
    address internal ATTACKER = vm.addr(OpusWallets.ATTACKER_KEY);
    address internal constant RELAYER = address(0x4E1A);
    mapping(address => uint256) internal walletKeys;

    TestDollar internal usdc;
    EscrowFactory internal factory;
    ProjectEscrow internal escrow;

    function deployWithDelay(uint64 delay) internal {
        vm.warp(1_800_000_000);
        walletKeys[ALICE_WALLET] = OpusWallets.ALICE_KEY;
        walletKeys[ATTACKER] = OpusWallets.ATTACKER_KEY;
        walletKeys[vm.addr(OpusWallets.NEW_WALLET_KEY)] = OpusWallets.NEW_WALLET_KEY;
        usdc = new TestDollar();
        vm.prank(REGISTRAR);
        factory = DeployFactory.create(REGISTRAR, FEE, AUTHORITY, delay);
        vm.prank(OWNER);
        escrow = ProjectEscrow(factory.create(keccak256("project"), IERC20(address(usdc)), Purpose.Ordinary));
        usdc.mint(OWNER, 1_000_000e6);
        vm.prank(OWNER);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function fund(uint64 amount) internal {
        vm.prank(OWNER);
        escrow.deposit(amount);
    }

    function commit(bytes32 source, uint64 actor, uint64 gross) internal returns (bytes32 id) {
        id = escrow.awardId(source);
        vm.prank(OWNER);
        escrow.commitAward(id, actor, gross, source);
    }

    /// @dev The destination wallet signs the exact binding; the authority submits it.
    function bindAs(uint64 actor, address dest) internal returns (uint64 version) {
        (, uint64 current,,,) = escrow.bindings(actor);
        uint256 key = walletKeys[dest];
        require(key != 0, "unknown wallet key");
        bytes32 claim = keccak256(abi.encode(actor, dest, current));
        uint64 expiresAt = uint64(block.timestamp + 1 hours);
        bytes memory signature = OpusWallets.sign(vm, escrow, key, actor, dest, current, claim, expiresAt);
        vm.prank(AUTHORITY);
        escrow.bindDestination(actor, dest, current, claim, expiresAt, signature);
        version = current + 1;
    }

    function check(bool ok, string memory why) internal pure {
        require(ok, why);
    }
}

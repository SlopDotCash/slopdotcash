// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {DeployFactory} from "./DeployFactory.sol";

import {EscrowFactory, IERC20, ProjectEscrow, Purpose} from "../src/ProjectEscrow.sol";
import {TestDollar} from "../integration/TestDollar.sol";

interface Vm {
    function prank(address) external;
    function warp(uint256) external;
    function expectRevert(bytes4) external;
    function expectRevert() external;
    function expectEmit(bool, bool, bool, bool) external;
    function addr(uint256) external pure returns (address);
    function sign(uint256, bytes32) external pure returns (uint8, bytes32, bytes32);
}

/// @dev Contributor-signed bindings and timelocked identity authority rotation (escrow review H-1).
/// No forge-std is vendored; the harness declares the cheatcodes it uses.
contract BoundedAttesterTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant OWNER = address(0xA11CE);
    address internal constant AUTHORITY = address(0xA07);
    address internal constant NEXT_AUTHORITY = address(0xA08);
    address internal constant FEE = address(0xFEE);
    address internal constant REGISTRAR = address(0x5E6);
    uint256 internal constant CONTRIBUTOR_KEY = 0xC0DE;
    uint256 internal constant STRANGER_KEY = 0xBAD;
    uint64 internal constant DELAY = 48 hours;
    uint64 internal constant ACTOR = 101;
    bytes32 internal constant PROJECT = keccak256("project");
    bytes32 internal constant CLAIM = keccak256("claim");

    event IdentityAuthorityRotationProposed(address indexed current, address indexed proposed, uint64 effectiveAt);
    event IdentityAuthorityRotationCancelled(address indexed proposed);
    event IdentityAuthorityRotated(address indexed previous, address indexed current);

    TestDollar internal usdc;
    EscrowFactory internal factory;
    ProjectEscrow internal vault;
    address internal contributor;

    function setUp() public {
        vm.warp(1_800_000_000);
        contributor = vm.addr(CONTRIBUTOR_KEY);
        usdc = new TestDollar();
        vm.prank(REGISTRAR);
        factory = DeployFactory.create(REGISTRAR, FEE, AUTHORITY, DELAY);
        vm.prank(OWNER);
        vault = ProjectEscrow(factory.create(PROJECT, IERC20(address(usdc)), Purpose.Ordinary));
        usdc.mint(OWNER, 1_000_000e6);
        vm.prank(OWNER);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(OWNER);
        vault.deposit(1_000e6);
    }

    function commit(bytes32 source, uint64 gross) internal returns (bytes32 id) {
        id = vault.awardId(source);
        vm.prank(OWNER);
        vault.commitAward(id, ACTOR, gross, source);
    }

    function walletSignature(uint256 key, uint64 expectedVersion, uint64 expiresAt, address destination)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(key, vault.bindingDigest(ACTOR, destination, expectedVersion, CLAIM, expiresAt));
        return abi.encodePacked(r, s, v);
    }

    function bindAs(address authority, uint64 expectedVersion, bytes memory signature) internal {
        vm.prank(authority);
        vault.bindDestination(ACTOR, contributor, expectedVersion, CLAIM, uint64(block.timestamp + 1 hours), signature);
    }

    function activeVersion() internal view returns (uint64 version) {
        (, version,,,) = vault.bindings(ACTOR);
    }

    // Part 1: the destination wallet must sign the binding.

    function test_bindWithoutWalletSignatureReverts() public {
        vm.expectRevert(ProjectEscrow.InvalidWalletSignature.selector);
        bindAs(AUTHORITY, 0, "");
        assertEq(activeVersion(), 0);
    }

    function test_bindWithWrongSignerReverts() public {
        uint64 expiresAt = uint64(block.timestamp + 1 hours);
        bytes memory stranger = walletSignature(STRANGER_KEY, 0, expiresAt, contributor);
        vm.expectRevert(ProjectEscrow.InvalidWalletSignature.selector);
        bindAs(AUTHORITY, 0, stranger);
        assertEq(activeVersion(), 0);
    }

    function test_bindWithSignatureOverOtherFieldsReverts() public {
        uint64 expiresAt = uint64(block.timestamp + 1 hours);
        // Signed for version 1, submitted as version 0.
        bytes memory wrongVersion = walletSignature(CONTRIBUTOR_KEY, 1, expiresAt, contributor);
        vm.expectRevert(ProjectEscrow.InvalidWalletSignature.selector);
        bindAs(AUTHORITY, 0, wrongVersion);
        // Signed for a different expiry.
        bytes memory wrongExpiry = walletSignature(CONTRIBUTOR_KEY, 0, expiresAt + 1, contributor);
        vm.expectRevert(ProjectEscrow.InvalidWalletSignature.selector);
        bindAs(AUTHORITY, 0, wrongExpiry);
        assertEq(activeVersion(), 0);
    }

    function test_signatureCannotReplayOnAnotherVault() public {
        vm.prank(OWNER);
        ProjectEscrow other = ProjectEscrow(factory.create(keccak256("other"), IERC20(address(usdc)), Purpose.Ordinary));
        uint64 expiresAt = uint64(block.timestamp + 1 hours);
        bytes memory signature = walletSignature(CONTRIBUTOR_KEY, 0, expiresAt, contributor);
        vm.prank(AUTHORITY);
        vm.expectRevert(ProjectEscrow.InvalidWalletSignature.selector);
        other.bindDestination(ACTOR, contributor, 0, CLAIM, expiresAt, signature);
    }

    function test_walletSignatureAloneBindsNothing() public {
        uint64 expiresAt = uint64(block.timestamp + 1 hours);
        bytes memory signature = walletSignature(CONTRIBUTOR_KEY, 0, expiresAt, contributor);
        vm.prank(contributor);
        vm.expectRevert(ProjectEscrow.Unauthorized.selector);
        vault.bindDestination(ACTOR, contributor, 0, CLAIM, expiresAt, signature);
    }

    function test_bindWithWalletSignaturePaysAfterDelay() public {
        bytes32 id = commit(keccak256("source"), 100e6);
        uint64 expiresAt = uint64(block.timestamp + 1 hours);
        bindAs(AUTHORITY, 0, walletSignature(CONTRIBUTOR_KEY, 0, expiresAt, contributor));
        assertEq(activeVersion(), 1);
        // The award commitment and binding review periods end together here.
        vm.expectRevert(ProjectEscrow.AwardPending.selector);
        vault.pay(id, 1);
        vm.warp(block.timestamp + DELAY);
        vault.pay(id, 1);
        assertEq(usdc.balanceOf(contributor), 98e6);
    }

    // Part 2: timelocked rotation held by the factory.

    function test_onlyRegistrarProposesAndCancels() public {
        vm.prank(AUTHORITY);
        vm.expectRevert(ProjectEscrow.Unauthorized.selector);
        factory.proposeIdentityAuthority(NEXT_AUTHORITY);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.Unauthorized.selector);
        factory.proposeIdentityAuthority(NEXT_AUTHORITY);
        vm.prank(REGISTRAR);
        factory.proposeIdentityAuthority(NEXT_AUTHORITY);
        vm.prank(AUTHORITY);
        vm.expectRevert(ProjectEscrow.Unauthorized.selector);
        factory.cancelIdentityAuthorityRotation();
    }

    function test_proposalRejectsZeroSameAndRegistrar() public {
        vm.prank(REGISTRAR);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        factory.proposeIdentityAuthority(address(0));
        vm.prank(REGISTRAR);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        factory.proposeIdentityAuthority(AUTHORITY);
        vm.prank(REGISTRAR);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        factory.proposeIdentityAuthority(REGISTRAR);
    }

    function test_rotationProposeCancelExecute() public {
        uint64 effectiveAt = uint64(block.timestamp) + factory.AUTHORITY_ROTATION_DELAY();
        vm.expectEmit(true, true, false, true);
        emit IdentityAuthorityRotationProposed(AUTHORITY, NEXT_AUTHORITY, effectiveAt);
        vm.prank(REGISTRAR);
        factory.proposeIdentityAuthority(NEXT_AUTHORITY);
        assertEq(factory.pendingIdentityAuthority(), NEXT_AUTHORITY);
        assertEq(factory.identityAuthorityEffectiveAt(), effectiveAt);
        // One proposal at a time.
        vm.prank(REGISTRAR);
        vm.expectRevert(EscrowFactory.RotationPending.selector);
        factory.proposeIdentityAuthority(address(0xA09));
        // The registrar can withdraw its own proposal.
        vm.expectEmit(true, false, false, true);
        emit IdentityAuthorityRotationCancelled(NEXT_AUTHORITY);
        vm.prank(REGISTRAR);
        factory.cancelIdentityAuthorityRotation();
        assertEq(factory.pendingIdentityAuthority(), address(0));
        assertEq(factory.identityAuthorityEffectiveAt(), 0);
        vm.expectRevert(EscrowFactory.NoRotationPending.selector);
        factory.executeIdentityAuthorityRotation();
        vm.prank(REGISTRAR);
        vm.expectRevert(EscrowFactory.NoRotationPending.selector);
        factory.cancelIdentityAuthorityRotation();
        // Propose again and execute immediately from a stranger's account.
        vm.prank(REGISTRAR);
        factory.proposeIdentityAuthority(NEXT_AUTHORITY);
        vm.warp(block.timestamp + 7 days);
        vm.expectEmit(true, true, false, true);
        emit IdentityAuthorityRotated(AUTHORITY, NEXT_AUTHORITY);
        vm.prank(vm.addr(STRANGER_KEY));
        factory.executeIdentityAuthorityRotation();
        assertEq(factory.identityAuthority(), NEXT_AUTHORITY);
        assertEq(vault.identityAuthority(), NEXT_AUTHORITY);
        assertEq(factory.pendingIdentityAuthority(), address(0));
    }

    function test_oldAuthorityCannotBindAfterRotation() public {
        vm.prank(REGISTRAR);
        factory.proposeIdentityAuthority(NEXT_AUTHORITY);
        uint64 expiresAt = uint64(block.timestamp + 8 days);
        bytes memory signature = walletSignature(CONTRIBUTOR_KEY, 0, expiresAt, contributor);
        // Until execution the current authority still binds.
        vm.warp(block.timestamp + 7 days - 1);
        vm.prank(AUTHORITY);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        vault.bindDestination(ACTOR, contributor, 1, CLAIM, expiresAt, signature);
        vm.warp(block.timestamp + 1);
        factory.executeIdentityAuthorityRotation();
        vm.prank(AUTHORITY);
        vm.expectRevert(ProjectEscrow.Unauthorized.selector);
        vault.bindDestination(ACTOR, contributor, 0, CLAIM, expiresAt, signature);
        vm.prank(NEXT_AUTHORITY);
        vault.bindDestination(ACTOR, contributor, 0, CLAIM, expiresAt, signature);
        assertEq(activeVersion(), 1);
    }

    function test_existingBindingsRemainValidAcrossRotation() public {
        bytes32 first = commit(keccak256("first"), 100e6);
        bytes32 second = commit(keccak256("second"), 50e6);
        uint64 expiresAt = uint64(block.timestamp + 1 hours);
        // An active binding made by the old authority.
        bindAs(AUTHORITY, 0, walletSignature(CONTRIBUTOR_KEY, 0, expiresAt, contributor));
        vm.warp(block.timestamp + DELAY);
        vault.pay(first, 1);
        vm.prank(REGISTRAR);
        factory.proposeIdentityAuthority(NEXT_AUTHORITY);
        factory.executeIdentityAuthorityRotation();
        // Pays through the same binding after the rotation.
        vault.pay(second, 1);
        assertEq(usdc.balanceOf(contributor), 147e6);
        // A recent binding remains immediately payable across execution.
        bytes32 third = commit(keccak256("third"), 10e6);
        uint64 later = uint64(block.timestamp + 1 hours);
        vm.prank(REGISTRAR);
        factory.proposeIdentityAuthority(address(0xA09));
        vm.warp(block.timestamp + 7 days - 1 hours);
        later = uint64(block.timestamp + 1 hours);
        bindAs(NEXT_AUTHORITY, 1, walletSignature(CONTRIBUTOR_KEY, 1, later, contributor));
        vm.warp(block.timestamp + 1 hours);
        factory.executeIdentityAuthorityRotation();
        vault.pay(third, 2);
        assertEq(usdc.balanceOf(contributor), 156_800_000);
    }

    function test_ownerCanStillCancelDuringRotationWindow() public {
        vm.prank(REGISTRAR);
        factory.proposeIdentityAuthority(NEXT_AUTHORITY);
        uint64 expiresAt = uint64(block.timestamp + 1 hours);
        bindAs(AUTHORITY, 0, walletSignature(CONTRIBUTOR_KEY, 0, expiresAt, contributor));
        vm.prank(OWNER);
        vault.cancelBinding(ACTOR, 1);
        (,,,, bool cancelled) = vault.bindings(ACTOR);
        assertEq(cancelled ? 1 : 0, 1);
    }

    uint256 internal constant ATTACKER_KEY = 0xBADBAD;

    /// @dev Binds ACTOR to the wallet of `key`, submitted by `authority`, with that wallet's signature.
    function bindWallet(address authority, uint256 key, uint64 expectedVersion) internal {
        uint64 expiresAt = uint64(block.timestamp + 1 hours);
        address destination = vm.addr(key);
        bytes memory signature = walletSignature(key, expectedVersion, expiresAt, destination);
        vm.prank(authority);
        vault.bindDestination(ACTOR, destination, expectedVersion, CLAIM, expiresAt, signature);
    }

    /// Owner cancellations mined before payment remain effective during authority rotation.
    /// This does not assert a guaranteed intervention window: verified bindings activate immediately.
    function test_cancelBeforePaymentDuringRotation() public {
        bytes32 id = commit(keccak256("h1"), 100e6);
        vm.prank(REGISTRAR);
        factory.proposeIdentityAuthority(NEXT_AUTHORITY);
        uint64 rotationAt = factory.identityAuthorityEffectiveAt();
        uint64 version = 0;
        for (uint256 i = 0; i < vault.MAX_CANCELS_BETWEEN_PAYMENTS(); i++) {
            bindWallet(AUTHORITY, ATTACKER_KEY, version);
            version++;
            vm.warp(block.timestamp + DELAY - 1);
            (, uint64 payable_) = vault.payableBinding(ACTOR);
            assertEq(payable_, version);
            vm.prank(OWNER);
            vault.cancelBinding(ACTOR, version);
            vm.warp(block.timestamp + 1);
        }
        // Three cancels during the notice period, none counted against the cap.
        assertEq(vault.cancelCount(ACTOR), 0);
        bindWallet(AUTHORITY, ATTACKER_KEY, version);
        version++;
        if (block.timestamp < rotationAt) vm.warp(rotationAt);
        factory.executeIdentityAuthorityRotation();
        // The stolen key can no longer bind.
        uint64 expiresAt = uint64(block.timestamp + 1 hours);
        address attacker = vm.addr(ATTACKER_KEY);
        bytes memory stolen = walletSignature(ATTACKER_KEY, version, expiresAt, attacker);
        vm.prank(AUTHORITY);
        vm.expectRevert(ProjectEscrow.Unauthorized.selector);
        vault.bindDestination(ACTOR, attacker, version, CLAIM, expiresAt, stolen);
        // The new authority binds the contributor's wallet with the contributor's signature. It replaces the
        // attacker binding before any payment is submitted.
        bindWallet(NEXT_AUTHORITY, CONTRIBUTOR_KEY, version);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        vault.pay(id, version);
        if (block.timestamp < rotationAt + DELAY) vm.warp(rotationAt + DELAY);
        vault.pay(id, version + 1);
        assertEq(usdc.balanceOf(attacker), 0);
        assertEq(usdc.balanceOf(contributor), 98e6);
    }

    /// A prior cancellation does not consume the cap waived during pending authority rotation.
    function test_cancelBeforePaymentDuringRotationAfterPriorCancel() public {
        bytes32 id = commit(keccak256("h1-prior"), 100e6);
        // One ordinary cancel before the compromise: the contributor's own binding, retracted by the owner.
        bindWallet(AUTHORITY, CONTRIBUTOR_KEY, 0);
        vm.prank(OWNER);
        vault.cancelBinding(ACTOR, 1);
        assertEq(vault.cancelCount(ACTOR), 1);
        uint64 version = 1;
        // The key is stolen; the registrar proposes a replacement at once.
        vm.prank(REGISTRAR);
        factory.proposeIdentityAuthority(NEXT_AUTHORITY);
        uint64 rotationAt = factory.identityAuthorityEffectiveAt();
        // Three attacker bindings, each cancelled late in its review period: cancels 2, 3 and 4 since the last
        // payment, more than the cap allows outside a rotation.
        for (uint256 i = 0; i < vault.MAX_CANCELS_BETWEEN_PAYMENTS(); i++) {
            bindWallet(AUTHORITY, ATTACKER_KEY, version);
            version++;
            vm.warp(block.timestamp + DELAY - 1);
            (, uint64 payable_) = vault.payableBinding(ACTOR);
            assertEq(payable_, version);
            vm.prank(OWNER);
            vault.cancelBinding(ACTOR, version);
            vm.warp(block.timestamp + 1);
        }
        // Waived cancels are not counted.
        assertEq(vault.cancelCount(ACTOR), 1);
        // The fourth binding is active; the test does not submit a payment before replacement.
        bindWallet(AUTHORITY, ATTACKER_KEY, version);
        version++;
        if (block.timestamp < rotationAt) vm.warp(rotationAt);
        factory.executeIdentityAuthorityRotation();
        // The new authority replaces the attacker binding before any payment is submitted.
        bindWallet(NEXT_AUTHORITY, CONTRIBUTOR_KEY, version);
        vm.expectRevert(ProjectEscrow.InvalidBinding.selector);
        vault.pay(id, version);
        if (block.timestamp < rotationAt + DELAY) vm.warp(rotationAt + DELAY);
        vault.pay(id, version + 1);
        assertEq(usdc.balanceOf(vm.addr(ATTACKER_KEY)), 0);
        assertEq(usdc.balanceOf(contributor), 98e6);
        assertEq(vault.cancelCount(ACTOR), 0);
    }

    /// Without a pending rotation the cap is unchanged: three cancels since the last payment, then the next
    /// binding cannot be cancelled.
    function test_cancelCapStillAppliesWithoutPendingRotation() public {
        commit(keccak256("cap"), 100e6);
        uint64 version = 0;
        for (uint256 i = 0; i < vault.MAX_CANCELS_BETWEEN_PAYMENTS(); i++) {
            bindWallet(AUTHORITY, CONTRIBUTOR_KEY, version);
            version++;
            vm.prank(OWNER);
            vault.cancelBinding(ACTOR, version);
            assertEq(vault.cancelCount(ACTOR), i + 1);
        }
        bindWallet(AUTHORITY, CONTRIBUTOR_KEY, version);
        version++;
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.CancelLimit.selector);
        vault.cancelBinding(ACTOR, version);
        assertEq(vault.cancelCount(ACTOR), vault.MAX_CANCELS_BETWEEN_PAYMENTS());
    }

    /// The waiver lasts exactly as long as the proposal is pending: once the registrar withdraws it, the cap
    /// applies again with the count the owner had before, because waived cancels never counted.
    function test_cancelCapResumesWhenRotationIsCancelled() public {
        commit(keccak256("resume"), 100e6);
        uint64 version = 0;
        for (uint256 i = 0; i < vault.MAX_CANCELS_BETWEEN_PAYMENTS(); i++) {
            bindWallet(AUTHORITY, CONTRIBUTOR_KEY, version);
            version++;
            vm.prank(OWNER);
            vault.cancelBinding(ACTOR, version);
        }
        bindWallet(AUTHORITY, CONTRIBUTOR_KEY, version);
        version++;
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.CancelLimit.selector);
        vault.cancelBinding(ACTOR, version);
        // A pending proposal lifts the cap; the cancel is not counted.
        vm.prank(REGISTRAR);
        factory.proposeIdentityAuthority(NEXT_AUTHORITY);
        vm.prank(OWNER);
        vault.cancelBinding(ACTOR, version);
        assertEq(vault.cancelCount(ACTOR), vault.MAX_CANCELS_BETWEEN_PAYMENTS());
        // Withdrawing the proposal restores the cap at once.
        vm.prank(REGISTRAR);
        factory.cancelIdentityAuthorityRotation();
        bindWallet(AUTHORITY, CONTRIBUTOR_KEY, version);
        version++;
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.CancelLimit.selector);
        vault.cancelBinding(ACTOR, version);
        // The eligible award pays through the uncancelled binding.
        vm.warp(block.timestamp + DELAY);
        (, uint64 payable_) = vault.payableBinding(ACTOR);
        assertEq(payable_, version);
    }

    function test_vaultsAreCreatedOnlyByTheFactory() public {
        vm.expectRevert();
        vault.initialize(PROJECT, IERC20(address(usdc)), OWNER, Purpose.Ordinary, FEE, DELAY);
    }

    function test_factoryRejectsRegistrarAsAuthority() public {
        vm.prank(REGISTRAR);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        DeployFactory.create(REGISTRAR, FEE, REGISTRAR, DELAY);
    }

    function assertEq(uint256 a, uint256 b) internal pure {
        require(a == b, "assertEq(uint)");
    }

    function assertEq(address a, address b) internal pure {
        require(a == b, "assertEq(address)");
    }
}

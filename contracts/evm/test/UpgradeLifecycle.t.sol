// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ProjectEscrow, EscrowFactory, IERC20, Purpose} from "../src/ProjectEscrow.sol";
import {OpusBase} from "./OpusBase.sol";

contract VaultNext is ProjectEscrow {
    function revision() external pure returns (uint256) {
        return 2;
    }
}

contract FactoryNext is EscrowFactory {
    function revision() external pure returns (uint256) {
        return 2;
    }
}

/// @dev A real funded proxy lifecycle: retain obligations and signatures across both upgrades.
contract UpgradeLifecycleTest is OpusBase {
    function test_upgradeFundedVaultAndPayImmediately() public {
        deployWithDelay(0);
        fund(1_000e6);
        bytes32 source = keccak256("upgrade-paid");
        bytes32 id = commit(source, 101, 100e6);
        bytes32 held = commit(keccak256("upgrade-unclaimed"), 102, 50e6);
        uint64 version = bindAs(101, ALICE_WALLET);

        VaultNext nextVault = new VaultNext();
        FactoryNext nextFactory = new FactoryNext();
        address upgradeOwner = factory.upgradeAuthority();
        {
            address[3] memory denied = [FEE, AUTHORITY, OWNER];
            for (uint256 i; i < denied.length; ++i) {
                vm.prank(denied[i]);
                vm.expectRevert(ProjectEscrow.Unauthorized.selector);
                escrow.upgradeToAndCall(address(nextVault), "");
                vm.prank(denied[i]);
                vm.expectRevert(ProjectEscrow.Unauthorized.selector);
                factory.upgradeToAndCall(address(nextFactory), "");
            }
        }
        vm.prank(upgradeOwner);
        factory.upgradeToAndCall(
            address(nextFactory), abi.encodeCall(EscrowFactory.setVaultImplementation, (address(nextVault)))
        );
        vm.prank(upgradeOwner);
        escrow.upgradeToAndCall(address(nextVault), "");
        check(FactoryNext(address(factory)).revision() == 2, "factory upgraded");
        check(VaultNext(address(escrow)).revision() == 2, "vault upgraded");
        check(escrow.owner() == OWNER && escrow.identityAuthority() == AUTHORITY, "roles preserved");
        check(escrow.reservedPrincipal() == 147e6 && escrow.reservedFees() == 3e6, "reserved preserved");
        check(escrow.freeBalance() == 850e6, "free balance preserved");
        check(escrow.consumedSources(source), "source replay guard preserved");
        check(!escrow.monthlyEnabled() && escrow.monthlyCap() == 0, "existing monthly choice preserved");
        vm.prank(OWNER);
        ProjectEscrow created = ProjectEscrow(
            factory.createWithMonthlyCommitment(keccak256("new-monthly-project"), IERC20(address(usdc)), 50e6, true)
        );
        check(VaultNext(address(created)).revision() == 2, "new vault uses selected implementation");
        check(created.owner() == OWNER && created.monthlyEnabled() && created.monthlyCap() == 50e6, "monthly setup");
        {
            (address destination, uint64 currentVersion) = escrow.payableBinding(101);
            check(destination == ALICE_WALLET && currentVersion == version, "signed binding preserved");
        }
        // No warp: commitment, upgrades and payment all use the same timestamp.
        escrow.pay(id, version);
        check(usdc.balanceOf(ALICE_WALLET) == 98e6 && escrow.accruedFees() == 2e6, "exact payment");
        check(escrow.reservedPrincipal() == 49e6 && escrow.reservedFees() == 1e6, "unclaimed stays reserved");
        (,,,,, bool paid) = escrow.awards(held);
        check(!paid, "unclaimed not paid");
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        escrow.pay(id, version);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.DuplicateAward.selector);
        escrow.commitAward(id, 101, 100e6, source);
        vm.expectRevert();
        escrow.initialize(keccak256("replacement"), IERC20(address(usdc)), OWNER, Purpose.Ordinary, FEE, 0);
        vm.expectRevert();
        nextFactory.initialize(REGISTRAR, FEE, AUTHORITY, 0, upgradeOwner, address(nextVault));
        // A registrar rotation can execute immediately and preserves the wallet binding.
        vm.prank(REGISTRAR);
        factory.proposeIdentityAuthority(address(0x1234));
        factory.executeIdentityAuthorityRotation();
        check(escrow.identityAuthority() == address(0x1234), "immediate authority rotation");
        // Upgrade transfer requires the new authority, with no waiting period.
        vm.prank(upgradeOwner);
        factory.proposeUpgradeAuthority(address(0x9999));
        vm.prank(address(0x9999));
        factory.acceptUpgradeAuthority();
        vm.prank(upgradeOwner);
        vm.expectRevert(ProjectEscrow.Unauthorized.selector);
        escrow.upgradeToAndCall(address(nextVault), "");
        vm.prank(address(0x9999));
        escrow.upgradeToAndCall(address(nextVault), "");
    }
}

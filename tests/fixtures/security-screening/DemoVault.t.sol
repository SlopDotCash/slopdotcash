// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "./DemoVault.sol";

interface Vm {
    function deal(address, uint256) external;
    function prank(address) external;
    function expectRevert(bytes calldata) external;
}

contract FixedDemoVault is DemoVault {
    function withdraw(address account, uint256 amount) public override {
        require(msg.sender == account, "owner");
        super.withdraw(account, amount);
    }
}

contract DemoVaultTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant alice = address(0xA11CE);
    address constant bob = address(0xB0B);

    function testUnauthorizedWithdrawalTransfersAliceDepositToBob() public {
        DemoVault vault = new DemoVault();
        vm.deal(alice, 100);
        vm.deal(bob, 0);
        vm.prank(alice);
        vault.deposit{value: 100}();
        vm.prank(bob);
        vault.withdraw(alice, 100);
        require(vault.balances(alice) == 0, "alice recorded balance");
        require(bob.balance == 100, "bob received deposit");
        require(address(vault).balance == 0, "vault emptied");
    }

    function testOwnerCheckRejectsBobAndPreservesAliceDeposit() public {
        DemoVault vault = new FixedDemoVault();
        vm.deal(alice, 100);
        vm.deal(bob, 0);
        vm.prank(alice);
        vault.deposit{value: 100}();
        vm.expectRevert(bytes("owner"));
        vm.prank(bob);
        vault.withdraw(alice, 100);
        require(vault.balances(alice) == 100, "alice deposit preserved");
        require(bob.balance == 0, "bob received nothing");
        require(address(vault).balance == 100, "vault preserved");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {EscrowFactory, ProjectEscrow, ERC1967Proxy} from "../src/ProjectEscrow.sol";

/// @dev Constructor boundary lets existing revert assertions cover atomic proxy initialization.
contract FactoryFixture {
    EscrowFactory public factory;

    constructor(address registrar, address fee, address identity, uint64 delay) {
        ProjectEscrow vaultLogic = new ProjectEscrow();
        EscrowFactory logic = new EscrowFactory();
        factory = EscrowFactory(
            address(
                new ERC1967Proxy(
                    address(logic),
                    abi.encodeCall(
                        EscrowFactory.initialize,
                        (registrar, fee, identity, delay, address(0xABCDE), address(vaultLogic))
                    )
                )
            )
        );
    }
}

library DeployFactory {
    function create(address registrar, address fee, address identity, uint64 delay) internal returns (EscrowFactory) {
        FactoryFixture fixture = new FactoryFixture(registrar, fee, identity, delay);
        if (address(fixture).code.length == 0) return EscrowFactory(address(0));
        return fixture.factory();
    }
}

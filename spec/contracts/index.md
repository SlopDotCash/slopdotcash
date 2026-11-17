# On-chain escrow contracts

The contracts of `packages/contracts`: the EVM escrow factory and vaults
under `evm/`, and the Solana Anchor escrow program under `solana/`. Each
specification models the contract's own state from its source, every
revert as a refused event, and the invariants the code maintains. Off-chain
settlement, evidence and signer rules stay in [settlement](../settlement/);
the referral distributor is [its own contract model](../settlement/referralDistributor.md).

- [Escrow ledger shared by both chains](./ledger.md)
- [Month pledges shared by both chains](./monthPledge.md)
- [EVM project escrow](./evmEscrow.md)
- [Solana project escrow program](./solanaEscrow.md)

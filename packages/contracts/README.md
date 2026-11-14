# @repo/contracts

Slop's project escrow contracts, copied from SlopDotCash/slopdotcash
(`development`, `5268ca066`) without the TypeScript adapters, Workers and
scripts that drive them.

| Path | Holds |
|---|---|
| [`evm/`](evm/README.md) | `ProjectEscrow` and `EscrowFactory` (UUPS), the fee library `EscrowMath`, `ReferralDistributor`, vendored OpenZeppelin v5.5.0, Foundry tests and deploy scripts |
| [`solana/`](solana/README.md) | The Anchor program `slop-escrow`, its IDL and `scripts/build-local.sh` |
| [`DEPLOY-MAINNET.md`](DEPLOY-MAINNET.md) | The mainnet deployment runbook of the source repository |

## Commands

| Command | Runs |
|---|---|
| `pnpm --filter @repo/contracts build` | `forge build`, and `cargo check --locked` of the program |
| `pnpm --filter @repo/contracts test` | every Foundry suite, invariants included; the SMTChecker run below; `cargo test --locked` |

They need Foundry 1.7.1 (it installs solc 0.8.30), a Rust toolchain with
`cargo`, and `z3` on `PATH` (4.12.5 is the version checked). Cargo builds
into `solana/.cache/target`.

An SBF build needs Anchor 0.32.1 and the Solana platform tools v1.52:
`solana/scripts/build-local.sh`. `cargo-build-sbf` stops on any directory in
`~/.cache/solana` that is not a tools version; run it with `HOME` pointing to
a directory whose `.cache/solana` holds only `v1.52`.

## Money invariants

Each property is an `assert` in the source, so it is also checked at run time
by every Foundry test and the invariant campaign, and never fails there.

| Property | Assert | SMTChecker |
|---|---|---|
| The 2% fee is `ceil(gross / 50)`: `50 * fee >= gross` and `50 * fee < gross + 50` | `EscrowMath.payoutFee` | proved |
| A bounty fee is exactly 25%, the researcher's principal exactly 75% | `EscrowMath.bountyFee` | proved |
| No division by zero, overflow or underflow in either | `EscrowMath` | proved |
| `totalDeposited == freeBalance + pendingMonthlyGross + reservedPrincipal + reservedFees + totalPaid + totalPayoutFees + totalGrossWithdrawn`: every money-moving function changes the right side by what it adds to the left | `ProjectEscrow.conserves` | not proved |
| A payment never exceeds what is reserved for it | `ProjectEscrow.pay` | not proved |
| One allocation root per period, within the owner's monthly cap | `commitMonthly`, `reserveMonthly` | not proved |
| A release returns the whole admitted reserve, once | `releaseMonthlyReserve` | not proved |

`FOUNDRY_PROFILE=smt forge build --deny warnings src/EscrowMath.sol`, run in
`evm/` by `test`, checks `EscrowMath` with the BMC engine: the library has no
loops or calls, so BMC explores every path for every input, under the solver's
deterministic resource limit. A violated or unproved target is a warning, and
the run fails on it.

The four rows not proved hold for the whole contract, not one pure function.
Neither engine finishes on `ProjectEscrow`: its loops over allocations,
`keccak256` and `ecrecover` digests, nonlinear calendar arithmetic and token
calls leave CHC without an invariant and BMC without an answer in hours. The
conservation identity is also a property of all calls together, and the payment
bound needs the sum of every unpaid award, which the SMTChecker cannot state
over a mapping. Foundry's `OpusInvariant` campaign checks both identities after
every call.

## Monthly reserve release

`releaseMonthlyReserve` returns the whole untouched reserve of a period whose
admitted root has the wrong total, exactly once, as the Solana program's
`release_monthly_reserve` does
([spec/settlement/reserveRelease.md](../../spec/settlement/reserveRelease.md)).
A committed leaf, an earlier release or a partial amount refuses it. The
source release allowed partial and repeated releases; this package's version
refuses them, with the same ABI, signature digest and storage layout.

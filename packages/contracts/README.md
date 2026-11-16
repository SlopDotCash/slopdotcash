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
| `pnpm --filter @repo/contracts test` | every Foundry suite, invariants included; the SMTChecker runs below; `cargo test --locked` |

They need Foundry 1.7.1 (it installs solc 0.8.30), a Rust toolchain with
`cargo`, and `z3` on `PATH` (4.12.5 is the version checked). Cargo builds
into `solana/.cache/target`.

An SBF build needs Anchor 0.32.1 and the Solana platform tools v1.52:
`solana/scripts/build-local.sh`. `cargo-build-sbf` stops on any directory in
`~/.cache/solana` that is not a tools version; run it with `HOME` pointing to
a directory whose `.cache/solana` holds only `v1.52`.

## Money invariants

Each property is an `assert`. Those in `evm/src` are also checked at run time
by every Foundry test and the invariant campaign, and never fail there.

| Property | Assert | SMTChecker |
|---|---|---|
| The 2% fee is `ceil(gross / 50)`: `50 * fee >= gross` and `50 * fee < gross + 50` | `EscrowMath.payoutFee` | proved (BMC) |
| A bounty fee is exactly 25%, the researcher's principal exactly 75% | `EscrowMath.bountyFee` | proved (BMC) |
| No division by zero, overflow or underflow in either | `EscrowMath` | proved (BMC) |
| Neither fee exceeds its gross, so `gross - fee` in `recordAward`, `pay` and `withdrawUnused` never underflows | `EscrowLemmas.feeNeverExceedsGross` | proved (CHC) |
| The fee is the floor fee `gross / 50` or one more, so an award reserved before fees rounded up differs from the current fee by at most one unit; `commitMonthly` accepts either | `EscrowLemmas.feeIsFloorFeeOrOneMore` | proved (CHC) |
| Splitting an amount in two never lowers the total fee | `EscrowLemmas.splittingNeverLowersTheFee` | proved (CHC) |
| `totalDeposited == freeBalance + pendingMonthlyGross + reservedPrincipal + reservedFees + totalPaid + totalPayoutFees + totalGrossWithdrawn`: every money-moving function changes the right side by what it adds to the left | `ProjectEscrow.conserves` | not proved |
| A payment never exceeds what is reserved for it | `ProjectEscrow.pay` | not proved |
| One allocation root per period, within the owner's monthly cap | `commitMonthly`, `reserveMonthly` | not proved |
| A release returns the whole admitted reserve, once | `releaseMonthlyReserve` | not proved |

`test` runs two checks in `evm/`, each with `--force`, so a cached build never
skips the check, and `--deny warnings`, so a violated or unproved target fails
the run. The `smt` profile checks `src/EscrowMath.sol` with BMC: the library
has no loops or calls, so BMC explores every path for every input. The
`smt_chc` profile proves with CHC the lemmas of `test/smt/EscrowLemmas.sol`,
a contract that is never deployed and calls the same internal `EscrowMath`
functions that `ProjectEscrow` inlines. Both run under the solver's
deterministic resource limit.

The four rows not proved hold for the whole contract, not one pure function.
The solc 0.8.30 SMTChecker does not model `revert` with a custom error, which
every guard of `ProjectEscrow` uses, so it cannot prove an assert that depends
on a guard. `ProjectEscrow` also has loops over allocations, `keccak256` and
`ecrecover` digests, token calls and the inline assembly of its OpenZeppelin
base. The conservation identity is a property of all calls together, and the
payment bound needs the sum of every unpaid award, which the SMTChecker cannot
state over a mapping. Foundry's `OpusInvariant` campaign checks both identities
after every call. Neither engine proved within 900 seconds that a monthly window
lasts 28 to 31 days; `MonthlyCommitment` and `MonthlyReserveV2` check sampled
windows, including a year boundary.

## Monthly reserve release

`releaseMonthlyReserve` returns the whole untouched reserve of a period whose
admitted root has the wrong total, exactly once, as the Solana program's
`release_monthly_reserve` does
([spec/settlement/reserveRelease.md](../../spec/settlement/reserveRelease.md)).
A committed leaf, an earlier release or a partial amount refuses it. The
source release allowed partial and repeated releases; this package's version
refuses them, with the same ABI, signature digest and storage layout.

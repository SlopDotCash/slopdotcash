# @repo/contracts

Slop's project escrow contracts, copied from SlopDotCash/slopdotcash
(`development`, `5268ca066`, with its month pledges from `a52ce0e56`) without
the TypeScript adapters, Workers and scripts that drive them.

| Path | Holds |
|---|---|
| [`evm/`](evm/README.md) | `ProjectEscrow` and `EscrowFactory` (UUPS), the libraries `EscrowMath` (fees) and `MonthlyCalendar` (monthly windows), `ReferralDistributor` and its `ReferralClaims`, vendored OpenZeppelin v5.5.0, Foundry tests and deploy scripts |
| [`solana/`](solana/README.md) | The Anchor program `slop-escrow`, its IDL and `scripts/build-local.sh` |
| [`DEPLOY-MAINNET.md`](DEPLOY-MAINNET.md) | The mainnet deployment runbook of the source repository |

## Commands

| Command | Runs |
|---|---|
| `pnpm --filter @repo/contracts build` | `forge build`, and `cargo check --locked` of the program |
| `pnpm --filter @repo/contracts test` | every Foundry suite, invariants included; the SMTChecker runs below; `cargo test --locked` |
| `npm run test:e2e` in `solana/` | the contract-only validator suite; see [solana/README.md](solana/README.md#local-build-and-end-to-end-tests) |

They need Foundry 1.7.1 (it installs solc 0.8.30), a Rust toolchain with
`cargo`, and `z3` on `PATH` (4.12.5 is the version checked). Cargo builds
into `solana/.cache/target`.

An SBF build needs Anchor 0.32.1 and the Solana platform tools v1.52:
`solana/scripts/build-local.sh`. `cargo-build-sbf` stops on any directory in
`~/.cache/solana` that is not a tools version; run it with `HOME` pointing to
a directory whose `.cache/solana` holds only `v1.52`.

## Money invariants

No property is a run-time `assert` in `ProjectEscrow`: the escrow with month
pledges is 22 bytes under the EIP-170 limit, and run-time checks would put it
over. Each property is proved by the solc SMTChecker for every input,
or checked after every call of Foundry's invariant campaigns.

| Property | Where | Checked by |
|---|---|---|
| The 2% fee is `ceil(gross / 50)`: `50 * fee >= gross` and `50 * fee < gross + 50` | `EscrowLemmas.feeIsTheCeiling` | proved (CHC) |
| A bounty fee is exactly 25%, the researcher's principal exactly 75% | `EscrowLemmas.bountySplitsExactly` | proved (CHC) |
| No division by zero, overflow or underflow in either fee | `EscrowMath` | proved (BMC) |
| Neither fee exceeds its gross, so `gross - fee` in `recordAward`, `pay` and `withdrawUnused` never underflows | `EscrowLemmas.feeNeverExceedsGross` | proved (CHC) |
| The fee is the floor fee `gross / 50` or one more, so an award reserved before fees rounded up differs from the current fee by at most one unit; `commitMonthly` accepts either | `EscrowLemmas.feeIsFloorFeeOrOneMore` | proved (CHC) |
| Splitting an amount in two never lowers the total fee | `EscrowLemmas.splittingNeverLowersTheFee` | proved (CHC) |
| `totalDeposited == freeBalance + pendingMonthlyGross + reservedPrincipal + reservedFees + totalPaid + totalPayoutFees + totalGrossWithdrawn` | `OpusInvariant`, `MonthPledgeInvariant` `invariant_supplyIdentity` | invariant campaign |
| The vault's balance is what it accounts for, plus donations | `OpusInvariant.invariant_balanceIdentity` | invariant campaign |
| Free funds always cover open pledges, and the pledged total is the sum of open pledges | `MonthPledgeInvariant` | invariant campaign |
| A payment never exceeds what is reserved for it, and each award pays once | `OpusInvariant.invariant_paymentsExactOnceAndRouted` | invariant campaign |
| One allocation root per period, within the period's cap: the larger of the monthly cap and its open pledge | `MonthlyCommitment`, `MonthPledge` tests | unit and fuzz tests |
| A release returns the whole admitted reserve, once | `MonthlyReserveV2` tests | unit tests |
| No division by zero, overflow or underflow in the checked steps of the monthly window and the current period | `MonthlyCalendar` | proved (BMC) |
| `monthlyWindow` refuses exactly the periods outside 200001 to 999912, so a valid window never opens at zero | `CalendarLemmas.onlyAnInvalidPeriodHasNoWindow` | proved (BMC, single-lemma z3 4.12.5 run; opt-in profile) |
| A window opens before it closes, and the next period's window opens when it closes: window starts strictly increase per period | `CalendarLemmas.windowStartIncreasesPerPeriod` | BMC, not finished |
| `currentPeriod` is a calendar month for every time before year 42949673, from which YYYYMM no longer fits in `uint32` | `CalendarLemmas.periodIsACalendarMonth` | BMC, not finished |
| Every window and current period is development's: years 2000 to 2899 and 9100 to 9999, the second before, at and a day after every month start from 1970 to 2800, and fuzzed periods and times | `MonthlyCommitment` `...Development...` tests | unit and fuzz tests |
| No overflow or underflow in a referral claim | `ReferralClaims` | proved (BMC) |
| A payable claim pays the cumulative less what the account claimed, and the claimed total never exceeds the root's total | `ReferralLemmas.claimNeverExceedsTotal` | proved (CHC) |
| The root's remainder after a payable claim, `total - (totalClaimed + amount)`, is never negative | `ReferralLemmas.remainingIsNeverNegative` | proved (CHC) |
| A claim is refused only when nothing is new, it exceeds the total, or the claimed total would overflow | `ReferralLemmas.refusesOnlyWhatDoesNotFit` | proved (CHC) |
| `claim` and `claimable` answer, pay and revert exactly as development's inline arithmetic | `ReferralDistributor` `...Development...` tests | fuzz tests |

`test` runs two checks in `evm/`, each with `--force`, so a cached build never
skips the check, and `--deny warnings`, so a violated or unproved target fails
the run. The `smt` profile checks `src/EscrowMath.sol`, `src/MonthlyCalendar.sol`
and `src/ReferralClaims.sol` with BMC under the solver's deterministic resource
limit: the libraries have no loops or calls, so BMC explores every path for
every input. The `smt_chc` profile proves with CHC, under the solver's
deterministic resource limit, the lemmas of `test/smt/EscrowLemmas.sol` and
`test/smt/ReferralLemmas.sol`. The separate opt-in `smt_calendar` profile checks
`test/smt/CalendarLemmas.sol` with BMC and no solver limit (`timeout = 0`, run via
`FOUNDRY_PROFILE=smt_calendar forge build --force --deny warnings test/smt/CalendarLemmas.sol`);
it is kept out of `pnpm test` and CI because solc encodes narrowing conversions
such as `uint32(x)` with `int2bv`, and z3 needs hours for the calendar lemmas: a
standalone single-lemma `z3 4.12.5` run proved `onlyAnInvalidPeriodHasNoWindow`
in 97 minutes (not the default CI solver or profile), while the other two lemmas
remain unfinished. All three lemma contracts are never deployed and call the same
internal library functions that `ProjectEscrow` and `ReferralDistributor` inline.

The SMTChecker does not check `unchecked` arithmetic. `MonthlyCalendar` leaves
unchecked only divisions, and sums and products of values that its `uint64`
and `uint32` inputs keep below 2^100: checking them put `ProjectEscrow` over
the size limit. `currentPeriod` takes the block time as `uint64`, the width of
every EVM block header's timestamp. Its civil-from-days arithmetic is all of
that kind, so only `periodIsACalendarMonth` states anything about it, and the
equivalence tests with development's loop carry it. `ReferralClaims` reports a claimed total that
would overflow, and `ReferralDistributor` then reaches the same checked
addition, so a claim reverts with the same panic as before.

The whole-contract rows are not proved. The solc 0.8.30 SMTChecker does not
model `revert` with a custom error, which every guard of `ProjectEscrow` uses,
and the contract has loops over allocations, `keccak256` and `ecrecover`
digests, token calls and the inline assembly of its OpenZeppelin base. The
conservation identity is a property of all calls together, and the payment
bound needs the sum of every unpaid award, which the SMTChecker cannot state
over a mapping. Neither engine proved within 900 seconds that a monthly window
lasts 28 to 31 days; the equivalence tests compare every window of the years
above with development's.

## Monthly reserve release

`releaseMonthlyReserve` returns the whole untouched reserve of a period whose
admitted root has the wrong total, exactly once, as the Solana program's
`release_monthly_reserve` does
([spec/settlement/reserveRelease.md](../../spec/settlement/reserveRelease.md)).
A committed leaf, an earlier release or a partial amount refuses it. The
source release allowed partial and repeated releases; this package's version
refuses them, with the same ABI, signature digest and storage layout.

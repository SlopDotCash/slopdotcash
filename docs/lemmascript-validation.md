# LemmaScript validation record

## Reproduction

The initial research started from development commit
`e3d7dea64f1171f5761033069b98de4fd5cc1e77`. Follow-up commits track the
coordinated Quint integration branch; each final review must use current
`origin/development`. Runtime contracts and proof
artifacts are listed in `LemmaScript-files.txt`; their exact source hashes,
command output and current results are written to ignored
`evidence/lemmascript/<run>/result.json`. These receipts, not the static counts
below, establish what a particular run checked.

Use Node 24, lockfile-pinned Bun 1.3.14, LemmaScript 0.6.6, and Dafny 4.11.0:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run lemmascript:setup
bun run lemmascript:check
```

The eight proof modules contain 41 selected runtime functions. The check uses
Dafny's `--isolate-assertions` option, which proves every assertion in a separate
obligation. It does not filter or skip assertions. The completed run reports
1,364 verified obligations: 142 money, 40 frontend, 231 fee-converter, 26 worker
policy, 65 evidence-partition, 5 budget/timeout, 662 complete-allocation and 193
decimal-parsing obligations, with zero errors. These counts cannot be compared directly with
the earlier 60 declaration checks because the proof splitting changed.
Neither count is a function coverage percentage.

The default timeout is 30 seconds per prover obligation; the runner also
bounds each subprocess and kills the subprocess group on timeout. Explicit
nonnegative quotient assertions were added to two existing division lemmas
so their proofs do not depend on facts from another assertion group.

### Complete numerical allocation

`verified-allocation.ts` contains the executable sum, merge sort and full
largest-remainder algorithm. All four functions are verified together without
imported-method or native-sort axioms. The proof applies to every finite array
of nonnegative BigInt weights and every nonnegative BigInt total. Positive
weight sum gives exact conservation; empty or all-zero weights give zero.
The result preserves the array length, bounds every share by the total, gives
floor-or-ceiling quotas, and applies exact remainder and ordinal tie order.
The returned order contains each input index exactly once.

The project, quality, funding-review and review-budget callers share an adapter
that retains their original actor comparisons only within equal-remainder
groups. Review credit uses its existing ordered weights directly. Its five-
reviewer cap, safe-integer checks and errors are unchanged. The new module
supersedes the initial bounded reviewer proof and separate sum/sort files.
The adapter's grouping, identity and collation remain outside the numerical
proof; this is not a complete implementation-refinement claim.

Before integration, 3,030 direct numerical cases matched the reference result,
including empty/all-zero weights, zero pools and 256-bit totals. Another 1,010
adapter cases covered identity ties. A further 3,000 comparisons exercised the
actual five callers against the earlier integration baseline, including map
insertion order, zero cases, Unicode/case ties and large supported caps. All
matched. The current production extraction passes the strict source/proof
integrity check: 662 allocation obligations, zero errors.

The existing allocation, monthly attestation, history, Points, review-pool and
integrity regressions passed 103 tests and 3,366 assertions before the final
empty/all-zero extension. The final exact-head record must include the repeated
pinned-runtime workflows and full repository gates before merge.

### Evidence partition and budget follow-up

`chunkLayout` uses `partitionCount` and `partitionSize` after its existing
safe-integer and array checks. The proof covers positive total and chunk width,
with no bound on either magnitude or the number of parts. It proves a positive
part count, full-sized nonfinal parts, a positive bounded final part, contiguous
offsets and `(count - 1) * width + finalPart = total`. The caller still checks
every record's exact index, keys, digest and size. Cryptographic content identity,
object storage and actor access remain separate workflow obligations.

Fee conversion, the referral poster and the payment keeper now use shared
verified predicates for their existing transaction/day limits. The keeper's
same-nonce grouping, outstanding-reserve accumulation and SQL transaction are
not proved by these scalar predicates. `callTimeoutMs` uses the exact existing
120-second-plus-token estimate capped at ten minutes. Its number theorem
applies to finite integer estimates, not IEEE exceptional values.

The initial host-runtime private-evidence API, native-gas, referral-poster
and review-plan suites passed 81 tests and 1,861 assertions. They include
real migrated D1/SQLite and R2-compatible storage,
large multi-part evidence, stale evidence refusal, concurrent native reservations
and receipt-day accounting. The actual local Anvil/SQLite/public-HTTP keeper
integration passed all 19 scenarios, including budget refusal before signing,
pending replacement liability, restart recovery and midnight accounting.
These local-chain results do not establish mainnet settlement or provider
availability. All seven exact-source proof modules and typecheck passed.

### Exact aggregation and performance

The proved sum is reused for monthly owner-change and frozen-execution totals,
received-money validation and the allocation algorithm itself. A frozen
execution total is calculated from its exact emitted award rows. Grouping,
recipient identity and authority remain caller responsibilities.

The initial sort adapter compared every actor in advance. A benchmark exposed
needless work for distinct remainders; the adapter now compares identities
only within equal-remainder groups. Against the earlier production quality
allocator on this host, final median times were about 0.71 ms versus 0.41 ms
for 1,000 distinct-weight rows, and 8.15 ms versus 3.51 ms for 10,000 rows.
Equal-weight cases were close (about 401 ms versus 392 ms at 10,000 rows).
These are local comparative measurements, not production latency guarantees.
The extra numerical merge and array preparation buy an executable proof; the
change is not presented as a speed improvement.

### Native receipt accounting

The money module now proves the gas-used/gas-price product, the sum of the
execution, blob, L1-data and operator components, and Solana's payer-only fee
normalization. The fee-converter arithmetic module proves the final cost is
the greater of fee-plus-rent and the wallet debit after removing intended
principal. All inputs remain exact BigInts. Existing receipt identity, missing
component refusals, safe-integer balance checks and journal authority remain
outside these scalar proofs and in their current callers.

The affected converter and Solana-adapter suites passed 119 tests and 750
assertions. An actual local Anvil flow reconciled 13 signed receipt costs.
An actual local Solana validator run cloned the public route, finalized the
native conversion, and reconciled 4,083,560 lamports of native cost against a
5,000,000-lamport reserve, including the 5,000-lamport network fee. It excluded
the 100,000,000-lamport transfer principal. These are local test balances, not
mainnet payments. The run reused the existing test ELF and IDL after checking
that their Rust source tree matched; it is not a fresh release-build claim.
The dependency install used the committed Solana package lock with lifecycle
scripts disabled.

The first concurrent Anvil/proof run exposed a source-walker bug: Foundry's
`contracts/evm/cache/solidity-files-cache.json` was being hashed as production
source and changed during compilation. The shared walker now excludes that
specific generated directory, as it already excludes target/build trees.
Actual contract source remains included, and the strict proof rerun passes.

### Exact decimal input

`verified-decimal.ts` parses ASCII digit components and scales them with a
proved power-of-ten loop. Its contract gives exact whole/fraction composition,
nonnegative output and the fractional interval. It uses no `BigInt(string)`
parser assumption. The shared `decimalBaseUnits` entry point checks its
unsigned-digit, precision and fractional-length contract before calling it;
all three production callers already use decimal grammars and asset precision.
Unsupported direct helper inputs such as signs, hexadecimal strings and
noninteger/out-of-range precision are refused rather than passed to a partial
arithmetic function. Public vault-amount refusal messages remain unchanged.

The vault parser now rejects a canonical whole part longer than 39 digits
before arithmetic. The checked `VaultWholePartOverflow` lemma establishes
that a nonzero 40-digit whole part cannot fit uint128 at any allowed precision,
so this preserves the existing range refusal. This also bounds the parser's
work for pasted oversized amounts; other callers already bound the whole part
to 13 or 16 digits.

There were 7,597 successful comparisons with the previous supported behavior,
including every precision from 0 through 36, fractional zeros, maximum uint128,
invalid vault input and error messages. An oversized 100,000-digit input kept
the same refusal; one local comparison measured about 65 ms before and 0.05 ms
after the early range check. This is not a production latency guarantee.
The five affected project/amount/monthly suites passed 121 tests and 1,211
assertions. The actual production entry points also passed under Node 24.15.0,
including its MJS-to-TypeScript module loading.

### Runtime evidence correction

An initial PATH prefix pointed at an npm cache containing Windows `bun.exe`
files rather than a runnable macOS Bun. That command fell back to the host's
Bun 1.4.2. Those test results remain host-runtime results. The corrected runs
use the explicitly checked executable
`slopdotcash-quint/.tools/bun-1.3.14/bin/bun` and Node 24.15.0. The final
combined follow-up receipt supersedes the preliminary runtime label; neither
passing tests nor package metadata is used as proof of the executing version.

## Local publication inputs

A fresh checkout intentionally has no live leaderboard and an empty committed
project registry. Follow the existing README/CI bootstrap before the full build:

```sh
bun run projects:sync
mkdir -p evidence/bootstrap public/data
bun scripts/download-leaderboard.ts https://slop.cash/data/leaderboard.json evidence/bootstrap/published-leaderboard.json
bun scripts/prepare-pr-ledger.ts evidence/bootstrap/published-leaderboard.json public/data/leaderboard.json
```

The project sync reads the public D1 API. Do not hand-edit or commit those
local generated snapshots with the proof change. The PR ledger adapter checks
the published snapshot against current source. It does not establish live
GitHub collection completeness. Browser fixtures and current public bootstrap
inputs have separate roles and must be identified in results.

Then run the normal required gates and the browser workflow:

```sh
bun run verify
bun run test:e2e
```

The LemmaScript workflow installs its own pinned prover, checks the inventory,
regenerates all selected sources and verifies proof integrity. The ordinary
`verify:code` workflow does not need Dafny; `verify` and the dedicated contract
job do. This preserves the existing CI installation contract.

## Confirmed regression evidence

Baseline source at the commit above with the new gas-price regression produces
two expected failures: `usdMicro('1e-1')` returns zero, and a quote with gas price
`20000009e-7` is submitted instead of kept pending. The fixed worker's existing
quote-to-conversion suite passes the same inputs. Baseline and fixed logs are
local evidence, not committed generated output.

The fee-converter focused run passed 101 tests and 597 assertions. Independent
frontend/money review passed existing allocation, quality, joint-score,
monthly-preparation, display and locale regressions. The integrity regression
suite rejects changed executable bodies, weakened obligations, assumptions,
bodyless helpers, disabled verification, unchecked includes, duplicate
symbols and missing or nested-only runtime targets.

The dependency audit initially found GHSA-g3hv-75wg-m249 in the new toolchain's
transitive minimatch dependency. The lockfile now pins the patched minimatch
11.0.5 override; the repeated audit reports no vulnerabilities. All source
regeneration and proofs must also pass with that override.

## Nested dependency regression

An isolated copy reproduced a proof-runner failure after a contract dependency
install: a `contracts/solana/node_modules` directory link was rejected as source.
Both scanners now use the same non-production directory exclusions before
link inspection. With that directory link present, inventory generation and
all four then-selected real proof modules pass. A link to an actual source file still fails
closed. No dependency source or generated native build output enters the proof
snapshot. This check used the pinned tools, not a mocked verifier.

The native Solana validator also creates links under its generated
`contracts/solana/.local` tree. That exact directory is excluded by the shared
source walker. A repeat with the real validator files present passes the
inventory and all four then-selected proofs, while both entry points still reject a
temporary link in `src/`. The CI artifact retains receipts and tool logs only;
the local source mirror is not uploaded.

## Browser test dependencies

The initial full browser matrix was not green: 446 preview and 48 registry
checks passed, 23 failed, and the 35-minute limits left additional checks
unrun. Failure traces identified stalled `avatars.githubusercontent.com`
requests and navigation waiting for network idle. The local-only fixture now
serves deterministic avatar bytes for that exact host in every test context;
first-party request, response, page and console diagnostics remain enforced.
Live base URLs still use the real image provider.

The focused desktop/mobile rerun passed 13 preview checks, including transient
HTTP retention, allocation status, record display and reflow. Both previously
timed-out two-contributor registry workflows passed with separate browser
contexts. These focused results do not substitute for the final complete
combined-branch browser run.

A separate local setup hang occurred after D1 migrations had completed.
Wrangler's update-banner request remained open after its own timeout. Turning
off telemetry alone did not release it. Local tool children now disable the
update banner and telemetry explicitly, without changing global settings or
inheriting credentials. The equivalent migration-list command then exited in
2.2 seconds. A real child-process regression checks that caller overrides
cannot re-enable these requests and that credentials remain absent.

## Evidence limits

No live transaction, provider call, signer activation, payment, deployment or
DNS change is part of this change. No current TSX layout or text was changed.
The frontend browser checks concern preserved state behavior. Formal contracts
cover the selected kernels under their stated domains; the research report
records unproved callers, collections, parser semantics and external systems.
Quint model coverage and combined integration results are tracked separately by
the concurrent state-review work. A source merge alone establishes neither
production release nor complete application refinement.

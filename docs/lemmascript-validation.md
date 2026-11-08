# LemmaScript validation record

## Current application-source checkpoint

This section records validation of application commit
`bd4d58ef66b326a4e85b1728b972e9bf6e56fd65` and tree
`98f425d815a23511029a596263305ada3cee22eb`. It does not certify a later merge
head. Documentation-only changes do not replace the recorded source identity.
The historical checkpoints below remain useful evidence but do not certify
this larger source set.

The manifest contains 33 modules and 168 selected production functions.
Independent read-only review counted the same 168 generated postcondition
targets, checked every generated/proof pair for integrity, and found no
material runner, workflow or source-binding issue. The inventory separately
records 9,625 unproved functions; discovery is not proof coverage. The compiler,
prover and installed dependency contents remain trusted tools. Their package
versions are pinned, but their installed binary contents are not part of the
source snapshot hash list.

| Gate at this source checkpoint | Observed result |
| --- | --- |
| Combined LemmaScript proof | Local and hosted checks passed: all 33 modules and 168 selected functions; 23,995 isolated obligations, zero errors. All selected source/proof inputs match. |
| Full repository `verify` | Failed at two formal phase deadlines. Both unchanged targeted reruns passed. The later lint, unit, integration, build and format commands passed separately; this is not a successful full `verify`. |
| Browser acceptance | All 741 original normal-lane cases were observed: 693 passed, 46 skipped and two failed stale navigation expectations. Corrected and opt-in runs provide passing evidence for the navigation cases and all 42 functional normal-lane skips. Four intentional desktop duplicate-reflow skips remain; their mobile executions passed. This is assembled evidence, not one clean full-matrix rerun. |
| Complete Quint exploration | Passed: all 302 bounded model graphs and all seven declared temporal properties, with no filtered or skipped models and stable mapped input hashes. |
| Native Solana fee conversion | JUP and SOL passed on the unchanged source after the guest-clock correction described below. |
| Native EVM contracts and keeper | The complete `test:contracts:evm` command passed with unchanged source hashes. |

### Complete runtime proof at this checkpoint

The full unfiltered `bun run lemmascript:check` gate passed with 23,995 verified
obligations and zero errors. The recorded input hashes remained unchanged.
The receipt is `evidence/lemmascript/1794168363587-25012/result.json`, SHA-256
`3c59ce6b79e679684fa21b1d8225f7462082f229a5db0a03e456c4f2cc93feb5`.
The final Jupiter module contributed 15,551 obligations and took 1,037.046
seconds in this combined run. The per-obligation limit remained 30 seconds;
the one-module 3,600-second wall limit and all other 180-second wall limits
were unchanged. This table lists the actual functions and successful obligation
counts recorded for every selected source:

| Runtime source | Functions | Obligations |
| --- | ---: | ---: |
| `src/lib/verified-money.ts` | 8 | 256 |
| `src/lib/verified-frontend.ts` | 7 | 40 |
| `workers/fee-converter/verified-arithmetic.ts` | 11 | 231 |
| `workers/verified-policy.ts` | 4 | 26 |
| `src/lib/verified-partition.ts` | 2 | 65 |
| `workers/verified-budget.ts` | 3 | 5 |
| `src/lib/verified-allocation.ts` | 4 | 662 |
| `src/lib/verified-decimal.ts` | 3 | 193 |
| `src/lib/verified-selection.ts` | 2 | 71 |
| `src/lib/verified-aggregation.ts` | 2 | 155 |
| `src/lib/verified-reviewers.ts` | 1 | 164 |
| `workers/notify/verified-delivery.ts` | 3 | 41 |
| `backend/security/verified-intake.ts` | 3 | 32 |
| `contracts/solana/verified-token-extensions.ts` | 6 | 631 |
| `src/lib/verified-monthly-replacement.ts` | 2 | 85 |
| `backend/vetting/verified-reuse.ts` | 4 | 64 |
| `workers/fee-converter/verified-native-liability.ts` | 3 | 256 |
| `workers/fee-converter/verified-expiry.ts` | 3 | 123 |
| `workers/slopbot/verified-work-unit.ts` | 1 | 281 |
| `src/lib/verified-base58.ts` | 3 | 704 |
| `backend/payments/verified-evidence.ts` | 6 | 58 |
| `workers/vetting/verified-review-batches.ts` | 3 | 229 |
| `backend/projects/verified-enforcement.ts` | 14 | 879 |
| `workers/vetting/verified-text-parts.ts` | 2 | 205 |
| `workers/slopbot/verified-source-ownership.ts` | 5 | 364 |
| `workers/fee-converter/verified-solana-wire.ts` | 6 | 891 |
| `workers/slopbot/verified-retained-binding.ts` | 5 | 536 |
| `backend/projects/verified-setup.ts` | 2 | 67 |
| `workers/fee-converter/verified-jupiter-policy.ts` | 4 | 83 |
| `backend/security/verified-direct-recovery.ts` | 2 | 207 |
| `workers/fee-converter/verified-route-credit.ts` | 4 | 332 |
| `src/lib/verified-global-joins.ts` | 5 | 508 |
| `workers/fee-converter/verified-jupiter-wire.ts` | 35 | 15,551 |
| **Total** | **168** | **23,995** |

### Hosted proof and repository continuation

The hosted proof job in
[Actions run 42518917199](https://github.com/SlopDotCash/slopdotcash/actions/runs/42518917199)
passed the same 33 modules, 168 selected functions and 23,995 obligations.
Its receipt SHA-256 is
`ddcadbe5f7cfe010e424744334e83f173a389b8fee52ded7e2b1d68fee361357`.
All selected source and proof hashes match the local proof receipt. The only
recorded input differences are the generated project registry and project
revisions from the local D1 preparation. This hosted result establishes the
proof job, not a production deployment or every job in the workflow.

The full local `bun run verify` command failed in two formal-check phases:
`native_budget` typechecking and the `notification_schema_upgrade` scenario
run exceeded their 90-second deadlines. The first also reported `kill EPERM`
during cleanup. The report retained 901 successful phases out of 903 and
unchanged inputs. Both models then passed their ordinary targeted typecheck,
scenario and simulation phases without a source or deadline change. The
original failure remains a failure; those reruns do not turn the full command
into a pass. Browser work overlapped the failed phases, but the evidence does
not establish CPU contention or a particular process-ownership cause.

The diagnostic record is
`evidence/formal-timeouts/diagnostic-receipt.json`. The subsequent
`evidence/lemmascript-selection/remaining-gates-receipt.json` is explicitly a
continuation, not a full-verify receipt. Its SHA-256 is
`b310b252ec9595bc7f70b2949807d8ec6dab3fe74b242377f9c38ab56bd4218b`.
Lint and formatting passed. The unit-test command completed with 1,881 passes,
six skips, zero failures and 22,308 assertions. All 16
integration drivers passed, and the build verified 140 output files. The
recorded application head and proof inputs remained unchanged. There is no
successful complete rerun of `verify` in this checkpoint.

### Browser and model checks

The focused navigation rerun used test-only correction `d370b48d7` from upstream
`1b33fcd2db727091292738f1d8db035a04305869`. Its served application assets were
byte-identical to the `bd4d58ef6` build, with manifest digest
`f8412967b3940a0888d5e75d0ef4322d2fbc593eb5f068c441142145872330b8`.
This eight-test pass addresses the stale expectation; it does not erase the
original failures or substitute for an entire preview-matrix rerun.

The ordinary registry lanes passed 57 cases and skipped 28 gated cases.
The initial DEV sign-in attempt failed four cases; the follow-up passed all
four after test-harness commit `9537c4b45`, which selected the pinned browser
and isolated its cache. The first private-intake attempt reported eight
passes, one failure, four intentional chain skips and five cases not run. After test-only ordering fix `7d247b240`,
the follow-up passed 14 cases with four explicit chain-gated skips.

Test tag correction `61149b6a723db7cfa9f836b01376d1995c5d1b57` restored ten
owner-creation cases to the private-intake selection without changing the
ordinary registry identity set. A separate flagged owner/chain run passed
all 14 selected cases with zero skips or failures. Its union with the corrected
14-case private run covers all 28 intended cases, with no missing or extra
identities, as recorded in `evidence/browser-final/intake-union.json`.
This is case coverage across runs, not one new full-matrix pass. Both native-ETH
bounty browser variants then passed with explicit local-chain flags. No
application-source change is attributed to these test-harness or tag fixes.

The final browser aggregate is `evidence/browser-final/final-browser-receipt.json`,
SHA-256 `25aa4c498b80b5e26c85339517420cd362141e8b40fce5980c98d9d65d3262f5`.
Its original 741 normal-lane results remain 693 passes, 46 skips and two stale
navigation expectation failures. Later runs covered all 42 functional skips.
The four remaining raw skips are intentional desktop duplicates in
`payout-wallet-picker.spec.ts`: open-modal and wallet-change reflow checks at
320 pixels with 200-percent text and at the 160-pixel zoom approximation.
Each passed in its designated mobile run. This aggregate includes the original
failures, focused corrections and opt-in runs; it is not one all-green fresh
matrix. All reserved ports and DEV ports were released, owned validator
containers were absent, and no owned chain or ETH child process survived.
Screenshots, videos, traces and exact per-case outcomes remain retained.

The three gated translator tests also passed separately with 15 assertions:
the real pipeline rejected the false invariant and accepted the literal and
fold examples. The log hash is
`720279fefb755b38a9cfc5583906e16eb37c38e8e6dd20f316813abdef28f671`.
This closes the three translator skips from the ordinary unit run. Its three
remaining skips are the Windows path, Windows Git Bash and native sandbox
platform cases; these are not reported as executed.

The opt-in vault run discovered exactly 14 requested Chromium desktop/mobile
cases: eight EVM and six Solana. Its first attempt passed 11, failed one
desktop Solana case in the SDK's legacy confirmation wait, and did not run two
later cases in that serial group. The original failure and cleanup timeout
remain retained. The unchanged desktop Solana group then passed all three
cases with zero skips. An external HTTP monitor observed successful finalized
transactions with null errors during this focused rerun. The earlier timeout
did not reproduce, so no speculative source fix or timeout increase was made.

All 14 unique vault cases therefore have passing evidence across the two
runs; this is not one clean 14-case run. Each selected passing case retained
zero unexpected browser diagnostics. The existing accessibility, keyboard,
200-percent text and transaction/recovery checks passed. All three owned
Solana containers reached `stopped` and were absent afterward; the owned
Anvil, preview, RPC and helper ports were closed. The fixture source commits,
served manifests, videos, screenshots, diagnostics and exact per-case outcomes
are retained in `evidence/vault-browser/final-result.json` and its artifacts.
The tests used fresh historical-data fixtures and local throwaway funds, not
production D1 state or live payment authority.

The frozen-source `bun run formal:verify` run completed all 302 model graphs
in 18 minutes 13 seconds. TLC generated 175,107,207 states and retained
5,607,158 distinct states in total across those separate graphs. All 754 mapped
source hashes, plus the model and tool hashes, remained stable. The receipt is
`evidence/formal/verification.json`, SHA-256
`0bb41d62895eb4a43590e45f78e019fb3f967ce242ec770b2b951cb36f1ca65d`;
its per-model bounds are retained in `evidence/formal-final/bounds-index.json`.
These are finite bounded state-space results. The TLC backend disables
deadlock checking, so terminal progress is covered only by the explicit
scenarios and declared properties. The run does not prove implementation
refinement and does not include the later recovery or UI completion models.

### Prepared data and exact-source limits

The repository check uses the documented public snapshot adapter for local
pull-request validation. It does not perform a new complete live GitHub
collection. The recorded 34,251,751-byte leaderboard input and prepared
`public/data/leaderboard.json` share SHA-256
`eb245381bbb0f21bf76c7214b95682ad272a80d64b2936ce1c18c13c8983efb7`.
The D1 registry synchronization succeeded. Its generated registry and revision
hashes are `968d6aa069be8c90cd721368677031e02bdfbcdbb2ddbcc53731fe3c0e36bae4`
and `bb1e5ae0cf430410f29572962f984cfb260622cedb0570131fd3b1758eb647f9`.
The ignored `evidence/lemmascript-selection/final-data-receipt.json` binds these
prepared inputs to the application-source checkpoint. Source identity and
prepared data are separate inputs; neither is proof of current provider truth.

### Exact-source native acceptance

A separate worktree at the recorded application commit used Bun 1.3.14,
Node 24.15.0 and the pinned contained Agave 2.1.21 validator. Root dependencies
were reused read-only. The nested Solana SDK was installed in that worktree
from its committed lockfile with lifecycle scripts disabled. The test ELF and
IDL were reused only after their hashes and all six tracked Rust/Cargo/Anchor
build inputs matched the previously qualified source. This is not a fresh
release build or a deployed-program attestation.

Both initial Solana attempts failed before swap submission with Whirlpool
`InvalidTimestamp` 6022. The actual local Clock sysvar and VM clock were about
2,339 seconds behind the host and finalized mainnet clock, while the cloned
pool contained a newer reward timestamp. Those failed runs remain recorded as
failures. After both VM owners confirmed no running containers, the guest
clock alone was synchronized. Its measured lag fell from 2,339.16 seconds to
1.16 seconds. No host clock, application source, machine configuration or
storage was changed. Fresh local clones on the same source then passed:

| Local flow | Finalized result |
| --- | --- |
| JUP | 30,000,000 input units produced 7,145,684 USDC micro-units, above the 7,109,955 minimum, with zero input left. Native cost was 2,044,280 lamports against a 5,000,000 reserve. |
| SOL | A 105,005,000-lamport earned-fee claim finalized; 100,000,000 lamports produced 8,938,385 USDC micro-units, above the 8,891,825 minimum, with zero wrapped input left. Claim and swap costs were 5,000 and 4,083,560 lamports, each within its 5,000,000 reserve. |

Both conversion transactions used v0 messages with one lookup table.
Reopening the D1 journal and repeating execution retained one finalized
conversion. The SOL
fixture also checked unchanged principal and zero remaining accrued fees.
Only RPC/WebSocket pairs 28799/28800 and 28999/29000 were published, on IPv4
loopback. Both validators reported the pinned executable hash and were removed;
all four ports were closed afterward. The ignored native receipts retain the
failed runs, corrected-clock runs, chain records and listener evidence.

The EVM command passed its adapter, nested native ETH, monthly-reserve and
payment-keeper workflows in 46.85 seconds with Foundry 1.7.1. The 100-award
monthly scenario materialized 98 new awards and kept the highest bounded
transaction at 220,733 gas below its 500,000 ceiling. The keeper completed
19 scenarios, eight payments and 16 signatures, including restart, lost-send,
replacement, replay and budget refusal. Ports 29146, 29149, 29247 and 29350 were
observed on loopback and closed after completion. Source hashes were unchanged
and the isolated worktree remained tracked-clean.

The native records are in the validation worktree under
`evidence/native-final/final-result.json` and
`evidence/native-final/evm/final-result.json`. They use throwaway local funds,
not mainnet transfers. They do not establish production activation, remote
provider availability, whole-application correctness or implementation
refinement. The combined runtime proof and bounded model exploration are
complete at the recorded checkpoint, including the hosted LemmaScript proof
job. Browser case coverage is assembled from the recorded original and
follow-up runs. A successful complete `verify` rerun on the final rebased head,
final integration and merge, and deployment outcomes remain separate gates
until their terminal evidence is recorded. This checkpoint does not certify
the later combined application/model head.

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

### Historical 88-function checkpoint

The following earlier combined checkpoint contains twenty-three modules and
88 selected runtime functions. The current 33-module result is recorded above. Dafny's `--isolate-assertions` option proves every
assertion in a separate obligation; it does not filter assertions. The run
completed 4,607 obligations with zero errors:

| Runtime module | Functions | Obligations |
| --- | ---: | ---: |
| Money and monthly frozen awards | 8 | 256 |
| Frontend state decisions | 7 | 40 |
| Fee-converter arithmetic | 11 | 231 |
| Worker policy | 4 | 26 |
| Evidence partition | 2 | 65 |
| Budgets and timeout | 3 | 5 |
| Complete numerical allocation | 4 | 662 |
| Decimal parsing | 3 | 193 |
| Bounded totals and maximum selection | 2 | 71 |
| Signed bucket aggregation | 2 | 155 |
| Complete reviewer selection | 1 | 164 |
| Notification consent | 3 | 41 |
| Private intake decisions | 3 | 32 |
| Token-2022 headers and metadata | 6 | 631 |
| Monthly award replacement | 2 | 85 |
| Original clean-scan reuse | 4 | 64 |
| Native daily liability | 1 | 150 |
| Retained expiry agreement | 1 | 43 |
| Complete claim partition | 1 | 281 |
| Base58 conversion | 3 | 704 |
| Payment facts and counters | 6 | 58 |
| Review groups and JSON sizes | 3 | 229 |
| Restrictions and appeals | 8 | 421 |

The later modules and extensions first had individual complete strict proof
receipts. This table preserves those cohort results; the combined 168-function
result is recorded in the current checkpoint above:

| Later module or extension | Current functions in module | Current obligations in module |
| --- | ---: | ---: |
| Complete text partition | 2 | 205 |
| Accepted-source ownership | 5 | 364 |
| Signed Solana wire parser | 6 | 891 |
| Retained-copy graph and unique binding | 5 | 536 |
| Expiry agreement and complete traversal step | 3 | 123 |
| Setup header and authority decisions | 2 | 67 |
| Native liability and earned-fee accounting | 3 | 256 |
| Jupiter account and quote policy | 4 | 83 |
| EVM recovery selection | 2 | 207 |
| Enforcement folds, action planning and flag scans | 14 | 879 |
| Finalized route token reconciliation | 4 | 332 |
| Global actor, archive and payout selection | 5 | 508 |
| Complete canonical Jupiter decoder | 35 | 15,551 |

The expiry, native-liability and enforcement rows replace the earlier module
counts rather than adding a second copy. Complete graph reachability is also
used by final work-unit history coverage without adding another proof target.
Each detailed report records actual production callers, comparison and
workflow results, input assumptions and measured costs. The full Jupiter
decoder completed its unfiltered run in 1,135.748 seconds with unchanged input
hashes. Its earlier 1,200-second timeout remains recorded as incomplete. Only
this module has a 3,600-second process limit; all modules retain the 30-second
per-obligation limit and all others retain the 180-second process limit. The
workflow allows 80 minutes for the manifest, setup and artifact upload.

These counts cannot be compared directly with the earlier 60 declaration
checks because the proof splitting changed. Neither count is a function
coverage percentage. A proof check does not replace the complete repository
or browser gates.

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

### Review and release selection

`verified-selection.ts` adds two executable sequence proofs. `cappedTotal`
returns the existing minimum/limit-bounded sum while keeping each intermediate
addition within the supplied safe integer limit. Review credit passes the
validated assessed-size limit, validated positive bands and the single existing
policy minimum. The theorem does not assume the uncapped sum fits a number.

`firstMaximumIndex` returns the first maximum for every nonempty supplied list.
Its initial use for review-source selection is superseded by the complete
reviewer-group scan below. The Pages deployment selector uses it
after all its existing clean-commit, branch, project, stage, time and URL checks.
Equal deployment timestamps retain the first matching result. The empty result
still returns `undefined`. These changes do not prove upstream identity,
JavaScript date parsing, Cloudflare truth or release authority.

The standalone proof passed all 71 assertion checks. The first strict check
rejected plain added assertions in a generated method; placing the same checked
facts in explicit proof blocks passes the unchanged integrity gate. The actual
review callers matched the prior implementation in 2,420 cases, and the actual
deployment selector matched in 1,604 cases. The production command also passed
under Node 24.15.0, including equal timestamps and the empty-result exit status.
Seven affected workflow suites passed 36 tests and 2,902 assertions.
Final exact-source checks and caller evidence are recorded in the current run receipts. The earlier
41-function combined checks remain evidence for their own unchanged checkpoint.

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

Chain writes in this follow-up use local test validators. The Solana setup
reads public route and RPC data before cloning. No production signer
activation, payment, deployment or DNS change is part of this change.
No current TSX layout or text was changed.
The frontend browser checks concern preserved state behavior. Formal contracts
cover the selected kernels under their stated domains; the research report
records unproved callers, collections, parser semantics and external systems.
Quint model coverage and combined integration results are tracked separately by
the concurrent state-review work. A source merge alone establishes neither
production release nor complete application refinement.

## Combined checkpoint still under review

The reviewer extension proves the complete distinct-actor order, first highest
source per actor and bounded credited count. The production caller keeps the
validated timestamp/review-ID order and immutable-ID mapping, with original
source objects and grouped repeated/beyond-limit IDs. Its 164 isolated
obligations, 15 workflow tests and 1,018 actual-caller comparisons passed before
integration. See [the reviewer report](lemmascript-reviewer-selection.md) for
the ordering/identity adapter limits and measured performance.

The bucket extension proves exact signed totals and ordered, bounded debit
consumption across arbitrary finite indexed buckets. Its actual caller
comparison covers score, project/global views, Points import and reversal.
It also fixes a schema-accepted retained Points journal whose negative total
previously rounded outside the safe-number range. The corrected projection
uses the existing overflow refusal. See [the aggregation report](lemmascript-aggregation-research.md)
for the constructed-input limit and remaining identity/order obligations.
The extension passed 155 isolated proof obligations, 16 workflow tests and
1,320 actual-caller comparisons before integration.

The Token-2022 extension proves complete header/payload traversal, ordered
records, allowed unique types, exact refusals and zero-only trailing bytes.
It retains the native `Uint8Array`; its explicit proof mapping covers only
length and bounded indexed reads. See [the parser report](lemmascript-token-extensions-research.md)
for the supported semantics and benchmark method. Its 463 isolated obligations,
20 affected tests and 17,878 public-reader comparisons passed before integration.
Metadata contents, RPC truth and cryptographic identity remain separate.

The notification extension adds three actual dispatch functions and 41 isolated
proof obligations. The original API/SQLite/Worker workflows passed 37 tests and
275 assertions on the extension. Its exact domain and caller obligations are in
[the notification report](lemmascript-notification-prototype.md). It preserves
the distinction between no preference, unset security preference, unavailable
pilot destination and a registered destination with its own pinned version.
These contracts pass in the combined sixteen-module run. The complete repository
gate and browser checks remain separate requirements.

The follow-up at `d543fa204` passed all nine strict source/proof modules:
43 runtime functions and 1,435 assertion checks. The subsequent feed-deadline
correction requires the final combined source gate to run again.
The latest combined proof receipt is
`evidence/lemmascript/1794155956372-51446/result.json`; all twenty-three modules pass
4,607 obligations on the integrated `f18d89377` checkpoint after the rebase onto Quint parent
`1f0dafd45aa172ca5b65bb22fb16da99e35fbb1a`. Source hashes are stable; combined
typecheck, lint and format checks pass. The rebased
server-free translator's 14 gated regression tests also pass, including a real
TLC counterexample for the false literal invariant. The changed monthly, vetting, native and claim-partition models pass their
type, scenario and simulation stages.

The repository test checkpoint at `54be5f519` passed 1,848 tests and 21,746
assertions with zero failures in 629.74 seconds. Six platform/opt-in cases were
skipped; the real TLC translator tests passed separately. This checkpoint
predates monthly replacement and scan reuse. Its log and source revision are
recorded in `evidence/lemmascript-selection/combined-59-test-receipt.json`.
It is not a final combined `verify`, browser or deployment result, and does not
change the status of the earlier interrupted run described below.

After the monthly replacement and scan-reuse integration, their combined real
API/SQLite workflows pass 171 tests and 1,806 assertions with zero failures.
One existing disposable-sandbox case is skipped. This run takes 330.70 seconds;
`evidence/lemmascript-selection/combined-65-workflow-receipt.json` records the
source and log hash. It also predates the final Quint-parent rebase.

After that rebase, native accounting and route preparation pass 104 tests/620
assertions; accepted-work partition workflows pass 30 tests/210 assertions;
base58 wallet, adapter and route workflows pass 24 tests/235 assertions.
Independent frontend/shared review also passes 22 existing workflows/1,729
assertions and finds no substantive integration defect. The backend review
also finds no substantive defect. These source reviews and test results do
not replace the final browser, full repository or chain gates.

The complete browser attempt at `3649142e0` was not green. The Pages lane
passed six checks. Preview passed 343 checks before its 35-minute limit, with
211 reported skipped. Registry passed 17 checks, had six unexpected results
and reported 62 skipped before the same limit. Unexpected results included
three individual test timeouts, a missing revision confirmation, cancelled
asset requests and a cancelled notification read. These need current-head
investigation and reruns; passing subsets do not close the browser requirement.

The source gate was interrupted during model checks and is not a completed
`verify` result. Exhaustive model checking was also stopped after the local
Apalache process was observed listening on all network interfaces despite a
localhost client endpoint. A separate in-process comparison found the pinned
CLI translator's output byte-identical to the original command service for
plain, nested-fold and temporal models. That comparison supports a server-free
transport correction; it does not replace the required final model runs.

The integration remains open until the current development branch, corrected
verifier launch, full source gate, browser checks and GitHub review/merge state
are verified together.

# LemmaScript validation record

## Reproduction

The branch starts from current development
`e3d7dea64f1171f5761033069b98de4fd5cc1e77`. Runtime contracts and proof
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

The five proof modules contain 27 selected runtime functions. The check now
uses Dafny's `--isolate-assertions` option, which proves every assertion in a
separate obligation. It does not filter or skip assertions. The completed run
reports 700 verified obligations: 96 money, 40 frontend, 202 fee-converter,
26 worker policy, and 336 review-allocation obligations, with zero errors.
These counts cannot be compared directly with the earlier 60 declaration
checks because the proof splitting changed. Neither count is a function
coverage percentage.

The default timeout is 30 seconds per prover obligation; the runner also
bounds each subprocess and kills the subprocess group on timeout. Explicit
nonnegative quotient assertions were added to two existing division lemmas
so their proofs do not depend on facts from another assertion group.

### Complete review-credit allocation

`allocateReviewCredit` now calls the verified `allocateReviewShares` runtime
function. The existing input guards and refusal messages are unchanged. The
proof covers every positive weight list of length one through five and every
nonnegative BigInt pool: exact conservation, nonnegative bounded amounts,
floor-or-ceiling quotas, largest-remainder priority, and original-index ties.
The public wrapper requires a positive safe-integer pool and positive
safe-integer weights. Every output is bounded by the pool, so its conversion
back to a JavaScript number is exact within that domain.

The five-entry bound is the existing published reviewer cap. This proof does
not apply to the separate project/funding/quality allocators, which accept
larger lists. The scan algorithm does at most five passes over five entries;
it preserves the previous sort's result without changing reviewer selection.

Against the prior implementation, 140,904 valid-input comparisons matched,
including equal remainders and maximum-safe-integer pools and weights. Nine
invalid-input cases retained the exact error class and message. The existing
Quint-generated review-pool replay, joint scoring, review eligibility,
review deduplication and self-review workflows passed: 16 tests, zero failures,
1,604 assertions. Typecheck and the strict regenerated-source/proof-integrity
gate also passed. These local results are separate from the combined PR's
final current-head CI and browser evidence.

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

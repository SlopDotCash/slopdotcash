# LemmaScript integration research and implementation

## Target and decision

This work implements the owner's 7 November 2026 request to research the entire
frontend and backend, select the strongest LemmaScript candidates, implement
those contracts, and integrate them with the concurrent Quint work.

The implementation starts from current `origin/development`, commit
`e3d7dea64f1171f5761033069b98de4fd5cc1e77`, in a separate worktree. The original
checkout had a materially different application and economic policy. It was
preserved; its source and policy were not used as the integration baseline.
Current rules include 2% ordinary payouts, historical fee-rounding compatibility,
25% private-bounty fees, optional contribution receipts, and the existing narrow
signer permissions. This change does not expand those permissions.

The accepted scope is executable contracts for real production computations,
a deterministic source inventory, reproducible proof checks, and a confirmed
gas-price correctness fix. The contracts support the existing PRD sections 4–8
and section 11. They add no product feature or interface change. The concurrent
Quint work owns transition-model coverage and source-to-model conformance.

## Research coverage

Three parallel research tracks examined frontend/shared domains,
backend/workers, and tooling/financial/release systems. Their detailed reports:

- [Frontend and UI journeys](lemmascript-frontend-research.md)
- [Backend and Worker boundaries](lemmascript-backend-research.md)
- [Tooling, money, publication, Slopbot, vetting and referrals](lemmascript-tooling-research.md)
- [Deterministic source/function inventory](lemmascript-inventory.json)

The inventory enumerates first-party JavaScript and TypeScript function bodies
under `src`, `backend`, `workers`, `functions`, `scripts`, `skills`, and the
TypeScript contract adapters. It records file/function hashes, names, source
locations, selected contracts and syntax that needs further review. It also
accounts for Python, shell, Solidity and Rust files as outside the TypeScript
proof toolchain. Tests, fixtures, generated data, declarations and dependency
build trees are excluded. Anonymous callbacks are counted as bodies, not as
independent business capabilities. The exact counts come from the current
inventory; they do not measure proof completeness.

A syntax scan cannot determine purity, reachability, all indirect calls, or
implementation correctness. Every unselected function remains explicitly
unproved. Selected functions are marked `contract-target-unconfirmed` until a
successful exact-source run produces the corresponding evidence receipt.

## Technology findings and alternatives

The current [LemmaScript specification](https://docs.lemmascript.org/spec/),
[Dafny backend](https://docs.lemmascript.org/spec-dafny/),
[supported subset](https://docs.lemmascript.org/subset/), and
[brownfield guide](https://docs.lemmascript.org/getting-started/) support
verification annotations in ordinary TypeScript. We pin LemmaScript 0.6.6 and
Dafny 4.11.0 and prove the generated implementation, rather than maintaining a
separate executable model. Specification comments have no runtime cost.

Dafny is the selected backend because it supports the needed records, strings,
booleans and exact integer operations. BigInt matches the monetary domain.
JavaScript `number` is modeled mathematically; it does not establish IEEE 754,
NaN, Infinity, or precision behavior. Number callers and limits are documented
in the frontend report. Date, URL, regex, cryptography, external APIs, async
scheduling and storage remain separately tested boundaries.

Direct annotations are preferable for small independent modules. Large existing
modules cause transitive type and unsupported-expression extraction even with
selective verification. For those modules we extract a small **runtime-used**
function, then import it into the original workflow. This removes repeated
arithmetic and gives the proof a concrete implementation connection. We retain
all schema, identity, authority and time validation at the existing boundary.

Rejected alternatives were detached reference implementations, assumed extern
contracts, broad rewrites of handlers, and treating passing tests or finite
models as proof of the full application. Each would obscure the actual claim.
A full Lean stack is not needed for these contracts and would add another
maintenance surface without improving the selected acceptance result.

## Implemented priorities

| Area | Actual kernel and callers | Property established |
| --- | --- | --- |
| Ordinary payment policy | `verified-money`: `ordinaryFeeAmount`, `ordinaryFeeMatches`; `payments/contracts` | Upward 2% rounding, zero for nonpositive projections, exact historical floor compatibility and no third accepted fee |
| Private-bounty policy | `bountyFeeAmount`; `payments/contracts` | Exact 25/75 split after the existing positive, bounded and divisible-by-four checks |
| Allocation arithmetic | `weightedShare`; project, review-budget, quality, funding-review allocators | Nonnegative bounded floor quota, remainder bounds, and exact quotient/remainder conservation per contributor |
| Complete review-credit allocation | `verified-review-allocation`; `scoring-policy.allocateReviewCredit` | Exact conservation, bounded floor-or-ceiling shares and largest-remainder order with original-index ties for one to five reviewers |
| Contributor allocations | `verified-frontend`: `allocationDisposition` | Recorded-transfer precedence, closure refusal, registered-wallet scheduling, and deadline-dependent unclaimed state |
| Private draft retention | `draftStillNeeded`; `intake-drafts` | Keep only unresolved locally submitted cases; recorded advisories and terminal refusals release the draft |
| Public-resource retention | `transientHttpStatus`; `use-public-resource` | Transient/server failures differ from 4xx authorization/refusal responses |
| Cache/time boundaries | `freshCacheAge`, `identityPollDelay`; `use-snapshot`, `identity-flow` | Half-open freshness interval and poll delay bounded by both allowed interval and remaining lifetime |
| Funding/display | `fundingReminderVisible`, `roundedUsdcCents` | Suppression for terminal/inapplicable funding states and exact half-up minor-unit display |
| Fee-conversion arithmetic | `workers/fee-converter/verified-arithmetic` | Exact directional division, slippage floor, cap intersection, strict requote reduction, reserve/rent accounting, price-impact ceiling and replacement percentage rounding |
| Slopbot/scanner/referral policy | `workers/verified-policy` | Exact closure admission, published penalty debit, specialist escalation and referral cap arithmetic; external identity and evidence remain caller responsibilities |

### Allocation claim boundary

`weightedShare` proves `amount * totalWeight + remainder = total * weight`,
`0 <= remainder < totalWeight`, and `0 <= amount <= total` under nonnegative
weights and a positive total. Project, review-budget, quality and funding-review
callers use this implementation. Their actor uniqueness, aggregation, sorting
and residual distribution remain outside the per-term proof.

The review-credit caller now uses the complete `allocateReviewShares` loop
proof. For one through five positive weights it proves exact pool conservation,
nonnegative bounded shares, floor-or-ceiling quotas, largest-remainder
selection and original-index tie order. Five is the existing reviewer cap,
not an added product restriction. BigInt pool and weight magnitudes are not
bounded in the proof. The public wrapper keeps its safe-integer guards and
existing errors, and each result is bounded by its safely representable pool.

Neither proof establishes actor identity, reviewer eligibility, source time,
or score authority. Those remain in the existing selection code and the
Quint-generated workflow replay. The unrestricted project/funding allocators
still need whole-list proofs. `allocateIntegerTotal` receives nonnegative
weights through the existing validated scoring path; this is a reviewed caller
assumption, not a newly proved public input validator.

### Confirmed defect: scientific gas-price rounding

`workers/fee-converter/evm.ts:usdMicro` accepted a negative exponent in its
regular expression but returned zero whenever the exponent was present.
For example, `20000009e-7` is 2.0000009 USD and must round upward to 2,000,001
micro-USD. Returning zero could allow a quote through the existing ten-times-gas
cost gate.

The fix scales decimal digits exactly and uses the verified directional-division
kernel when discarding digits. A positive sub-micro amount rounds upward to one,
including extremely large negative exponents. It is detected before calculating
a power of ten. Existing malformed-input refusal and supported grammar remain.

The existing Kyber quote-to-conversion test now passes this scientific-notation
gas amount through the real client and conversion gate and requires `pending`,
which prevents signing. This is workflow evidence with deterministic provider
responses; it does not claim a live Kyber request or on-chain execution. The
proof covers the arithmetic kernel, not the regex parser or whole handler.

## Reproducible verification

```sh
bun install --frozen-lockfile --ignore-scripts
bun run lemmascript:setup
bun run lemmascript:inventory
bun run lemmascript:check
bun run verify
bun run test:e2e
```

After reviewing a changed contract/caller, refresh the inventory with
`bun run lemmascript:inventory:update`. Regenerate proof artifacts with the
pinned `lsc` using `lemmascript.json`. Keep proof additions separate from
regenerated implementations. Do not refresh a source hash in place of reviewing
the change.

`LemmaScript-files.txt` is the explicit production target list. The check:

1. Requires exact tool versions, nonempty unique targets and generated
   postconditions for every selected top-level runtime function.
2. Regenerates from an isolated snapshot of current source and configuration.
3. Requires byte-identical generated baseline and unchanged verified artifacts.
4. Rejects rewritten generated declarations, executable changes, assumptions,
   unchecked includes, bodyless axioms and verifier-disabling attributes.
5. Requires positive completed Dafny verification results with zero errors.
   `--isolate-assertions` splits every assertion into a separate check; no
   assertion or function is filtered out.
   Unsupported syntax, missing tools, timeout and output overflow fail closed.
6. Records command, duration, exit result, source and artifact hashes under
   ignored `evidence/lemmascript/`, and rejects input drift during verification.

The independent CI workflow repeats these checks on pull requests and pushes
to `development` and `main`. The normal `verify` command also includes them.
The generated translation, TypeScript frontend, Dafny and SMT solver remain
trusted tools. The integrity gate verifies permitted proof edits; it does not
prove the translation itself sound.

## Boundaries and follow-on research

The selected pure contracts are deductive checks over their stated domains,
not finite simulations. They do not prove all frontend/backend functions,
all JavaScript semantics, crypto primitives, safe sandbox execution, live
provider behavior, database transactions, economic policy, deployment,
wallet control, or chain finality.

The detailed reports rank remaining sequence/collection and parser candidates.
Highest follow-on work is unrestricted largest-remainder conservation with
actor uniqueness, review selection and penalty aggregation, monthly allocation
replacement invariants, byte decoder bounds, and intake/notification selection.
Those need larger loop/sequence proofs and explicit parser semantics. They are
recorded as unproved, not replaced with assumptions or marked complete merely
because the source appears in the inventory.

Quint owns asynchronous/concurrent transition exploration; implementation tests
exercise real entry points. A model link, a source hash, a test pass, and a proof
of a helper are distinct evidence. The final validation record is maintained in
[the integration record](lemmascript-validation.md). Merge and deployment status
must be reported separately from local proof results.

# Verified private-intake gates

Base: `cc54e73b9`. This prototype implements the private-intake qualification
and screening-recovery candidate from the backend research report. It serves
PRD section 8: human routing decisions take precedence, saved reports remain
recoverable after a worker is lost, and retry does not imply authorization to
change a case or pay an award.

## Executed contract

`backend/security/report-intake.ts` calls the three functions in
`backend/security/verified-intake.ts` from its existing qualification and
recovery helpers. Inputs represent actual stored fields, not an authorization
boolean supplied by another function.

| Function | Domain and checked result |
| --- | --- |
| `intakeReviewState` | Any string or null. Null maps exactly to unreviewed, `forward` to forward, and `request-information` to that decision. Other strings have a separate state and cannot qualify. |
| `qualifiedIntake` | Explicit review state plus screening state. Qualification holds exactly for a manual forward decision, or for an unreviewed legitimate screen. Manual information requests and other decisions never qualify. |
| `recoverableIntakeScreening` | Complete queued/running/legitimate/needs-information/spam/unavailable variants, with known or invalid clock for running work, and a nonnegative bigint age limit. Queued/unavailable work recovers. Running work recovers only with a known clock and elapsed time strictly greater than the limit. Completed screening and invalid running clocks do not recover. |

The caller still passes the existing 900,000-millisecond limit. At exactly
15 minutes the gate remains closed. A future start time also does not recover.
No missing timestamp becomes zero: the existing `screening_started_at ??
received_at` fallback is retained, and an unparseable selected time remains an
invalid clock.

## Boundary and evaluation-order preservation

The current database restricts `review_decision` to null, forward, or
request-information (`migrations/0101_durable_security_intake.sql`). The
normalizer additionally preserves refusal for another string; it introduces no
runtime validation or new exception.

The recovery wrapper reads time only for a running screen, as before. It calls
`now.getTime()` and then `Date.parse` in the original order. JavaScript Date
times are integer milliseconds within the safe-integer range. Valid readings
become exact bigint inputs; invalid readings become an explicit invalid-clock
variant. The proof does not verify Date parsing itself. Although the difference
of extreme Date readings can exceed the safe range, bigint and the old numeric
comparison agree at the small 900,000-millisecond boundary: close readings have
an exactly representable difference, and larger differences cannot round
across that boundary.

All database reads, role checks, revision comparisons, quota checks, stored
report bytes, provider calls and writes remain in their original order. The
same helpers still feed the existing API views, routing, manual-review result,
screening worker, and authorization-to-forward checks. A qualified predicate
does not by itself establish reporter or maintainer authority.

This proof does not establish SQL atomicity, optimistic-concurrency correctness,
provider honesty, storage availability, or the whole private-intake workflow.
Those boundaries remain with the existing Quint and implementation evidence.

## Verification

Pinned tools: Bun 1.3.14, Node 24.15.0, LemmaScript 0.6.6, Dafny 4.11.0.

```sh
lsc check --backend=dafny --time-limit=30 backend/security/verified-intake.ts
dafny verify --isolate-assertions --verification-time-limit 30 \
  --unicode-char:false --allow-deprecation \
  formal/lemmascript/backend/security/verified-intake.dfy
bun test ./backend/security/report-intake.test.ts --timeout 30000
bun run typecheck
```

The isolated-assertion proof reports **32 verified, 0 errors**, for three
production functions. Source/proof integrity and named-obligation checks pass.
The generated proof and `.dfy.gen` are identical: there is no hand-edited
executable proof body, axiom, extern, assumption, or disabled obligation.
Explicit discriminated records avoid unsupported nullable-record extraction;
the final generated definitions preserve all states and clock variants.

The existing private-intake API/SQLite workflow suite reports **51 passed,
0 failed, 576 assertions**. Its existing lost-worker test now also reads the
actual API at exactly 15 minutes and confirms no retry, before recovery at
16 minutes. The suite covers retained report bytes, routing retries, manual
decision precedence, unauthorized access, idempotency, revision conflicts and
partial-write rollback. Provider dependencies are deterministic; no live
provider behavior is claimed.

Uncommitted evidence lives in `evidence/private-intake/`. `receipt.json`
records the exact tested commit and file hashes, with the proof, integrity,
typecheck and workflow logs alongside it. Shared manifests and inventories are
left for the final integration review.

## Original-clean scan reuse

`backend/vetting/reuse.ts` remains unchanged. Its current gate combines the
latest effective restriction, its actor role and request-time boundary, original
clean status, project identity, case-folded repository identity, source inventory,
template, policy, scan run and report digest. Its callers also establish result
schema and current flag coverage.

A later complete reuse contract should retain those concrete fields and prove
the exact conjunction, with schema validation, Unicode case folding and the
existing lexical timestamp assumptions explicit. It must not replace the
restriction history or current flag coverage with an unexplained trusted
`authorized` boolean. This intake prototype makes no scan-reuse proof claim.

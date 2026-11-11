# Identity admission terminal safety VIEW

This PRD section 12 / STATE-05 experiment starts from
`4066e7b41a1054a808ccf7c140cdb48aa826988d`. It adds a source-bound TLC safety
VIEW for `api_identity_admission`. The concrete model, initializer, actions,
dispatcher, domains, invariant, scenarios and runtime files remain byte-identical.
This private child follows frozen `af16336d41333470d395333e03e15c0b8884c03f`.
It grants the same reviewed graph 600 seconds for a hosted diagnostic and adds
the reviewed manual model/shard selectors. Earlier native and ordinary checks
passed as recorded below. Complete finite exploration remains pending; an
exhausted deadline is incomplete evidence, not a passing graph.

## Exact observation

Every global remains exact: clock, complete counter map (including absent rows,
count, start, expiry and generation), cleanup phase and captured cleanup clock.
Every request outside `unused` and `done` remains exact, including its phase,
digest key, captured clock, returned count/expiry/generation, result and retry.

Each unused/done request is replaced in the VIEW only by the following tuple,
computed from the full raw request before projection:

1. Exact phase.
2. Exact generation, including zero or hypothetical values outside the ID set.
3. Whether result is `allowed`.
4. `allowed` implies count is between one and two.
5. `allowed` or `429` implies expiry exceeds captured clock, retry equals their
   difference, and retry is at least one.
6. `429` implies count exceeds two.
7. `503` implies retry is zero.

The four local clauses remain separate truth observations, including false
classes. They are never replaced by an assumption that the model invariant
holds. Exact per-index generation plus allowed membership reconstructs each
original generation's allowed-request count exactly. Thus over-quota states,
out-of-domain generations, and later changes in another slot are distinguished.
All global invariant clauses are evaluated over exact retained globals.

## Every action and future continuation

Related states have identical globals and live records, and equal terminal
tuples. For the same original action and parameters they have the same
enabledness and projected successor:

| Action | Read/write argument |
| --- | --- |
| Tick | Reads and increments the exact bounded clock. Request observations carry. |
| Capture | Requires the exact `unused` phase and constant ID/key domains. It replaces the entire record from `unused`, writes hash phase, input key and exact current clock. Generation becomes zero, result nonallowed and all four local clauses true, even from a dirty unused record. The quota contribution removed by the reset is known from the old exact generation and allowed bit. |
| Hash | Requires hash phase and therefore reads an exact live record. Success enters ready; failure enters done with result 503 and the carried raw retry. The new tuple computes every original clause rather than assuming failure retry is valid. |
| Commit | Requires ready phase; captured key and clock and every prior counter field remain exact. Reset/recreation, increment, returned expiry and row generation use the original expressions. The committed request remains exact. |
| SQL failure | Requires ready and enters done with result 503, preserving all other raw fields. Its four new observations are computed from that record. |
| Reply | Requires committed and therefore reads exact count, expiry and captured clock. It produces the original allowed/429/503 result and retry, then computes the terminal tuple. Lost/invalid replies still retain consumed counts. |
| Begin cleanup | Reads exact cleanup phase/clock and writes the exact captured clock. |
| Delete expired | Reads exact cleanup state and complete counter rows and writes the original absent records. It does not alter returned request snapshots or their local clauses. Quota does not depend on current counter rows. |
| Cleanup failure | Only changes the exact cleanup phase. |
| Explicit stutter | Every observation stays equal. |

No action reads terminal key, stamp, count, expiry, retry or full error result.
Only request phase gates capture/hash/commit/failure/reply. There is no done-slot
reuse and no cross-slot payload reader outside the quota invariant. Cleanup or
another request's commit cannot mutate a stored terminal snapshot. Another
request's reply can increase a generation's allowed count, and capture can
remove a dirty unused contribution; the retained generation/allowed data
determines both changes without assuming the old quota bound was true.

This supplies a manual same-parameter successor-congruence argument on raw
states, including false local/global/quota classes. It is not a mechanically
checked refinement theorem. The VIEW changes TLC fingerprints only; the
original initializer and invariant still run over concrete records. A completed
graph would prove finite model safety through this quotient, not temporal
progress, exact diagnostic output, implementation/SQL conformance or unbounded
quota behavior. Named scenarios still inspect their unchanged full records.

## Binding and controls

The hardcoded helper and matching manifest pin exact complete QNT, complete
translated production TLA, final loader-produced VIEW TLA and official adapter
hashes. Actual `bindSafetyView` and `applySafetyView` validate the captured
complete production configuration, preserving the entire 80-character module
terminator and concrete body. Unknown definitions, temporal properties and
source/TLA/expression/adapter drift fail closed. No generic expression engine
or alternate finite step is added.

The full-file source guard covers helpers, initializer, action guards/updates,
domains, dispatcher, invariant and all scenarios. Tests reject new terminal
payload readers, reuse, cross-slot reads, altered quota grouping and capture
reset drift. Native definitions use the actual reviewed VIEW through the pinned
official runner, one named property alone per fixture, and demand a State 2
counterexample with no initial violation. They include each original local
clause and false-to-true class, both retry result branches, exact generation
and allowed quota contributions, dirty unused resets, live snapshots and the
global clock/counter bounds. These controls establish observation sensitivity
and loader behavior; they do not by themselves prove successor congruence.

Two additional native diagnostic pairs use only `q_inv == TRUE`. Each requires
two raw states and exactly one viewed state. The first varies only nonallowed
terminal key/clock/count/expiry/retry payload, with all four clauses true. The
second varies an allowed terminal count between zero and three (both violate
the same first local clause) and its dead key, preserving phase, generation,
allowed membership and all four clause truths. It deliberately begins with a
false original clause and checks coalescing without trusting invariant truth.

Ignored experiment evidence records translation, the actual complete-TLA
binding, exact source/tool and binary identities, and later receipts separately.
No native or full graph is claimed until its own completed, stable-source
receipt exists. Timeout, cancellation and resource exhaustion remain incomplete.

## Frozen qualification and private hosted follow-up

At `af16336d41333470d395333e03e15c0b8884c03f`, the focused native file passed
38 tests and 245 assertions: two source guards, 34 counterexamples and two
paired raw-two/view-one diagnostics, including the already-false local clause.
The unchanged ordinary typecheck, 17 scenarios and 500×60 seeded traces passed,
with the original 90-second stage limits. All 20 frozen source/tool hashes and
five binary identities stayed stable. These are the parent experiment's actual
receipts, not fresh qualification receipts for this resource-only child.

The one canonical 180-second full graph was incomplete: 8,275,248 generated,
2,375,684 distinct states, 1,608,755 queued at depth 11. The receipt reports
`passed=false`, `inputsUnchanged=true` and `canceled=false`. The wrapper logged
SIGKILL, cleanup `kill EPERM` and cleanup-did-not-finish warnings. These failures
remain in their original receipt. A separate post-exit process audit found
all six recorded PIDs, including Java PID 72479, absent; no process matched the
exact owned output directory or process groups, and the temporary directory
was removed. No manual kill was performed. Verified cleanup does not turn this
incomplete graph into a safety pass.

This private follow-up changes the model-specific full-verifier allowance
from 180 to 600 seconds; every ordinary stage keeps 90 seconds. QNT, VIEW,
manifest, native-control and adapter bytes stay exact. The manual diagnostic
selectors match the release investigation's reviewed interface. All three
inventories are regenerated against this child. No bot or other projection
prototype is imported. The hosted 600-second experiment is PENDING until its
own stable-source receipt reports completed finite exploration with zero
queued states. No temporal, exact-output or implementation-refinement claim is
added, and no failed receipt is relabeled as passed.

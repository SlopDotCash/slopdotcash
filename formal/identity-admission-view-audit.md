# Identity admission terminal safety VIEW V2

This PRD section 12 / STATE-05 source-only child starts from the frozen V1
`af16336d41333470d395333e03e15c0b8884c03f`, whose concrete source starts at
`4066e7b41a1054a808ccf7c140cdb48aa826988d`. The concrete model, initializer,
actions, dispatcher, domains, invariant, scenarios, runtime files and resource
allowance remain byte-identical. V2 changes only the safety VIEW's terminal
nonallowed generation observation, its exact bindings and scheduled controls.

The V1 local targeted file passed 38 tests, including its scheduled native
controls; the unchanged concrete model passed 17 scenarios and 500 traces of
60 steps. Its 180-second full exploration remained incomplete at 2,375,684
distinct states, 1,608,755 queued and depth 11. The separately owned hosted V1
600-second probe (run 43122103257) also remained incomplete: last progress was
179,688,186 generated states, 39,264,584 distinct, 21,586,148 queued and depth 15.
That retained receipt records unchanged inputs, exit 1 and the 600,000 ms
deadline, without a counterexample. Its model and three mapped runtime-source
hashes match this packet. These are V1 history, not V2 qualification or completed
safety proofs. No native controls, ordinary checks or full V2 graph have run.

## Exact observation

Every global remains exact: clock, complete counter map (including absent rows,
count, start, expiry and generation), cleanup phase and captured cleanup clock.
Every request outside `unused` and `done` remains exact, including its phase,
digest key, captured clock, returned count/expiry/generation, result and retry.

Each unused/done request is replaced in the VIEW only by the following tuple,
computed from the full raw request before projection:

1. Exact phase.
2. Exact raw generation only when raw result is `allowed`, including zero or
   hypothetical values outside the ID set; otherwise zero.
3. Whether result is `allowed`.
4. `allowed` implies count is between one and two.
5. `allowed` or `429` implies expiry exceeds captured clock, retry equals their
   difference, and retry is at least one.
6. `429` implies count exceeds two.
7. `503` implies retry is zero.

The four local clauses remain separate truth observations, including false
classes. They are never replaced by an assumption that the model invariant
holds. Per-index allowed generation plus allowed membership reconstructs each
original generation's allowed-request count exactly. A nonallowed request never
contributes to that comprehension, regardless of its generation. Thus over-quota
states, out-of-domain allowed generations, and later changes in another slot
are distinguished.
All global invariant clauses are evaluated over exact retained globals.

## Every action and future continuation

Related states have identical globals and live records, and equal terminal
tuples. For the same original action and parameters they have the same
enabledness and projected successor:

| Action | Read/write argument |
| --- | --- |
| Tick | Reads and increments the exact bounded clock. Request observations carry. |
| Capture | Requires the exact `unused` phase and constant ID/key domains. It replaces the entire record from `unused`, writes hash phase, input key and exact current clock. Generation becomes zero, result nonallowed and all four local clauses true, even from a dirty unused record. The quota contribution removed by the reset is known from the old allowed generation and allowed bit. |
| Hash | Requires hash phase and therefore reads an exact live record. Success enters ready; failure enters done with result 503 and the carried raw retry. The new tuple computes every original clause rather than assuming failure retry is valid. |
| Commit | Requires ready phase; captured key and clock and every prior counter field remain exact. Reset/recreation, increment, returned expiry and row generation use the original expressions. The committed request remains exact. |
| SQL failure | Requires ready and enters done with result 503, preserving all other raw fields. Its four new observations are computed from that record. |
| Reply | Requires committed and therefore reads exact count, expiry and captured clock. It produces the original allowed/429/503 result and retry, then computes the terminal tuple. Lost/invalid replies still retain consumed counts. |
| Begin cleanup | Reads exact cleanup phase/clock and writes the exact captured clock. |
| Delete expired | Reads exact cleanup state and complete counter rows and writes the original absent records. It does not alter returned request snapshots or their local clauses. Quota does not depend on current counter rows. |
| Cleanup failure | Only changes the exact cleanup phase. |
| Explicit stutter | Every observation stays equal. |

No enabled action consumes terminal key, stamp, count, expiry, retry or full error result.
Only request phase gates capture/hash/commit/failure/reply. There is no done-slot
reuse and no cross-slot payload reader outside the quota invariant. Cleanup or
another request's commit cannot mutate a stored terminal snapshot. Another
request's reply can increase a generation's allowed count, and capture can
remove a dirty unused contribution; the retained allowed generation and allowed
bit determine both changes without assuming the old quota bound was true.

V2 erases an additional operand only under the raw nonallowed result test.
No action reads unused/done generation. Done never reopens, so a nonallowed
terminal request cannot later become allowed. Capture replaces the complete
unused record and sets generation zero and result none; it never copies the old
nonallowed generation into a live request. If a dirty unused request was allowed,
its exact old generation remains retained until capture removes its known quota
contribution. All live requests remain full raw records, so a later reply's
allowed membership and exact generation are determined before terminal masking.
No counter row or other request is normalized. Thus two related states still
have the same enabled actions and same projected successors even with false
quota or local clauses, out-of-domain generations, delayed replies, cleanup and
row recreation. Raw local truth bits are computed before generation is masked.

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

The unchanged QNT has SHA-256
`e1c0aa22340edbcca2f64c27fba1336a4e24bc48bc5cfa67799a79827d1cbe4c`.
A fresh full production translation has SHA-256
`84223337fae384041a9ed6a1642bd9746e0efabf37f78220accc9b60786465c4`.
Actual loader application produces V2 SHA-256
`d035692da35d36d9c14e3bd41a5f787fd10341145fbd0df0604ebba70eab6f2b`.
These bind the source-only packet; they are not completed verification receipts.

The full-file source guard covers helpers, initializer, action guards/updates,
domains, dispatcher, invariant and all scenarios. Tests reject new terminal
payload readers, reuse, cross-slot reads, altered quota grouping and capture
reset drift. Native definitions use the actual reviewed VIEW through the pinned
official runner, one named property alone per fixture, and demand a State 2
counterexample with no initial violation. They include each original local
clause and false-to-true class, both retry result branches, exact generation
and allowed quota contributions (including zero/out-of-domain generation
false/healing boundaries), dirty unused resets, live snapshots and the
global clock/counter bounds. These controls establish observation sensitivity
and loader behavior; they do not by themselves prove successor congruence.

Three native diagnostic pairs use only `q_inv == TRUE`. Each requires
two raw states and exactly one viewed state. The former V1 nonallowed-generation
negative control now varies only two nonallowed terminal generations: this is
the additional V2 equivalence, rather than an observation V2 should preserve.
The second pair varies only nonallowed terminal key/clock/count/expiry/retry
payload, with all four clauses true. The
third varies an allowed terminal count between zero and three (both violate
the same first local clause) and its dead key, preserving phase, generation,
allowed membership and all four clause truths. It deliberately begins with a
false original clause and checks coalescing without trusting invariant truth.

Three further native controls freshly capture the full pinned production TLA
under the native flag. They retain its actual definitions and 80-character
terminator, replacing only harness aliases and inserting a dirty initial record
and named witness before their first use. Actual `capture(1, 2)` must heal a
false local count clause and false quota by fully resetting a dirty unused
allowed request; actual `capture(1, 1)` must reset a dirty nonallowed generation
and false 503 retry clause; actual `reply(3, TRUE)` must create a false quota when
another slot completes in the same generation. Each tests only its named witness
as `q_inv`, requires a noninitial State 2 counterexample, and cannot pass through
an unrelated original invariant violation. Reversing the harness replacements
must restore the full original translation exactly. No action is hand-copied.

All three repository inventories are regenerated; their checks run again after
the source commit. Final integration must regenerate them against its combined source.
Ignored experiment evidence records translation, the actual complete-TLA
binding, exact source/tool and binary identities, and later receipts separately.
No native or full graph is claimed until its own completed, stable-source
receipt exists. Timeout, cancellation and resource exhaustion remain incomplete.

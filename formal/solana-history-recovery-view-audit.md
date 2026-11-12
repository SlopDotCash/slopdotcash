# Solana history proof and terminal safety VIEW

This PRD section 12 / STATE-05 source-only experiment starts at
`dabd9d893d2b323746128496d65c49daee308aab`. It changes TLC safety fingerprints
only. The concrete QNT, initializer, helpers, actions, step, domains, invariants,
scenarios, runtime files and resource allowances remain byte-identical.

The retained raw 600-second attempt (run 43122136526, raw14-0e) was incomplete:
163,501,789 generated states, 27,602,918 distinct, 7,356,680 queued, depth 17.
Its receipt records unchanged inputs, exit 1 and the 600,000 ms deadline, without
a counterexample. Its QNT and six mapped runtime hashes match this packet.
That is source equivalence only: its runner was SHA-256
`28b8a5fce561fe1df7db1e2208dec14a94247529757f2d76a46d19cedb2833fb`;
this dabd packet retains the unchanged runner
`856e3abcba9da1a9418c5337037dfccd0fb2515a50492eb2d859ab4ae35dc1a2`.
The raw receipt does not attest this packet's tools, VIEW or graph completion.
Integration must pin its own runner and report builder again; no report-builder
implementation exists at this packet's base. No raw graph is rerun here.

## Uniform proof-copy observation

Use the same N on every global cache entry, local snapshot entry and candidate:

| Raw proof | N(proof) |
| --- | --- |
| signature is not valid | Original absent record |
| signature is valid but exists is false | Original absent record with signature valid |
| exists is true and signature valid | Entire exact raw proof |

For every op body, payer and message index, this preserves the original valid
predicate. It separately preserves signature == valid, which the global written
invariant reads even when exists is false. A valid-signature nonexistent proof
must not collapse into an invalid-signature proof. Positive present proofs keep
exact body/payer/message even if currently mismatched: a later context and action
can make them valid. No current-mismatch or current-ownership cut is used.

All proof consumers and writers are closed under N:

| Consumer or writer | Argument |
| --- | --- |
| Seed | Writes complete proofs or carries the old global cache. Every original kind/domain remains available; invalid signature representatives may share a fingerprint. |
| Read cache | Copies whole global proofs into a captured local map with the same map domain. Uniform N on both locations preserves the copy. |
| Lookup | Reads only valid(local[index], op, index), which N preserves for every captured tag/index. |
| Signature return | Writes a complete candidate with the exact captured body/payer/index and valid signature; invalid returns stop without partially repairing a candidate. |
| Cache write | Guards on candidate validity, then copies the exact candidate to global/local storage and adds its exact key to written. A passing candidate is positive/present, so N leaves every copied field exact. |
| Ready-proof invariant | Reads only valid for each exact ready member. Every raw truth, including false, is preserved. |
| Written invariant | Reads signature == valid independently of exists. The special nonexistent-valid-signature class preserves it. |
| All other actions | Carry proof values or replace the entire operation from idle; they do not partially repair or inspect additional proof fields. |

Map domains remain exact. This applies uniformly even to unknown/live phases;
all their other fields and phase labels remain full raw records. There is no
relative-to-current-body erasure and no assumption that a failed owner or proof
cannot recover. N preserves validity for every future consumer, not only the
current one.

## Diagnostic copy cone

Global error normalizes to none. Start, context replacement and parent refresh
reset it; stopped either writes its diagnostic argument or carries old error
into that same field. No guard or invariant consumes it. Direct scenarios still
inspect the unchanged raw error values; no exact diagnostic-output claim is made.
All other globals stay raw, apart from the proof-value normalization above.

## Unused/done observation

Only phase unused or done becomes this tuple, computed from the full raw record:

1. Exact phase.
2. Exact context.
3. Raw dispatched flag.
4. If lateEligible, pair TRUE with exact captured revision; otherwise FALSE/zero.
5. Raw index between one and two.
6. Raw prompts <= 2.
7. Raw ready subset of messageIndices.
8. Raw authorized implies observedRevision == revision.
9. Raw dispatched implies authorized and ready == messageIndices.
10. Raw every ready local proof is valid for its captured body/payer/index.

The final six are separate indexed raw observations, not freely independent
Boolean combinations. For example, dispatched plus a false ready-subset clause
forces the dispatched obligation false. Controls use feasible combinations and
preserve every false/healing class without assuming the invariant is true.

lateEligible uses exactly:

- Raw dispatched.
- ID absent from the exact global effects set.
- Captured postCookie equals captured op.actor.
- Captured postCookie is positive.

It excludes phase, ownership, authorized, ready, backendAccepted and **current
server-revision match**. A currently stale revision can become eligible after a
server advance, so its exact captured value remains when lateEligible is true.
Global actor is not substituted for captured op.actor.

External effect is phase-independent, including dirty unused/done slots. Its
remaining guard is captured revision == exact current serverRevision. After it
runs, effects grows and backendAccepted becomes true. Only effects affects the
terminal observation. Cookie captures cannot change in these terminal phases;
effects never loses a member under step. Therefore a false lateEligible class
cannot recover without unused start replacing the complete record. This is a
source write-set argument, not a claim that currently failed ownership cannot
recover. No operation is folded merely because current(id) is false.

Raw context preserves active > 0 implies current(active), including active
terminal false-prefix states. Raw dispatched and exact effects preserve the
effects-implies-dispatched invariant. Dirty unused start resets dispatched to
false while old effects remains: that false obligation must stay observable.
The six local truths cannot change under external effect/global changes: all
captured operands remain immutable until unused full reset. Done never reopens.

## Every original action and projected successor

| Action group | Exact retained dependencies and update |
| --- | --- |
| Connected, seed | Phase guards remain exact. Every global guard stays raw. Seed proof writes commute with N; connected changes only raw wallet state. |
| Start | Requires exact child/active/unused and original ID/mode domains. It replaces the complete record from idle, captures raw globals, resets late flags and establishes all six local clauses. Old dirty effects persists and is evaluated against the new raw dispatched flag. |
| Identity reply, cache read | Live ownership, actor, wallet, JSON state and cache key remain raw. The cache copy commutes with N. Stops compute terminal observations from the carried raw record. |
| Authorize, parent observation/completion, session reply, continuation | Live phase, next, captured/current identity, context, revisions, authorization and observed snapshots stay raw. Parent refresh retains every global counter/update. Unknown next-phase values are not normalized. |
| Wallet return | Exact current ownership and original matches input choose the same stop/wallet update. |
| Lookup, signature return, cache write | Original validity decisions and proof copies are preserved as above. Scope/actor/index and exact global keys/written membership remain raw. |
| Advance, begin verification | Live index/ready/ownership remain raw; ready subsets and captured proof validity remain observable. |
| Inner post observation/return, dispatch | Every live postActor/cookie/actor/context/parent/revision field remains raw through dispatch. No preflight cookie or actor is prematurely summarized. |
| External effect | Raw dispatched/effects and terminal lateEligible/revision preserve the full same-ID guard, even after departure and with other local clauses false. Other fields remain exact while live. Effects only grows; the terminal backendAccepted write has no later consumer. |
| Backend stale/actor refusal, verify return | All guards read live verify-await records, retained in full. They may stop into a tuple while still leaving an external effect eligible. |
| Server advance, context/account/access/lifetime changes | All globals stay exact. Live captures remain raw. Terminal local clauses carry; late revision matching is recomputed from the exact server revision. There is no !current-based folding. |
| Explicit stutter | Observation is unchanged. |

Related raw states thus enable the same original action/parameter tuples and
have equal projected successors. Global bounds, busy/active, badEffect and
revision ordering remain functions of raw globals. Written-signature truth is
preserved by N; effects uses raw dispatched; active/current uses raw context.
Every local invariant clause is preserved through N on live records and by its
raw truth observation on unused/done records. Old negative actions outside step,
all direct scenarios and the complete concrete step remain unchanged.

This is a manual safety-quotient argument, not a machine-checked congruence or
runtime-refinement theorem. It claims no temporal progress, crypto/decoder proof,
continuous freshness, cancellation of a handed-off effect, exact output or
unbounded behavior. No finite bounds or original safety properties are narrowed.

## Binding and native control source

The hardcoded helper and matching manifest bind whole QNT, full translated TLA,
actual loader-produced final VIEW and the official adapter. Unknown definitions,
source/expression/translation/adapter drift and temporal properties fail closed.
Actual bindSafetyView/applySafetyView preserve the complete concrete body and
full 80-character terminator. The source guard covers every original helper,
phase, copy, writer, domain, invariant, scenario and dispatcher branch.

QNT SHA-256:
`4dfd003b560905492820e104f07f6091e10de2144dbc360a925cdad41538f590`.
Actual complete production TLA SHA-256:
`257f9d7eeab7709bdd000e43a7d0aad76c875d7ef7beda429aefde44403d7b09`.
Actual final VIEW SHA-256:
`ee7a362272db0d2d6a993d8887ed73d1b5d7a05b73621c032828bc4ff2958793`.

Native controls are source only. Under their flag, they freshly capture this
complete production translation and validate actual loader application. They
retain every production definition and reversibly replace only test init/step/
invariant aliases; helper definitions precede first use. All consumers and
boundary sequences call actual production actions, without copied action bodies.
Map domains remain exact, including a defined local key 3 in subset-false fixtures.

The source defines 52 observation cases, six raw-two/view-one pairs, five actual
boundary witnesses, eleven queue-zero positive/refusal guard cases, and four
stale/context-healing cases. Negative properties stand alone and require their
named noninitial State 2/3/17 counterexample, never an unrelated invariant failure.
Positive guard/sequence controls require successful completion, exact state counts
and queue zero. Pairs require both raw and viewed counts with q_inv TRUE, including
false written/authorization/dispatched classes and real production read/write
boundary records. The stale two-initial-state control requires five states in
both raw and viewed graphs, preserving later healing of just one captured revision.

A positive present cached proof mismatched to the first body's messages must
survive the actual context replacement, reconnect and next check, become ready
without a prompt, and complete its 17-state invariant-preserving fixture. Another
fixture preserves effects after unmount. These controls make no general theorem
claim and remain unexecuted until the coordinated hosted diagnostic.

All three inventories are regenerated, then checked again after the source
commit. Integration must regenerate its combined inventories and re-pin actual
runner/report tooling. Ignored evidence records exact packet source/tool/binary
hashes, complete translation/application and the old incomplete receipt separately.
Native/ordinary/full qualification and push remain held for actual review.

# Submission recovery terminal safety VIEW

This source-only PRD section 12 / STATE-05 experiment starts at
`dabd9d893d2b323746128496d65c49daee308aab`. The full concrete model has SHA-256
`8b39e8302787904f8979c4175aac8263a5068e3e60ca9471f7ad3099e44ea95f` and is
byte-identical to the previously reviewed 4066 model. No initializer, action,
dispatcher, domain, invariant, scenario, runtime source or resource allowance
changes. The earlier hosted 180-second exploration remained incomplete at
8,064,427 distinct states, 1,850,647 queued and depth 25. The separately owned
raw 600-second probe at `3be11937ad34b0ffb09d9604a89dca1accc22d33`
(run 43112962636) also remained incomplete: its last progress was
245,369,743 generated states, 34,239,458 distinct, 7,007,581 queued and
depth 31. Its retained receipt records the 600,000 ms deadline, exit 1,
unchanged inputs and no counterexample. That raw model SHA-256 and all six
mapped runtime-source hashes are identical to this packet's sources. It used
the concrete step without a VIEW and provides resource history, not a passing
proof or qualification of this quotient. Neither timeout establishes completion.

## Retained observation

Every global remains exact except `absenceObserved` and `receiptReplyLost`.
These two fields are write-only under the complete original step and invariant.
They normalize to false. Sender `response` is also globally write-only and
normalizes to `none`. The unchanged direct scenarios still inspect full raw
values; this VIEW authorizes no exact response or diagnostic-output claim.

Every unused or live sender otherwise remains **fully exact**. In particular,
unused is not an empty terminal class: read accepts unused/read and changes
only phase and three read snapshots. It preserves the other old fields, which
may already violate an invariant in a hypothetical false-prefix state.

Only a sender whose phase is `done` is replaced by:

1. Exact phase.
2. Exact committed attempt number.
3. Exact posted flag.
4. Whether outcome is outside `terminal`, `retryable` and `throttled`.
5. The raw original own-claim implication: posted implies matched, usable
   revision equals claim revision, and usable state is `submitting`.

The implication is evaluated before projection and retained when false. Its
operands are captured sender fields, never current globals. Done has no local
continuation or reuse. Thus later clock, receipt, revision, gate, account or
other-sender changes cannot heal its truth by consuming an erased operand.

The other retained terminal fields are indispensable: land(copy) still reads
all sender slots regardless of their phases. Its existential witness compares
attempt with copy, requires posted, and excludes exactly the three outcomes
above. The invariant independently counts posted senders. Exact attempt,
posted and eligibility preserve late copies, shared-attempt false prefixes,
and both directions of false-to-true global count/membership changes.

All other invariant clauses remain functions of raw globals: attempt/revision/
case bounds, saved and verified case obligations, advisory/copy membership,
copies within posts, and posts within the original two-ID domain. Posted
cardinality is reconstructed exactly from live/raw and done/retained flags.
Own-claim truth is raw for live/unused senders and retained separately for each
done sender. No invariant is assumed true to identify states.

## Every original action and same-parameter successor

| Action group | Preserved dependency and update |
| --- | --- |
| Save, ban, changeGate, reverseCopyOrder | All guards and written globals remain exact. No erased field feeds these operations. |
| Read | The exact unused/read phase and all old fields remain available. It preserves the old payload and overwrites only the original read snapshots. It cannot reopen done. |
| ClaimSend | The live read record and every current phase/revision/gate/ban/saved/attempt guard remain exact. It retains the original CAS comparison and commits the original claim revision/attempt or enters done with a raw-computed observation. |
| ClaimReply, claimReadback | Their live phase, claim revision and current row observations remain exact. Missing replies do not remove committed global state. The historical unchecked readback remains outside step. |
| ProviderStart | Ready sender and exact attempt remain live. The original posts union and posted write occur before any terminal projection. |
| Land | Exact posts and copies, plus every slot's attempt/posted/eligibility, determine the complete original guard for the same copy input. It changes only the raw copies set; local done own-claim truth carries. Other-slot effects and false membership/counting states stay visible. |
| ProviderResult | The live attempt, all global copies/order and each original outcome/listing input remain exact. Its chosen copy, next state and outcome writes are unchanged. |
| CommitOutcome | The live usable revision/state, outcome, chosen copy and next state remain exact until their final CAS use. Success and stale accepted-fallback behavior remain distinct. |
| OutcomeReply, outcomeReadback | Next revision/state and raw current globals remain exact. All terminal observations are computed from the actual carried sender, including false own-claim classes. |
| FallbackRead, fallbackWrite | The exact captured fallback revision and current row determine the original conditional uncertainty write. No stale accepted reply gains a resend transition. |
| Age, idle expiry, interrupted, reconcileFound/Empty/Inconclusive | Global guards and copy ordering remain exact. Erased absenceObserved writes cannot affect a later guard or invariant; its claim reset is equally unobserved. |
| Contacts, verify, loseReceiptReply, verification expiry, abandon | Every saved-case, receipt, age, contact, phase and revision condition remains exact. The erased receiptReplyLost write has no consumer. |
| Explicit stutter | Leaves the observation unchanged. |

For related raw states, every same original action/parameter tuple therefore
has the same enabledness and projected successor. Live-to-done transitions
compute their new tuple from exact source operands. Done-to-done global
transitions carry local observations while recomputing all raw global and
posted-count clauses. There is no terminal reset. Unused/read records are not
folded, so a partial read cannot silently repair or discard a false old capture.

This is a manual safety-quotient argument, not a machine-checked congruence or
implementation-refinement theorem. It does not claim exactly-once external
POSTs, live/atomic authority at the network call, unbounded recovery, liveness,
or exact diagnostic output. The concrete scenario that deliberately borrows a
new claim through legacyClaimReadback remains unchanged and still lies outside
the finite step's authorized transitions.

## Source binding and planned controls

The literal helper/manifest definition pins the whole QNT, actual complete
translated production TLA, loader-produced final VIEW and official TLC adapter.
Actual bindSafetyView/applySafetyView validate the complete captured config;
the concrete TLA body and whole module terminator remain intact. Unknown
definitions, source/translation/expression/adapter drift and temporal properties
fail closed. No generic projection engine or alternate step is added.

The actual captured production translation is SHA-256
`3c6c2cce46e5f182cf5f8ec7720fac70b7b878d3a673b510637986c2461993c1`.
Actual loader application produces
`e33157f8eb832d71e22f2da5e2d81f04a068d3cfbfea534b5c835d0b291ab71a`.
The pinned official runner is
`30d69d445952c1ff928923155b2caf6a1955243efe21420c467a0fd5bb0179ec`.
These are source/translation bindings, not completed verification receipts.

Whole-file guard mutants reject done reentry, read reset/retention changes,
new terminal/cross-slot consumers, changed land dependencies/outcome classes,
new readers of erased outputs and adoption of the excluded legacy action.
Native fixture source preserves each original observation and false/healing
own-claim class, posted counting, late land from a done sender, raw unused/live
snapshots, and all global obligations. Named negative properties stand alone
and require a noninitial State 2 violation. Positive raw-two/view-one pairs
include an already-false own-claim implication without assuming invariant truth.

Three additional native controls capture a fresh complete production translation
under the native flag, verify its pinned SHA-256 and whole 80-character module
terminator, and validate actual loader application against the production VIEW
hash above. They retain every original translated definition and replace only
the harness init/step/invariant aliases, inserting a dirty initial record and a
named reachability witness before their first use. They call the actual
production `read(1)`, `land(1)` and `land(2)` definitions: read must preserve an
unused sender's already-false
own-claim payload; land must consume a done sender's exact attempt, posted flag
and eligibility while carrying that false implication; cross-slot late land
must use the sender's attempt rather than its slot ID. Each witness must appear
alone as a noninitial State 2 violation, so an unrelated false original invariant
cannot satisfy the test. No production action is copied into a toy fixture.

This packet is source-only. Static source/translation checks are distinct from
native qualification, original scenarios/simulation and full finite exploration.
No native, ordinary or full graph is authorized or claimed by this document.
The source-only child regenerates all three repository inventories and checks
their committed inputs; central integration must refresh them again against its
combined source before release qualification. Timeout/cancellation is incomplete,
never a passing proof; graph counts would describe this quotient, not raw states.

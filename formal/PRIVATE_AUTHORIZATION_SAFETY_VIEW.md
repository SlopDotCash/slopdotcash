# Private authorization continuation safety VIEW

PRD section 12, STATE-04/05. This view addresses the finite verifier's broad
callback and consumed-snapshot frontier. The source model, init, step, four
original invariant clauses, domains, failure branches and all named scenarios
remain unchanged. No temporal, provider, cryptographic or source-refinement
claim is made. This is a manual congruence argument, with native controls;
it is not a machine-checked refinement proof.

## Bound source and observation relation

The literal allowlist and manifest bind the complete QNT source, actual
translated TLA body, appended VIEW and official TLC adapter. Any changed
source byte, temporal property, projection field or clause requires renewed
review. The original invariant is still the property TLC checks.

All globals, code consumption, grant/cookie identity, clocks and
capability facts remain exact except the following observations:

- `flowUntil` is write-only in executable transitions and the invariant. Raw
  named scenarios still inspect it; the VIEW makes no exact-output claim.
- The six `used*` fields become four **separate** truth bits: when global
  phase is `used`, the original session, actor and submission equalities and
  captured-time strict deadline. Each bit retains false and healing classes,
  including when another bit is already false. Outside `used` all four
  implications are true. No invariant is assumed to justify this relation.
- Callback phase always remains exact. `unused` is wholly overwritten by
  capture; `done` has no executable continuation or reuse. Their payloads are
  dead. A response retains success/failure and, on success, exact flow and
  captured time. Other failure names have identical successors. Active
  callbacks keep exact flow/time, nonce through validation, and actor through
  exchange and identity. A seal has consumed actor and nonce. Pre-response
  result is overwritten before delivery and has no invariant consumer.

## Successor congruence, without an invariant premise

Use the same action and parameters from either related state. Enabledness
and the projected successor agree:

| Action | Live inputs and successor reason |
| --- | --- |
| `beginFlow` | All guards and flow map are exact. It is the **only** flow-record writer and simultaneously leaves `used`, making all four use implications true. It cannot silently heal one while remaining in `used`. |
| `capture` | Exact unused phase and flow cookie/clock. Overwrites the complete callback record before any erased payload can be consumed. |
| `validate` | Exact phase, flow, time and nonce; exact flow map. Error classes all remain failed responses; success keeps flow/time/actor for exchange and identity. |
| `exchange` | Exact phase, flow and consumed-code set. The actor survives for identity. Success/failed response effects agree. |
| `identify` | Exact flow, provider parameter and presented actor. Identity failure is a failed response; success reaches seal with exact flow/time. |
| `seal` | Only phase and success parameter affect its result. Flow/time survive into an accepted response. |
| `deliver` | Exact response success bit; accepted flow/time determine the exact grant/deadline. Failed payload is not consumed. Callback becomes absorbing done, and global phase exits `used`. |
| `useGrant` | Exact live globals, flow and grant determine enabledness. It overwrites all six historical use fields; each new equality/deadline bit agrees. This also handles an initially false use observation. |
| Account/session/submission switches, tamper, cookie expiry, tick | Read and update exact globals only, preserving the flow map and historical-use bits. |
| Stutter | Preserves the relation. |

The earlier multi-step scenario helpers and obsolete clear-cookie negative
control are not members of `step`. The relation does not authorize including
those helpers, arbitrary future actions, callback reuse, cross-slot payload
reads or new invariant observations. Full-source binding refuses that drift.

The first three original invariant clauses observe exact globals/flow maps.
The final conjunct is exactly the conjunction of the four separately retained
bits. Thus every original invariant truth value is constant on each class,
including counterexamples and their later repairs.

## V2 phase and expiry closure

V2 also erases the global phase label itself. Only the scenario helper `begin`
reads it; that helper is outside `step`. All executable writers of global
phase (`beginFlow`, `deliver`, `useGrant`) make all four historical-use
implications true. Other executable actions preserve the flow map and captured
use fields, hence preserve each bit, even when a bit was already false. The
four conditional truth bits are computed from the raw state before masking.
There is no invariant premise or action-parameter permutation.

For each existing flow `i`, V2 erases only its `until` field if the current
cookie is different and **no** callback is in `validate` with exact flow `i`.
That cone is permanent: `beginFlow` cannot select an existing flow; a future
cookie can only become zero or a newly created different flow. Capture always
replaces the entire callback from the current cookie. Every other callback
transition can only leave validation, not return to it. Thus neither expiry
consumer (`validate` and `expireCookie`) can ever read that field again.

Before entering the cone, the exact deadline remains, including validation
of an old flow after a newer cookie replaces it. Non-existing flows retain
their deadline conservatively. All session/actor/submission/existence fields,
live cookies, callback phases, grants, clocks and original invariant bits
remain as specified above. `useGrant` reads the captured **grant** deadline,
not `flow.until`. `finishAllowed` is a raw scenario helper outside `step`.
This reasoning applies even when an original invariant is already false.

No ID symmetry is implemented. Flow IDs, callback slots, actor IDs and their
existing concrete domains remain exact in the raw model and in this view,
apart from the individually described dead fields.

## V3 permanently retired flow identity

V3 additionally erases an existing flow's session, actor and submission only
when its ID is neither the current flow cookie nor the current grant and no
callback referencing it is in validate, exchange, identity, seal or an accepted
response. The predicate uses raw callback records before callback masking. It
deliberately keeps identity for a grant ID even when hasGrant is false, and
keeps all non-existing flow identities conservatively.

This cone is permanent under every original step action. An existing flow
cannot be selected by beginFlow again, so no future cookie can name it.
Capture uses only the current cookie and replaces its entire prior record.
An unused or done callback cannot restore its old flow; a failed response can
only deliver without changing the grant to that flow. All other possible
future accepted callbacks are explicitly outside the cone. No existing flow
record is modified after creation. A future grant cannot return to this ID.

The three flow identity consumers are identify, useGrant and the historical
used invariant clauses. identify retains the flow whenever any callback can
reach that phase. useGrant retains the current grant regardless of grant
readiness. The four historical bits are computed separately from the RAW flow
and used fields, outside the masked state. A false bit remains false and a
later change in its truth remains observable. No existing invariant is a
premise for the reduction. A global phase writer either makes the four bits
true or captures exact other live flow identity; every other action leaves
the historical observation unchanged. The flow existence bit and both global
existence/consumed-code invariants remain exact.

This is a same-action, same-parameter continuation congruence. It adds no ID
symmetry, terminal stutter, input delay, weakened invariant, new initial state,
new model transition or resource allowance. The V2 expiry condition is kept
unchanged and independent: identity can still be live after expiry becomes
dead, for example while a callback is in identity or a grant references it.

## Qualification

V1 at3145ce792 passed38 focused tests (22 named witness/continuation controls,
5 paired raw/view coalescing cases), all31 original scenarios and500×60
seeded sampling, but its180s graph remained incomplete:3,668,460 distinct,
2,465,105 queued. Its cleanup reported EPERM; later recorded process checks
found no surviving owned PID or exact temp-directory match. That failure is
retained and is never a completion claim.

V2 at51e5dfed5 passed51 focused tests, including25 named noninitial controls,
9 paired raw/view cases and one conservative boundary (44 TLC invocations),
all31 original scenarios and500x60 sampling. Its180s graph remained incomplete.
A later isolated hosted600s V2 run43122103257 also remained incomplete:
24,050,509 distinct,12,164,780 queued,depth13,600430ms; source stayed stable,
the run was not canceled and no invariant counterexample was reported. Both
failures are retained. Neither a partial graph nor the native controls establish
completion or source refinement.

V3 is a separate private STATIC candidate. Literal and controller review,
fresh native controls, original scenarios/sampling and a complete graph are
pending. No native or broad V3 graph has run. All raw QNT, mapped implementation,
original scenarios, actions, domains, failure cases and resource budgets remain
unchanged. Earlier receipts apply to their exact V2 source, not to V3.

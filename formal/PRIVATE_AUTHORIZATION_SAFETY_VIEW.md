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

All globals, flows, code consumption, grant/cookie identity, clocks and
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

## Qualification

V1 at3145ce792 passed38 focused tests (22 named witness/continuation controls,
5 paired raw/view coalescing cases), all31 original scenarios and500×60
seeded sampling, but its180s graph remained incomplete:3,668,460 distinct,
2,465,105 queued. Its cleanup reported EPERM; later recorded process checks
found no surviving owned PID or exact temp-directory match. That failure is
retained and is never a completion claim.

V2 at `51e5dfed5` passed 51 fresh tests with the native flag enabled and 220
assertions. These include 25 named counterexamples that require State 2 and
reject initial-state violations, nine paired raw/VIEW coalescing cases and
one conservative retained-data boundary. The 31 original scenarios and 500
seeded samples with a limit of 60 steps also passed.

The single local graph attempt with the original 180s budget remained
incomplete. Its last reported progress was 1,236,681 distinct states, 876,923
queued, at depth 9. Cleanup reported EPERM; immediate recorded PID, PGID,
start-time, command and exact temporary-directory audits found no survivor.
All 2,163 tracked hashes and six pinned tool/binary hashes stayed unchanged.
The incomplete result and cleanup failure remain failures.

This child changes only the private-authorization verifier allowance to 600s,
matching merged development `dabd9d893`, plus the reviewed manual models/shards
diagnostic inputs and derived indexes. The QNT, projection, manifest, source
bindings, native/controller file and all their pins are byte-identical to
`51e5`. No ID orbits, new domains or local graph retry exist. Normal release
defaults still request all models and all six shards. A focused hosted dispatch
may select `api_private_authorization` and shard `[1]`.

Hosted qualification at 600s is pending. Inherited control/scenario receipts
remain scoped to their recorded parent source; they are not relabeled as a
fresh execution of the entire child. All three generated inventory/catalog
checks must pass again after committing this child's final bytes before any
dispatch. No graph completion claim is authorized until the real hosted graph
finishes with zero queued states, stable inputs and no cancellation.

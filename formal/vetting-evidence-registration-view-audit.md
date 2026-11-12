# Evidence-registration observation VIEW V1

This private PRD section 12 prototype starts from
`dabd9d893d2b323746128496d65c49daee308aab`. The complete original model
`formal/models/vetting/vetting_evidence_registration.qnt` is unchanged,
SHA-256 `351ba8aa9a95eacd15a068743ed99a5a75f35b4d5581446b10fa84dcdcc9f00c`.
The owner reported the earlier raw 600-second attempt incomplete with rounded
progress of 30.8 million distinct states and 27.37 million queued. This is
context for a separate static reduction, not an independently parsed receipt,
proof, completed graph or reason to change any budget.

No QNT byte, action, dispatcher, parameter/domain, bound, invariant, scenario,
runtime or allowance changes. This candidate adds one source-bound TLC VIEW,
its dedicated controls and the existing native-inventory registration.
The concrete ordinary step and every direct scenario remain original. Exact
error-code, stored-hint membership and service/time diagnostic values are not
observations established by this safety quotient.

## Exact projection and complete consumer audit

All fields and map domains stay raw except the following independent classes.
The projection is evaluated on the original state; model actions never run on
the projected record. In particular the stored field is a Boolean observation
in the fingerprint, while the concrete model still carries its original set.

| Field | Projection | Every executable/invariant consumer |
| --- | --- | --- |
| bytes[part] | valid stays valid; every other value becomes missing | hint compares only equality with valid. changePart validates its original parameter and directly replaces the chosen entry. The complete physical-part domain remains. |
| request.fault | none; early JSON {json,shape,digest,empty,limit} represented by json; all other non-none values represented by object | json tests membership in exactly that early set; objects tests != none. No invariant reads a fault. Original begin parameter legality remains exact. |
| request.raw | 3 stays 3; other values become 1 | canonical tests only == 3, selecting manifest 2 or 1. Original raw forms 1/2 remain distinct in unchanged concrete scenarios. |
| request.status | 200; 201; every other integer becomes 0 | The invariant tests success membership {200,201}, == 201, and replay's == 200 separately. No step reads an old status to choose a branch. |
| request.stored | Raw subset-of-{1,2} truth, including false | The invariant's subset predicate is its only consumer. hint only preserves or unions object 1/2. begin replaces it from idle, including the empty set. |
| wholeMatches | true | Only init and wrongWhole write it. Its only reads are excluded direct scenario expectations. |
| request.cause | none | batch writes its local diagnostic; no step/invariant reads it. |
| request.delivered | false | response writes its original parameter; no step/invariant reads the prior field. |
| request.service/request.at and row.service/row.at | zero in every row/request | begin stores its validated service parameter; initialRead captures exact now into request.at. batch only copies these fields into the row. No guard/invariant reads any field in this closed copy cone. Direct scenarios retain their original raw values. |

Global now is retained exactly: tick reads its < 3 guard, and initialRead
still captures it before a batch. All IDs, scopes, attempts, phases, manifests,
commit/replay bits, hint cursors, assessment state, object/audit facts, current
and row generations remain exact. No terminal record or slot is removed.

## Same-parameter successors, without an invariant premise

Related states have the same exact live fields above, the same byte-validity
class per physical part, fault class, raw-3 class, status class, and independent
raw stored-subset bit per request. They may differ in each explicitly erased
copy/diagnostic value. This relation applies when any original invariant clause
is already false; no clause is replaced by an assumption that it holds.

* begin's guards read only exact IDs, parameter domains, prior phase/attempt,
  and its original constant domains. It resets the entire request from idle.
  The same original arguments therefore produce equal projected captures,
  regardless of old stored poison, status, fault or diagnostic fields.
* configuration and signature branch on the same original parameter and exact
  phase. Their error-code writes all enter the other-status class; successful
  phase changes preserve each existing class. They read no erased old value.
* json treats every early JSON fault alike, preserving the assessment-before-
  object ordering. objects refuses every non-none fault, including an early
  fault in a hypothetical objects prefix. None is a separate class throughout.
* canonical computes the same manifest from the raw-3 bit before moving to
  initial-read. Both original reordered forms retain manifest 1. No manifest
  or immutable repository/storage identity is projected away.
* initialRead and catchRead use exact scope, readable parameter and row
  manifest. The shared replay function compares exact manifests, sets exact
  replayed and the 200 class on success, or the other-status class on conflict.
  Batch success still sets the separate 201 class and exact committed bit.
* batch's current-row, operational and assessment predicates stay exact. It
  preserves the original atomic row/object/audit/generation update. Copies of
  service/time and the cause diagnostic stay entirely inside the erased cone.
  Batch-reply and catch-read ordering and every failure branch remain original.
* hint uses exact row generation, cursor, I/O parameter and each needed part's
  valid/nonvalid bit. It therefore takes the same skip/advance branch and
  writes the same exact cursor/phase. Union of 1 or 2 preserves a true subset
  bit. It cannot remove an outside member, so a false bit stays false through
  every hint, including when part validity or I/O availability later changes.
* response keeps the original phase guard and done transition, erasing only
  its unconsumed delivery parameter. Retry begins still use exact attempt and
  phase, then reset all request fields before another consumer.
* tick, assessment removal and generation rotation have only exact guards and
  retained writes. changePart keeps its full original parameter domain and
  produces the corresponding validity class. wrongWhole becomes a projected
  stutter, matched by the explicit original step stutter.

The three row invariant clauses remain literal predicates of exact manifest,
audit, objects, assessment and generation. Each request's attempt bound stays
raw. Stored-subset truth is retained individually. Success binding is computed
dynamically from exact scope/manifest and row manifest with the status success
class; 201=>committed keeps its distinct status bit. Replay still observes
200 and exact phase != batch. Consequently a false clause, independent false
clauses and their later healing remain distinguishable. The current invariant
is reconstructible from these observations, not from masked service/time or
invented parser/storage claims.

Every original call with the same parameters has identical enabledness and
matching projected successors. This is a manual strong finite safety-
congruence argument. It is not machine-checked application refinement,
cryptographic/parser/provider correctness, liveness, exact HTTP/error/hint
payload equivalence or an unbounded-system theorem. Existing source-model
assumptions about signatures, D1 atomicity, manifests, generation retirement
and storage retention are unchanged.

## Binding, control source and qualification limits

The only added hardcoded definition is
`vetting-evidence-registration-observation-safety-v1`, operator
`SlopVettingEvidenceRegistrationViewV1`. Exact complete source, complete
production TLA and complete final VIEW TLA are pinned separately:

* QNT: `351ba8aa9a95eacd15a068743ed99a5a75f35b4d5581446b10fa84dcdcc9f00c`
* TLA: `3388b5c753ed3c871a00e2d3584f61e4608edaba67aec546578513335c954eae`
* VIEW: `81f21385a81587b0ced0b773290a118695a784c9d26e96b4977956f999f582a3`

Translation-only capture intercepts tlc.verify before exploration. Actual
apply/bind validates the full production module and its 80-equals terminator;
a synthetic four-equals fixture is not production evidence. The dedicated
native harness freshly translates that complete original model under the
native flag, modifies only q_init/q_step/q_inv for each controlled witness,
and calls the original json/objects/canonical/hint/begin/batch actions. The
production actions and all full-model domains remain unchanged.

Whole-source gates reject new exact byte/fault/raw/status consumers, stored
membership reads or outside-poison removal, incomplete begin reset, readers
of any copy/diagnostic field, changed bounds and new invariant observations.
The literal projection hash and the existing exact adapter/translation/VIEW
checks also refuse unreviewed definitions or temporal properties.

Negative definitions isolate the original invariant families with independent
false/healing cases. Additional definitions cover 200/201/other status classes,
false replay status, exact live fences, each physical part's validity, original
JSON/object consumers, raw canonicalization, skip ordering, poison carry and
actual begin reset. A named witness ALONE is negated into q_inv; no conjunction
with the production invariant can create an unrelated failure. Every negative
requires a noninitial State 2; two-step consumer controls explicitly require
State 3 as well.

Paired controls use TRUE alone and require raw/view queue zero. They cover
missing/corrupt bytes per part, both nontrivial fault classes, the two raw
orderings, other errors with a false replay clause, inside/outside stored sets,
and the entire copy/diagnostic cone. Original batch copies and hint poison
carry also use two-initial-state continuations (raw four/view two). These are
projection diagnostics, never a replacement for complete original-invariant
verification.

This packet is STATIC until root's actual literal/controller review. Native
controls, original ordinary scenarios/500-by-60 sampling and a complete finite
graph remain held; no result from another candidate is a fresh result here.
No push or dispatch is authorized by preparing this prototype. Static checks,
source hashes and translation binding alone do not complete qualification.

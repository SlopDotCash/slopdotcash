# Historical subscription intake phase/readback VIEW V2

This private PRD section 12 static candidate starts from frozen V1
`24080eb471dbb976a082d79a646e9c9db9fe8989`. It changes only the fingerprint
projection, dedicated guard/control source and documentation/inventories.
The full original QNT, every action and parameter domain, step, invariant,
28 concrete scenarios, mapped runtime and original 180-second allowance are
unchanged. The V1 local native/ordinary receipts remain V1 evidence. Its local
180-second graph was incomplete: last reported 1,446,214 distinct states,
1,128,063 queued and depth 7, about 31 seconds before the deadline. Cleanup
warnings and the later exact owned-process absence audit are separate facts.
The owner also reported its hosted 600-second child incomplete at about
11.47 million distinct / 5.76 million queued. That latter rounded reference
is not a freshly parsed receipt, a V2 result or a reason to retry unchanged.

## Exact delta from V1

The sole historical entry is replaced by
`historical-subscription-intake-phase-readback-safety-v2`, operator
`SlopHistoricalSubscriptionIntakeViewV2`. It adds exactly three cuts:

1. Only in `prepare`, `preflight`, `append` and `readback`, set each local
   `sourceRevisions` map value to zero while retaining its entire original
   DOMAIN. Before these phases, and in an unknown phase, keep it exact.
2. In those same four phases, erase local collected/refreshed sets but retain
   each of the two separate RAW original subset implications. Compute these
   on the complete actual state, before any set is masked. The carrier tuple
   has an explicit `post-refresh` class; the exact phase stays in its record.
   All other fields stay as V1, especially exact members and registryRevision.
3. In V1's unused/response/done tuple, add the RAW original receipt clause
   `I = (status == 200 => rowAt(returnedRow).exists &&
   returnedPayload == rowAt(returnedRow).payload)`. Retain exact row/payload
   references if I is FALSE. If I is TRUE, observe the canonical pair (0,0).
   Preserve V1's separate status-is-200 truth, exact phase and attempt,
   retry envelope and three independent noStore/subset truth observations.

Every global record, source/claim/parent index, tip, global source and registry
revision, active/installation flag and selected-source set stays exact.
All live fields outside the two explicitly named post-refresh carriers stay
exact except write-only received, already erased in V1. No unknown phase is
silently treated as terminal or post-refresh. Map domains and request slot
indices remain original. The concrete actions never run on masked records.

## Whole-source consumers and cut entry

| Original action/helper | Reads and matching projected successors |
| --- | --- |
| sourceChanges / registryChanges / pause / removeSource / revokeInstallation | Only exact global reads and writes. Global sourceChanges does not rewrite a request's captured map. |
| begin | Only unused/done and exact attempt guards. The complete original five-field envelope remains exact when 0 < attempt < 2; that equality guard is vacuous at nonpositive attempts and begin is disabled at >=2. A full idle-based reset replaces every local carrier and receipt reference before any live consumer. |
| headers / session / body / envelope / installation | Exact phase/parameter/envelope predicates. Failure uses original respond: positive status/noStore true; all raw successor observations are recomputed after that action. |
| collect | Exact members and collected membership, exact global source revision and local map writes. This pre-cut phase stays exact. SourceRevisions is only copied here and read by refresh. |
| reconstruct / capture | Exact mode/bundle, global authority, exact members and registry capture. All pre-cut sets/maps remain exact. |
| refresh | Exact local sourceRevision vs global revision, exact members/refreshed membership and original argument. Successful refresh writes the actual new refreshed set and enters prepare iff it equals members. The new separate raw subset bits are then computed on this successor, never inferred from the phase or an invariant. |
| prepare / preflight | Exact phase/argument; exact mode/key/parent, global tip and replay facts. Neither action reads the post-cut map or collected/refreshed sets. |
| appendRecord | Exact mode/key/parent/payload/members and captured registry revision, global authority/selection, records/tip. Writes the original complete row and all indices atomically. It never reads collected/refreshed or the local source snapshot. |
| readback | Exact rowOf inputs and global row determine original success/refusal. Success sets exact row/payload and status 200/noStore true; the new terminal raw I is computed after this actual write. It does not read sourceRevisions or either set. |
| failure / send | Failure has only original live phase guards and responds 409/noStore true; send has response guard and writes only done/received. Maps/sets and receipt fields are otherwise carried, so the observations carry. |
| stutter / other-slot action | No hidden local read. Global writes remain exact; dynamic FALSE receipt observations are reevaluated against the new exact global rows. |

Post-refresh phases cannot regress to collect/refresh. There is no partial
request reuse: only begin reuses unused/done, and fully resets the request.
There are no other-slot reads of a request's erased carriers. Every original
call with the same parameters therefore has identical enabledness and
matching projected successors, without assuming any invariant is true.

In a dirty refresh prefix, members={1}, collected={}, refreshed={} and a
matching source revision produce prepare with refreshed={1}. The first subset
clause is FALSE while collected subseteq members is TRUE. A second prefix
with collected={1,2} yields first TRUE / second FALSE. Both-false and both-true
classes are separate too. No phase-based rule substitutes TRUE for any clause.
After entry, all four post-refresh actions and failure/send preserve the raw
sets, so each bit carries independently. Begin resets both sets to empty and
derives members from the original mode argument, healing both bits to TRUE.
This handles false prefixes and reset healing without an invariant premise.

## Why a TRUE terminal receipt is forward closed

I is computed from the ORIGINAL status, references and global records.
For non200, only begin can later create a live response path, and it fully
resets all local receipt fields first. send carries status; every other local
action is phase-disabled. The false guard therefore stays false until reset.

For status200 and I TRUE, the referenced row exists with matching payload.
No model action deletes a record or replaces an existing row: appendRecord's
replay branch is selected before its only INSERT, so even a dirty prefix with
another tip/parent cannot overwrite that existing row. Other authority/source
changes do not touch records. Thus I remains TRUE under all other-slot actions,
send and stutter. Begin resets it to TRUE with status0 before any future read.
The raw references cannot affect another guard, write, retry envelope or
invariant clause. TRUE representatives with different valid references have
matching successors, not merely the same current invariant value.

For I FALSE, exact references MUST remain: another request may append the
currently absent referenced row with the matching payload and heal I. An
existing row with a mismatching payload cannot be overwritten, but V2 keeps
those references conservatively too. Out-of-domain references remain exact.
Related false representatives therefore point at the same row/payload and
see identical cross-slot healing when the exact global INSERT occurs.
A false class never gets silently canonicalized by the projection.

All original global invariant clauses remain literal predicates of exact
fields. Local noStore and subset truths remain separate raw observations.
The readback clause is exact in live phases and is its raw I in terminal
phases. V1's retry guard/counter argument remains unchanged. This is a manual
strong finite safety-congruence argument, not machine-checked source or SQL
refinement, exact HTTP/output equivalence, liveness, continuous GitHub
freshness, cryptographic/provider correctness or an unbounded-system theorem.

## Exact bindings, retained controls and limits

* Full original QNT: `cbc8d18d11f2c13246d83dfb9c2d6aefc5345bfa20b248e82f172258b4ee6f22`
* Full production TLA: `10224d70eb2cdae0311f4a59a054299aa94675042c0e3ea7f7f58b020735f93c`
* Final VIEW TLA: `403e5edaa1b8cbca5ce4f54eb4cd5ff229bc8fca472930c77250eaac1a6428f0`

The actual complete retained production TLA binds and applies the final VIEW
using its complete long module terminator. No synthetic four-equals fixture
or manually clipped terminator is production-pin evidence. The native harness
continues to derive fresh complete production TLA when explicitly enabled;
it has no dependency on ignored local artifacts. The adapter, model selection,
config and lock remain unchanged.

Every V1 named case, positive pair, retry/exhaustion and unviewed future-consumer
control remains, bound to V2. No exact-output case needs retargeting: the old
returned-row/payload pre-healing controls already have I FALSE, so V2 retains
those exact references. A true-to-false returned-payload change alters raw I
and remains visible. The old cases/harness have an explicit equivalence audit;
only the reviewed ID rebind and optional stricter trace-depth assertion are
common-harness changes. V1's direct 28 scenarios remain byte-for-byte exact
and run concretely without a VIEW; their output assertions are unchanged.

New native SOURCE covers the actual dirty last-refresh boundary, each separate
false subset, pre-cut source reads, map DOMAIN and conservative unknown phases,
exact members at append, every actual post-cut carry, failure/send/full begin
reset, FALSE cross-slot INSERT healing/nonhealing, out-of-domain false refs,
immutable TRUE receipts, terminal retry boundaries and no-VIEW future consumers.
Negatives use the named witness ALONE via q_inv = ~witness, require noninitial
State2 (or later for real continuations), and reject initial failures.
New TRUE200/non200 and all four post-refresh carrier/class pairs require
RAW2/VIEW1, q_inv TRUE alone and empty queue. Both false clauses are retained
in these diagnostics rather than adding the original invariant as a premise.

Complete-source and action/step/invariant-prefix guards reject added carrier
consumers, phase regression, cross-slot reads, record overwrite/deletion,
terminal output routing, retry/domain/invariant changes and temporal claims.
The dedicated test filename is unchanged and already registered in formal.yml;
no native inventory path is dropped or added speculatively.

This is a STATIC candidate. V2 native, ordinary and complete finite graph
executions and push remain held for root's actual implementation review and
separately scheduled combined hosted qualification. No old V1 pass is a fresh
V2 result, and neither static checks nor an incomplete graph proves safety.


## Hosted namespace correction

The composed 12-candidate run 43130733415 at 5e09 reached SANY for this VIEW and
FAILED after 7276ms, before graph exploration. Its local LET name receipt
collided with the unchanged production receipt(request) operator, producing
multiply-defined-symbol and arity errors. That is a binding failure, not an
invariant counterexample, completed graph or 600-second resource exhaustion.
Inputs were unchanged and the run was uncanceled. Retain the terminal receipt
SHA-256 9a68f4b4af76b0d781c5366f10c546f8ab7800188e0e36b742c0e790f5c15f6a.

The same composed source's original ordinary stages passed: type 1492ms,
all 28 scenarios 1707ms, and the unchanged 500-by-60 sampler 22509ms. Those are
retained hosted-source receipts; they are not fresh qualification of this
new static child or its verifier/tools.

This child alpha-renames ONLY that local boolean and its two uses to
SlopIntakeReadbackSafe. The new name is absent from the entire retained
production TLA. Inverting those three identifier replacements restores the
exact parent expression. The QNT, full production TLA, all semantic clauses,
original domains/actions/scenarios, every controller case, model-selected step,
allowances, mapped runtime and adapters remain unchanged. Only the expression
and final VIEW hashes change. Complete-production apply verifies the new
403e5edaa1b8cbca5ce4f54eb4cd5ff229bc8fca472930c77250eaac1a6428f0 pin using
the retained full input and full terminator, without retranslation or a JVM.
Static checks cannot claim the new module parsed or explored successfully;
native, ordinary and full-graph reruns remain held for reviewed hosted execution.

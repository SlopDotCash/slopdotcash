# Generation-storage observation VIEW V1

This private PRD section 12 STATIC candidate starts from
`dabd9d893d2b323746128496d65c49daee308aab`. The complete original
`formal/models/vetting/vetting_generation_storage.qnt` remains byte-identical,
SHA-256 `1beb326e7630b58014e64b30cce756404d334917d07b37abb5a85c88d735dd80`.
The owner reported the earlier raw 600-second search incomplete at rounded
13.89 million distinct states / 2.06 million queued. The owner retains that
failure; this is not a freshly parsed receipt or a completed proof. No raw
retry, allowance change or finite-domain change is part of this candidate.

Every action, dispatcher, original parameter/domain, invariant, scenario,
runtime and budget remains original. The only added behavior is a source-bound
TLC fingerprint projection plus its dedicated guard/control definitions and
native-inventory registration. The original ordinary model still carries all
its raw result/diagnostic values. This VIEW establishes no exact HTTP/error,
publication-diagnostic or response-payload equivalence.

## Literal projection

Every global field remains exact: generation states, all immutable target
identities, all heads, body values and their domains, retired targets and both
safety flags. Request-slot indices remain exact. There is no ID permutation,
input delay, transition removal or new initial model state.

For every request, published is unconsumed and dbFailure is an internal error-
label carrier. The result classes are stored, read and other. Nonterminal and
unknown-phase requests retain every other raw field. Only exact phases idle
and done use this tuple:

`<<phase, Bstored, Bread, putPending, pendingPayload>>`

* Bstored is the RAW original implication
  `result == stored => verified && activeAccepted && selected > 0`.
* Bread is the separate RAW original implication
  `result == read => verified && selected > 0`.
* putPending is the exact original Boolean.
* pendingPayload is EXACT `<<candidate,generation,descriptor,reserved>>` while
  putPending is true; otherwise it is the canonical `<<0,0,0,false>>`.

The two result bits are computed from the complete original request, not from
masked fields or a true-invariant premise. Each can be false in its own
result class; because result is one string, they cannot both be false for the
same request. The predicates remain separate observations.
The pending identity clause is deliberately NOT stored as a frozen truth bit.
It is reconstructed dynamically from the exact pending payload and the exact
global targets. No request with a pending PUT loses that payload, even in done.

## Whole-source consumer audit

| Field/action family | Complete executable and invariant dependency |
| --- | --- |
| request.published | Only init/begin and publish write it. Its only reader is an excluded concrete scenario expectation. No step or invariant consumes it. |
| request.dbFailure | reserve/publish assign it; reservationReply/publicationReply OR it with reply failure. reservationReadback uses it only to choose reservation-error vs retired. winnerRead uses it only to choose database-error vs publication-error. Both choices stop in done with result-other and identical retained writes. No guard/invariant reads the flag. |
| request.result | stop, begin, activeCheck and currentRead write it. No step branches on an old result. Only the original stored/read implications consume it. All other strings are the same invariant class. |
| active/unknown records | Every mode, generation, descriptor, candidate, expected/selected pointer, reservation/verification/acceptance flag, pending/settled flag and phase stays raw except the three classes above. All current-read, reservation, publication, winner and reply consumers keep their original operands. |
| terminal result operands | No idle/done action partly changes result, verified, activeAccepted or selected. settlePut changes pending/settled only. begin is idle-only and fully resets all local fields before another live consumer. done cannot begin again. |
| terminal pending payload | settlePut is enabled by putPending independently of phase. It reads candidate/bodyAt and may still write the exact body key after a failed reply. The original invariant also reads reserved and the candidate's current global generation/descriptor. |
| terminal nonpending payload | settlePut is disabled. All pipeline consumers are phase-disabled. Only idle begin can leave, and it replaces the complete request from idle using the original arguments. Other slots/environment actions read globals, not this payload. |
| every global/environment action | changeBody, generation retirement/markers/records and nextGeneration read/write only exact globals. Other callers reserve targets or publish heads with their exact live request fields. No terminal local payload is read cross-slot. |

Erasing dbFailure therefore requires result classification; it is not claimed
to be literally write-only. A related pair can take different concrete error
labels, but those labels both enter other, with identical phase, pending state
and all retained writes. reservationReply and publicationReply only propagate
the erased flag, so they cannot later distinguish the pair in another class.

## Same-parameter successor argument, including false prefixes

Related states have equal globals. Active/unknown requests agree after only
the three global diagnostic/result classes. For idle/done, related requests
have equal phase, each independent raw result implication, pending flag and
all four pending-payload values when pending. No original invariant is assumed.

Every original call has the same enabledness for the same original arguments.
Live guards use the exact phase, raw retained inputs and exact globals. The
database flag's only branching differences are equivalent other-result errors.
For each live successor, the original full assignment runs before the new
projection is computed; entry to done does not infer either result bit true.
For example, a dirty finishing activeCheck prefix can still yield stored with
a false stored implication. An already-false terminal read implication is
retained too.

At idle, begin checks phase and its constant original argument domains. It
never reads the old mode, candidate or other captures; it resets every field
from idle. Even a dirty idle request with pending true is reset exactly as the
source model specifies. Its new pending false and result-other give two true
result implications, and a live successor retains its fresh original inputs.
An invalid input ends in done with those fresh raw observations. This is a
model reset argument, not a new application guarantee about physical I/O.

At done, begin and every pipeline action are disabled. settlePut remains
enabled iff the exact pending flag is true. It uses the retained candidate and
exact bodyAt result, writes the same global key only if missing, preserves a
marker/other existing body, and sets pending false/settled true. It never
changes a result implication's operands. Afterward the pending payload can be
forgotten because no remaining terminal action reads it. The same reasoning
covers a pending idle prefix before begin is chosen.

While pending remains true, another caller's reserve can change an absent
target to the exact immutable generation/descriptor. That can heal a false
pending-identity clause. Candidate, generation, descriptor AND reserved must
therefore stay individually exact; a current false/true Boolean is insufficient.
Two terminal prefixes with false identity clauses may react differently when
another caller reserves one specific tuple. The controls use a test-only field
change to select such a prefix before the original reserve; no original done
action repairs those local fields. The late PUT's actual body destination also
depends on candidate independently of current identity truth. The tuple
retains all these distinctions.

The five global invariant families remain literal predicates of exact global
fields. For each request, the stored/read implications are their separate raw
bits in terminal phases and are reconstructible from the retained result
class/full record elsewhere. Pending=false makes its identity implication
true; pending=true reconstructs it from the exact four-value payload and global
identity. Global reserve writes can still heal or break relevant false
observations. No global safety flag, target/body/marker fact or request truth
is silently assumed healthy.

Thus same-parameter original transitions have matching projected successors,
including last-use boundaries, late effects, reset healing and unrelated
false clauses. This is a manual strong finite safety-congruence argument,
not machine-checked implementation refinement, continuous active-generation
or byte freshness, provider liveness/correctness, exact diagnostic/output
traces or an unbounded-system theorem. The original create-only, retirement,
marker-integrity and API-authority assumptions remain unchanged.

## Pins and control source

The only new hardcoded definition is
`vetting-generation-storage-observation-safety-v1`, operator
`SlopVettingGenerationStorageViewV1`. Complete bindings are separate:

* QNT `1beb326e7630b58014e64b30cce756404d334917d07b37abb5a85c88d735dd80`
* Production TLA `30365ae6d173c92c54c501d3f2600f9a252c13c9734e524996710f9fe2a57d37`
* Final VIEW TLA `84de8a367f8e33996a0f770dc15decb889160900765bac6d34e177f8e8eeec2a`

Translation-only capture intercepts tlc.verify before exploration. Actual
apply/bind must preserve the entire original production body and its complete
80-equals terminator. Synthetic fixture pins do not replace that check. The
native harness freshly derives this full translation when explicitly enabled,
then changes only q_init/q_step/q_inv for controlled fixtures and calls the
original source actions. Aliases are placed after their actual dependencies.

Whole-source gates reject added diagnostic/result consumers, a terminal
reader or reuse, incomplete reset, a new late-effect operand/phase condition,
a changed invariant observation, cross-slot payload reads and domain changes.
The literal projection digest and exact source/TLA/VIEW/adapter checks also
refuse unreviewed expressions or temporal properties.

Negative SOURCE isolates each global invariant family and independent terminal
stored/read false/healing observations, keeping another clause false where
useful. Pending controls retain every identity value and the exact flag, with
actual other-slot reserve healing after a false-prefix field repair. Exact
unknown fields and live head/read/verification/reservation/reply consumers are
covered too. Actual putReply(false) -> done+pending -> settlePut, body-key
selection, marker preservation and dirty idle reset use the original actions.
Each negative uses ONLY its named witness as q_inv's negation, requires State 2
(or State 3 for the two-step consumers), and refuses an initial violation.

Paired diagnostics use TRUE alone and require both raw/view queues empty.
They cover all intended terminal truth classes, retained pending identity with
dead unrelated fields, active/unknown diagnostic classes and real error-label
branches. Original lost-reply/late-settle, dirty full reset, false stored-bit
carry and other-slot reservation boundaries have explicit expected raw/view
class counts. They are projection diagnostics, not a complete invariant proof.

This is a STATIC candidate. Native controls, original ordinary scenarios and
500-by-60 sampling, a complete finite graph, push and dispatch remain held
pending root's actual implementation review and hosted qualification. The
old raw 600-second incomplete run is not retried or relabeled. Static checks,
manual source review and binding alone do not complete qualification.

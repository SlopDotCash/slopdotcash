# Journal safety view

The `direct-bounty-journal-safety-v4` view is specific to the invariant in
`models/payments/direct_bounty_journal.qnt`. It changes TLC state fingerprints,
not the source model, full-state named scenarios or sampled execution. The
model SHA-256 is
`3020aebd3ca62801dace69ab002c49c19fa9bdb71723b435b72d0e204d824dd0`.
Earlier full-state and shorter view runs ended incomplete; they remain failed
receipts and cannot be relabeled by a later result. Model authoring comments
record their original checkpoint, not current execution status.

## Exact projection

Version 4 preserves all fields except each entry `hash` in the view of `store`
and both component `memory` maps. It maps hash zero to zero and hashes one or
two to a single positive representative. It preserves every map domain, every `request`, `transaction`, `held`, `used` and `mounted` value, and every store `candidate`. It canonicalizes only memory-entry `candidate` to zero: no action reads that field for a guard, store update, or either invariant clause.
It then retains these two independently computed truth values:

- O: `(s.wrote and s.expected > 0) implies s.observed == s.expected`.
- F: `s.touched > 0 implies Set(1,2).exclude(Set(s.touched)).forall(n => s.store.get(n) == s.before.get(n))`.

The view computes both clauses from the full representative state. They are
not supplied authorization flags. False O and false F remain distinct and
visible to the unchanged invariant. No raw field is removed from the source
model or from normal scenario execution.

Let N normalize those entry hashes and only memory-entry candidate fields, let R contain the normalized store
and memory plus unchanged held/used/mounted, and let P(s) = (R(s), O(s), F(s)).
The original invariant is exactly the conjunction of the `used` domain rule,
O and F. Its truth therefore depends only on P.

## Successor-congruence argument

Every reachable hash is zero, one or two. All hash guards use equality to zero
or positivity; no action compares the two positive markers. Those guards are
preserved by N. Normalization commutes with map replacement, copying entries,
and replacing a hash with N of the assigned hash. All other fields are copied exactly. Memory candidate is only copied or retained within memory; `returned` fallback changes only its hash, and `check` takes candidate from the current store, never memory. Therefore memory-candidate normalization also commutes with every projected successor. Store candidate stays exact because `rejected` reads it. Therefore guards and normalized R updates depend only on R and the
action parameters.
`emptyInput` feeds only `checked`. `warning` and `checked` feed no guard or R
update. The five raw witness fields feed only the invariant and carried state.
For reachable, well-typed states with equal P, the following action table
therefore gives equal projected successor sets.

| Action | O successor | F successor |
| --- | --- | --- |
| `reserve(..., stored=true)` | true: expected becomes zero | true: before snapshots old store and only the touched nonce changes |
| `reserve(..., stored=false)` | true: wrote becomes false | previous F: store, before and touched are carried |
| `returned` | true: a write requires current/held identity; otherwise wrote is false. Hash assignment one and memory copies commute with N. | true: fresh old-store witness and only the touched nonce can change |
| `rejected` | true: a write requires matching current/held identity; otherwise wrote is false | true: fresh old-store witness and only the touched nonce can change |
| `check` | true: merge requires matching current/local request; otherwise expected is zero or wrote is false. Zero/positive tests and copied local hashes commute with N; the exact checked output stays in the full model. | true: fresh old-store witness and at most the touched nonce changes |
| `newerStoredHash`, `resolvedAndRemoved`, `legacy` | true: expected becomes zero. Assignment two normalizes to positive; cleared/new entries have zero hash. | true: fresh old-store witness and at most the touched nonce changes |
| `depart`, `clearInput`, stutter | previous O | previous F |

The raw frame clause is evaluated on full `s.store` and `s.before`, before
normalization. A difference between hash one and hash two still makes F false
even when normalized entries agree. Fresh store writes reset the frame witness
to true; carry-only actions preserve its exact old truth. O retains exact
identity comparison and is not normalized. R has the normalized form of its
existing successor in every row. Starting from the single initial
state, successor congruence makes the quotient reachable graph exactly the
projection of the full reachable graph. The invariant is constant in each
class, so this quotient does not lose an invariant counterexample. This is a
reviewed source-level argument, not a mechanically checked refinement proof.
It does not authorize future source changes or other properties.

The two clauses must stay separate. A failed reserve resets O to true while
carrying F; a single combined O-and-F bit cannot determine that successor.
The view itself uses no integer symmetry: actor, nonce, request and
transaction identities, and store candidates, are unchanged in the view. Only
the view coalesces the positive hash markers and unused memory candidates;
the full model retains their exact values.

Separately, the model's finite `step` (not the view) reserves the
deterministic fresh request ID `used.size() + 1` instead of any unused ID
in 1..3. Request IDs are compared only with each other and with 0, the `used`
domain rule is closed under permutations of 1..3 fixing 0, and `used` only
grows, so every reservation of another unused ID reaches a permutation image
of a canonical state with equal invariant truth. O compares `observed` with
`expected` by equality and F compares whole entries, so both clauses are
permutation-invariant. The view's congruence argument above is unchanged: the
canonical choice depends only on `used`, which R retains. Direct
`reserve(q,n,id,stored)` and the named scenarios still accept any ID; two
scenarios exercise the canonical choice, including same-nonce ABA reuse and
exhaustion after three IDs. No nonce, actor, sequence, retry or time domain is
reduced.

The full model still includes `warning`, `checked`, `emptyInput` and every raw
witness. All seventeen normal scenarios still check full outputs. The full normal
scenario that protects a newer hash two from a local hash one
remains unchanged. This quotient does not assert that distinct application
transaction hashes are interchangeable. It is not exhaustive UI-output
verification or a new temporal guarantee. Exact positive-hash identity
properties are not established by this safety quotient; the full-model named
scenarios still check their declared hash-one/hash-two expectations.
The model declares no temporal property, and the adapter refuses a temporal
request rather than applying this projection to it.

[TLC's documented VIEW semantics](https://lamport.azurewebsites.net/tla/book-02-03-04.pdf)
identify states by a view; arbitrary projections can omit required behavior.
The [official state implementation](https://github.com/tlaplus/tlaplus/blob/master/tlatools/org.lamport.tlatools/src/tlc2/tool/TLCStateMut.java)
fingerprints the configured view while retaining a full representative state.

## Strict version and tool binding

The journal entry in `formal/tlc-safety-views.json` permits only the version-4 request ID, exact
model path and source hash, module, operator, explicit hash-normalization mode, the explicit memory-candidate policy, ordered field expressions,
two named clause expressions, original generated-TLA hash and final view-TLA hash. The helper
checks that exact schema and projection. Unknown requests, operators, source,
TLA, projection or temporal changes fail before TLC. There is no fallback
after a rejected projection request. The separately audited owner-vault terminal, project-lookup legacy-cache and
[admin mutation continuation](admin-mutation-continuation-view-audit.md) views have their own hardcoded operators,
expressions, source and translation bindings; their arguments and limitations
are documented in [the model guide](README.md#owner-vault-terminal-requests).
No manifest entry can authorize another projection. Unselected models use the
unchanged full-state official runner. The checker clears inherited view requests and
requires the exact view evidence it requested.

The original generated TLA remains SHA-256
`1590bd9335502629e541960c97301336c752fc1b9ffa93d402bf116cefa65fed`.
Only a named projection definition is inserted before its terminator. The
version-4 result is bound to
`b2e133f3c0a01c493a3050c5cf2a72142defa676c2fce198fc7f00d71799b553`.
These are exact bytes; newline/platform/compiler differences require review,
not normalization or fallback acceptance.

Quint 0.33.1 lacks VIEW config plumbing. The adapter retains version 1's
SHA-bound, one-line in-memory config-emission patch under Node 24.15.0.
Its complete official runner body, Java flags, resource settings, deadlock
setting, temporary-file lifecycle and result interpretation are unchanged.
Removing the inserted VIEW-emission line recovers the original runner bytes.
No installed dependency is edited. Original adapter, overlay, source, TLA and
view hashes and both clause definitions are recorded with the result.

## Validation contract

`SLOP_QUINT_TRANSLATOR_TEST=1 bun test ./scripts/quint-local-translator.test.ts
./scripts/quint-safety-view.test.ts` exercises the actual TLC runner. Six
counterexample controls separately violate the used-identity domain, ownership
witness, frame witness, both zero/positive hash directions, and a store
candidate. They must return a nonzero result and no success claim. The same
command retains the no-view false-literal control and valid no-view examples.
Lightweight tests cover exact model/request/TLA binding, projection refusal,
complete generated-body preservation and Node import resolution. These
controls test the adapter; they do not mechanically prove successor congruence.

Run the complete model through `bun run formal:verify` or select it with
`node scripts/check-formal.mjs --verify --model=direct_bounty_journal`.
The checked-in limit is 1,800 seconds. A finished finite view graph is a pass
only for the invariant, projection and domains above. A timeout, cancellation,
changed input or nonempty work queue is incomplete. Exact source, tool and
projection hashes, effective limit and output belong in `evidence/formal/`.
Do not replace failed receipts with a claim about a different representation.
Browser, database, chain and implementation-conformance checks are separate.

## Security-settings lifetime view

The separately allowlisted `ui-security-settings-lifetime-safety-v2` applies
only to the unchanged `ui_security_settings_lifetime` model. Whole-source
SHA-256 remains
`5dfb3b1c648c9792524106c6ff425bf869c7649356ce54b25b4449ee7c60cd10`.
The complete production verify TLA remains
`1f03e2459080252441a5f0720ee3bad56e8901a21b9d554056a4e20f5090fb5d`;
inserting only `SlopSecuritySettingsLifetimeViewV2` before its full terminator
gives `aeb4fe4113d16530466ad71fa56c9be1286bc0301ffdc479eb2985106a7678d0`.
The concrete model, schemas, initial state, domains, invariant, scenarios and
runtime sources stay unchanged. The existing official-adapter VIEW emission
line is unchanged. Earlier V1 runs at 600 and 1200 seconds remain incomplete
receipts, with nonempty queues; they are never relabeled by a later result.

Version 2 retains version 1's publication projection without further erasure.
It normalizes only write-only globals error/success/serverBody and stored
publication body, retains phase for unused/done publications, retains every
other live publication field exactly, and keeps each publication index's
independently computed `accepted implies cookie == actor` truth value. False
values and independent false-slot healing remain exact. All other globals,
including read/active pointers, actor/cookie/life, mounted, gate/editor,
server/base/parent and identityRefresh, remain exact.

Read records are projected in this order:

| Read class | Retained observation |
| --- | --- |
| unused or done | Exact phase; reuse requires complete beginRead reset. |
| live and read unequal to this index, at HTTP | Exact phase and exact admitted predicate `(kind = revision) or (cookie = actor)`, including false. |
| other live phase and read unequal to this index | Exact phase only. |
| current pre/dispatch | Exact phase, kind, actor and lifetime. |
| current HTTP | Those four fields plus exact cookie. |
| current post | Those four fields plus exact ok and revision, for every kind. |
| any other current phase | Complete record, conservatively. |

Let R be the resulting state observation and I the complete per-index
publication-identity Boolean map. P(s) = (R(s), I(s)). No actor, slot or revision
identity is renamed, and every index and map domain remains exact. The original
invariant is precisely the retained server bounds, parent/server ordering,
editor/mounted/gate implication and conjunction of I. Every false clause is
therefore observable without assuming the invariant already holds. The stale
HTTP admitted predicate additionally preserves action enabledness; it is not
an authorization assertion supplied by a caller.

The action and future-read audit is:

| Action or helper | Reads and projected successor |
| --- | --- |
| `beginRead` | The only writer assigning a nonzero read pointer. It requires unused/done phase, then replaces the full record with kind/current actor/life and default cookie/ok/revision. Reusing done does not carry an old admission predicate or identity. |
| stale `readPreflight` | Phase and observed-actor argument domain remain exact. It takes not-owns, marks only this record done and preserves all globals, including another current read pointer. |
| stale `readDispatch`, `wrongPermissionViewer` | Ownership is false because read differs from the index, so neither is enabled, independently of erased payloads. |
| stale `readReply` | Phase/outcome domain and success-admitted guard remain exact. Success needs the retained bit even before ownership; other outcomes are enabled unchanged. Every admitted continuation takes not-owns and marks done without clearing the current pointer. |
| stale `readPostflight` | Phase and observed argument domain remain exact. It takes not-owns and marks done without copying ok/revision or clearing another pointer. |
| current `readPreflight` | Every identity/ownership comparison remains exact. Cookie/ok/revision are unread. Outcome phase/rights/refresh changes agree. |
| current `readDispatch` | Uses exact ownership and phase, captures exact global cookie, enters HTTP. Previous captured cookie is overwritten before use. |
| current `readReply` | Retains every admission/ownership input. Refusal or stale ownership ends the record. The post continuation overwrites ok and revision from outcome/server; their old HTTP values cannot affect the successor. |
| current `readPostflight`, `wrongPermissionViewer` | Kind, identity, ok and revision remain exact. All rights/base/parent updates agree. Cookie is no longer read. |
| publication actions and helpers | Identical to V1: ownership/admission/expected-revision/accepted/result fields remain exact while live; body flows only to erased serverBody. Completion retains the exact per-index I value. |
| `deny`, `identityDeny`, `depart`, `parentIdentityReply` | Read retained globals and clear pointers/rights as in the concrete model. A current HTTP read becoming stale derives the same admitted bit from its exact captured kind/cookie/actor. |
| `cookieChanges`, `remount`, stutter | Carry read records; change only exact globals or erased diagnostics. Current identity/lifetime remains exact through hypothetical ownership recovery. |

A stale live read cannot regain the pointer in its current phase. Only
`beginRead` assigns its index, and requires unused/done; no live continuation
returns to unused. After completion, beginRead fully resets every field before
reuse. Stale dispatch cannot progress and remains exactly that phase. Stale
HTTP admission is a predicate of captured record fields only, which do not
change before completion. Its false/true value and revision-kind bypass must
remain; replacing it with an assumed-true flag would change success enabledness.
Each stale slot retains its own predicate rather than one combined conjunction.

Current actor/life cannot be erased merely because ownership currently fails.
Security remount changes mounted/life/actor/error only; it preserves read and
active. In a hypothetical detached current read with captured actor/lifetime
two, remount(2) may restore ownership. The projection retains its identity and
post payload. This argument does not assume such a state is reachable or that
any invariant holds. Conversely, read-pointer inequality remains true until
phase completion/reset even through remount. Unknown current phases retain
full records rather than depending on an unstated phase restriction.

For equal P states, the same concrete action parameters consequently have
equal enabledness and projected successors. From the unchanged initial state,
the quotient is exactly the projection of reachable full states, and invariant
counterexamples cannot disappear. This is a manually reviewed strong finite
safety-congruence argument, not a machine-checked refinement proof, concrete
presentation-byte or stale-payload equivalence, temporal/unbounded guarantee
or implementation conformance result.

The dedicated `scripts/security-settings-safety-view.test.ts` binds the whole
model and the complete audited schema/initializer/domain/helper/transition/
invariant prefix. Future pointer restoration, post-cookie or pre-ok/revision
reads, extra stale-HTTP admission conditions, cross-slot dead reads, terminal
reuse and new invariant observations refuse the existing VIEW. Projection,
translated TLA, final bytes and temporal drift also refuse. Native tests derive
complete production TLA under the native flag and use actual applySafetyView
with the full terminator; no ignored local file is a committed test dependency.

The inherited reset witness observes only retained pre kind/phase/actor/life;
real post-publication controls retain ok/revision checks. Native negatives
retain every original invariant false class and publication identity healing,
and add independent stale-admission false/healing classes, revision-kind
bypass, current-cookie/ok consumption, hypothetical remount identity recovery
and stale callbacks preserving globals. Every negative uses only
`q_inv == ~SlopControlWitness`; unrelated invariant failures cannot satisfy it.
Positive controls coalesce only the audited phase-specific dead payloads,
check disabled stale dispatch and complete done reuse before new HTTP admission.
No-VIEW future-read and future-pointer controls expose changes the static
source guards separately refuse. Controls validate adapter observations, not
the manual proof, and do not replace a completed unchanged finite V2 graph.
Held, timed-out, canceled or nonempty-queue verification remains incomplete.

## Contributor-allocation view

The separately allowlisted `ui-contributor-allocation-safety-v2` binds only the
unchanged `ui_contributor_allocation` model, SHA-256
`767f463c4c1243d01ac4e0ca77316869af0c5e9441d1d96d911c27fdf077ad59`.
The exact complete production verify TLA remains
`c1dd49b06bbf150ee35e1b28fd796fc20d2568224454d46b5a24f937041080ed`;
inserting only `SlopContributorAllocationViewV2` before the full module
terminator produces
`c3c7da3bd3645e1fd1fa872f42e6fd00dac225a11e00e5ef8337d998227a184a`.
The source model, initial state, domains, legal choices, invariant, scenarios
and runtime sources remain unchanged. The official adapter's only alteration
remains its existing source-bound VIEW config emission line. The earlier V1
180-second graph with 219,779 queued states remains an incomplete receipt.

Let N map each indexed wallet set to `{"on-time"}` if it contains that member,
or `{"none"}` otherwise. The sole read of a wallet set is that membership in
`eligibleWallet`; keeping both indexed memberships handles account changes.
Let P apply N while retaining every other global exactly, including mounted,
actor, active, life, document/error, current masks and closed state,
publishedBy/publishedLife, load scheduling, deadline/render observations and
both timer flags. Every map domain and slot index remains exact. Project each
request as follows, in order:

| Request class | Retained fields |
| --- | --- |
| unused or done | Exact phase. |
| any other phase with active unequal to this index | Exact phase. |
| current HTTP or body | Exact phase and lifetime. |
| current decoded valid | All fields exactly. |
| current decoded absent | Exact phase, lifetime, absent outcome and closed; normalize masks to zero. |
| current decoded error | Exact phase and lifetime; one error outcome class; normalize ignored masks/closed. |
| any other current phase | Complete record, conservatively. |

No invariant reads request payloads. Every original invariant expression is a
function of retained globals and per-account wallet membership. Its life/actor
and mask domains, transfer subset, row/amount and disposition rules, link
exclusion, publication identity/lifetime and detached-state rule therefore
remain exact, including all false classes. No invariant truth is assumed.

The complete action and future-read audit is:

| Action or helper | Reads and projected successor |
| --- | --- |
| `maskContains`, `subset`, `hasRow`, `rowActor`, `displayedAmount`, `state`, links | Read exact globals and on-time membership only. Every derived output and invariant observation agrees. |
| `beginRead` | The only writer assigning a nonzero active index. It requires unused phase and completely resets that record to current life and HTTP defaults. A previously current request at another index becomes permanently stale. |
| stale `headers`, `body`, `requestFails` | Required phase and argument domains stay exact. These actions change only that record. Result phases agree; all their payload remains stale and is unobserved. |
| stale `publish` | Active differs from the slot, so ownership is false regardless of mounted state or captured lifetime. It changes phase to done and preserves every global, including another current active pointer. |
| current `headers` | Reads HTTP phase and the argument. It overwrites outcome. Success enters body, where all snapshot fields will be overwritten; failure enters an error class whose payload publication ignores. Lifetime is retained. |
| current `body`, `requestFails` | Body overwrites outcome, both masks and closed from unchanged validated arguments. Failure overwrites outcome with an error whose remaining snapshot payload is ignored. Both keep exact lifetime until publish. |
| current `publish` | Only decoded phase continues. Ownership depends on retained mounted/active/life. Valid copies all exact snapshots; absent zeroes masks but copies exact closed; error copies none. Each branch produces exact global output/identity/timer updates and done phase. |
| `walletsChange` | Same unchanged parameters replace one wallet set; N of that replacement agrees, as does exact renderedExpired. Other indexed membership remains separate. |
| `retry`, `accountChanges`, timer actions | Read and write retained globals only. Account changes select the separately retained membership of the new account. |
| `depart`, `remount` | Depart clears active to zero. Remount does not assign active. Exact globals and retained current lifetime handle hypothetical remount recovery; stale slots remain stale. |
| `step` stutter | Carries the complete state and P class. |

A nonunused stale slot cannot regain current status: only `beginRead` can
assign its index to active, and it requires unused phase. No transition resets
a nonunused slot to unused, and done absorbs. This argument applies without
assuming reachability or invariant truth. In particular, use active inequality,
not failed ownership, as the stale criterion. In a hypothetical detached state
with active equal to the slot and a captured lifetime of two, remount from life
one to two can restore ownership and publish its valid snapshot. P retains
that current lifetime and snapshot. Stale phases are not collapsed together:
headers, body, failure and consumption still have their exact enabledness.

Current predecoded payloads cannot reach a successful publication without
complete body overwrite; header/failure paths either overwrite again or ignore
them at error publication. Current decoded records have no header/body/failure
continuation. Error outcomes are distinguished only by exclusion from valid
and absent, and their snapshot fields are ignored. Absent closed remains live
because publication copies it even when document becomes none. All global
outputs stay exact. No cross-slot helper reads an erased payload.

Thus equal P states have the same original invariant truth and, for the same
concrete action arguments, equal enabledness and projected successors. From
the unchanged initial state, the quotient is exactly the projection of
reachable concrete states and cannot lose an invariant counterexample. This
is a manually reviewed strong safety-congruence argument, not a machine-checked
refinement proof, exact dead-payload byte equivalence, temporal guarantee or
statement about an unbounded product or chain payment.

`scripts/contributor-allocation-safety-view.test.ts` binds the entire schema,
initializer, domains, helpers, concrete transition relation and invariant
prefix in addition to the whole-model hash. Future active restoration,
other-class/whole-set wallet reads, predecoded payload or absent-mask reads,
distinct error branches, cross-slot consumed-snapshot reads, done-slot reuse
and invariant changes require renewed review. Source/TLA/projection/final-byte
or temporal drift refuses; there is no stale-pin fallback. Native tests derive
complete production TLA under the native flag and apply the actual helper to
its full terminator; no ignored local artifact is a committed dependency.

The controls retain all V1 independently falsifiable invariant witnesses,
both accounts' membership changes, valid decoded snapshots and global timer,
identity and output observations. The active-pointer case now uses concrete
request replacement and stale consumption, rather than artificially restoring
a stale index and claiming its payload is live. Added negative controls cover
absent.closed, current-lifetime recovery on hypothetical remount, error
publication, stale phase progress and stale remount consumption. Positive
controls coalesce only reviewed stale/predecoded/error/absent-mask payloads.
Every negative uses `q_inv == ~SlopControlWitness` alone; unrelated invariant
failures cannot satisfy it. No-VIEW native controls expose deliberately new
wallet reads and active restoration, which the source guards separately
refuse. These controls validate the adapter and observations, not the manual
proof. Native controls and a completed finite graph remain separate required
receipts; held, timed-out, canceled and nonempty-queue runs stay incomplete.

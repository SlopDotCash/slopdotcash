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

The separately allowlisted `ui-security-settings-lifetime-safety-v1` applies only
to the unchanged `ui_security_settings_lifetime` model. Its whole-source SHA-256
is `5dfb3b1c648c9792524106c6ff425bf869c7649356ce54b25b4449ee7c60cd10`.
The complete production verify translation is bound to
`1f03e2459080252441a5f0720ee3bad56e8901a21b9d554056a4e20f5090fb5d`;
inserting only `SlopSecuritySettingsLifetimeViewV1` before the complete module
terminator gives
`75770a9a85fb5f7363e189022ee82cecc6ec17566625c4ab6dbc85e7b39ed2e0`.
Neither the model nor its state domains, invariant, scenarios or runtime sources
change. The ordinary official adapter, resource limits and result handling stay
unchanged except for the already audited VIEW config line.

Let R normalize `error`, `success` and `serverBody` to their initial values,
normalize stored publication `body` to zero, and retain only `phase` for each
`unused` or `done` read/publication record. R retains every index, map domain,
phase, other global and live field exactly. Let I be the map from each
publication index to its exact Boolean observation
`accepted implies cookie == actor`. The projection is P(s) = (R(s), I(s)).
It uses no actor, slot or revision symmetry and no assumed-true invariant bit.
The invariant is exactly the unchanged server bounds, parent/server ordering,
editor/mounted/gate implication, and conjunction of I. Its truth, including
every false class, is therefore constant in each P class.

The audited field-read and continuation argument is:

| Concrete action or helper | Reads and projected successor |
| --- | --- |
| `ownsRead`, `ownsPublish`, `deny`, `identityDeny` | Ownership reads only retained mounted, pointer, actor and lifetime fields of live slots. Denial clears retained rights/pointers/refresh and writes only an erased error. Callers exclude dead phases before using ownership. |
| `beginRead` | Its guards read retained globals, index and phase only. It fully replaces the chosen `unused` or `done` record, so every new live field is determined by retained globals and arguments. |
| `readPreflight`, `readDispatch`, `readReply`, `wrongPermissionViewer`, `readPostflight` | Each requires a live phase. All reads, including the captured actor/cookie/lifetime, kind, success and revision, remain exact. Finishing the read drops only now-dead payloads; retained rights/base/parent updates agree. |
| `beginPublish` | Guards read retained globals, index and `unused` phase. It fully replaces that record; captured expected revision, actor and lifetime are retained. Body is stored but can only flow to erased `serverBody`. The reset makes this slot's I true even if its old value was false. |
| `publishPreflight`, `publishDispatch` | Only live phases continue. Their identity guards and captured cookie remain exact. A phase change to `done` carries the previous exact I value. |
| `serverResult` | Only `server` phase continues. Policy, actor/cookie equality, expected/server equality and the revision cap stay exact. Acceptance and returned revision remain exact; body only writes erased `serverBody`. The new I is determined by those retained values, including when the previous I was false. |
| `publishReply`, `publishPostflight`, `unavailablePublicationIdentity` | Their required live phases, acceptance/outcome guards and ownership checks remain exact. Rights, active pointer, base and parent updates agree. A completion retains the exact per-slot I observation. |
| `cookieChanges`, `depart`, `parentIdentityReply`, `remount` | Guards and all reads of actor, lifetime, refresh and mounted state remain exact. These actions carry slot maps, preserving I, and write only retained globals or erased presentation outputs. |
| `step` stutter | Carries the complete state and therefore its exact P class. |

No action reads a dead payload from another slot. Every read continuation
excludes both dead phases, and a read can reenter a live phase only through the
complete reset in `beginRead`. Publications exclude `done` forever; only
`beginPublish` uses `unused` and fully resets it. Stored body and the three
erased globals have no transitive read into a guard, invariant or retained
field. Convenience `loadSettings` composes the same unchanged concrete read
actions; it is not an additional branch of `step`.

Thus for any well-typed states with equal P, not merely states satisfying the
invariant, the same concrete action arguments have equal enabledness and
projected successors. Per-index I is necessary: resetting one false slot may
make it true while another false slot remains false. The combined conjunction
alone could not determine that successor. From the unchanged initial state,
the quotient graph is exactly the projection of reachable concrete states;
invariant counterexamples cannot be lost. This is a manually reviewed strong
safety-congruence argument, not a machine-checked refinement proof. It certifies
neither concrete presentation bytes, exact publication body history, temporal
properties nor implementation conformance.

The dedicated `scripts/security-settings-safety-view.test.ts` binds the entire
audited prefix, including every schema, initializer, domain, helper, transition
and invariant, in addition to the whole-model binding. Source mutations adding
reads of erased globals/body, dead-slot payload reads, terminal publication
reuse, cross-slot reads or a new invariant observation refuse the existing
VIEW. Changed projection, generated TLA, final VIEW bytes or temporal requests
also refuse. Native tests derive complete production TLA using the pinned
translator and exercise actual `applySafetyView` on it; no ignored local file
is a committed test dependency.

With `SLOP_QUINT_TRANSLATOR_TEST=1`, fifteen tiny native negative controls use
`q_inv == ~SlopControlWitness` alone. They independently require server lower
and upper bound, parent ordering, detached/unpermitted editor and terminal
identity false classes; one-false-slot healing while another stays false;
concrete read/publication resets; and live expected, cookie, actor, lifetime,
read revision and base continuations. Their fixtures retain the complete
translated action definitions and replace only the test initial/step/property
aliases. Two positive native controls check audited coalescing and absorbing
done publications. A no-VIEW native control demonstrates a deliberately new
future read's observable continuation; the source guards separately reject
that changed source. These adapter controls do not prove the manual argument
or replace completion of the unchanged finite safety quotient. The earlier
600-second full-state timeout remains incomplete. Keep exact local freeze,
controls and completed-graph receipts in ignored `evidence/formal/`; a held,
timed-out or canceled graph is not a passing proof.

## Contributor-allocation view

The separately allowlisted `ui-contributor-allocation-safety-v1` binds only the
unchanged `ui_contributor_allocation` model, SHA-256
`767f463c4c1243d01ac4e0ca77316869af0c5e9441d1d96d911c27fdf077ad59`.
The exact complete production verify TLA is
`c1dd49b06bbf150ee35e1b28fd796fc20d2568224454d46b5a24f937041080ed`;
inserting only `SlopContributorAllocationViewV1` before the full module
terminator produces
`1d357be0a171c3779cdb40a6bdd111039ff7a5f2e3d744d62c68b2ad13514fe2`.
The source model, its initial state, domains, legal choices, invariant, scenarios
and runtime sources remain unchanged. The official adapter's only alteration
remains its existing source-bound VIEW config emission line.

Let N map each indexed wallet set to `{"on-time"}` if it contains that member,
or `{"none"}` otherwise. Let P retain the complete state with N applied to
wallets, except that `unused` and `done` request records retain only their exact
phase. Every map index and domain remains exact. Every other global and every
live request field remains exact; in particular the projection keeps actor,
active pointer, lifetime, document/error, current masks and closed state,
publishedBy/publishedLife, load scheduling, deadline/render observations and
both timer flags. It retains complete HTTP, body and decoded request records.

The derived `eligibleWallet` is the sole read of a wallet set anywhere in the
transition or invariant boundary. It tests only on-time membership at the
current account. Keeping both per-account memberships handles later account
switches and never replaces them with one aggregate eligibility flag. Every
original invariant expression is a function of these retained values. This
includes its life and actor domains, mask domains and subset condition,
row/amount and disposition rules, link exclusion, published identity/lifetime
and detached-state rule. Every false clause remains observable; no invariant
truth is assumed or stored as an always-true flag.

The complete action audit is:

| Action or helper | Reads and projected successor |
| --- | --- |
| `maskContains`, `subset`, `hasRow`, `rowActor`, `displayedAmount`, `state`, link helpers | Read exact global masks, actor, mounted/document/error/closed and rendered deadline state. The only wallet read is retained on-time membership. Every derived output and invariant observation agrees in related states. |
| `owns`, `publish` | Publication requires a decoded phase, whose complete record remains exact. Its ownership reads current mounted/active/life and captured request life. Valid/absent/error branches, copied masks/closed state, published identities and timer resets agree. An obsolete request is consumed to done without changing the published globals. |
| `beginRead` | Reads mounted, loadScheduled, index and unused phase only. It fully replaces the selected record with empty values, current life and HTTP phase; no erased payload can reenter a live request. Exact error/render updates agree. |
| `headers`, `body`, `requestFails` | Require HTTP/body live phases. Complete live records and original argument domains remain exact, so all guards and full resulting records agree until completion. |
| `walletsChange` | Validates unchanged actor and wallet-class arguments, then replaces one set with `Set(first,second)`. N of that replacement is determined only by those same arguments. The other indexed membership and exact renderedExpired update agree. |
| `retry`, `accountChanges` | Read exact mounted/error/scheduling globals and unchanged actor domain. Their exact updates agree; selecting another account reads its separately retained wallet membership. |
| `deadline`, `installBoundary`, `fireBoundary` | Read exact nowExpired, document, mounted and boundary flags; exact rendered expiration and timer successors agree. No time constraint or fairness assumption is added. |
| `depart`, `remount` | Read exact mounted/life/actor domain and carry request maps. Remount resets its global output and timer fields exactly; old live requests still retain their old lifetime and cannot gain ownership. |
| `step` stutter | Carries the complete state and its P class. |

All request actions except `beginRead` exclude unused and done phases;
`beginRead` excludes done and completely resets unused payloads. No cross-slot
action reads an unused or done payload. A completed snapshot has no later
consumer. For any related well-formed states, without assuming their invariant
holds, the same action parameters therefore give equal enabledness and equal
projected successors. Starting from the unchanged initial state, the finite
quotient is exactly the projection of concrete reachable states. Since the
original invariant is constant in each P class, it cannot hide an invariant
counterexample. This is a manually reviewed strong safety-congruence argument,
not a machine-checked refinement proof, exact wallet-set byte equivalence,
temporal property or statement about an unbounded product or chain payment.

`scripts/contributor-allocation-safety-view.test.ts` binds the complete schema,
initializer, domains, helpers, transition relation and invariant prefix in
addition to the whole-model hash. Future other-class or whole-set wallet reads,
dead payload reads, done-slot reuse, cross-slot consumed-snapshot reads and new
invariant observations refuse the old VIEW. Model/TLA/projection/final-byte or
temporal drift also refuses; no stale-pin fallback is permitted. Native tests
derive complete production TLA under the existing native flag and apply the
actual helper to that complete module. No ignored local evidence file is a
committed test dependency.

Twenty-eight tiny native negative controls use `q_inv == ~SlopControlWitness`
alone. They target both accounts' membership gains/losses and account switches;
the independently falsifiable original invariant classes; live decoded outcome,
lifetime, recipient/transfer/closed snapshots and ownership; consumed stale
results; current masks, load/error state and exact deadline/timer behavior.
Their fixtures retain all actual translated action definitions and replace only
test initial/step/property aliases. Positive controls check only audited
coalescing and done-slot absorption. A no-VIEW witness demonstrates a deliberately
new wallet-class read; static source guards separately refuse that drift.
These controls validate the adapter and selected observations, not the manual
congruence proof. Keep actual control and graph results separately: a held,
timed-out, canceled or nonempty-queue run remains incomplete, and only a
completed unchanged finite quotient can support an exhaustive safety claim.

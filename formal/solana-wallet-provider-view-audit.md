# Solana wallet-provider safety VIEW

The current reviewed operator is V3. The frozen resource-only revision
`d38949ba5bf11d10c095bb8849e181132e341996` completed its finite quotient in
516.944 seconds under 600 seconds: 43,246,465 generated states, 2,526,432
distinct states, zero queued and depth 21. Recorded inputs stayed unchanged
and the run was not canceled. The earlier versions below explain the retained
observations and incomplete attempts; their timeouts are not passing proofs.

This isolated PRD section 12 experiment starts from
`212e225444073b60e023d97bc5d7ca272cd31517`. It addresses the translated
`solana_wallet_provider` finite graph exceeding its original 180-second limit;
the earlier incomplete graph is not a safety pass.

The model at `models/ui/solana_wallet_provider.qnt` stays byte-identical,
SHA-256 `5256522b9bcddb34689d809d593abbddc172aa4a211349029dda65dbc4da9c48`.
`solana-wallet-provider-observation-safety-v1` changes TLC fingerprints only.
No action, input domain, bound, invariant, named scenario or runtime code is
changed. It authorizes no provider prompt, signature, send or financial action.

## Projection

Every global field stays exact. Global accountObject is retained because
replaceAccountObject reads whether it is one; erasing it would change that
action's enabledness. The operation's usedObject is write-only and normalizes
to zero. It records the provider object used, but no transition or invariant
reads it. Concrete scenarios still inspect the original object identity.

A live operation's result keeps the class `ok` versus `none` for every other
string. No action reads an old result value. The only invariant consumer is
equality to `ok` in the encoded-message clause. Ending/provider replies assign
the same class for the same parameters, while other actions copy its class.
All other live fields remain exact: method, captured address/chain, gate
observations, callback/reconnect/invocation flags and encoding flag. Full
provider outcome domains remain unchanged, including legacy changed-message
acceptance and transaction empty/changed-byte acceptance.

An unused or done operation becomes the tuple
`<<phase, invoked, isSend, B1, B2, B3, B4, B5, B6>>`, where:

1. B1 is `invoked => checked and matched and feature and chainMatch and legacyFormat`.
2. B2 is `invoked => registered`.
3. B3 is `invoked => reconnected`.
4. B4 is `invoked and method == send => callback`.
5. B5 is `encoded => method == text and result == ok`.
6. B6 is `effects contains id => invoked and method == send`.

isSend is the exact Boolean `method == send`. All bits are computed from the
complete concrete record and global effects before projection. False bits
remain separate observations, not trusted constants.

B2 and B3 deliberately omit the global kind test. The original second local
clause is equivalent to `kind == standard => B2`, and the third to
`kind == legacy => B3`. Keeping both unconditional observations permits their
truths to be reconstructed after a global configure changes kind, even for a
hypothetical false prefix with a dormant terminal observation. The proof does
not assume an invariant, or that kind can never change after an arbitrary
typed terminal snapshot.

## Late effects, reset and cross-slot dependencies

Done does not prohibit sendEffect. That action's complete guard is the exact
invoked flag, exact isSend flag and absence of the ID from exact global
effects. These are all retained. When enabled, adding the effect makes B6 true
and carries B1..B5 unchanged. A false B6 means the effect already exists and
invoked/isSend is false, so the action is disabled; the false observation is
not silently healed. Other IDs add only their own effects and cannot change
this operation's B6.

No other step action accepts done and begin requires unused. An unused slot
can still satisfy a hypothetical late-effect guard, so its invoked/isSend
flags are retained too. Begin fully replaces an unused operation with idle
plus the selected method, captured global address and requested chain. The
new invoked flag is false, B1..B5 are true, and B6 is exactly `not effects[id]`.
isSend is determined by the original method parameter. These observations are
recomputed, including when method exposure produces immediate done. They are
not copied from a dirty unused record's former bits.

No operation reads another operation's payload. Global wallet registration,
account/feature/chain/format changes do not change captured terminal operands.
The only terminal invariant dependencies on mutable globals are kind and
effects, handled explicitly above. Actual current account objects, requested
chains and all current-provider gates remain exact where they are consumed.

## Invariant and successor argument

The four original global clauses read only exact global address,
capturedAddress, connection phase and effects. Each local clause is its
retained terminal observation, the kind-conditioned B2/B3 described above, or
an observation of exact live fields and the exact result-success class.
Therefore the invariant has constant truth in a VIEW class, including false
classes. No original invariant conjunct is assumed true.

For related states and the same original parameters:

| Action | Enabledness and projected successor |
| --- | --- |
| configure/connect/connectReply | Exact global guards, provider kind, exposure and captured-address writes. Changing kind reconstructs both local kind-conditioned clauses from the retained B2/B3. |
| unregister/setAddress/replaceAccountObject/withdrawFeature/removeChain/removeLegacyFormat | Every guard and changed global field is exact. Captured operation observations stay unchanged. |
| begin | Exact connected/exposure/phase guards and full original inputs. Entire payload replacement gives the fresh observations above. |
| standardInvoke | Exact live method, address and chain plus exact current registration, feature, chain, format, object and callback parameter determine the gate. Only usedObject and non-ok diagnostic strings are erased. Every raw terminal bit is computed after the original update. |
| reconnect/reconnectReply | Exact live address/method/flags and current account determine the same transition. Current object writes are diagnostic only. |
| providerReply | The exact live method, kind and original outcome determine acceptance, encoding and result class. New terminal observations are computed from the updated record, including false preexisting invocation clauses. |
| sendEffect | Exact invoked/isSend/effects determine the guard. The same ID is added; B6 remains true on the enabled update and the other bits carry. |
| Stutter | The observation is unchanged. |

Historical oldTextInvoke is excluded from step and all original negative
scenarios remain concrete. No source transition is removed. From unchanged
init, this manually reviewed same-parameter congruence makes the quotient
graph the projection of the finite full graph and preserves invariant
counterexamples. It is not a mechanically proved refinement theorem.

The VIEW does not establish exact provider-object/result diagnostics,
implementation refinement, cryptographic validity, echoed-byte or transaction
validation beyond the model predicates, chain finality, temporal progress or
unbounded safety. It leaves the source's ordinary scenarios and sampled
execution intact.

## Binding and controls

The helper adds one model-specific hardcoded operator/expression and manifest
entry. Exact model, complete translated TLA, final VIEW TLA and official
adapter bytes are pinned. Actual bindSafetyView/applySafetyView must accept
the complete production translation before graph execution, preserving its
full module terminator and original body. Changed definitions or temporal
properties fail closed.

The full-file source guard includes every schema, domain, helper, action,
dispatcher, invariant and scenario. Future result/object reads, cross-slot
dependencies, terminal reuse and late-effect payload reads force renewed
review. Native controls isolate each original invariant observation, false
and healing terminal classes, dormant B2/B3 with kind changes, late-effect
guards, dirty unused reset and representative active gates. Each property
is the named observation alone and requires a noninitial second-state
violation. These synthetic fixtures test distinguishability through the real
pinned runner, not source conformance or the manual successor theorem.

Static/scenario checks and native controls use Node 24.15.0, Bun 1.3.14 and
Java 21. Native controls and a full finite graph require scheduled capacity.
The original 180-second graph allowance is unchanged. A passing finite claim
requires frozen model/source/tools, a completed original invariant check and
zero queued states. An incomplete or changed-input receipt remains incomplete;
no sampled run or native fixture is substituted for graph completion.


## Private V2 closed capability cone

V1's original 180-second full search ended incomplete: 9,849,061 generated,
1,055,305 distinct, 532,961 queued at depth 11. That receipt is retained in the
V1 worktree; it is not a safety pass. V2 keeps the same concrete model, original
budget, input domains, actions, dispatcher, invariant and named scenarios.
`solana-wallet-provider-observation-safety-v2` changes only its versioned VIEW.

Define drained as global phase connected and every operation phase in
{provider-wait, done}. Under exactly that predicate, normalize these seven
Boolean globals to false: exposedTransaction, exposedSend, messageFeature,
transactionFeature, sendFeature, transactionLegacy and sendLegacy. Otherwise
all seven stay exact. No provider-wait capture is additionally folded. All
V1 live/terminal operation observations remain as described above. The global
registered, address, accountObject, chains, capturedAddress, kind, configured,
phase and effects remain exact.

### Closure and same-parameter successors

The predicate is defined solely by retained global/request phases. It is
closed without assuming any invariant: connected never returns to connecting,
providerReply changes provider-wait only to done, and no step action restores
unused/gate/reconnect/reconnect-wait. Begin requires unused; standardInvoke
requires gate; reconnect and reconnectReply require their respective earlier
phases; connect/connectReply require idle/connecting. Every consumer of a field in the cone is therefore disabled after drained;
the other earlier-phase calls are disabled too. Their original calls and
complete parameter domains are still present in step.

| Action under drained | Enabledness and projected successor |
| --- | --- |
| configure | configured/kind guards and writes stay exact. It may change kind in a hypothetical false prefix; the two unconditional V1 B2/B3 observations retain each resulting invariant truth. It cannot reopen a phase. |
| withdrawFeature/removeLegacyFormat | Their guards depend only on the original method parameter. Their writes remain inside the seven-field cone and project to stutter, matched by the unchanged explicit stutter transition. |
| providerReply | Only exact live method, kind and the original outcome parameter determine its guard, acceptance, result class and new terminal tuple. No current capability is read. |
| sendEffect | Exact invoked/isSend/effects retain the full guard and effect update even after completion. |
| unregister/setAddress/replaceAccountObject/removeChain | Every guard and changed global is retained. No erased capability controls a retained write. |
| begin/connect/connectReply/standardInvoke/reconnect/reconnectReply | Disabled by exact phases. No erased input can enable a call. |
| Stutter | The projected state is unchanged. |

Before drained, the seven capabilities are equal in related states. The last
begin with an unsupported method, last synchronous gate, last reconnect reply,
or (for a hypothetical typed prefix) connectReply therefore consumes equal
original inputs and performs its exact capture/update before the successor
is masked. If a transition does not enter drained, its capabilities remain
exact. Configure can change a hypothetical prefix's kind but cannot undo
closure; no invariant assumes kind fixed.

None of the ten original global/local invariant clauses reads these seven
globals. Invariant truth remains reconstructible from retained globals,
exact live operation fields/result classes, and the six V1 terminal bits.
False classes, dormant registration/reconnect observations, effects and their
repairs are not replaced by trusted constants. Related states have equal
original enabledness and the same projected successor for every original
parameter. Together with the unchanged init this is a manually reviewed
strong finite safety quotient, not a theorem of implementation refinement,
exact capability/output diagnostics, provider success, liveness or unbounded
request behavior.

### V2 binding and controls

V2 has a new ID/operator and exact complete-production-TLA/final-VIEW pins.
The original full-file source guard is unchanged in strength; additional
mutants add capability consumers to sendEffect/providerReply/invariants or
let cone writes influence a retained address, and restore unused on completion.
All require renewed review. Default native fixtures keep a spare unused slot
so active capability changes remain observable. Additional closed fixtures
isolate every original clause, false/healing and dormant B2/B3 observations,
retained globals and live provider data. Boundary fixtures expose last begin,
gate/reconnect capture and connecting-to-connected transitions. Each native
property is its named observation alone, requires a State 2 counterexample
and rejects an initial-state violation. Synthetic controls do not replace the
manual successor audit or the frozen actual graph. V2's 75 native
counterexample controls passed; its original 180-second full search ended
incomplete, as recorded below. No completed V2 full proof is claimed here.


## Private V3 consumed provider-wait payload

The V2 full search kept its original 180-second budget and ended incomplete:
6,216,549 generated, 693,115 distinct, 371,650 queued, depth 11; 75 native
counterexample controls passed. Both V1 and V2 incomplete receipts remain in
their original frozen worktrees. Neither timeout is a completed proof.

V3 changes only a provider-wait operation to
`<<phase, method, invoked, B1, B2, B3, B4, B5, B6>>`. Method and invoked stay
exact. All six bits are the same unconditional raw observations defined for
V1, including false bits and the dormant kind-dependent B2/B3 facts. Every
earlier phase keeps the full V2 live record. Unused/done retain V2's tuple.
The entire V2 seven-global drained expression is unchanged. The concrete QNT,
original actions, step, full domains, invariant, scenarios and 180-second
budget remain unchanged.

### Every future consumer

For one provider-wait ID, only providerReply and sendEffect can act on it.
Begin requires unused, standardInvoke requires gate, reconnect requires
reconnect and reconnectReply requires reconnect-wait. These phase tests stay
exact; no action resets wait or done to an earlier phase. Historical
oldTextInvoke is outside step, and its gate/reconnect guard is false here too.
No other ID's action reads this ID's payload; all changes remain ID-local
except the exact global effects membership and exact provider configuration.

| Action | Same-parameter enabledness and successor |
| --- | --- |
| providerReply | Exact phase and method determine the original outcomes domain. Acceptance uses only exact method, exact global kind and the original outcome parameter. It copies every other captured operand, sets encoded to accepted-and-text and result to ok on acceptance, otherwise encoded false with its original diagnostic result. Therefore B5 becomes true for **every** outcome even if the old B5 was false. B1..B4 and B6 carry unchanged. The terminal exact invoked/isSend values follow from retained invoked and method. |
| sendEffect | Exact invoked, method-is-send and absence from exact effects retain the complete guard. An enabled addition makes B6 true; B1..B5 carry. A false B6 already has an effect with !invoked or !send, so this action is disabled and does not heal it. |
| configure | Exact configured/kind retain enabledness and the global update. B2/B3 remain unconditional, so either kind-conditioned invariant clause remains reconstructible after a hypothetical false prefix changes kind. |
| Other-ID operations/effects | No cross-ID payload read. Adding another ID's effect cannot change this ID's B6. Earlier phases of the other ID remain full, including gates and all captures. |
| Other global actions | Registered, current address/object, chain set, phase and all guards remain as V2. Capability/format writes stay in the V2 closed cone only under its exact drained predicate. They do not read or mutate captured wait flags. |
| Stutter | The observation is unchanged. |

Address, requested chain and individual checked/matched/feature/chainMatch/
legacyFormat values have been consumed before wait. Their only remaining
safety observation is B1. Captured registered/reconnected/callback are needed
only through B2/B3/B4; encoded/result only through B5. usedObject was already
write-only in V1. Copying these fields into a completed record does not make
them live again: the same terminal bits are recomputed from unchanged
operands, with the reply's known B5 update as above. No HTTP/provider outcome,
field value or diagnostic erased here is claimed to remain byte-identical.

All four global invariant clauses read retained globals. Each of the six
local clauses is either its retained bit or the exact kind-conditioned B2/B3
reconstruction. No original invariant is assumed true. Related wait records
therefore have the same invariant truth, enabled original calls and projected
successors for each original parameter, including false/healing states. The
V2 drained predicate uses only exact global phase and exact per-ID phases; it
is equally reconstructible with the new tuple. Last gate/reconnect/begin
crossings consume full equal V2 inputs before the wait projection. This is a
manual strong finite safety-congruence argument, not delayed input,
application refinement, cryptographic/provider success or temporal progress.

### Probe retargeting, source binding and qualification

Four old V2 probes inspected values now dead at wait: live-result-class,
closed-provider-address, closed-provider-chain and closed-provider-result-class.
They are explicitly renamed to pre-gate-result-class or last-gate address,
chain and result probes and run in gate, where V3 still retains their full
values. No original invariant false/healing control is removed. Exact method
probes remain at wait. Additional wait fixtures retain every raw bit's false
and healing cases, kind reclassification, late effects and accepted/refused
reply repairs of a false B5. Dirty successful gate/reconnect boundaries carry
a false incoming B5 into wait; a refusing gate can create a false terminal B5.
Only the actual providerReply update sets B5 to its proved true value.
Full-file source guards reject new wait address,
chain, encoded/result or cross-ID reads, changed individual invariant
operands and phase reuse; V2 capability/read guards remain intact.

A separate positive native diagnostic checks intended coalescing: its property
is TRUE alone, its raw graph has two distinct states and the actual VIEW has
one, while a false B1 stays false and consumed fields change. This is not a
counterexample test or an original-invariant proof. Every negative control
still uses only its named observation, requires State 2 and refuses an initial
violation. Actual complete production TLA/source/VIEW/adapter pins distinguish
V3. The fresh `ce8b54a5c` native batch passed 110 tests and 695 assertions,
including 107 negative controls and two paired raw/VIEW invocations. The
resource-only `d38949ba5bf11d10c095bb8849e181132e341996` follow-up reused those
unchanged controls and completed the graph recorded above. All 25 recorded
hash entries and tool identities remained stable. These receipts belong to
their frozen prototype inputs; final combined-source qualification is separate.


## V3 resource-only continuation

The frozen V3 source at `ce8b54a5c621ecd5c90d389ae66041350f8f6493` passed
110 focused tests and 695 assertions: 107 native negative controls plus two
raw/viewed coalescing invocations. Its original 180-second graph ended
incomplete after 185,138 milliseconds. Last progress was 18,545,536 generated,
1,471,827 distinct, 446,535 queued, depth 13. Inputs stayed unchanged; the
receipt was not canceled and is not a completed proof. Known owned processes
were confirmed absent after the timeout.

This follow-up grants only this model a bounded 600-second verification
allowance. QNT, complete TLA, VIEW, native cases, every finite domain, original
invariant and named scenario remain byte-identical. Ordinary checks retain
the same 90-second stage limits and 500-by-60 seed/bounds. The prior native
qualification is reused through the exact model/helper/test/adapter lineage,
not described as a fresh native batch. Fresh ordinary checks bind the new
checker hash. The completed result recorded above belongs to that frozen
resource-only revision; later source combinations need their own qualification.
No sampling or queue estimate substitutes for completion.

# Solana wallet-provider safety VIEW

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

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

`formal/tlc-safety-views.json` permits only the version-4 request ID, exact
model path and source hash, module, operator, explicit hash-normalization mode, the explicit memory-candidate policy, ordered field expressions,
two named clause expressions, original generated-TLA hash and final view-TLA hash. The helper
checks that exact schema and projection. Unknown requests, operators, source,
TLA, projection or temporal changes fail before TLC. There is no fallback
after a rejected projection request. Unselected models use the unchanged
full-state official runner. The checker clears inherited view requests and
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

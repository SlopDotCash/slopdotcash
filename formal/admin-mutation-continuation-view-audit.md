# Admin mutation continuation safety view

`ui-admin-mutation-continuation-safety-v2` is specific to the unchanged
`models/ui/ui_admin_mutation_identity.qnt`, SHA-256
`aa2359d42de5765cda3fec220fc6716ecba23ca809fe1ea838a55323049c59b8`.
It changes only TLC fingerprints. The original model, two request IDs, both
lifetimes, actor and draft domains, concrete actions, invariant, named scenarios
and ordinary sampled execution remain unchanged.

## Projection

The view is `P(s) = <<N(s), C(s)>>`, where
`C(s) = (s.didClear => s.clearExpected = s.clearObserved)` is computed from the
full representative state. False C remains distinct from true C.

N retains every field except the following exact normalizations:

| Field | Normalization and last continuation read |
| --- | --- |
| Global `error` | Keep `request` distinct; normalize `none`, `identity` and `newer-draft` to `none`. Only `useRecheck` reads it, as equality to `request`. |
| `didClear`, `clearExpected`, `clearObserved` | Normalize to false/zero/zero. Only C reads them; no transition does. C is retained separately. |
| Request `observedActor`, `observedAdmin` | Keep exact in `preflight-observed`, `preflight-returned`, `recheck-observed` and `recheck-returned`. Otherwise zero/false: the next observation overwrites them before use, or the slot is done. |
| Request `accepted` | Keep exact through `http`. Normalize to false in recheck phases and omit from the done tuple: only `commit` and `response`, both guarded by `http`, read it. |
| Request `draft` | Keep nonterminal save drafts exact; normalize action drafts to zero. Omit done drafts. A live action draft feeds only `clearExpected`; save comparisons alone can change storage or suppress callbacks. |
| Request `kind` | Keep exact until `done`, then omit it. No action accepts a done slot and `begin` requires `unused`. |

All global identity, session, admin, data, storage, active-owner, accepted and
callback fields remain exact. Every nonterminal request phase, actor, captured cookie, lifetime and
admitted field remains exact. A done request becomes the tuple
`<<"done", (r.admitted => r.cookie = r.actor)>>`, whose admission clause is
computed from the complete representative. Thus false terminal admission
classes remain distinct; terminal identity bytes are no longer a VIEW
guarantee. Save draft comparisons and all live identity checks remain exact.

## Invariant and successor congruence

Let two well-typed reachable states have equal P. The invariant's presence/mount and callback/accepted subset rules read only
unchanged globals. Each terminal admission clause is retained as its exact
truth value; nonterminal admission clauses still read exact identity fields.
The remaining global conjunct is C, retained exactly.
Thus the invariant is constant within each view class, including a false-C
class.

For each original action and the same original parameter values:

| Action | Enabledness and projected successor |
| --- | --- |
| `begin` | Reads exact mount/data/active/phase; replaces its request from equal global actor, lifetime and draft values. An action draft normalizes immediately, but is never a storage or callback input. |
| `observePreflight`, `observeRecheck` | Read exact phase, session cookie and admin fields. They overwrite both snapshot observations and move to a phase where those observations stay exact. |
| `returnPreflight`, `returnRecheck` | Preserve exact observations in returned phases. |
| `usePreflight` | Reads exact ownership and current snapshot observations, so both states choose the same done/denied/dispatch outcome. Observations become dead only after this choice. |
| `dispatch`, `admit`, `commit` | Read exact phase, lifetime/active ownership, captured actor/cookie, admitted flag and HTTP acceptance. Commit changes the same exact global accepted set. |
| `response` | Reads exact HTTP acceptance. A save reads its exact captured draft and current stored draft. An action cannot clear storage regardless of its draft. Every response sets new C to true: a clear requires stored=captured draft; otherwise C's antecedent is false. The same exact storage, phase and normalized error result follows. |
| `useRecheck` | Reads exact ownership, observations, save draft and global callback/accepted data, plus precisely the preserved request-error class. It therefore produces the same callback and normalized-error successor. |
| `sessionChanges`, `edit`, `depart`, `remount`, stutter | Read and update exact globals, carry the same normalized request data, and carry C unchanged. |

A done request never returns to another phase and cannot be reused. Every
request-local action excludes done; `begin` requires unused. Other requests
do not read its payload, directly or through a helper. Global session,
remount, storage and other-slot updates cannot change the captured terminal
admission clause, so its exact truth carries forward. Related terminal
requests therefore have the same unchanged phase and local invariant truth,
with no remaining payload-dependent continuation. The source guard covers
all schema, domains, helpers, actions and invariant, including a future
terminal reuse or cross-slot payload read. The composite `preflight` and `recheck`
actions inherit the congruence of their three unchanged stages. Hence related
states have identical enabledness and projected successor sets for every
original step. Starting from the unchanged initial state, the quotient graph
is the projection of the reachable full graph and loses no invariant
counterexample under this source-bound argument.

This is a reviewed argument, not a mechanically proved refinement theorem.
The view does not prove exact diagnostic strings, dead payload bytes, rendered
UI equivalence, temporal progress, unbounded behavior or implementation
refinement. The adapter refuses temporal properties. Source-model scenarios
continue to inspect exact errors, captured drafts and old-lifetime behavior.

## Binding and controls

The helper hardcodes this model's versioned ID, operator, ordered field and
clause expressions, and modes. The manifest additionally binds exact model,
original translated TLA, final view TLA and official Quint adapter bytes. A
binding change requires review; there is no fallback after refusal. Inserting
the view preserves the complete original TLA body and official runner.

`admin-mutation-continuation-quotient.test.ts` binds the complete schema,
domains, helpers, actions, invariant and scenarios. Added dead-field reads,
indirect aliases, cross-slot dependencies or terminal reuse fail that guard.
With `SLOP_QUINT_TRANSLATOR_TEST=1`, native TLC controls must reject all four
original invariant violations: false clear witness, callback without
acceptance, a mounted departed view and false terminal admitted identity.
Additional native controls distinguish wrong actor/admin observations in both
returned phases, the request-error class, saved draft, lifetime, session,
active owner and stored draft. These controls exercise the actual runner and
view; their tiny test inputs are not application-model substitutes or an
expanded production allowlist.

Run the original scenarios and seeded simulation with:

```sh
node scripts/check-formal.mjs --model=ui_admin_mutation_identity
SLOP_QUINT_TRANSLATOR_TEST=1 bun test scripts/admin-mutation-continuation-quotient.test.ts scripts/quint-safety-view.test.ts
node scripts/check-formal.mjs --verify --model=ui_admin_mutation_identity
```

The finite exploration retains its explicit 1,800-second budget. A timeout,
changed input, cancellation or nonempty work queue is incomplete, never a
pass. Preserve each experiment's frozen commit, mapped source and tool
hashes, limits, native control output and complete graph receipt separately.

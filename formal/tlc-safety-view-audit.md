# Hash-bound journal safety view, version 2

This follow-up preserves every byte of `direct_bounty_journal.qnt`, including
all fields, domains, actions, the invariant and fifteen named output scenarios.
It changes only the state fingerprint used by TLC for this reviewed safety
invariant. It serves PRD section 12. No application runtime or policy changes.

The full model SHA-256 remains
`549580117b331f06f8bb0950211c650c84a7fbffbcb51045812f0c26d3e38fa3`.
At `a77cb2516`, canonical 180-second and diagnostic 600-second full-state
checks both ended incomplete, without an invariant counterexample. The longer
run's last progress was 48,955,304 generated, 9,508,664 distinct and 7,289,887
queued states at depth 9. Version 1 of the view at `cebc1d565` also exceeded
180 seconds: its last progress was 16,307,349 generated, 2,227,568 distinct
quotient states and 1,436,139 queued states at depth 10. These are incomplete
progress counts, not complete graph sizes. All original receipts remain
preserved; version 2 does not relabel those runs as passes.

## Exact projection

Version 2 retains the full `store`, `memory`, `held`, `used` and `mounted`
values. It then retains these two independently computed truth values:

- O: `(s.wrote and s.expected > 0) implies s.observed == s.expected`.
- F: `s.touched > 0 implies Set(1,2).exclude(Set(s.touched)).forall(n => s.store.get(n) == s.before.get(n))`.

The view computes both clauses from the full representative state. They are
not supplied authorization flags. False O and false F remain distinct and
visible to the unchanged invariant. No raw field is removed from the source
model or from normal scenario execution.

Let R be the five retained real-state fields and let P(s) = (R(s), O(s), F(s)).
The original invariant is exactly the conjunction of the `used` domain rule,
O and F. Its truth therefore depends only on P.

## Successor-congruence argument

All action guards and R updates depend only on R and the action parameters.
`emptyInput` feeds only `checked`. `warning` and `checked` feed no guard or R
update. The five raw witness fields feed only the invariant and carried state.
For reachable, well-typed states with equal P, the following action table
therefore gives equal projected successor sets.

| Action | O successor | F successor |
| --- | --- | --- |
| `reserve(..., stored=true)` | true: expected becomes zero | true: before snapshots old store and only the touched nonce changes |
| `reserve(..., stored=false)` | true: wrote becomes false | previous F: store, before and touched are carried |
| `returned` | true: a write requires the current request and transaction to match the held attempt; otherwise wrote is false | true: fresh old-store witness and only the touched nonce can change |
| `rejected` | true: a write requires matching current/held identity; otherwise wrote is false | true: fresh old-store witness and only the touched nonce can change |
| `check` | true: merge requires matching current/local request; without merge expected is zero; without a successful write wrote is false | true: fresh old-store witness and at most the touched nonce changes |
| `newerStoredHash`, `resolvedAndRemoved`, `legacy` | true: expected becomes zero | true: fresh old-store witness and at most the touched nonce changes |
| `depart`, `clearInput`, stutter | previous O | previous F |

R has its existing successor in every row. Starting from the single initial
state, successor congruence makes the quotient reachable graph exactly the
projection of the full reachable graph. The invariant is constant in each
class, so this quotient does not lose an invariant counterexample. This is a
reviewed source-level argument, not a mechanically checked refinement proof.
It does not authorize future source changes or other properties.

The two clauses must stay separate. A failed reserve resets O to true while
carrying F; a single combined O-and-F bit cannot determine that successor.
No integer symmetry is used. No actor, nonce, request or hash identity changes.
No state, sequence, retry, time or action domain is reduced.

The full model still includes `warning`, `checked`, `emptyInput` and every raw
witness. All fifteen normal scenarios still check full outputs. This safety
quotient is not exhaustive UI-output verification or a new temporal guarantee.
The model declares no temporal property, and the adapter refuses a temporal
request rather than applying this projection to it.

[TLC's documented VIEW semantics](https://lamport.azurewebsites.net/tla/book-02-03-04.pdf)
identify states by a view; arbitrary projections can omit required behavior.
The [official state implementation](https://github.com/tlaplus/tlaplus/blob/master/tlatools/org.lamport.tlatools/src/tlc2/tool/TLCStateMut.java)
fingerprints the configured view while retaining a full representative state.

## Strict version and tool binding

`formal/tlc-safety-views.json` permits only the version-2 request ID, exact
model path and source hash, module, operator, ordered fields, two named clause
expressions, original generated-TLA hash and final view-TLA hash. The helper
checks that exact schema and projection. Unknown requests, operators, source,
TLA, projection or temporal changes fail before TLC. There is no fallback
after a rejected projection request. Unselected models use the unchanged
full-state official runner. The checker clears inherited view requests and
requires the exact view evidence it requested.

The original generated TLA remains SHA-256
`d7ac95341cfc3820f3e72a9a3983f3c30ed8930a24e3f9a2299c152cc3f587ad`.
Only a named projection definition is inserted before its terminator. The
version-2 result is bound to
`4bd0e4ce0d63cd51a74c2ede7ed3a3b483bcaa0cc0ec98d9f6177df077847056`.
These are exact bytes; newline/platform/compiler differences require review,
not normalization or fallback acceptance.

Quint 0.33.1 lacks VIEW config plumbing. The adapter retains version 1's
SHA-bound, one-line in-memory config-emission patch under Node 24.15.0.
Its complete official runner body, Java flags, resource settings, deadlock
setting, temporary-file lifecycle and result interpretation are unchanged.
Removing the inserted VIEW-emission line recovers the original runner bytes.
No installed dependency is edited. Original adapter, overlay, source, TLA and
view hashes and both clause definitions are recorded with the result.

## Checks and remaining evidence

Lightweight checks cover exact source/request binding, stale TLA/projection
refusal, complete generated-body preservation, separate clause metadata,
unknown operator refusal, and actual Node import/export resolution. The
normal-check source and all existing no-view controls remain unchanged.

Three opt-in controls use the actual TLC runner and typed test-only records:
one violates the retained `used` domain; one changes only the ownership
witness; one changes only the frame witness. The latter two keep every R field
unchanged. Each must produce the expected invariant counterexample, a nonzero
result and no success message. Test fixtures are not added to the production
allowlist and prove no application behavior. The same CI command also runs
the existing no-view false-literal control and two no-view successes.

No version-2 TLC, normal scenario/simulation or real negative-control run has
occurred yet. Those executions wait for the shared verification lane. Required
next evidence is the unchanged fifteen journal scenarios and seeded simulation,
complete version-2 quotient TLC, all real counterexample/no-view controls and
the source-bound toolchain checks. Report complete quotient counts as quotient
counts, with the prior failures and external boundaries still explicit.

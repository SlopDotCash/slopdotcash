# Hash-bound journal safety view

This follow-up preserves every byte of `direct_bounty_journal.qnt`, including
all fields, domains, actions, the invariant and fifteen named output scenarios.
It changes only the state fingerprint used by TLC for this reviewed invariant.
It serves PRD section 12's state-correctness verification requirement. There is
no application runtime or policy change.

The unchanged model SHA-256 is
`549580117b331f06f8bb0950211c650c84a7fbffbcb51045812f0c26d3e38fa3`.
At source `a77cb2516`, canonical 180-second and diagnostic 600-second full-state
runs both ended incomplete, without an invariant counterexample. The longer
run's last printed progress was 48,955,304 generated states, 9,508,664 distinct
states and 7,289,887 queued states at depth 9. Those are pre-timeout progress
counts, not a completed graph. Its inputs and two-worker/2-GiB configuration
were unchanged; the failed receipts remain under ignored evidence.

## Projection and safety argument

The view keeps the complete values of `store`, `memory`, `held`, `used`,
`mounted`, `before`, `touched`, `observed`, `expected` and `wrote`. It omits
`warning`, `checked` and `emptyInput` from the fingerprint only. A representative
state still contains every field. Normal scenarios still read the full state.

Let P select those ten retained fields. For reachable well-typed states s and t
with P(s)=P(t), action guards enable the same parameter choices and produce the
same sets of projected successors:

- `reserve`, `returned`, `rejected`, `depart`, `newerStoredHash`,
  `resolvedAndRemoved` and `legacy` read no omitted field for a guard or retained
  update.
- `clearInput` updates only `emptyInput`; its projected transition is stuttering,
  which is already present in `step`.
- `check` reads `emptyInput` only to compute the value written to `checked`.
  Its merge/conflict conditions, enabledness, store/memory writes and invariant
  witness fields do not depend on that value.
- `warning` and `checked` do not feed any action guard or retained update.
- The invariant reads only retained fields, so its truth value is constant in
  each P-equivalence class.

Starting from the single initial state, successor independence therefore makes
the quotient reachable graph exactly the projection of the full reachable
graph. Checking this invariant on the quotient loses no invariant counterexample.
This is a reviewed source-level argument, not a mechanically checked refinement
theorem. It is not authority for other properties or future model changes.

The full model retains the UI outputs and their named-scenario expectations.
No temporal property is authorized with this view. The omitted fields have at
most 576 joint values in these finite domains, but that is not a measured
compression ratio or a speed claim. Component, nonce, request and hash roles
retain their original values; integer symmetry is not enabled.

[TLC's documented VIEW semantics](https://lamport.azurewebsites.net/tla/book-02-03-04.pdf)
use a view to identify states. Such a view needs this dependency argument;
arbitrary projection can omit required checks. The
[official state implementation](https://github.com/tlaplus/tlaplus/blob/master/tlatools/org.lamport.tlatools/src/tlc2/tool/TLCStateMut.java)
fingerprints the configured view while retaining a full representative state.

## Explicit tool binding

`formal/tlc-safety-views.json` permits one model path, source hash, module,
operator, ordered field list and exact generated-TLA hash. Unknown requests,
source/TLA changes, property changes and unsupported operators fail before
TLC starts. There is no permissive fallback after a view request. Unselected
models continue through the unmodified official runner without a projection.
The checker explicitly requests the registered view and requires its binding
receipt; an inherited environment variable cannot silently select another view.

Quint 0.33.1 has no VIEW option in its config emitter. The adapter therefore
loads the exact SHA-bound official `tlc.js` into a separate in-memory CommonJS
module under pinned Node 24.15.0. One exact replacement adds a VIEW line to the
config emitter. Removing that inserted line yields the original module byte
for byte. Its Java invocation, flags, default resource settings, deadlock mode,
temporary-file lifecycle and success/counterexample/error interpretation are
unchanged. No installed dependency is edited. The receipt records both original
adapter and overlay hashes.

The original generated TLA is preserved with one named projection operator
inserted before its module terminator. A short compile without TLC reproduced
the captured original TLA hash
`d7ac95341cfc3820f3e72a9a3983f3c30ed8930a24e3f9a2299c152cc3f587ad`.
The hash is exact bytes: platform/newline/compiler differences fail closed and
require review; they are not normalized into acceptance. The full model is
unchanged, and normal tests remain full-state tests.

## Current evidence and required execution

Lightweight binding/config tests cover model changes, unknown requests and
operators, temporal refusal, exact TLA preservation, exact one-line adapter
change and actual Node import/export resolution. The updated toolchain model
typechecks. An initial use of reserved `temporal` as a parameter was corrected
to `wantsTemporal`; no semantics or domain changed in that correction.

No journal normal run, quotient TLC check or real-TLC counterexample control
has run for this change. The opt-in counterexample test invokes the actual
official runner with a tiny test-only TLA input, retains all projection fields
and requires a reachable retained-field invariant violation, a nonzero result
and no success message. That input is not
in the production allowlist and proves no application behavior. Required next
checks are the unchanged fifteen journal scenarios and seeded simulation,
complete quotient TLC, the real counterexample control and source-bound
toolchain-model checks. Report quotient counts as quotient counts, preserving
the original incomplete full-state receipts and all external boundaries.

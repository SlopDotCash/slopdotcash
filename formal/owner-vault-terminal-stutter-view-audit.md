# Owner terminal-phase safety VIEW experiment

This V7 experiment serves PRD section 12 STATE-04/05 verification of the
approved project-vault setup in sections 4 and 6. It starts from the frozen
delayed-input experiment `6c332eca50b79b9997da4a6a128f6a181a7eead7`.
Only the owning model VIEW comment changes to state the active V7 limits.
No runtime, module-body expression, domain, action, invariant or scenario changes.

## Relation and safety observations

Let Q6 be the reviewed V6 owner VIEW. Q7 changes only the first member of
each `response`/`done` request tuple from its concrete phase to the constant
`"terminal"`. Every global, every nonterminal Q6 field, all five local
invariant truth values, and the global obligation observation remain Q6-exact.
The latter still retains exact `(committed, purpose)` indices while false and
uses canonical indices only while true. Each truth is recomputed from the
complete representative state; a false clause never becomes an assumed fact.

Relate states with equal Q7 projections. The original invariant does not read
terminal phase or `received`, so it is constant within each class. This holds
for each false local observation and false global obligation, independently
of whether any other invariant clause is true. Existing monotone-history and
deployment reasoning remains necessary: true obligation is closed under all
global writers; false obligation keeps exact indices and recomputes identically
after a writer. Its truth is never frozen.

## Whole-next successor audit

| Action class | Related-state successor argument |
| --- | --- |
| `begin`, `verificationBegin` | Require `unused`; neither response nor done can be reused. Live arguments and V6 retained observations are unchanged. |
| `omitProject`, `seedDeployment` | Every cross-slot guard requires `unused`; response and done both fail it. They cannot read erased terminal payloads. |
| `changeAuthority`, `restrict`, `ban`, `edit` | Read globals only, which remain exact. Global writes match and preserve the previous monotonicity argument. |
| `headers`, `session`, `project`, `enforcements`, `authority`, `funds`, `service`, `body`, `expected`, `history`, `chain`, `appendGeneration`, `appendValidation`, `commit`, `postcommit`, `dependencyFailure` | Every guard excludes both terminal phases. Enabled live requests follow the unchanged V6 phase-liveness argument; no other slot's terminal phase is read. |
| `verificationBody`, `verificationExpected` | Their guards exclude both terminal phases and their materialization inputs remain the existing delayed-input experiment. |
| `send` | Response advances to done and changes only `received`; neither change affects Q7, globals, local invariant truth or obligation indices. Its projected successor is the same class, including false observations. |
| unconditional `s' = s` | Present in both ordinary `step` and selected `verificationStep`; supplies that same projected self-loop for a related done representative where `send` is disabled. |

Thus each whole-next successor class is matched in both directions. The only
new unmatched action instance, `send` from response versus done, is matched
by the other representative's unconditional stutter. This is deliberately
an **unlabeled whole-next safety quotient**, not per-action congruence:
`send` enabledness and action labels differ. Removing stutter, adding terminal
reuse, returning to a live phase, or reading terminal phase/received in any
guard or invariant requires a new audit. The lookup model cannot use this
argument: its done requests can be reused.

## Binding, controls and claim limits

The helper and manifest allow only the exact V7 ID, expression, model SHA,
official generated TLA SHA and final viewed TLA SHA. The independent delayed
verification-step selector retains its full-source pin. Full-source and
transition-boundary guards reject reuse, backward transitions, cross-slot
phase reads, invariant phase reads, received reads and removal of either
dispatcher stutter. Existing actual native TLC false-clause controls remain;
additional done-phase controls exercise every original terminal invariant
observation. Fixture binding overrides are test-only and do not expand the
production allowlist.

V7 additionally depends on the separately documented manual forward safety
simulation for delayed inputs. Neither argument is a machine-checked
refinement theorem. It proves no liveness, fairness, response delivery,
HTTP payload equality, action-label trace equality, exact full-state count,
implementation conformance or deployed behavior. Named scenarios and sampled
traces continue to use the original concrete entry point and full state.
An unfinished or unscheduled graph is not a pass.

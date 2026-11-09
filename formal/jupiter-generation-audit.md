# Jupiter generator control-flow audit

`models/tooling/jupiter_generation.qnt` maps the canonical decoder generator's
`--write`, `--sync-proof` and `--check` modes and the enclosing proof gate.
It records a captured input epoch, source/native/proof output classes,
baseline availability, partial writes, refused stale data and final proof
acceptance. The two epochs and three output classes are finite abstractions;
the temporary semantics file is grouped with proof output, not a separate
published artifact.

Writing source or synchronizing a proof is not proof acceptance. A readable
`.dfy.gen` may be old. Only the enclosing gate's regenerated body comparison,
successful theorem check and unchanged inputs permit acceptance. The model's
`baselinePresent` field means readable emission shape, not freshness.
`bodyMatches` and `theoremPassed` abstract separate actual verifier results;
the model does not establish the correctness of those tools or results.

Write failures can leave completed earlier outputs and an invalid current
output. The model retains that partial state and prevents it from becoming a
successful check without another generation/synchronization. The repeated
write scenario covers failure while replacing a previously valid output.
Input drift after capture can leave a locally consistent generator comparison
but blocks final proof acceptance in the enclosing hash-bound gate.

Review of the generator confirmed its sequential source/native writes,
optional existing-proof update, baseline read before synchronization, and
exact source/native/proof comparisons. No atomic multi-file commit, automatic
rollback or theorem check by `--write`/`--sync-proof` is assumed.

Validation with Quint 0.33.1: type checking and all 11 named scenarios pass.
The official pinned Apalache CLI/TLC path exhaustively explores 668 distinct
states (23,953 generated), leaves no states queued, and reaches depth 19 with
no invariant violation. The receipt reports unchanged model, source and
tool hashes. An earlier 2,000-sample, 30-step simulation also passed before
the repeated-write failure case was added; it is not the exhaustive result.
TLC's configured deadlock checking is disabled, so explicit scenarios cover
terminal refusal and nonacceptance. These bounds are not implementation
refinement or proof of filesystem, compiler, hash or solver semantics.

Ignored `evidence/jupiter-generator/` and
`evidence/formal/verification-jupiter_generation.json` retain the checks.

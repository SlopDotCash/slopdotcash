# Registry snapshot completion and failure states

Source review of `scripts/sync-project-registry.mjs` found model coverage gaps,
not a new application defect. The original publication model covered a valid
pair, successful sequential writes and a mismatch between those writes. It did
not represent the bounded retry, first-deployment fallback or invalid bytes
left by an interrupted write.

`fetchConsistentRegistry` retries only a valid response whose manifests and
revision history disagree, with at most three total reads. Invalid data and
transport errors refuse without retry. A missing API on the first read may
retain the committed snapshot. A missing API after a prior successful read is
an error, not first-deployment fallback. A coherent response must pass the
existing grammar, digest and restriction checks before rendering.

The two `writeFile` calls are sequential and are not a transaction. A rejected
write can leave retained, partial or complete bytes; a complete first file and
old or partial second file are not a valid pair. The model now distinguishes
these states. A separate check refuses invalid or mismatched bytes. A sync
error does not prove that both files are invalid: a later check can accept a
complete canonical pair even if the earlier operation reported a close error.
The earlier failed command remains failed.

The model represents one synchronization followed by an optional check, two
snapshot generations, three read attempts and three file outcomes. It does not
establish atomic publication, tolerance of concurrent local writers, full JSON
or JavaScript parsing, filesystem durability, or that a later build cannot
observe a different working tree. These remain source and environment
obligations. No registry output was edited, and no application behavior changed.

Ten named scenarios cover retry exhaustion and success, first-deployment
retention, a disappearing API, transport failure, matching output, mismatched
output, partial writes and completed bytes after an error. The original patch
was authored without checks under the user's instruction for this chat.

Independent validation at `29eb8bedf0bc02bd35e6ff44d16e8ce681e48af5` passed all
ten scenarios and 500 seeded simulations of at most 60 steps. Finite TLC
exploration found 97 distinct states, 2,083 generated states and depth 8, with
an empty queue. The model and mapped source hashes still match this local
follow-up. The receipt in
`slopdotcash-lemma-observation-models/evidence/formal/verification-registry_snapshot_publication.json`
has SHA-256 `c087857f1117c47871b6a61fba9f5b47c07d30f286122a4f0f9d37053af2b258`.
This is model evidence, not proof of filesystem or application refinement.

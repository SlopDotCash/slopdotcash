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
output, partial writes and completed bytes after an error. They are authored
but unexecuted. The user requested that this chat skip checks; no parser,
simulation, model checker or application test was run for this revision.

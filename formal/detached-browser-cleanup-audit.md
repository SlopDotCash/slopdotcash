# Detached browser cleanup

This change corrects a measured cancellation defect in the repository's browser
runner. It serves the PRD section 1 acceptance requirement to distinguish failed
checks from completed work; it does not change a product, wallet or signer flow.

## Observed defect

A real native-Solana browser run was interrupted while an added test used the
wrong navigation control. The coordinator returned 130 after its five-second
Playwright grace period. The local validator and other fixture services closed,
but the detached Pages process group still had a Workerd listener on port 55602.
The parent run retained its process samples, failed receipt and owned-group
cleanup record outside source control. Only that recorded group was stopped.

The pinned Playwright 1.61 implementation starts browsers and web servers in
separate POSIX process groups. SIGINT begins asynchronous test teardown. Killing
the launcher group after five seconds cannot also kill those detached groups.
Increasing the grace period alone would only postpone the same refusal case.

## Change and refusal behavior

Before sending the browser interrupt, the existing supervisor reads a bounded
process table and follows the launcher's parent-child links. It records only
process groups whose leader is an observed descendant; an ancestor's inherited
group, another user's process, a port match, or a command-name match grants no
ownership. The fallback rechecks the group's recorded process start identities
and requires a surviving recorded member before it sends a signal. A changed
leader identity or missing ownership evidence refuses the signal and prints a
cleanup error. It never searches by name or kills an unowned port holder.

The same five-second grace and cleanup limits remain. Forced cleanup also waits
for the recorded detached groups. Ordinary non-interrupt exits keep their
existing path. The Windows task-tree behavior is unchanged. Signal cancellation
still returns failure even when cleanup succeeds.

## Evidence

Two real subprocess regressions start a detached TCP server below an
uncooperative launcher and keep an unrelated sibling listener open. They exercise
both cancellation and the deadline, confirm the owned listener is gone, and
confirm the sibling remains available. The original supervisor fails both checks
because the owned port remains in use. The changed supervisor passes both. These
are real operating-system lifecycle checks, not theorem or browser acceptance.

The stable final run passed all 13 runner and LemmaScript cancellation checks,
with 56 assertions and no failures. The earlier focused run passed both new
cases. The standalone old-source control failed both cases with `EADDRINUSE`;
the control harness then stopped only its own retained processes. An intermediate
23-case run included a duplicate evidence copy because unprefixed Bun paths are
filters. It is retained separately and does not replace the explicit-path final
run. Exact results and source hashes are retained in the ignored
`evidence/detached-cleanup/` directory. The new formal-process scenarios cover
forced cleanup after capture and refusal for unknown or changed group ownership.
The model and combined final browser run require the parent's separate execution;
a source mapping does not prove process-tree refinement.

## Limits

The process table is operating-system evidence, not a cryptographic process
handle. Start timestamps have the platform's resolution. The scan cannot acquire
processes already reparented before capture, or future detached processes that
the launcher creates after capture. Such unobserved processes are not claimed as
owned or stopped. SIGKILL, host death and supervisor loss remain external
failures. Failure to obtain or recheck ownership never permits an unrelated kill
and is not evidence of complete cleanup. No production services are started,
stopped or deployed by this change.

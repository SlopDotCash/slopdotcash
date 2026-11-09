# Installer activation, completion and recovery

Source-only correction against the aligned `3d5104b00` baseline, serving PRD
section 4's verified installation and retained-version contract. The installer
now distinguishes committed activation from complete verification and preserves
the primary error when cleanup also fails. The model's 15 named scenarios and
six added installer test cases are **unexecuted** under the user's instruction
to skip checks. No installer, parser, formatter, browser, test or prover ran.

## Current authority contract

The current repository instructions and PRD accept any immutable canonical
template commit, with exact source bytes and the approved D1 revision/digest
for generated skills. Template ancestry, freshness, release labels and old
revocation records are not admission gates. Ordinary generated-skill updates
cannot decrease the D1 revision; an explicit rollback can select a retained
version after fresh source/policy verification. This review does not restore
older installation rules from historical prose.

`skill_source_authority.qnt` separately models bounded transport retry and a
generated-contributor projection of source/blob/manifest/project admission.
Its unconditional manifest/open predicates do not represent the static/legacy
path or the reviewer path: `expected_skill_bytes` permits a static source with
no D1 binding and calls `require_project_open` only for contributors. The
installation model starts from abstract observations of applicable checks.
It does not prove ZIP parsing, GitHub contents, rendering equivalence, redirect
confinement or byte equality; those role-specific admission branches remain
outside this completion refinement.

## Source-to-transition relation

| Source in `src/lib/install-command.ts` | Refined transition |
| --- | --- |
| `main`, `acquire_lock` | `begin` owns the kernel lock through completion; `finish` releases it. Contender exclusion is an assumed lock primitive here, not a two-process proof. |
| `install_or_update`: downloads/checksum, `mkdtemp`, extraction | `begin`, `stageArchive`, `verifyBytes`; a refusal before staging has no work directory. Staging can contain incomplete/untrusted extracted bytes before verification. |
| Existing-target verification and no-change returns | `noChange` covers same identity and equal canonical bytes. Equal bytes from a different template retain the original identity. Different generated D1 revisions cannot have equal `project.json` bytes. |
| Receipt write, existing-version verification, `os.replace(staged_skill, version_path)` | `retain`; a new candidate moves out of staging, while reuse of an existing immutable version leaves a staged copy for cleanup. |
| `activate`: temporary relative symlink, atomic replacement, temporary-link `finally` | `prepareLink`, `activate`, `linkFailure`; the committed revision is recorded immediately after replacement. Failure to remove a not-activated temporary link can leave that invocation's link behind. |
| `current_install` and `verify_local_version` after activation | `confirmReadback` or `readbackFailure`; successful replacement has already committed the active identity. |
| Success print before `shutil.rmtree(work_root)` | `printSuccess`, then `cleanup`; printed success and a nonzero final exit can coexist. |
| `rollback` | Uses retained verification and the same activation/readback split, without creating an extraction work directory. |
| `cleanup_preserving_error`, `main` and outer exception boundary | `cleanup` retains a primary error and records an additional cleanup failure. `finish` reports refusal before commit, or committed activation with successful/incomplete readback after commit. The inert lock file remains on disk in either case. |

The bounds are two template identities, two generated D1 revisions and three
invocations. This is enough for install/update/rollback or failure/retry. The
original arbitrary-template/newer-policy and explicit-rollback scenarios remain;
additional scenarios cover post-commit read failure, post-success cleanup
failure, same-version verified retry, retained-version reuse, unchanged-byte
no-op, leftover temporary link, combined readback/cleanup failure and cleanup
preserving an earlier error. One prior scenario was renamed from
`cleanupFailureOverridesEarlierErrorTest` to
`cleanupFailurePreservesEarlierErrorTest` to reflect the corrected behavior.

## What can remain after a failure

The active symlink, immutable retained versions and command result are separate
state. Before atomic activation, failure leaves the prior active target. After
atomic activation, readback or cleanup failure does not undo the replacement.
The candidate had passed prepublication verification; this does not establish
successful postpublication readback when that read fails.

`workRoots` and `stagedCandidates` represent created artifacts without confirmed
cleanup, not a promise that a failed recursive deletion left a complete tree.
Deletion can remove some children before it fails. A moved candidate remains in
the immutable version store; a reused candidate's staged copy may remain in the
work directory. A failed temporary-link removal can leave an unactivated link.
New invocations use unique temporary names and do not sweep earlier leftovers.
Successful retry therefore does not certify removal of an earlier work root.
The model preserves those possible residual artifacts across its three
invocations and never treats them as active installation authority.

## Failure diagnostics and cleanup

Previously, a readback error after `activate(key)` committed reached the same
`Refusing skill operation` diagnostic as a pre-commit refusal, even though the
new target remained active. Cleanup could also replace that primary error.
These were source-confirmed paths, not observed runtime incidents.

The generated installer now records the committed revision immediately after
atomic replacement and records successful readback only after both target
identity and canonical bytes verify. A post-commit failure states that
activation committed, whether post-activation verification succeeded or did
not complete, the primary error, and that the committed activation was not
reverted. This describes an install, update or explicitly requested rollback
without denying which operation committed. It does
not infer that the current target is healthy from the earlier commit. A
pre-commit failure retains the existing refusal diagnostic. Every failure
still exits 1.

Temporary-link removal, staging removal and final lock-handle cleanup use the
same exception-preservation helper. A cleanup failure with no prior exception
becomes the primary failure. If another exception is already propagating, the
cleanup failure is printed separately and the original continues to the
outer boundary. Success output can precede a subsequent cleanup failure; the
post-commit diagnostic distinguishes verified activation from successful
completion of the whole command.

A new invocation fetches and verifies again. If the new version is already
active, its normal no-change branch re-verifies it and returns; this can recover
to success without another activation, provided that invocation's own cleanup
succeeds. If a readback failure reflected changed or damaged bytes, verification
can continue to refuse instead. Retry is not modeled as unconditional success.

The six added definitions in `tests/integration/installer.e2e.ts` use the
existing generated-script/file-authority workflow. They inject post-activation
readback failures for install, update and explicit rollback; staging failure
after verified activation; combined readback and staging failures; and a
pre-activation failure followed by staging failure. Assertions require exit 1,
truthful diagnostics, preservation of the primary error, the expected committed
target, retained versions and successful fresh verification on retry. A retry
does not claim to remove an earlier invocation's leftover staging directory.
These definitions were authored and manually read only.

No automatic rollback, authority-policy change, new freshness gate or retained
version deletion is introduced.

## Limits retained explicitly

The model assumes the single-process kernel lock and atomic replacement
primitives behave as specified. It does not cover concurrent manual changes to
managed paths, every partial recursive-deletion tree, disk durability or power
loss, Windows native rename semantics, process termination between individual
filesystem calls, or a model of errors from closing the lock handle itself
(the source now preserves an earlier exception there too). Static legacy
skills without a D1 suffix use the same completion shape but are not a separate
identity family in this bounded model. Existing installer integration definitions
exercise emitted scripts, retries, retention, lock contention and rollback;
none was rerun here, and no retained result is relabeled as current validation.

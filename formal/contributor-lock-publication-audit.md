# Discovery lock publication and cleanup

This source-only refinement covers `acquireLiveReportLock`, candidate preparation
and returned-handle release in the canonical contributor script. It serves PRD
section 4's live GitHub work-selection workflow. It changes neither contribution
authority nor the existing process/child ownership policy. No parser, formatter,
test, installer, model checker, application or service ran for this change.
Only the three source metadata inventories are regenerated. All new regression
definitions and model scenarios are unexecuted.

## Observed failure states and correction

Candidate preparation previously let its cleanup exception replace the original
write failure. Acquisition's unconditional candidate cleanup could likewise
replace contention or a failed publication. Those paths now retain their primary
exception and report secondary cleanup failure separately. A candidate already
moved into the canonical path is not removed through its former path.

After a stale owner and its commands were found inactive under the transition
guard, acquisition renamed that lock to a private stale path and published the
new owner. A failure removing the stale directory then threw before returning
the new handle. The caller's same-process retry encountered its own live owner.
The new path revokes only the unpublished new owner by renaming it back to its
unique candidate path, while still holding the guard. No handle has been returned,
and every helper startup uses the same guard. The partially removed old directory
is never restored. Candidate removal is best effort after this rollback; its
failure retains the original stale-cleanup exception. A later ordinary attempt
can acquire the empty canonical path while old private debris remains.

If rollback itself fails, the original stale-cleanup and rollback errors remain
in `AggregateError.errors` and its diagnostic; the outer error states that
ownership was acquired, no handle was returned, and stopped-process manual
recovery is required. Failure removing the transition guard after publication
also leaves a committed owner without a returned handle. The guard is never
automatically reclaimed, including after the owning process exits.

Release now closes its handle at the canonical-to-release-path rename, before
removing that private directory. It records the release path separately and
marks release complete only after transition-guard cleanup succeeds. An old
handle therefore refuses commands even if its cleanup failed. Repeating release
enters the guard and touches only its saved private path; a newer canonical owner
is neither inspected nor removed. A retained transition guard still blocks this
retry and requires the existing external recovery procedure.

| Boundary after a failure | Canonical authority and retry |
| --- | --- |
| Preparation or contention; guard removed | Existing authority is unchanged. Candidate debris is not a lock. |
| Old lock quarantined; new publication failed; guard removed | Canonical path is empty. Ordinary retry may acquire it; the old inactive directory stays private. |
| Stale cleanup failed; guarded rollback succeeded; guard removed | No new owner or handle survives. Same-process retry may acquire; the damaged old directory is not restored. |
| Guarded rollback failed | New ownership remains committed without a handle. The diagnostic preserves both failures; no blind same-process retry is promised. |
| Transition guard cleanup failed | Later acquisition and incomplete release refuse at the guard. Stop all affected processes before manual recovery. |
| Release rename succeeded; private cleanup failed; guard removed | Handle is closed. A successor may acquire. Cleanup retry addresses only the saved release path. |
| Release rename failed; guard removed | Original owner and usable handle remain. A later release may retry the rename. |

The real report prints its completed report before releasing its lock. A later
cleanup failure may therefore leave report stdout and a nonzero exit status.
Output alone remains insufficient evidence of successful command completion.

## Model and source correspondence

`contributor_lock_publication` adds 20 named scenarios. Its finite domain has
two caller identities, one already-dead prior owner, at most three acquisition
attempts, and at most one returned handle and saved release path per caller.
The used-caller set survives external recovery; clearing an in-memory handle
cannot reuse its tombstone identity. It separates preparation,
quarantine, publication, required stale cleanup, guarded rollback, candidate
cleanup, guard cleanup, returned-handle publication, release rename, release
cleanup and retry. Private stale and candidate debris remain distinct from the
canonical lock. A fresh retry does not discover or clean a prior attempt's stale
directory.

The invariant prevents a released handle from starting a command, keeps release
cleanup independent of the canonical successor, forbids restoration of a damaged
old owner, and binds committed-without-handle diagnostics to the retained owner.
External recovery requires a separate stopped-process observation; no timer or
automatic recovery action establishes it. `contributor_discovery_lock` still
covers actual helper/child startup ownership. This model assumes that contract
when it treats guarded rollback as excluding a new child; the two models have
not been mechanically composed. `contributor_command_completion` still covers
the report's primary error and output retention.

Node documents [`fs.renameSync`](https://nodejs.org/api/fs.html#fsrenamesyncoldpath-newpath)
as renaming the path and returning after the call. Here, a successful local
rename is the modeled commit boundary. This is not a claim of universal remote
filesystem atomicity, crash durability, or behavior after an ambiguous native
failure. The model does not cover malicious mutation by another process using
the same account, symlink replacement outside the existing path checks, arbitrary
process descendants, or power-loss recovery. It abstracts exact error strings,
filesystem bytes and process identity detection.

## Authored regression definitions

`scripts/contributor-lock-publication.test.ts` adds 11 definitions. Each copies
the actual canonical modules into an isolated directory and imports them in a
Node child. Filesystem hooks use `syncBuiltinESMExports` to target the actual
write/rename/remove boundaries. The tests do not replace lock logic. A local
fake `gh` only records an unexpected invocation; no GitHub call is intended.
The scenarios cover:

- no removal of a moved candidate;
- preparation and contention preserving their first failures;
- failed publication after stale quarantine and a successful later acquisition;
- successful guarded rollback and same-process retry, both with and without
  secondary candidate-cleanup failure;
- failed rollback retaining both causes and explicit committed ownership;
- acquisition guard-cleanup failure retaining the owner and blocking retries;
- repeated release-cleanup failure, successor preservation, cleanup retry and
  completed-release no-op;
- release guard-cleanup failure blocking every retry;
- failed release rename retaining the original owner until a later release.

The partial stale-cleanup fixture deletes the old owner file before throwing,
so the positive retry cannot rely on restoring an intact old snapshot. Fixtures
with retained guards finish their child before the test removes its isolated
directory; this is harness cleanup, not application recovery. They follow the
existing native lock suites' Windows exclusion. Native execution on supported
platforms, model parsing/checking, broad integration, and production acceptance
remain open.

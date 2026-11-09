# Contributor command completion and recovery

Source-only follow-up to aligned `e38b05ae8`. No command, installer, test,
parser, browser or verifier was executed. The three refined models contain
29 named scenarios: `skill_run_local` 12, `contributor_terms_preflight` 9, and
`contributor_discovery_lock` 8. Five regression definitions were added; two
process/signal cases are explicitly skipped on Windows.

The later [startup ownership follow-up](contributor-startup-ownership-audit.md)
revises the lock model and closes the helper-crash and handoff gaps listed here.
Counts and limits in this document describe the earlier `c42c7de07` checkpoint.

## Local receipt correction

`run-receipt.mjs` permitted completion up to five minutes before the recorded
start, while `validateCompletedRecord` rejected every negative duration. It
published the immutable completed JSON before validating that candidate. A
one-second clock regression could therefore create a completed file that the
initial finish and every subsequent replay rejected.

Finish now refuses every backward completion timestamp and validates the signed
candidate before `atomicJson` publishes it. Existing invalid completed records
remain explicit errors; they are not overwritten or repaired automatically.
The installer integration definition exercises the actual generated installed
CLI under a process-local clock, checks that refusal leaves only the active
record, then checks successful retry and exact immutable replay. It also checks
that an existing invalid completed record is preserved on refusal.

The model distinguishes preparation, validation, hard-link publication,
temporary cleanup, active-record cleanup and replay. A valid completed record
may coexist with its active record after cleanup failure. Temporary residue
may survive a successful later replay. These states do not imply that the
command succeeded merely because publication occurred.

The optional trace upload and the ordinary `opened` command have separate
server identities. The former uses the local `run_...` identifier; the latter
uses `pr_opened_<PR-node-id>` and does not require a local measured run. An
already uploaded trace is finalized before response digest mismatch is
reported; the old digest remains unchanged, but its server state can advance
to finalized. A later opened invocation has a new event timestamp and can
create another event, while exact-body retries reuse their key. The model does
not claim exactly one progress event across later invocations.

## Terms acknowledgement correction

The cache reader caught open/read errors, but its awaited close in `finally`
could still reject preflight. Cache close is now best effort, like the rest of
the optional cache. Digest verification still precedes use; close failure
cannot turn corrupt bytes into verified bytes. The new definition invokes the
actual preflight with a real immutable cache file and a child-local wrapper
that closes the real handle, then reports a controlled close error.

The non-JSON CLI previously printed “contributions open” without checking
project status. It now reports only that policy documents were verified. No
project-status gate was added. A second definition passes the real served
terms shape for a paused project through the actual CLI and checks this narrow
acknowledgement. The model separates verified required documents (including
none required), optional cache failure and project admission; acknowledgement
does not grant admission.

## Discovery child ownership correction

`runLockedGhCommand` launched `gh` before reading its birth identity and
publishing that identity to the helper lease. If either operation threw, its
`finally` deleted the lease before awaiting the launched child. The outer
report normally waits for the helper, but an outer-process loss during that
window could permit lock reclamation while the untracked child was alive.

The helper now requests termination of an already launched child and awaits
its close before removing the lease. The existing helper identity covers the
prepublication window. Cleanup failure does not replace the first bookkeeping,
spawn, output-limit or signal error. Cleanup of a failed lease-publication
temporary also preserves that original error. A normal nonzero `gh` exit keeps
its exact status and captured output even if lease cleanup fails; a diagnostic
adds the cleanup failure. Successful commands still fail if required cleanup
fails.

The refined lock model distinguishes helper-only lease, launched child,
published child identity, failure, observed child close and lease cleanup.
A live helper remains a blocker after the child closes. It does not use a
global oracle of live children for lock reclamation.

Two POSIX-only definitions use the real copied discovery module and its real
helper process. One delays a lease-publication exception until the owned fake
`gh` is running, holds that child after SIGTERM, kills only the owned outer
report, and checks that a second acquisition remains blocked until the child
closes. The other checks real nonzero command output/status when lease removal
fails. No request reaches GitHub. Cleanup observes only recorded owned process
identities. If startup failed before the bookkeeping boundary was observed,
the fixture retains its stop marker rather than claiming a late child cannot
start; it does not erase that recovery path.

## Bounds and remaining evidence

Receipt signatures, filesystem hard-link behavior, OS process birth identity,
network identity assertions and provider truth remain implementation/external
boundaries. The models do not establish wall-clock performance, all parser
languages or every crash point. The lock model does not model abrupt loss of
the helper itself while an unpublished child survives; the source's bounded
orphan grace and manual stale-transition recovery remain separate limits.
Progress/refusal, trace-size limits, bytes disclosed before upload and
idempotency checks were read, but this review did not execute or prove their
complete transport refinement. All new test definitions and model scenarios
remain unvalidated under the user's skip-checks instruction.

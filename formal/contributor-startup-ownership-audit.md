# Discovery startup ownership and command completion

This source-only follow-up starts at `c42c7de07`. No parser, formatter, test,
installer, application, simulator or verifier ran. The added or changed models
and regression definitions are unexecuted.

## Confirmed gaps

The former helper wrote a null-child lease, spawned `gh`, then published the
child's PID and birth identity. If the helper and outer report died before
publication, that lease expired after five minutes even when the child survived.
Elapsed time was not evidence that the child stopped.

Startup also ran outside the acquisition transition guard. A successor could
observe no leases, then an old helper could publish a lease and read the old
owner token before the successor renamed the directory. The old helper could
subsequently launch `gh` under a replaced owner. An extra unsynchronized token
read could not close that scan/rename gap.

Both traces were independently identified by source review. They were not
executed against old or new code in this lane.

## Ownership correction

Request publication now checks the owner and writes the request within the
existing synchronous transition guard. A released handle refuses before this
write. The helper then enters an **awaited** guard around current-owner
validation, its initial lease, child spawn and immutable child-identity
publication. The helper may legitimately finish a request after its parent
dies if no successor replaced its owner; the model no longer assumes a live
parent throughout startup.

On startup failure, the guard remains held while the helper requests child
termination and waits for its `close` result. An absent child identity also
requires positive close observation before startup releases the guard. A
helper crash leaves the persistent guard for explicit recovery. A legacy
null-child lease with a dead helper now refuses with stop-all/manual-recovery
guidance; it never expires into authorization. A recorded child which is
demonstrably gone still permits ordinary stale-owner reclamation.

The process boundary follows Node's documented distinction: [`close` follows
process termination and stdio closure](https://nodejs.org/api/child_process.html#event-close),
while [sending a kill signal does not establish termination](https://nodejs.org/api/child_process.html#subprocesskilled).
The implementation retains its existing fixed pipe configuration and waits on
the collector's close result. A failed spawn may have no streams, so the
collector installs its error/close listeners first and handles absent streams
without prematurely rejecting its close promise. This is not a
descendant-process supervisor.

A helper can remove its finished lease between another process's directory
listing and file read. Only `ENOENT` at that lease read is now treated as an
already-ended entry; malformed, inaccessible and mismatched-owner records
remain explicit failures.

## Completion and diagnostics

The request-file cleanup could replace a nonzero helper result and erase its
captured output. The outer report's lock release could also replace an existing
discovery exception. Both paths now preserve the primary failure, with cleanup
information kept separately. Successful work still fails if required cleanup
fails. Synchronous and asynchronous transition cleanup share the same primary
error rule; the asynchronous version actually awaits its operation.

These changes do not make post-rename acquisition/release cleanup atomic. Those
commit-before-diagnostic states still need separate review. They do not justify
reclaiming a live or unknown child.

## Models and authored evidence

`contributor_discovery_lock` has 22 named scenarios, two owner identities, at
most two lock generations and one command. It separates request capture,
reclaim scan and commit, helper startup, child launch, identity publication,
close, crash, legacy ambiguity and external manual recovery. The invariant
retains the launch owner while a child is alive. The manual recovery action
requires the modeled processes to have stopped; it does not infer that fact
from time or implement an application recovery endpoint.

`contributor_command_completion` adds eight named scenarios over one helper
outcome, request cleanup and report release. Nonzero output and primary error
identity survive later failures; clean success requires successful cleanup.
It abstracts exact bytes, OS exceptions, output stream failures and process
exit encodings. Report publication precedes lock release, so a later cleanup
failure may leave complete stdout with a failed exit status. Consumers still
must observe that exit status; published output alone is not command success.

Six new native regression definitions cover:

- a helper killed at the child-identity publication barrier, with a surviving
  child and an old timestamp; the same retained lease is then presented as a
  legacy null-child record and still refuses;
- a stale helper starting while a successor holds its reclaim scan;
- a released handle refusing before any request or child;
- the actual report CLI retaining its discovery error after lock-release failure;
- a missing `gh` executable completing startup cleanup while retaining its spawn error;
- a nonzero helper result retaining output after request-file cleanup failure.

The first five are in `scripts/contributor-discovery-startup.test.ts`; the last
extends `scripts/contributor-discovery-lifetime.test.ts`. They use actual copied
scripts, controlled filesystem barriers, local fake `gh`, and owned process
identities; no GitHub request is intended. Process fixtures are explicitly
skipped on Windows. Existing startup-failure and lease-cleanup cases remain.

This does not prove every platform's PID identity, all filesystems, arbitrary
process descendants, every power-loss state, or implementation refinement.
Native Windows evidence and execution of every changed model/test remain open.

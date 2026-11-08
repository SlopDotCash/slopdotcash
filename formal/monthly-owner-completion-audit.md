# Monthly owner mutation completion

This source-only follow-up starts at `e4ee8a3c79b035999d3da98f008f57c674c989d2`.
No tests, syntax/type/lint/format checks, model scenarios, simulations,
verifiers, browser commands or services were run. The runtime correction and
fourteen model scenarios are unvalidated.

## Source-confirmed order

`monthlyOwnerService.authorized` reads a current project record, then awaits
`verifyProjectAuthority`. The production binding verifies the repository's
immutable GitHub identity and the actor's current permission against that
record. `setAutomatic` next awaits a participation read. `changeAllocation`
also reads the period's immutable proposal and allocation history before its
write. Those awaits permit a registry revision to replace the steward or
repository used for the earlier authorization.

Neither mutation's INSERT previously bound the captured project revision.
For example, A passes authorization for registry revision 1; an approved
revision 2 changes the User steward from A to B; the older request resumes.
An unchanged settings/allocation sequence and absence of a participation ban
still let A append its change under revision 2. The allocation freeze trigger
and cutoff predicate do not test project authority. This is a source-visible
stale authorization order, not an executed exploit or unauthorized payment.

The proposed correction adds an execution-time `EXISTS` for project ID,
revision and manifest SHA-256 to both INSERTs. It uses the same database as
the mutation, so a queued write cannot pass merely because a prior read was
current. A zero-row result rereads that registry row to report
`project_changed` before the existing sequence/cutoff/participation refusal.
An absent registry row reports `503 payment_registry_unavailable`; a missing
table still fails the statement and cannot fall back to an unchecked write.

## Preserved semantics and topology

The predicates retain the existing automatic-setting ordering: a later
opt-out invalidates an earlier enable, while an explicitly requested off may
append after another settings write. Allocation writes retain their current
sequence uniqueness, frozen-month trigger, participation predicate, captured
cutoff check and SQLite execution clock. They still derive amounts and
exclusions from the immutable period proposal. No old proposal, award,
setting or allocation record is edited.

The earlier authorization for these two operations does not require an active
project. Accordingly, this patch does not add `status='active'`. A paused
project can still be managed by its currently authorized owner, but any
intervening revision, including a pause revision, requires a new request.
Finalization keeps its existing stronger active/revision/hash predicate.

Production and staging use the canonical project registry and payments in
the same D1 database. An isolated payment database without that registry row
is unsupported for these owner writes and fails closed. This patch does not
create a second inventory or accept the caller's cached project as fallback.
Database atomic statement execution and append-only registry revisions remain
external assumptions. Current GitHub permission can change outside D1; this
predicate does not claim a distributed transaction with GitHub or reauthorize
an old request against a newly selected repository.

## Model and conformance boundary

`monthly_owner_completion.qnt` covers one already-authorized request for an
allocation, enable or disable, two registry versions/digests, at most two
competing setting/allocation writes, one cutoff, a freeze, participation ban,
missing registry and terminal commit/refusal. The terminal model does not
assert that a historical valid write becomes invalid after a later registry
change. Amount validation, immutable proposal content, external GitHub proof,
clock grammar and D1 execution semantics remain separate predicates.
For an enable, the implementation captures the settings sequence before
authority checks. This model starts after that authorization boundary and
represents a competing opt-out before execution; the existing monthly setting
ordering model separately covers the earlier sequence-capture order.
The ban refusal uses the implementation's `account_banned` error code.

Existing real-SQLite references are `backend/payments/monthly.test.ts`:
automatic/owner finalization preserving a pause before its freeze write;
enable versus a later opt-out; allocation cutoff/execution-time and frozen
month cases; and reserve release refusing a changed project revision. Those
references explain the retained boundaries, but no prior run proves the new
two-INSERT predicate. No runtime regression was added or run under the active
instruction to skip checks. Exact-source API/SQLite before/after evidence is
still required for the newly fenced owner/steward-change orders.

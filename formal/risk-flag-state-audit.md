# Risk flag admission and retained history

These source/model/test changes were authored without running tests, parsers,
type/lint/format checks, simulations, verifiers, browsers or services.
`vetting_flag_admission` has five unexecuted scenarios (two retained, three
added); `vetting_flag_reinstatement` has thirteen (six retained, seven added).

## Admission correction

The flag handler checked the owner and GitHub eligibility against a captured
project, then awaited further reads before writing. Its INSERT selected the
latest registry revision/hash using only project ID and the participation-ban
predicate. A revision changing the steward or repository could land in that
interval. Old eligibility would then admit a flag labelled with the new
revision, even if the reporter had become its steward.

The INSERT now also matches the captured `project.revision` and
`project.manifestSha256`. It does not make a second preflight read. A mismatch
in the database execution yields no new flag and follows the existing
`flag_retry` response. The existing ban predicate, one-active-flag constraint,
atomic pause and notification writes remain intact. The existing expiry
maintenance in that batch is not rolled back just because the new INSERT
matches no project.

The real SQLite regression source uses the existing pre-batch hook, now
awaitable, to append an immutable registry revision while the reporter's
flag waits. It expects `flag_retry`, no second flag or quarantine notice, and
`owner_cannot_flag` on a fresh request by the new steward. The injected
trusted-storage revision tests the concurrency boundary; it does not claim
to exercise the separate admin policy/proof review for that revision.

## Reinstatement model corrections

Active flags are now immutable flag IDs, with reporter identity and retained
closed-state history stored separately. Withdrawing and refiling by the same
reporter creates a different ID. The older scan cannot cover it merely
because the reporter is unchanged. Duplicate active submissions still do not
add a flag, and withdrawal/expiry preserve history without lifting a pause.

The SQL clean-result trigger closes the captured active IDs on every recorded
pending-to-clean result. That occurs independently of whether the current
project can be reinstated. The model now retains a flag-only quarantine when
the live pin is stale/unavailable or a new uncovered flag exists, while still
resolving the scan's captured active IDs. A later refresh may use a recorded
clean scan after the same live pin becomes readable. A confirmed malicious
ban still needs the separate moderator decision; clean results cannot undo it.

Project revision and relevant content identity are separate in the model.
`planScanReinstatement` compares content digests and current pins, not raw
revision equality. A presentation-only revision therefore need not invalidate
an in-flight scan's completion. The later refresh route selects recorded
scans only at the current project revision, so the model separately requires
revision equality for that retry route. The restriction epoch represents
whether the scan was requested after the latest relevant pause; it is not a
wall-clock duration.

The second new real-handler regression source withdraws and refiles the same
reporter while a scan waits. It checks distinct IDs, the older withdrawn row,
the other captured row resolved by the clean-result trigger, the newer active
row retained, and no reinstatement. Neither new regression was executed.

## Bounds and remaining boundary

Admission has two actors and two captured revision/hash values. Reinstatement
has three reporters, four total flag records, up to three project revisions,
two content identities, two live pins and one pending scan. Repeated requests
can reuse a completed scan slot, but arbitrary histories, exact time arithmetic,
GitHub permission changes without a registry change, SQL-engine atomicity and
complete handler/model refinement are not proved by these models.

`src/ProjectRiskFlag.tsx` has no current importer. The live browser source
explicitly expects that form to be absent; no dormant UI code was changed or
counted as a browser-tested user flow. Its callback/actor behavior would need
review before any future integration.

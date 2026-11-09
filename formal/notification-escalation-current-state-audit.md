# Current escalation eligibility

This source-only correction follows `6c63d6fae`. No tests, parsers, type or
format checks, simulations, verifiers, applications, services or real sends
were run. All five new regression cases and six new model scenarios are
unexecuted.

`escalate` previously retained only the prepared failure decision across its
awaited backup-role lookup. Independent operator evidence could change the
primary from `ambiguous` to `delivered` before the INSERT, yet the INSERT still
created a backup notice. This was wrong for an informational report receipt,
which requires no acknowledgment, and for an action notice whose acknowledgment
deadline had not passed. A new scan would refuse both, as required by the
failure-or-missed-acknowledgment contract in `workers/notify/README.md`.

The escalation INSERT now checks the current primary state in the same
transaction as the new notice. `ambiguous`, `exhausted`, `bounced`, and a
provider-evidenced suppression remain eligible failures. A `provider-accepted`
or `delivered` action notice remains eligible after its existing acknowledgment
deadline. Informational receipts cannot use that deadline. Queued, retrying,
sending and locally suppressed notices do not become eligible merely because
an earlier observation was a failure. The existing acknowledgment, parent,
one-backup and immutable notification/event guards remain in force.

Every caller passes its existing observed `acknowledgeHours`; the database
compares the primary creation time with the corresponding cutoff calculated
after the backup check. This does not invent a new deadline or make external
role checks atomic. A delivered but overdue action notice still escalates,
which is why merely fencing the earlier state or attempt would be wrong.
Later reconciliation does not remove a backup that already committed.

`notification_escalation.qnt` retains its ten earlier scenario names and adds
six, for sixteen total. It reapplies the current failure-or-overdue predicate
at commit and captures the evaluated eligibility as a creation witness.
The invariant requires every backup to carry that witness, while later
delivery may make current eligibility false without deleting committed history.
The finite scope remains one primary, one backup, action/receipt classes,
due/not-due time and observed role booleans. `provider-suppressed` represents
the database's suppression event with independent evidence. The model does not
prove provider evidence truth, SQL/date parsing, address handling or arbitrary
implementation refinement.

Five definitions in `workers/notify/security.test.ts` use the real case setup,
migrated SQLite, dispatcher and reconciliation function. Each holds the backup
access read after an ambiguous send, records independent reconciliation while
it is held, and then resumes. They distinguish delivered receipts, delivered
early action notices, delivered overdue actions, definitely non-accepted
receipts awaiting retry, and provider-suppressed receipts. The expected backup
counts are respectively zero, zero, one, zero and one. Only the external mail
transport and delay are substituted; these are authored tests, not observed
passes.

# Retired specification drafts

No unfinished drafts remain in `formal/drafts/`. Every draft created during the
initial specification migration has been integrated into the active Vibestack
specification tree under `spec/` and its temporary draft files removed:

- Shared Slopbot source leases (`value-group-leases.md`) →
  [Slopbot value requests](../../spec/slopbot/valueRequests.md).
- Incomplete assessments in the private Inbox (`assessment-inbox.md` and
  `assessment-inbox-partial.json`) →
  [Slopbot assessment Inbox](../../spec/slopbot/assessmentInbox.md).
- Slopbot value history (`value-history-partial.json`,
  `value-history-witness.qnt`, `value-history-witness.log`) →
  [Slopbot value history](../../spec/slopbot/valueHistory.md).
- EVM monthly reserve (`monthly-reserve.md`) →
  [Settlement escrow](../../spec/settlement/escrow.md) and the contract units.

The [source manifest](../source-manifest.json) records the application and
requirements revisions. The [proof inventory](../validation/full-tree/current-proof-coverage.json)
tracks recorded full-tree proof coverage and its refresh command.

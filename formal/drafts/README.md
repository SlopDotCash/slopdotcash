# Unfinished specification work

These drafts are preserved for the next migration pass. The active Vibestack
specification tree is under `spec/`. Verify each draft and its current source
before integrating it into that tree.

- [Shared Slopbot source leases](value-group-leases.md) drafts an all-or-none
  claim across overlapping groups. Proof and replay certification is pending.
- [Incomplete assessments in the private Inbox](assessment-inbox.md) drafts
  gap coalescing and current-authority reads. The [partial report](assessment-inbox-partial.json)
  records 24 generated replays and binds the draft SHA. Proof certification
  and integration are pending.
- [EVM monthly reserve](monthly-reserve.md) drafts admission of a funded root,
  partial leaf materialization and observed contract release. Proof and replay
  certification is pending.
- [Slopbot value history](../../spec/slopbot/valueHistory.md) is already on
  the branch. Its [partial report](value-history-partial.json) and
  [Quint witness](value-history-witness.qnt) preserve focused work.
  Verify the final proof, wire the spec into the index and refresh the catalog.

The [source manifest](../source-manifest.json) records the application and
requirements revisions. The [proof inventory](../validation/full-tree/current-proof-coverage.json)
applies to its recorded source snapshot.

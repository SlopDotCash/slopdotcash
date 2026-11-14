# Live discovery snapshot and review frontier

PRD sections 4 and 5. `skills/project-contributor-template/scripts/live-report.mjs`
reads the repository's open items and recent activity into one read-only
inventory (legacy `contributor_discovery_snapshot` and
`contributor_review_epoch`). The inventory is a heuristic aid: the contributor
re-reads live GitHub before acting and before submitting
([work and review](./workflow.md)). Snapshots keep every open issue and pull
request for source-count integrity, and each item gets a deterministic
selection decision.

## Story: Publish a complete inventory or none

### A changed inventory retries the whole snapshot once and a failed read never publishes

The open-item inventory is read first and the activity second, within a
bounded command budget of three reads per attempt. If the inventory changed
while activity was read, the whole snapshot is retried once; a second change
fails closed. A transport failure, malformed response or exhausted command budget
(`failRead`) fails without publishing an empty success. Every run of the command's own
reads ends published or failed.

```quint
type SnapshotPhase = ReadingInventory | ReadingActivity | ReadyToPublish | Published | SnapshotFailed
type Snapshot = { phase: SnapshotPhase, attempt: int, reads: int, inventoryItems: int, activityRead: bool }
pure val readBudget = 3
pure val initial: Snapshot = { phase: ReadingInventory, attempt: 1, reads: 0, inventoryItems: -1, activityRead: false }
pure def canReadInventory(s: Snapshot, items: int): bool = s.phase == ReadingInventory and s.reads < readBudget and items >= 0
pure def readInventory(s: Snapshot, items: int): Snapshot = { ...s, phase: ReadingActivity, reads: s.reads + 1, inventoryItems: items }
pure def canReadActivity(s: Snapshot, inventoryChanged: bool): bool = s.phase == ReadingActivity and s.reads < readBudget
pure def readActivity(s: Snapshot, inventoryChanged: bool): Snapshot =
  if (not(inventoryChanged)) { ...s, phase: ReadyToPublish, reads: s.reads + 1, activityRead: true }
  else if (s.attempt == 1) { phase: ReadingInventory, attempt: 2, reads: 0, inventoryItems: -1, activityRead: false }
  else { ...s, phase: SnapshotFailed, reads: s.reads + 1 }
pure def canFailRead(s: Snapshot): bool = s.phase == ReadingInventory or s.phase == ReadingActivity or s.phase == ReadyToPublish
pure def failRead(s: Snapshot): Snapshot = { ...s, phase: SnapshotFailed }
pure def canPublish(s: Snapshot): bool = s.phase == ReadyToPublish
pure def publish(s: Snapshot): Snapshot = { ...s, phase: Published }
pure def alwaysPublishedComplete(s: Snapshot): bool = s.phase == Published implies s.inventoryItems >= 0 and s.activityRead
pure def alwaysBounded(s: Snapshot): bool = 1 <= s.attempt and s.attempt <= 2 and 0 <= s.reads and s.reads <= readBudget
pure def stepTerminal(before: Snapshot, after: Snapshot): bool =
  (before.phase == Published or before.phase == SnapshotFailed) implies after == before
pure def sometimesRetriedThenPublished(s: Snapshot): bool = s.phase == Published and s.attempt == 2
pure def sometimesSecondChangeFailed(s: Snapshot): bool = s.phase == SnapshotFailed and s.attempt == 2
pure def sometimesEmptyInventoryPublished(s: Snapshot): bool = s.phase == Published and s.inventoryItems == 0
pure def leadsToTerminal(s: Snapshot, later: Snapshot): bool = later.phase == Published or later.phase == SnapshotFailed
pure val fair_readInventory = "weak"
pure val fair_readActivity = "weak"
pure val fair_publish = "weak"
pure val itemsValues = Set(0, 2)

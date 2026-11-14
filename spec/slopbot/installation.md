# Slopbot GitHub App installation lifecycle

PRD section 5 limits Slopbot to registered repositories where the project
installed the App. CLAUDE.md requires permanent repository and actor IDs.
Source is `workers/slopbot/index.ts` (`handleInstallation`),
`workers/slopbot/persistence.ts` (`claimInstallationDelivery`,
`completeInstallationDelivery`, `installationActive`),
`migrations/0013_slopbot.sql` and `backend/notifications/events.ts`
(`notifySlopbotInstallationLost`) at the pinned development revision. The
retained `bot_installation_lifecycle` model covers the same ordering.

This unit owns one installation row: whether it is known, removed or
suspended, the GitHub source time of its last applied change, the delivery
IDs whose installation change committed, and the owner notices for a lost
installation. The [webhook](./webhookDelivery.md) owns signature and receipt
checks before this unit runs. The webhook adapter parses the event kind,
the account and `installation.updated_at` from authenticated bytes.

## Story: Apply installation changes in GitHub's order

### An older or tied change cannot revive a removed or suspended installation

`created` and `new_permissions_accepted` upsert the row. They clear removal
and keep any suspension. `deleted` removes, `suspend` suspends and
`unsuspend` clears only the suspension. A change applies only when its
GitHub source time is later than the stored one. At an equal time, removal
applies unless the row is already removed. Suspension applies only to a row
that is neither removed nor suspended. An upsert or `unsuspend` never
applies at an equal time, so removal wins a tie. A first change for an
unknown installation inserts the row in the state that change names.
A delivery without an account completes without a change. A delivery whose
source time is missing or invalid fails without recording completion, so
GitHub's redelivery may retry it.

```quint
type InstallEventKind = Created | PermissionsAccepted | Deleted | Suspend | Unsuspend | OtherInstallAction
type InstallEvent = { delivery: int, kind: InstallEventKind, sourceTime: int, hasAccount: bool, validTime: bool }
type Installation = { known: bool, suspended: bool, removed: bool, sourceTime: int,
  processed: List[int], lostNotices: int, failures: int }
pure val initial: Installation = { known: false, suspended: false, removed: false, sourceTime: 0,
  processed: List(), lostNotices: 0, failures: 0 }
pure def newer(i: Installation, e: InstallEvent): bool = not(i.known) or e.sourceTime > i.sourceTime
pure def tie(i: Installation, e: InstallEvent): bool = i.known and e.sourceTime == i.sourceTime
pure def applies(i: Installation, e: InstallEvent): bool =
  if (e.kind == Created or e.kind == PermissionsAccepted or e.kind == Unsuspend) newer(i, e)
  else if (e.kind == Deleted) newer(i, e) or (tie(i, e) and not(i.removed))
  else if (e.kind == Suspend) newer(i, e) or (tie(i, e) and not(i.removed) and not(i.suspended))
  else false
pure def changedBy(e: InstallEvent, i: Installation): Installation =
  if (not(applies(i, e))) i
  else if (e.kind == Created or e.kind == PermissionsAccepted)
    { ...i, known: true, removed: false, suspended: i.known and i.suspended, sourceTime: e.sourceTime }
  else if (e.kind == Deleted)
    { ...i, known: true, removed: true, suspended: i.known and i.suspended, sourceTime: e.sourceTime,
      lostNotices: i.lostNotices + 1 }
  else if (e.kind == Suspend)
    { ...i, known: true, suspended: true, removed: i.known and i.removed, sourceTime: e.sourceTime,
      lostNotices: i.lostNotices + 1 }
  else { ...i, known: true, suspended: false, removed: i.known and i.removed, sourceTime: e.sourceTime }
pure def canDeliver(i: Installation, e: InstallEvent): bool =
  e.delivery > 0 and not(i.processed.includes(e.delivery)) and e.sourceTime >= 0
pure def deliver(i: Installation, e: InstallEvent): Installation =
  if (not(e.hasAccount)) { ...i, processed: i.processed.append(e.delivery) }
  else if (not(e.validTime)) { ...i, failures: i.failures + 1 }
  else { ...changedBy(e, i), processed: i.processed.append(e.delivery) }
pure def lawOlderChangeIsIgnored(i: Installation, e: InstallEvent): bool =
  (i.known and e.sourceTime < i.sourceTime) implies changedBy(e, i) == i
pure def lawTieRemovalWins(i: Installation, e: InstallEvent): bool =
  (tie(i, e) and i.removed and e.kind != Deleted and e.kind != Suspend) implies changedBy(e, i).removed
pure def lawUpsertKeepsSuspension(i: Installation, e: InstallEvent): bool =
  (i.known and (e.kind == Created or e.kind == PermissionsAccepted)) implies changedBy(e, i).suspended == i.suspended
pure def lawUnsuspendNeverRestoresRemoval(i: Installation, e: InstallEvent): bool =
  (i.known and i.removed and e.kind == Unsuspend) implies changedBy(e, i).removed
pure def lawOtherActionsChangeNothing(i: Installation, e: InstallEvent): bool =
  e.kind == OtherInstallAction implies changedBy(e, i) == i
```

### Only an applied removal or suspension notifies the project owners

Each applied removal or suspension creates one idempotent notice per served
project and owner, keyed by installation, change time and project. A stale
or tied change that does not apply creates none. The notification service
owns the recipients and delivery. The count below stands for those notice
batches.

```quint
pure def lawStaleLossSendsNoNotice(i: Installation, e: InstallEvent): bool =
  not(applies(i, e)) implies changedBy(e, i).lostNotices == i.lostNotices
pure def lawAppliedLossSendsOneNotice(i: Installation, e: InstallEvent): bool =
  (applies(i, e) and (e.kind == Deleted or e.kind == Suspend)) implies changedBy(e, i).lostNotices == i.lostNotices + 1
```

### Every Slopbot effect requires an active installation

An active installation is known, not removed and not suspended. Review,
budget resume, value assessment, joint publication and historical import
refuse otherwise. A removal or suspension does not delete history.
A later newer upsert restores a removed installation, and a later newer
`unsuspend` lifts a suspension.

```quint
pure def active(i: Installation): bool = i.known and not(i.removed) and not(i.suspended)
pure def alwaysUnknownIsEmpty(i: Installation): bool =
  not(i.known) implies not(i.removed) and not(i.suspended) and i.sourceTime == 0 and i.lostNotices == 0
pure def alwaysCounters(i: Installation): bool = i.sourceTime >= 0 and i.lostNotices >= 0 and i.failures >= 0
pure def stepSourceTimeNeverRewinds(before: Installation, after: Installation): bool =
  (before.known implies after.known and after.sourceTime >= before.sourceTime)
    and before.processed.every(d => after.processed.includes(d)) and after.lostNotices >= before.lostNotices
pure def sometimesActive(i: Installation): bool = active(i)
pure def sometimesSuspended(i: Installation): bool = i.known and i.suspended and not(i.removed)
pure def sometimesRemovedAndSuspended(i: Installation): bool = i.removed and i.suspended
pure def sometimesRestoredAfterLoss(i: Installation): bool = active(i) and i.lostNotices > 0
pure def sometimesInvalidTimeRetried(i: Installation): bool = i.failures > 0 and i.processed.length() > 0
pure val eValues = Set(
  { delivery: 1, kind: Created, sourceTime: 1, hasAccount: true, validTime: true },
  { delivery: 2, kind: Deleted, sourceTime: 2, hasAccount: true, validTime: true },
  { delivery: 3, kind: Created, sourceTime: 2, hasAccount: true, validTime: true },
  { delivery: 4, kind: Suspend, sourceTime: 2, hasAccount: true, validTime: true },
  { delivery: 5, kind: Unsuspend, sourceTime: 3, hasAccount: true, validTime: true },
  { delivery: 6, kind: PermissionsAccepted, sourceTime: 4, hasAccount: true, validTime: true },
  { delivery: 7, kind: Deleted, sourceTime: 1, hasAccount: true, validTime: true },
  { delivery: 8, kind: Suspend, sourceTime: 5, hasAccount: true, validTime: false },
  { delivery: 9, kind: OtherInstallAction, sourceTime: 5, hasAccount: false, validTime: true })
pure val iValues = Set(initial, { ...initial, known: true, sourceTime: 2 },
  { ...initial, known: true, removed: true, sourceTime: 2, lostNotices: 1 },
  { ...initial, known: true, suspended: true, sourceTime: 2, lostNotices: 1 })
```

# Frozen review frontier

PRD sections 4 and 5. The discovery report gives reviewer work a fixed
cutoff (legacy `contributor_review_epoch`). Each pull request head in the
frozen frontier needs one terminal disposition before a single lower-tier
outcome is permitted. Items that arrive after the cutoff stay deferred to a
later epoch.

## Story: Dispose of every frozen head before any lower-tier outcome

### Each exact frozen head gets one disposition, including an explicit stale-head disposition

A disposition must name the exact head that was frozen. A head that moved
since the cutoff is disposed of explicitly as stale. A deferred item is not
part of this epoch.

```quint
type FrontierItem = { item: int, head: int, deferred: bool, disposed: bool, stale: bool }
type ReviewEpoch = { frozen: bool, items: List[FrontierItem], permitted: bool }
pure val initial: ReviewEpoch = { frozen: false, items: List(), permitted: false }
pure def canFreeze(e: ReviewEpoch, frontier: List[FrontierItem]): bool = not(e.frozen) and frontier.length() > 0
  and frontier.every(i => i.item > 0 and i.head > 0 and not(i.disposed) and not(i.stale)
    and frontier.select(j => j.item == i.item).length() == 1)
pure def freeze(e: ReviewEpoch, frontier: List[FrontierItem]): ReviewEpoch = { ...e, frozen: true, items: frontier }
pure def canDispose(e: ReviewEpoch, itemId: int, frozenHead: int, currentHead: int): bool = e.frozen and not(e.permitted)
  and e.items.some(i => i.item == itemId and not(i.deferred) and not(i.disposed) and i.head == frozenHead)
pure def dispose(e: ReviewEpoch, itemId: int, frozenHead: int, currentHead: int): ReviewEpoch =
  { ...e, items: e.items.listMap(i => if (i.item == itemId) { ...i, disposed: true, stale: currentHead != frozenHead } else i) }
pure def frontierDone(e: ReviewEpoch): bool = e.items.every(i => i.deferred or i.disposed)
pure def canPermit(e: ReviewEpoch): bool = e.frozen and not(e.permitted) and frontierDone(e)
pure def permit(e: ReviewEpoch): ReviewEpoch = { ...e, permitted: true }
pure def alwaysPermitNeedsFrontier(e: ReviewEpoch): bool = e.permitted implies e.frozen and frontierDone(e)
pure def alwaysStaleIsDisposed(e: ReviewEpoch): bool = e.items.every(i => (i.stale implies i.disposed) and not(i.deferred and i.disposed))
pure def stepFrontierFrozen(before: ReviewEpoch, after: ReviewEpoch): bool = before.frozen implies
  after.items.length() == before.items.length() and before.items.every(i => after.items.some(j => j.item == i.item and j.head == i.head and j.deferred == i.deferred))
pure def sometimesPermittedWithStale(e: ReviewEpoch): bool = e.permitted and e.items.some(i => i.stale)
pure def sometimesPermittedWithDeferred(e: ReviewEpoch): bool = e.permitted and e.items.some(i => i.deferred)
pure val itemA: FrontierItem = { item: 1, head: 1, deferred: false, disposed: false, stale: false }
pure val frontierValues = Set(List(itemA, { ...itemA, item: 2 }), List(itemA, { ...itemA, item: 3, deferred: true }))
pure val itemIdValues = Set(1, 2, 3)
pure val frozenHeadValues = Set(1, 2)
pure val currentHeadValues = Set(1, 2)

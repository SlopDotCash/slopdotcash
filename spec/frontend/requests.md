# Asynchronous reads and recovery

PRD sections 2, 7, 9 and 12. This machine is the shared read lifecycle for a
single resource identity. Resource keys include the relevant project, account,
case, wallet, network, asset and revision. Callers allocate a new lifetime when
any identity component changes. Independent resources have independent machines.

## Story: Read current data without losing the last good result

### Loading, empty, stale, denied, invalid and unavailable remain distinct

```quint
type ReadStatus = Idle | Loading | Current | Empty | Stale | Denied | Invalid | Unavailable | Failed | Cancelled
type ReadResult = HasRows | NoRows | BadData | NoAuthority | NoService | ReadError
type ReadState = { status: ReadStatus, resource: int, lifetime: int, requestId: int, rows: int, hasSnapshot: bool, pending: bool }
pure val initial: ReadState = { status: Idle, resource: 0, lifetime: 0, requestId: 0, rows: 0, hasSnapshot: false, pending: false }
```

### Changing a resource clears its data and invalidates in-flight results

Cancellation stops local ownership. A remote operation's outcome still needs
reconciliation in the owning backend machine.

```quint
pure def canSelectResource(r: ReadState, resourceId: int): bool = resourceId > 0 and resourceId != r.resource
pure def selectResource(r: ReadState, resourceId: int): ReadState = {
  status: Idle, resource: resourceId, lifetime: r.lifetime + 1,
  requestId: r.requestId + 1, rows: 0, hasSnapshot: false, pending: false
}
pure def canRequest(r: ReadState): bool = r.resource > 0 and not(r.pending)
pure def request(r: ReadState): ReadState = {
  ...r, status: Loading, requestId: r.requestId + 1, pending: true
}
pure def canCancel(r: ReadState): bool = r.pending
pure def cancel(r: ReadState): ReadState = {
  ...r, pending: false, status: if (r.hasSnapshot) Stale else Cancelled,
  requestId: r.requestId + 1
}
```

### Only the current request may publish its validated result

Refresh failure retains a last good public snapshot with stale status.
Authorization denial clears rows. Private caches are also cleared by their
account and role lifetime, as required by the navigation machine.

```quint
pure def canReceive(r: ReadState, resourceId: int, lifetimeId: int, responseId: int, result: ReadResult, count: int): bool =
  r.pending and resourceId == r.resource and lifetimeId == r.lifetime and responseId == r.requestId and
  count >= 0 and (result == HasRows implies count > 0) and (result == NoRows implies count == 0)
pure def receive(r: ReadState, resourceId: int, lifetimeId: int, responseId: int, result: ReadResult, count: int): ReadState = {
  ...r, pending: false,
  rows: if (result == HasRows) count else if (result == NoAuthority or result == NoRows) 0 else r.rows,
  hasSnapshot: if (result == HasRows or result == NoRows) true else if (result == NoAuthority) false else r.hasSnapshot,
  status: match result {
    | HasRows => Current
    | NoRows => Empty
    | NoAuthority => Denied
    | BadData => if (r.hasSnapshot) Stale else Invalid
    | NoService => if (r.hasSnapshot) Stale else Unavailable
    | ReadError => if (r.hasSnapshot) Stale else Failed
  }
}
```

### Empty and denied never display retained rows as current data

```quint
pure def alwaysReadShape(r: ReadState): bool = r.rows >= 0 and r.requestId >= 0 and r.lifetime >= 0 and
  (r.pending iff r.status == Loading) and
  (r.status == Current implies r.hasSnapshot and r.rows > 0) and
  (r.status == Empty implies r.hasSnapshot and r.rows == 0) and
  (r.status == Denied implies not(r.hasSnapshot) and r.rows == 0) and
  (r.status == Stale implies r.hasSnapshot)
pure def sometimesCurrent(r: ReadState): bool = r.status == Current
pure def sometimesEmpty(r: ReadState): bool = r.status == Empty
pure def sometimesStale(r: ReadState): bool = r.status == Stale
pure def sometimesDenied(r: ReadState): bool = r.status == Denied
pure def sometimesInvalid(r: ReadState): bool = r.status == Invalid
pure def sometimesUnavailable(r: ReadState): bool = r.status == Unavailable
pure def sometimesFailed(r: ReadState): bool = r.status == Failed
pure def sometimesCancelled(r: ReadState): bool = r.status == Cancelled
pure val resourceIdValues = Set(1, 2)
pure val countValues = Set(0, 1, 2)
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val lifetimeIdValues = Set(0, 1, 2, 3)
pure val responseIdValues = Set(0, 1, 2, 3)
```

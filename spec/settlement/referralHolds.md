# Referral holds

PRD section 11 lets the operator exclude a project from future referral
accruals with a public reason. Source anchors are development migration
`0086_referral_accruals.sql` (`referral_holds`, its `lift_only` and
`no_delete` triggers), `workers/referral-accrual/store.ts` (`activeHold`)
and `workers/referral-accrual/core.ts` (`judge`). The
[accrual ledger](./referralAccrual.md) reads the result as the frozen
`held` fact of each source payout.

Owner decision pending (OD4): whether holds get a product route or an admin
page. This specification models the default, which keeps production
behaviour: an operator writes hold rows directly, outside every product
route, and no product code writes them.

## Story: Hold a project's later accruals with a public reason

### An operator hold zeroes a project's later accruals until its single lift, and no hold is ever deleted

A hold names the project, a reason of 1 to 1,000 characters, the acting
operator's immutable account and its creation time. Lifting sets the lift
time and a lift reason of 1 to 1,000 characters together, exactly once;
nothing else about a hold ever changes and no hold is deleted. A project is
held while any of its holds is unlifted; the earliest unlifted hold is the
one an accrual run reports, as `<hold id>: <reason>` cut to 500 characters
on its zero `Held` record. Filed accruals never change when a hold is placed
or lifted: the ledger freezes the hold evidence once per run.

```quint
type Hold = { id: int, project: int, reasonLength: int, actor: int, createdAt: int,
  lifted: bool, liftReasonLength: int, liftedAt: int }
type Holds = { rows: List[Hold], now: int }
pure val initial: Holds = { rows: List(), now: 1 }
pure val noHold: Hold = { id: 0, project: 0, reasonLength: 0, actor: 0, createdAt: 0, lifted: false, liftReasonLength: 0, liftedAt: 0 }
pure def validReason(textLength: int): bool = textLength >= 1 and textLength <= 1000
pure def canObserveClock(h: Holds, now: int): bool = now > h.now
pure def observeClock(h: Holds, now: int): Holds = { ...h, now: now }
pure def canPlaceHold(h: Holds, id: int, project: int, reasonLength: int, actor: int, by: str): bool =
  by == "operator" and id > 0 and project > 0 and actor > 0 and validReason(reasonLength)
    and not(h.rows.some(r => r.id == id))
pure def placeHold(h: Holds, id: int, project: int, reasonLength: int, actor: int, by: str): Holds =
  { ...h, rows: h.rows.append({ ...noHold, id: id, project: project, reasonLength: reasonLength, actor: actor, createdAt: h.now }) }
pure def canLiftHold(h: Holds, id: int, liftReasonLength: int, by: str): bool =
  by == "operator" and validReason(liftReasonLength) and h.rows.some(r => r.id == id and not(r.lifted))
pure def liftHold(h: Holds, id: int, liftReasonLength: int, by: str): Holds =
  { ...h, rows: h.rows.listMap(r => if (r.id == id) { ...r, lifted: true, liftReasonLength: liftReasonLength, liftedAt: h.now } else r) }
pure def activeHold(h: Holds, project: int): Hold =
  h.rows.select(r => r.project == project and not(r.lifted)).nthOr(0, noHold)
pure def projectHeld(h: Holds, project: int): bool = activeHold(h, project).id > 0
```

### Holds keep their identity, reason and single lift for ever

The observed clock is always positive, and each hold keeps a unique positive identifier, valid reason lengths, monotonic timestamps and at most one lift.

```quint
pure def alwaysHoldsWellFormed(h: Holds): bool = h.now > 0 and h.rows.every(r => r.id > 0 and r.project > 0 and r.actor > 0
  and validReason(r.reasonLength) and r.createdAt > 0 and r.createdAt <= h.now
  and (r.lifted == validReason(r.liftReasonLength)) and (r.lifted == (r.liftedAt > 0))
  and (r.lifted implies r.liftedAt >= r.createdAt and r.liftedAt <= h.now)
  and h.rows.select(o => o.id == r.id).length() == 1)
pure def stepHoldsPermanent(before: Holds, after: Holds): bool = before.rows.every(r => after.rows.some(n =>
  n.id == r.id and n.project == r.project and n.reasonLength == r.reasonLength and n.actor == r.actor
    and n.createdAt == r.createdAt and (r.lifted implies n == r)))
pure def sometimesHeld(h: Holds): bool = h.rows.some(r => projectHeld(h, r.project))
pure def sometimesLiftedThenHeldAgain(h: Holds): bool = h.rows.some(r => r.lifted) and h.rows.some(r => not(r.lifted))
```

### Simulation samples

```quint
pure val byValues = Set("operator", "wrong")
pure val idValues = Set(1, 2)
pure val projectValues = Set(1)
pure val reasonLengthValues = Set(0, 1, 1001)
pure val liftReasonLengthValues = Set(0, 5)
pure val actorValues = Set(0, 7)
pure val nowValues = Set(2, 3)
```

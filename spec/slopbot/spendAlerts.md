# Slopbot spending milestones and provider notices

PRD section 5 requires alerts-only spending with an operator email at each
crossed $500 monthly milestone, alerts on low Surplus balance and provider
failures, and free review with no project charge. Surplus's own balance
notification is the low-balance alert. Source is
`workers/slopbot/spend-alerts.ts`, `workers/slopbot/failure-alerts.ts`,
`workers/slopbot/persistence.ts` (`recordCalls`) and migrations
`0013_slopbot.sql`, `0047_slopbot_review_billing.sql`,
`0049_slopbot_spend_alerts.sql`, `0085_slopbot_provider_failure_notices.sql`,
`0122_orbio_provider_failure_notices.sql` and
`0133_slopbot_failure_notice_suppressions.sql` at development 67fd54fd4. The retained `bot_notice_delivery` model covers the same claims.

This unit owns the global provider cost ledger shared by
[review](./review.md) and [value inference](./valueInference.md), the
milestone claims and their receipts, and the provider failure notice
queue. The notification service owns transport. Amounts are integer
micro-USD.

## Story: Keep one free cost ledger for every provider call

### Each new call appends an immutable cost row with zero customer charge

Every review and value call appends one row with its provider, outcome and
internal cost. The provider-reported amount takes precedence over the
estimate, including a reported zero. Each new row bills zero, so no project
or vault pays for Slopbot. Rows written before the free-review migration
keep their original billed amounts. Each row also keeps its job (the review
key and call kind), the requested model, the recorded failure text and its
time. A new failed Orbio or Surplus call queues one failure notice.
Historical rows never become a notice backlog.

```quint
type Provider = Orbio | Surplus
type FailureKind = NotFailed | BudgetExhausted | RequestFailed
type CallInput = { month: int, estimate: int, reported: int, providerReported: bool, provider: Provider, failure: FailureKind,
  job: int, model: str, cause: str, at: int }
type CostRow = { id: int, month: int, amount: int, provider: Provider, failure: FailureKind, billed: int, historical: bool,
  job: int, model: str, cause: str, at: int }
type Receipt = NoReceipt | Accepted | Ambiguous
type Suppression = NoSuppression | ServedByFallback | RepeatWithin6h
type Alert = { month: int, threshold: int, recorded: int, receipt: Receipt }
type FailureNotice = { call: int, claimed: bool, receipt: Receipt, suppressed: Suppression, recordedAt: int }
type Spend = { costs: List[CostRow], alerts: List[Alert], failures: List[FailureNotice] }
pure val interval = 500000000
pure val historicalRow: CostRow = { id: 1, month: 1, amount: 400000000, provider: Surplus, failure: RequestFailed,
  billed: 25, historical: true, job: 0, model: "", cause: "", at: 0 }
pure val initial: Spend = { costs: List(historicalRow), alerts: List(), failures: List() }
pure def amountOf(c: CallInput): int = if (c.providerReported) c.reported else c.estimate
pure def canRecordCall(s: Spend, c: CallInput): bool =
  c.month > 0 and c.estimate >= 0 and c.reported >= 0 and c.at >= 0
pure def recordCall(s: Spend, c: CallInput): Spend =
  val id = s.costs.length() + 1
  { ...s, costs: s.costs.append({ id: id, month: c.month, amount: amountOf(c), provider: c.provider,
      failure: c.failure, billed: 0, historical: false, job: c.job, model: c.model, cause: c.cause, at: c.at }),
    failures: if (c.failure != NotFailed)
      s.failures.append({ call: id, claimed: false, receipt: NoReceipt, suppressed: NoSuppression, recordedAt: 0 })
    else s.failures }
pure def lawReportedZeroWins(c: CallInput): bool = (c.providerReported and c.reported == 0) implies amountOf(c) == 0
pure def alwaysNewRowsAreFree(s: Spend): bool = s.costs.every(c => not(c.historical) implies c.billed == 0)
pure def alwaysRowsAreNumbered(s: Spend): bool =
  s.costs.every(c => c.id > 0 and c.id <= s.costs.length() and c.amount >= 0 and c.month > 0)
pure def alwaysEachNewFailureQueuedOnce(s: Spend): bool =
  s.costs.every(c => s.failures.select(n => n.call == c.id).length() ==
    (if (not(c.historical) and c.failure != NotFailed) 1 else 0))
```

## Story: Email each crossed monthly milestone once

### One claim per run, in order, and an ambiguous send is never resent

The month's total adds every row of that UTC month. A milestone is claimed
when the total reaches the largest claimed threshold of that month plus
$500. A run claims one milestone, so a large jump is reported over several
runs. A past month's milestone can still be claimed. The claim is durable
before the send. A send with an unknown outcome records `Ambiguous` and
needs operator reconciliation. It is never sent again automatically.

```quint
pure def monthTotal(s: Spend, month: int): int =
  s.costs.foldl(0, (sum, c) => sum + (if (c.month == month) c.amount else 0))
pure def claimedTop(s: Spend, month: int): int =
  s.alerts.foldl(0, (top, a) => if (a.month == month and a.threshold > top) a.threshold else top)
pure def canClaimMilestone(s: Spend, month: int): bool =
  month > 0 and monthTotal(s, month) >= claimedTop(s, month) + interval
pure def claimMilestone(s: Spend, month: int): Spend =
  { ...s, alerts: s.alerts.append({ month: month, threshold: claimedTop(s, month) + interval,
    recorded: monthTotal(s, month), receipt: NoReceipt }) }
pure def canDeliverMilestone(s: Spend, month: int, threshold: int, accepted: bool): bool =
  s.alerts.some(a => a.month == month and a.threshold == threshold and a.receipt == NoReceipt)
pure def deliverMilestone(s: Spend, month: int, threshold: int, accepted: bool): Spend =
  { ...s, alerts: s.alerts.listMap(a => if (a.month == month and a.threshold == threshold)
    { ...a, receipt: if (accepted) Accepted else Ambiguous } else a) }
pure def alwaysEachMilestoneOnce(s: Spend): bool =
  s.alerts.every(a => s.alerts.select(b => b.month == a.month and b.threshold == a.threshold).length() == 1)
pure def alwaysMilestoneWasReached(s: Spend): bool =
  s.alerts.every(a => a.threshold > 0 and a.threshold % interval == 0 and a.recorded >= a.threshold
    and monthTotal(s, a.month) >= a.threshold)
pure def alwaysMilestonesConsecutive(s: Spend): bool =
  s.alerts.every(a => a.threshold == interval
    or s.alerts.some(b => b.month == a.month and b.threshold == a.threshold - interval))
pure def stepReceiptsAreFinal(before: Spend, after: Spend): bool =
  before.alerts.every(a => a.receipt != NoReceipt implies after.alerts.includes(a))
    and before.failures.every(n => n.receipt != NoReceipt implies after.failures.includes(n))
pure def sometimesMilestoneAccepted(s: Spend): bool = s.alerts.some(a => a.receipt == Accepted)
pure def sometimesMilestoneAmbiguous(s: Spend): bool = s.alerts.some(a => a.receipt == Ambiguous)
pure def sometimesSecondMilestone(s: Spend): bool = s.alerts.some(a => a.threshold == 2 * interval)
```

### A failed call notice is claimed before it is sent

The notice carries only the call ID, model, failure kind and time, never a
prompt, response, key or request identifier. A Surplus spending denial is
`BudgetExhausted`; every other failure is `RequestFailed`. The claim
precedes the send, so an overlapping run cannot send it twice.

```quint
pure def canClaimFailure(s: Spend, call: int, now: int): bool =
  s.failures.some(n => n.call == call and not(n.claimed)) and routeSettled(s, call, now)
    and not(s.failures.some(n => n.call < call and not(n.claimed) and routeSettled(s, n.call, now)))
pure def claimFailure(s: Spend, call: int, now: int): Spend =
  { ...s, failures: s.failures.listMap(n => if (n.call == call)
    { ...n, claimed: true, suppressed: suppressionOf(s, call, now) } else n) }
pure def canDeliverFailure(s: Spend, call: int, accepted: bool, now: int): bool =
  s.failures.some(n => n.call == call and n.claimed and n.suppressed == NoSuppression and n.receipt == NoReceipt)
pure def deliverFailure(s: Spend, call: int, accepted: bool, now: int): Spend =
  { ...s, failures: s.failures.listMap(n => if (n.call == call)
    { ...n, receipt: if (accepted) Accepted else Ambiguous, recordedAt: now } else n) }
pure def alwaysReceiptFollowsClaim(s: Spend): bool = s.failures.every(n => n.receipt != NoReceipt implies n.claimed)
pure def sometimesFailureNoticeSent(s: Spend): bool = s.failures.some(n => n.receipt == Accepted)
```

### A failed call notice is sent only after its route settled, and a served or repeated failure is suppressed

Operator decision of 17 November 2026 (`failure-alerts.ts`,
`dispatchFailureAlert`; migration `0133`). A notice is claimed only once
its call is at least 120 seconds old, so the rest of its route is recorded
first, and a run takes the lowest such call ID first. At the claim it is
suppressed, with its reason recorded and no email, when its failure is not
a spending denial and a later call (higher ID) of the same job succeeded
(`ServedByFallback`), or when an email for a call with the same requested
model and the same failure text was accepted in the last 21,600 seconds
(`RepeatWithin6h`). A suppressed notice is never sent later. One scheduled
run claims at most 200 suppressed notices and sends at most one email; the
shell's loop keeps those bounds. Every notice names the new failed call row
it was queued for: a trigger on the insert of a failed `slopbot_costs` row
queues it under that row's ID (migrations `0085` and `0122`).

```quint
pure val settleSeconds = 120
pure val repeatSeconds = 21600
pure val maxSuppressionsPerRun = 200
pure def costOf(s: Spend, call: int): CostRow = s.costs.select(c => c.id == call).nthOr(0, historicalRow)
pure def routeSettled(s: Spend, call: int, now: int): bool = costOf(s, call).at + settleSeconds <= now
pure def suppressionOf(s: Spend, call: int, now: int): Suppression =
  val c = costOf(s, call)
  if (c.failure != BudgetExhausted and s.costs.some(o => o.job == c.job and o.id > c.id and o.failure == NotFailed))
    ServedByFallback
  else if (s.failures.some(m => m.receipt == Accepted and m.recordedAt >= now - repeatSeconds
    and costOf(s, m.call).model == c.model and costOf(s, m.call).cause == c.cause)) RepeatWithin6h
  else NoSuppression
pure def alwaysSuppressedNeverSent(s: Spend): bool =
  s.failures.every(n => n.suppressed != NoSuppression implies (n.receipt == NoReceipt and n.claimed))
pure def alwaysBudgetDenialNeverServedByFallback(s: Spend): bool =
  s.failures.every(n => costOf(s, n.call).failure == BudgetExhausted implies n.suppressed != ServedByFallback)
pure def alwaysNoticesNameNewRows(s: Spend): bool =
  s.failures.every(n => n.call > 0 and n.call <= s.costs.length() and not(costOf(s, n.call).historical)
    and costOf(s, n.call).failure != NotFailed)
pure def sometimesServedByFallback(s: Spend): bool = s.failures.some(n => n.suppressed == ServedByFallback)
pure def sometimesRepeatSuppressed(s: Spend): bool = s.failures.some(n => n.suppressed == RepeatWithin6h)
```

### Surplus's own balance notification is the low-balance alert

Slopbot sends no low-balance notice and keeps no low-balance threshold:
development relies on Surplus's own balance notification and on the
budget-exhausted failure notice (`workers/notify/README.md`, "These notices
neither change provider budgets nor configure Surplus's own low-balance
notification threshold"). The only emails this unit sends are the monthly
milestones and the failure notices above.

```quint
pure val sampleCall: CallInput = { month: 1, estimate: 300000000, reported: 0, providerReported: false,
  provider: Orbio, failure: NotFailed, job: 1, model: "claude-sonnet-5.5", cause: "", at: 0 }
pure val cValues = Set(sampleCall, { ...sampleCall, month: 2 }, { ...sampleCall, providerReported: true },
  { ...sampleCall, provider: Surplus, failure: BudgetExhausted, estimate: 1000, cause: "provider budget exhausted" },
  { ...sampleCall, failure: RequestFailed, estimate: 600000000, cause: "provider returned HTTP 500" },
  { ...sampleCall, failure: RequestFailed, cause: "provider returned HTTP 500", job: 2, at: 100 })
pure val monthValues = Set(1, 2)
pure val thresholdValues = Set(500000000, 1000000000)
pure val callValues = Set(1, 2, 3, 4)
pure val nowValues = Set(60, 300, 30000)
pure val weight_recordCall = 5
pure val weight_claimMilestone = 4
```

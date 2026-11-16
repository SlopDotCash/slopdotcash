# Slopbot spending milestones and provider notices

PRD section 5 requires alerts-only spending with an operator email at each
crossed $500 monthly milestone, alerts on low Surplus balance and provider
failures, and free review with no project charge. Source is
`workers/slopbot/spend-alerts.ts`, `workers/slopbot/failure-alerts.ts`,
`workers/slopbot/persistence.ts` (`recordCalls`) and migrations
`0013_slopbot.sql`, `0047_slopbot_review_billing.sql`,
`0049_slopbot_spend_alerts.sql`, `0085_slopbot_provider_failure_notices.sql`
and `0122_orbio_provider_failure_notices.sql` at the pinned development
revision. The retained `bot_notice_delivery` model covers the same claims.

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
keep their original billed amounts. A new failed Orbio or Surplus call
queues one failure notice. Historical rows never become a notice backlog.

```quint
type Provider = Orbio | Surplus
type FailureKind = NotFailed | BudgetExhausted | RequestFailed
type CallInput = { month: int, estimate: int, reported: int, providerReported: bool, provider: Provider, failure: FailureKind }
type CostRow = { id: int, month: int, amount: int, provider: Provider, failure: FailureKind, billed: int, historical: bool }
type Receipt = NoReceipt | Accepted | Ambiguous
type Alert = { month: int, threshold: int, recorded: int, receipt: Receipt }
type FailureNotice = { call: int, claimed: bool, receipt: Receipt }
type BalanceObservation = { month: int, verifiedProviderReport: bool, balance: int }
type OwnerThreshold = { recorded: bool, threshold: int }
type Spend = { costs: List[CostRow], alerts: List[Alert], failures: List[FailureNotice],
  lowBalanceThreshold: int, lowBalanceNotices: List[int] }
pure val interval = 500000000
pure val historicalRow: CostRow = { id: 1, month: 1, amount: 400000000, provider: Surplus, failure: RequestFailed,
  billed: 25, historical: true }
pure val initial: Spend = { costs: List(historicalRow), alerts: List(), failures: List(),
  lowBalanceThreshold: 0, lowBalanceNotices: List() }
pure def amountOf(c: CallInput): int = if (c.providerReported) c.reported else c.estimate
pure def canRecordCall(s: Spend, c: CallInput): bool =
  c.month > 0 and c.estimate >= 0 and c.reported >= 0
pure def recordCall(s: Spend, c: CallInput): Spend =
  val id = s.costs.length() + 1
  { ...s, costs: s.costs.append({ id: id, month: c.month, amount: amountOf(c), provider: c.provider,
      failure: c.failure, billed: 0, historical: false }),
    failures: if (c.failure != NotFailed) s.failures.append({ call: id, claimed: false, receipt: NoReceipt }) else s.failures }
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
pure def canClaimFailure(s: Spend, call: int): bool = s.failures.some(n => n.call == call and not(n.claimed))
pure def claimFailure(s: Spend, call: int): Spend =
  { ...s, failures: s.failures.listMap(n => if (n.call == call) { ...n, claimed: true } else n) }
pure def canDeliverFailure(s: Spend, call: int, accepted: bool): bool =
  s.failures.some(n => n.call == call and n.claimed and n.receipt == NoReceipt)
pure def deliverFailure(s: Spend, call: int, accepted: bool): Spend =
  { ...s, failures: s.failures.listMap(n => if (n.call == call) { ...n, receipt: if (accepted) Accepted else Ambiguous } else n) }
pure def alwaysReceiptFollowsClaim(s: Spend): bool = s.failures.every(n => n.receipt != NoReceipt implies n.claimed)
pure def sometimesFailureNoticeSent(s: Spend): bool = s.failures.some(n => n.receipt == Accepted)
```

### A low Surplus balance notice waits for an owner-approved threshold

The development worker relies on Surplus's own balance notification and on
budget-exhausted failure notices. No owner decision sets a Slopbot low
balance threshold. Until one is recorded, the threshold is zero and no
low-balance notice is produced. After it is recorded, a verified provider
balance report below it produces one notice per month.

```quint
pure def canRecordLowBalanceThreshold(s: Spend, decision: OwnerThreshold): bool =
  decision.recorded and decision.threshold > 0 and s.lowBalanceThreshold == 0
pure def recordLowBalanceThreshold(s: Spend, decision: OwnerThreshold): Spend = { ...s, lowBalanceThreshold: decision.threshold }
pure def canNoticeLowBalance(s: Spend, report: BalanceObservation): bool =
  s.lowBalanceThreshold > 0 and report.verifiedProviderReport and report.month > 0
    and report.balance < s.lowBalanceThreshold and not(s.lowBalanceNotices.includes(report.month))
pure def noticeLowBalance(s: Spend, report: BalanceObservation): Spend =
  { ...s, lowBalanceNotices: s.lowBalanceNotices.append(report.month) }
pure def alwaysLowBalanceNeedsThreshold(s: Spend): bool =
  s.lowBalanceNotices.length() > 0 implies s.lowBalanceThreshold > 0
pure def sometimesLowBalanceNotice(s: Spend): bool = s.lowBalanceNotices.length() > 0
pure val sampleCall: CallInput = { month: 1, estimate: 300000000, reported: 0, providerReported: false,
  provider: Orbio, failure: NotFailed }
pure val cValues = Set(sampleCall, { ...sampleCall, month: 2 }, { ...sampleCall, providerReported: true },
  { ...sampleCall, provider: Surplus, failure: BudgetExhausted, estimate: 1000 },
  { ...sampleCall, failure: RequestFailed, estimate: 600000000 })
pure val monthValues = Set(1, 2)
pure val thresholdValues = Set(500000000, 1000000000)
pure val callValues = Set(1, 2, 3, 4)
pure val decisionValues = Set({ recorded: true, threshold: 50000000 }, { recorded: false, threshold: 50000000 })
pure val reportValues = Set({ month: 1, verifiedProviderReport: true, balance: 1000 },
  { month: 1, verifiedProviderReport: false, balance: 1000 }, { month: 2, verifiedProviderReport: true, balance: 90000000 })
pure val weight_recordCall = 5
pure val weight_claimMilestone = 4
```

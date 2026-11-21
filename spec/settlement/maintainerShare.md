# Maintainer share of a monthly amount

PRD section 6 (operator decision, 18 November 2026): a project owner may set
a maintainer share of 0 to 30% of the monthly amount, stored in basis points
as `reward.maintainerShare`; absent is none. It is taken out of the monthly
amount before the Points split and divided among the GitHub accounts that
merged or closed another person's outside pull request in the project's
counted repositories during that UTC month, in proportion to the number each
decided. Sources at Slop development `ac54042a8`:
`src/lib/payments/maintainer-share.ts` (`maintainerShare`,
`assertMaintainerDecisionRecord`), `src/lib/maintainer-share.mjs`,
`scripts/maintainer-decisions.ts`, `scripts/prepare-monthly-rewards.ts`,
`migrations/0137_monthly_maintainer_shares.sql` and the retained model
`formal/models/rewards/maintainer_share.qnt`.

One instance is one project month, from its opening to its proposal, with
the owner's setting carried across months. [Reward weights and payout
exclusions](./payoutExclusions.md) supplies the exclusion list and the
UTC-month arithmetic, [full-width largest remainder](./allocation.md)
divides the share, and [monthly allocations](./monthly.md) owns the
proposal rows, the owner's later changes and cuts, and the cutoff, which
apply to these amounts as to any other. The project setting itself is a
field of the [project registry](../backend/projects.md) revision.

## Story: Take the maintainer share out of the monthly amount

> As a project owner, I want the people who decide outside pull requests to
> receive a published part of the monthly amount, so that reviewing outside
> work is paid without the month paying out more than its amount.

### Only another person's outside pull request, merged or closed by a person, is a decision

The deciding account is the one GitHub records as merging or closing the
pull request. GitHub lets only an account with maintainer rights merge or
close another person's pull request, so no permission list is read. The
author's own close, a merge or close by a bot, and a pull request whose
author is an owner, member or collaborator or a bot count for nobody. A
merge and a close count the same, and a reopened pull request counts once,
for its last close: the record holds each pull request at most once. A
record is the complete read of one project month: it names that month and
exactly the repositories the project counted, every decision falls in that
month, and it lists each deciding account once.

```quint
import money as M from "./money"
import allocation as A from "./allocation"
import payoutExclusions as X from "./payoutExclusions"
type DecisionKind = MergedByMaintainer | ClosedByMaintainer
type Decision = { repository: int, pull: int, author: int, authorOutside: bool, decider: int, deciderBot: bool,
  kind: DecisionKind, period: int }
type DecisionRecord = { period: int, repositories: List[int], deciders: List[int], decisions: List[Decision], digest: str }
pure def countedDecision(d: Decision): bool = d.authorOutside and not(d.deciderBot) and d.decider != d.author and d.decider > 0
pure def validRecord(record: DecisionRecord, period: int, repositories: List[int]): bool =
  record.period == period and record.repositories == repositories and record.digest != ""
    and record.decisions.every(d => d.period == period and repositories.includes(d.repository) and d.pull > 0
      and record.decisions.select(o => o.repository == d.repository and o.pull == d.pull).length() == 1
      and record.deciders.includes(d.decider))
    and record.deciders.every(a => a > 0 and record.deciders.select(o => o == a).length() == 1
      and record.decisions.some(d => d.decider == a))
pure def lawOwnCloseAndBotsCountForNobody(d: Decision): bool =
  (d.decider == d.author or d.deciderBot or not(d.authorOutside)) implies not(countedDecision(d))
```

### The share is a floor of the monthly amount and is split by decisions with ties to the lower account

Each deciding account weighs the number of its counted decisions. An account
on the payout exclusion list for the month is left out, so its decisions
count for nobody. The share is the monthly amount times the basis points,
divided by 10,000 and rounded down, in the asset's base units; with no
counted decision, or a share of zero, it is zero and the whole amount stays
with contributors. The share is divided by largest remainder, equal
remainders going to the lower GitHub actor ID ([allocation](./allocation.md),
`portionBefore`).

```quint
pure val maxShareBasisPoints = 3000
pure val basisPointsDivisor = 10000
pure def decisionsBy(record: DecisionRecord, actor: int): int =
  record.decisions.select(d => d.decider == actor and countedDecision(d)).length()
pure def shareWeights(record: DecisionRecord, exclusions: List[X::Exclusion]): List[A::Weight] =
  record.deciders.select(a => a > 0 and decisionsBy(record, a) > 0 and not(X::excludedIn(exclusions, a, record.period)))
    .listMap(a => { actor: a, weight: M::smallAmount(decisionsBy(record, a)) })
pure def sharePool(amount: M::Amount, basisPoints: int, weights: List[A::Weight]): M::Amount =
  if (weights.length() == 0 or basisPoints <= 0) M::zero
  else M::divideAmounts(M::multiplyAmounts(amount, M::smallAmount(basisPoints)), M::smallAmount(basisPointsDivisor)).quotient
pure def maintainerShares(pool: M::Amount, weights: List[A::Weight]): List[A::Share] =
  if (M::positiveAmount(pool)) A::allocateAmounts(pool, weights) else List()
pure def lawExcludedAccountHasNoWeight(record: DecisionRecord, exclusions: List[X::Exclusion], actor: int): bool =
  X::excludedIn(exclusions, actor, record.period) implies not(shareWeights(record, exclusions).some(w => w.actor == actor))
pure def lawNoCountedDecisionNoShare(amount: M::Amount, basisPoints: int, record: DecisionRecord, exclusions: List[X::Exclusion]): bool =
  shareWeights(record, exclusions).length() == 0 implies sharePool(amount, basisPoints, shareWeights(record, exclusions)) == M::zero
pure def lawZeroShareNoPool(amount: M::Amount, record: DecisionRecord, exclusions: List[X::Exclusion]): bool =
  sharePool(amount, 0, shareWeights(record, exclusions)) == M::zero
```

### A change starts with the next UTC month, and a month is proposed only from a complete read

The owner's revision sets the share for later months; the month in which it
is made and every earlier month keep the share they had. After the month
closes, the trusted monthly workflow reads the decisions from public GitHub
data. A month with a share is proposed only from a complete read of exactly
that month and the project's counted repositories; a failed read proposes
nothing and is read again by a later run, and other projects are not held
back. A month without a share needs no read. The proposal stores the record's
digest, the share, each maintainer's amount and the amount left for the
Points split, and is never computed again.

```quint
type SharePhase = MonthOpen | MonthClosed | MonthProposed
type DecisionRead = NotRead | ReadFailed | ReadComplete
type ShareMonth = { phase: SharePhase, period: int, setting: int, monthShare: int, amount: M::Amount,
  repositories: List[int], exclusions: List[X::Exclusion], read: DecisionRead, record: DecisionRecord,
  pool: M::Amount, maintainers: List[A::Share], contributors: M::Amount }
pure val owner = "owner"
pure val workflow = "monthly-workflow"
pure val clock = "clock"
pure val noRecord: DecisionRecord = { period: 0, repositories: List(), deciders: List(), decisions: List(), digest: "" }
pure val initial: ShareMonth = { phase: MonthOpen, period: 202612, setting: 0, monthShare: 0, amount: M::zero,
  repositories: List(), exclusions: List(), read: NotRead, record: noRecord, pool: M::zero, maintainers: List(),
  contributors: M::zero }
pure def canSetShare(m: ShareMonth, basisPoints: int, by: str): bool =
  by == owner and basisPoints >= 0 and basisPoints <= maxShareBasisPoints
pure def setShare(m: ShareMonth, basisPoints: int, by: str): ShareMonth = { ...m, setting: basisPoints }
pure def canCloseMonth(m: ShareMonth, amount: M::Amount, repositories: List[int], exclusions: List[X::Exclusion], by: str): bool =
  by == clock and m.phase == MonthOpen and M::validAmount(amount) and repositories.length() > 0
pure def closeMonth(m: ShareMonth, amount: M::Amount, repositories: List[int], exclusions: List[X::Exclusion], by: str): ShareMonth =
  { ...m, phase: MonthClosed, amount: amount, repositories: repositories, exclusions: exclusions }
pure def readPending(m: ShareMonth): bool = m.phase == MonthClosed and m.monthShare > 0 and m.read != ReadComplete
pure def canReadFails(m: ShareMonth, by: str): bool = by == workflow and readPending(m)
pure def readFails(m: ShareMonth, by: str): ShareMonth = { ...m, read: ReadFailed }
pure def canReadCompletes(m: ShareMonth, record: DecisionRecord, by: str): bool =
  by == workflow and readPending(m) and validRecord(record, m.period, m.repositories)
pure def readCompletes(m: ShareMonth, record: DecisionRecord, by: str): ShareMonth = { ...m, read: ReadComplete, record: record }
pure def proposedPool(m: ShareMonth): M::Amount =
  sharePool(m.amount, m.monthShare, if (m.monthShare > 0) shareWeights(m.record, m.exclusions) else List())
pure def canPropose(m: ShareMonth, by: str): bool =
  by == workflow and m.phase == MonthClosed and (m.monthShare == 0 or m.read == ReadComplete)
    and M::compareAmounts(m.amount, proposedPool(m)) >= 0
pure def propose(m: ShareMonth, by: str): ShareMonth =
  val pool = proposedPool(m)
  { ...m, phase: MonthProposed, pool: pool, maintainers: maintainerShares(pool, shareWeights(m.record, m.exclusions)),
    contributors: M::subtractAmounts(m.amount, pool) }
pure def canNextMonth(m: ShareMonth, by: str): bool = by == clock and m.phase == MonthProposed
pure def nextMonth(m: ShareMonth, by: str): ShareMonth =
  { ...initial, period: X::nextPeriod(m.period), setting: m.setting, monthShare: m.setting }
```

### Rules

The month keeps the share it opened with. A proposed month distributes
exactly its amount: the maintainer amounts sum to the share, and the share
plus the contributors' amount is the monthly amount. A month with a share is
split only from a complete read, a complete read is the valid record of that
month and its counted repositories, and an excluded account receives nothing.

```quint
pure def alwaysShareWithinLimits(m: ShareMonth): bool =
  m.setting >= 0 and m.setting <= maxShareBasisPoints and m.monthShare >= 0 and m.monthShare <= maxShareBasisPoints
pure def stepShareStartsNextMonth(before: ShareMonth, via: str, after: ShareMonth): bool =
  via != "nextMonth" implies after.monthShare == before.monthShare
pure def alwaysAmountValid(m: ShareMonth): bool = M::validAmount(m.amount)
pure def alwaysProposalIsTheAmount(m: ShareMonth): bool = m.phase == MonthProposed implies
  M::equalAmounts(M::addAmounts(m.contributors, m.pool), m.amount)
pure def alwaysMaintainersSplitTheShare(m: ShareMonth): bool = m.phase == MonthProposed implies
  (m.maintainers.length() == 0 or M::equalAmounts(A::allocatedTotal(m.maintainers), m.pool))
pure def alwaysShareOnlyFromCompleteRead(m: ShareMonth): bool =
  (m.phase == MonthProposed and M::positiveAmount(m.pool)) implies (m.read == ReadComplete and m.monthShare > 0)
pure def alwaysCompleteReadIsTheMonth(m: ShareMonth): bool =
  m.read == ReadComplete implies validRecord(m.record, m.period, m.repositories)
pure def alwaysExcludedReceivesNothing(m: ShareMonth): bool = m.phase == MonthProposed implies
  m.maintainers.every(s => not(X::excludedIn(m.exclusions, s.actor, m.period)))
pure def alwaysReadOnlyForAShare(m: ShareMonth): bool = m.read != NotRead implies (m.monthShare > 0 and m.phase != MonthOpen)
pure def sometimesSplitBetweenMaintainers(m: ShareMonth): bool = m.phase == MonthProposed and m.maintainers.length() >= 2
pure def sometimesNoDecisionNoShare(m: ShareMonth): bool =
  m.phase == MonthProposed and m.monthShare > 0 and m.read == ReadComplete and M::positiveAmount(m.amount) and m.pool == M::zero
pure def sometimesHeldByFailedRead(m: ShareMonth): bool = m.phase == MonthClosed and m.read == ReadFailed
pure def sometimesExcludedLeftOut(m: ShareMonth): bool = m.phase == MonthProposed and m.maintainers.length() == 1
  and m.exclusions.length() > 0 and m.record.deciders.length() == 2
pure def sometimesChangeWaitsForNextMonth(m: ShareMonth): bool = m.phase == MonthProposed and m.setting != m.monthShare
```

### Simulation samples

```quint
pure val decided: Decision = { repository: 1, pull: 1, author: 9, authorOutside: true, decider: 1, deciderBot: false,
  kind: MergedByMaintainer, period: 202701 }
pure val recordValues = Set(
  { period: 202701, repositories: List(1), deciders: List(1, 2), digest: "r1",
    decisions: List(decided, { ...decided, pull: 2, decider: 2, kind: ClosedByMaintainer }, { ...decided, pull: 3, decider: 2 }) },
  { period: 202701, repositories: List(1), deciders: List(1), digest: "r2",
    decisions: List({ ...decided, author: 1, decider: 1, kind: ClosedByMaintainer }) },
  { period: 202612, repositories: List(1), deciders: List(1), digest: "r3", decisions: List({ ...decided, period: 202612 }) })
pure val basisPointsValues = Set(0, 2000, 3000, 3001)
pure val amountValues = Set(List(0), List(10), List(15))
pure val repositoriesValues = Set(List(1), List(1, 2))
pure val exclusionsValues = Set(List(), List({ actor: 1, relationship: X::ProjectOwner, fromPeriod: 202612, untilPeriod: 0 }))
pure val actorValues = Set(1, 2)
pure val dValues = Set(decided, { ...decided, decider: 9 }, { ...decided, deciderBot: true }, { ...decided, authorOutside: false })
pure val byValues = Set(owner, workflow, clock)
pure val weight_readCompletes = 4
pure val weight_propose = 3
pure val weight_closeMonth = 3
```

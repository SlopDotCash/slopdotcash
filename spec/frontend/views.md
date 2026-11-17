# Derived public views

PRD sections 6, 7 and 9. These are display-only projections over records the
browser has already read and validated: the registry, the public snapshot, the
cycle index and the Points journal. The merge activity line is a
[projection](./projections.md) of the stored
[merge activity](../backend/mergeActivity.md) rows. None of them changes a
score, an award, a payment or a project state. The shell parses each source
at its boundary (lowercasing GitHub logins, converting timestamps to UTC days
or milliseconds) before these decisions see it.

## Story: Read a project's rewards and activity at a glance

> As a contributor choosing where to work, I want each project card to say
> what kind of reward it offers.

### A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards

Variants derive only from the registry's reward policy. An external prize
share shows its advertised amount. Otherwise a monthly pool with a cap above
zero shows its cap (a stablecoin pool in dollars, a token pool with its ticker
and explorer link), unless the security program is bounty-only. A security
program, separate or bounty-only, adds its own variant with its amount, status
and eligibility. A project with none of these shows Points only. A bounty-only
program replaces ordinary work: its project page is the bounty overview, its
title says "security bounty", and Home and community lists show it only while
the program is open. A card also names a separate bounty when that bounty is
open on a monthly-pool project with no cap.

```quint
type RewardKind = MonthlyPoolReward | ExternalPrizeShare
type BountyMode = NoBounty | SeparateBounty | BountyOnly
type CardPolicy = { reward: RewardKind, monthlyCapPositive: bool, bounty: BountyMode, bountyOpen: bool, active: bool }
type CardVariant = MonthlyPoolCard | SecurityBountyCard | ExternalPrizeCard | PointsOnlyCard
pure def cardVariants(policy: CardPolicy): List[CardVariant] =
  val ordinary = if (policy.reward == ExternalPrizeShare) List(ExternalPrizeCard)
    else if (policy.monthlyCapPositive and policy.bounty != BountyOnly) List(MonthlyPoolCard) else List()
  val withBounty = if (policy.bounty != NoBounty) ordinary.append(SecurityBountyCard) else ordinary
  if (withBounty.length() == 0) List(PointsOnlyCard) else withBounty
pure def bountyOverview(policy: CardPolicy): bool = policy.bounty == BountyOnly
pure def cardNamesBounty(policy: CardPolicy): bool = policy.bounty == BountyOnly or
  (policy.bounty == SeparateBounty and policy.bountyOpen and policy.reward == MonthlyPoolReward and not(policy.monthlyCapPositive))
pure def listedForDiscovery(policy: CardPolicy): bool = policy.active and (not(bountyOverview(policy)) or policy.bountyOpen)
pure def lawBountyOnlyHidesOrdinaryWork(policy: CardPolicy): bool =
  bountyOverview(policy) implies not(cardVariants(policy).includes(MonthlyPoolCard)) and cardVariants(policy).includes(SecurityBountyCard)
pure def lawCardAlwaysShowsAVariant(policy: CardPolicy): bool =
  cardVariants(policy).length() > 0 and cardVariants(policy).length() <= 2
pure def lawPointsOnlyStandsAlone(policy: CardPolicy): bool =
  cardVariants(policy).includes(PointsOnlyCard) implies cardVariants(policy) == List(PointsOnlyCard)
pure def lawClosedBountyOnlyLeavesDiscovery(policy: CardPolicy): bool =
  (bountyOverview(policy) and not(policy.bountyOpen)) implies not(listedForDiscovery(policy))
pure val policyValues = Set(
  { reward: MonthlyPoolReward, monthlyCapPositive: true, bounty: NoBounty, bountyOpen: false, active: true },
  { reward: MonthlyPoolReward, monthlyCapPositive: true, bounty: BountyOnly, bountyOpen: true, active: true },
  { reward: MonthlyPoolReward, monthlyCapPositive: false, bounty: SeparateBounty, bountyOpen: true, active: true },
  { reward: MonthlyPoolReward, monthlyCapPositive: false, bounty: NoBounty, bountyOpen: false, active: true },
  { reward: ExternalPrizeShare, monthlyCapPositive: false, bounty: SeparateBounty, bountyOpen: false, active: true },
  { reward: MonthlyPoolReward, monthlyCapPositive: true, bounty: BountyOnly, bountyOpen: false, active: true }
)
```

### A cycle reminds viewers to check funding from seven days before close only for an unsettled monthly pool with a non-zero cap

A public cycle record and its manifest do not establish the month's funding;
only the monthly payment run qualifies obligations against current funds. A
cycle page therefore shows "This record does not verify the month's funding
status." from 604 800 000 ms before the cycle closes onward, only for a monthly
pool with a cap above zero that has not settled and whose cycle is not closed
without awards, an external provisional record, paid or wound up.

```quint
type ReminderLifecycle = ClosedNoAwards | ExternalProvisional | LiveCycle | PaidCycle | PaymentReady | InReview | SettlementPlanned | WoundUp
type ReminderInput = { monthlyPool: bool, settled: bool, lifecycle: ReminderLifecycle, msSinceClose: int, capPositive: bool }
pure val reminderLeadMs = 604800000
pure def fundingReminderVisible(reminder: ReminderInput): bool =
  reminder.monthlyPool and not(reminder.settled) and reminder.capPositive and
    reminder.lifecycle != ClosedNoAwards and reminder.lifecycle != ExternalProvisional and
    reminder.lifecycle != PaidCycle and reminder.lifecycle != WoundUp and reminder.msSinceClose >= 0 - reminderLeadMs
pure def lawReminderOnlyForUnsettledPools(reminder: ReminderInput): bool =
  fundingReminderVisible(reminder) implies reminder.monthlyPool and not(reminder.settled) and reminder.capPositive
pure def lawNoReminderBeforeTheLastWeek(reminder: ReminderInput): bool =
  reminder.msSinceClose < 0 - reminderLeadMs implies not(fundingReminderVisible(reminder))
pure val reminderValues = Set(
  { monthlyPool: true, settled: false, lifecycle: LiveCycle, msSinceClose: -604800000, capPositive: true },
  { monthlyPool: true, settled: false, lifecycle: LiveCycle, msSinceClose: -604800001, capPositive: true },
  { monthlyPool: true, settled: false, lifecycle: PaidCycle, msSinceClose: 0, capPositive: true },
  { monthlyPool: true, settled: false, lifecycle: InReview, msSinceClose: 5, capPositive: false },
  { monthlyPool: false, settled: false, lifecycle: LiveCycle, msSinceClose: 0, capPositive: true }
)
```

### Cycle archive filters keep only selections that a published cycle supports

`/cycles` reads `project` (`[a-z0-9-]{1,48}`), `month` (`YYYY-MM`) and `state`
(`[a-z-]{1,40}`) from the query; any other value is no selection. Once the
cycle index has loaded, a selection that no published cycle carries is dropped
and the address is rewritten without it. A filter control appears only when
the records offer more than one value or a value is selected. "No cycles match
these filters." with Clear filters appears only when records exist and the
remaining valid selections together match none.

```quint
type CycleRecord = { project: str, month: str, cycleState: str }
type ArchiveFilter = { projectFilter: str, monthFilter: str, stateFilter: str }
pure def keptFilter(cycles: List[CycleRecord], requested: ArchiveFilter, indexLoaded: bool): ArchiveFilter =
  if (not(indexLoaded)) requested
  else { projectFilter: if (cycles.some(c => c.project == requested.projectFilter)) requested.projectFilter else "",
    monthFilter: if (cycles.some(c => c.month == requested.monthFilter)) requested.monthFilter else "",
    stateFilter: if (cycles.some(c => c.cycleState == requested.stateFilter)) requested.stateFilter else "" }
pure def cycleMatches(cycle: CycleRecord, archiveFilter: ArchiveFilter): bool =
  (archiveFilter.projectFilter == "" or cycle.project == archiveFilter.projectFilter) and
    (archiveFilter.monthFilter == "" or cycle.month == archiveFilter.monthFilter) and
    (archiveFilter.stateFilter == "" or cycle.cycleState == archiveFilter.stateFilter)
pure def shownCycles(cycles: List[CycleRecord], archiveFilter: ArchiveFilter): List[CycleRecord] = cycles.select(c => cycleMatches(c, archiveFilter))
pure def noMatchNotice(cycles: List[CycleRecord], archiveFilter: ArchiveFilter): bool =
  cycles.length() > 0 and shownCycles(cycles, archiveFilter).length() == 0
pure def lawKeptSelectionsArePublished(cycles: List[CycleRecord], requested: ArchiveFilter): bool =
  val kept = keptFilter(cycles, requested, true)
  (kept.projectFilter == "" or cycles.some(c => c.project == kept.projectFilter)) and
    (kept.monthFilter == "" or cycles.some(c => c.month == kept.monthFilter)) and
    (kept.stateFilter == "" or cycles.some(c => c.cycleState == kept.stateFilter))
pure def lawKeepingIsStable(cycles: List[CycleRecord], requested: ArchiveFilter): bool =
  keptFilter(cycles, keptFilter(cycles, requested, true), true) == keptFilter(cycles, requested, true)
pure def lawNoSelectionShowsEveryCycle(cycles: List[CycleRecord]): bool =
  shownCycles(cycles, { projectFilter: "", monthFilter: "", stateFilter: "" }) == cycles
pure val cyclesValues = Set(List(),
  List({ project: "eliza", month: "2026-10", cycleState: "paid" }, { project: "milady", month: "2026-11", cycleState: "live" }))
pure val requestedValues = Set(
  { projectFilter: "eliza", monthFilter: "2026-11", stateFilter: "" },
  { projectFilter: "gone", monthFilter: "", stateFilter: "paid" },
  { projectFilter: "", monthFilter: "", stateFilter: "" })
```

## Story: Read a contributor's profile and Points

> As a visitor or a member, I want a profile address to name the person who
> holds that login now, and my own Points to add up the records they come from.

### A profile login resolves through membership, current actors, directory and journal in that order, and any current source vetoes a stale login

The login's own membership record decides first: it resolves when its login
matches and no current actor or directory entry holds its ID under another
login or its login under another ID. Otherwise the current identity sources
(the signed-in actor, snapshot leaders, review-exclusion reviewers,
project-view leaders and opportunities) decide: the actor with that login,
unless one of them or the directory conflicts. Otherwise the public directory
resolves exactly one entry with that login whose ID no current actor holds
under another login; two such entries resolve no one. Last, once the Points
journal has loaded, the journal resolves the login if every journal entry with
it names one ID and no current source or directory entry conflicts. The
journal never vetoes, because its logins can be stale. Logins are compared
lowercased.

```quint
type ProfileSource = { id: int, login: str }
type MemberRecord = NoMember | MemberFound({ memberId: int, memberLogin: str })
type JournalRecord = JournalPending | JournalLoaded({ entries: List[ProfileSource] })
pure val noSource: ProfileSource = { id: 0, login: "" }
pure def conflictsIn(candidate: ProfileSource, sources: List[ProfileSource], login: str): bool =
  sources.some(s => if (s.id == candidate.id) s.login != login else s.login == login)
pure def vetoed(candidate: ProfileSource, actors: List[ProfileSource], people: List[ProfileSource], login: str): bool =
  conflictsIn(candidate, actors, login) or conflictsIn(candidate, people, login)
pure def journalFirst(entries: List[ProfileSource], login: str): ProfileSource = entries.select(s => s.login == login).nthOr(0, noSource)
pure def journalResolves(entries: List[ProfileSource], login: str, actors: List[ProfileSource], people: List[ProfileSource]): int =
  val recorded = journalFirst(entries, login)
  if (recorded.id > 0 and entries.every(s => s.login != login or s.id == recorded.id) and not(vetoed(recorded, actors, people, login))) recorded.id else 0
pure def journalActor(login: str, actors: List[ProfileSource], people: List[ProfileSource], journal: JournalRecord): int =
  match journal {
    | JournalLoaded(j) => journalResolves(j.entries, login, actors, people)
    | _ => 0
  }
pure def directoryOrJournalActor(login: str, actors: List[ProfileSource], people: List[ProfileSource], journal: JournalRecord): int =
  val candidates = people.select(p => p.login == login and not(actors.some(a => a.id == p.id and a.login != login)))
  if (candidates.length() == 1) candidates.nthOr(0, noSource).id
  else if (candidates.length() > 1) 0
  else journalActor(login, actors, people, journal)
pure def sourceActor(login: str, actors: List[ProfileSource], people: List[ProfileSource], journal: JournalRecord): int =
  val named = actors.select(a => a.login == login).nthOr(0, noSource)
  if (login != "" and named.login == login) (if (vetoed(named, actors, people, login)) 0 else named.id)
  else directoryOrJournalActor(login, actors, people, journal)
pure def memberActor(login: str, actors: List[ProfileSource], people: List[ProfileSource], memberId: int, memberLogin: str): int =
  if (memberLogin == login and not(vetoed({ id: memberId, login: memberLogin }, actors, people, login))) memberId else 0
pure def resolveProfileActor(login: str, actors: List[ProfileSource], people: List[ProfileSource], member: MemberRecord, journal: JournalRecord): int =
  match member {
    | MemberFound(m) => memberActor(login, actors, people, m.memberId, m.memberLogin)
    | _ => sourceActor(login, actors, people, journal)
  }
pure def lawResolvedActorHasNoCurrentRename(login: str, actors: List[ProfileSource], people: List[ProfileSource], member: MemberRecord, journal: JournalRecord): bool =
  val resolved = resolveProfileActor(login, actors, people, member, journal)
  resolved > 0 implies not(actors.some(a => a.id == resolved and a.login != login))
pure def lawMembershipDecidesFirst(login: str, actors: List[ProfileSource], people: List[ProfileSource], memberId: int, journal: JournalRecord): bool =
  val resolved = resolveProfileActor(login, actors, people, MemberFound({ memberId: memberId, memberLogin: login }), journal)
  resolved == memberId or resolved == 0
pure val loginValues = Set("alice", "bob")
pure val actorsValues = Set(List(), List({ id: 1, login: "alice" }), List({ id: 1, login: "carol" }))
pure val peopleValues = Set(List(), List({ id: 1, login: "alice" }), List({ id: 2, login: "alice" }, { id: 3, login: "alice" }))
pure val memberValues = Set(NoMember, MemberFound({ memberId: 1, memberLogin: "alice" }), MemberFound({ memberId: 4, memberLogin: "alice" }))
pure val journalValues = Set(JournalPending, JournalLoaded({ entries: List({ id: 5, login: "bob" }) }),
  JournalLoaded({ entries: List({ id: 5, login: "bob" }, { id: 6, login: "bob" }) }))
pure val memberIdValues = Set(1, 4)
```

### Recent Points sum each UTC day of the last days including today

A profile groups Points awards by the UTC day they occurred, independent of
payout eligibility, over the last `days` days ending today; Recent Points is
the sum of those days. An award outside the window, or in the future, is not
counted.

```quint
type DayAward = { day: int, amount: int }
pure def recentPoints(awards: List[DayAward], today: int, days: int): int =
  awards.foldl(0, (total, award) => total + (if (award.day <= today and award.day > today - days) award.amount else 0))
pure def lawEmptyWindowIsZero(awards: List[DayAward], today: int, days: int): bool =
  days <= 0 implies recentPoints(awards, today, days) == 0
pure def lawTodayCounts(today: int, amount: int, days: int): bool =
  days > 0 implies recentPoints(List({ day: today, amount: amount }), today, days) == amount
pure def lawFutureAwardsDoNotCount(today: int, amount: int, days: int): bool =
  recentPoints(List({ day: today + 1, amount: amount }), today, days) == 0
pure val awardsValues = Set(List(), List({ day: 20400, amount: 3 }, { day: 20380, amount: 5 }))
pure val todayValues = Set(20400)
pure val daysValues = Set(0, 1, 30)
pure val amountValues = Set(1, 7)
```

### The account menu total sums the signed-in member's Points records under the owner's chosen scope

Owner decision frontend-ui:OD4 (ARCHITECTURE O25) is pending. The production
behaviour is the default: the menu total is the member's total from the Points
standings plus their historical welcome award and historical X award (no such
award is made from 24 October 2026; earlier ones never change). Standings
themselves count accepted work only ("Monthly and lifetime standings sum the
same accepted-work history"). The alternative is a menu total of accepted work
only, equal to the standings. A member missing from the standings counts zero
there.

```quint
type MenuPoints = { standingTotal: int, welcomeAward: int, socialAward: int }
pure def accountMenuTotal(menu: MenuPoints): int = menu.standingTotal + menu.welcomeAward + menu.socialAward
pure def lawMenuTotalIncludesStandings(menu: MenuPoints): bool =
  (menu.welcomeAward >= 0 and menu.socialAward >= 0) implies accountMenuTotal(menu) >= menu.standingTotal
pure val menuValues = Set({ standingTotal: 30, welcomeAward: 10, socialAward: 0 }, { standingTotal: 0, welcomeAward: 0, socialAward: 5 })
```

## Story: Read the sponsor statistics without mistaking them for scores

> As a sponsor, I want to see where Slop's contributors work and which models
> they declare, from fixed published figures that never move a score.

### Who-builds counts come only from the committed 2026-09-17 snapshot pinned by its digest

Owner decision frontend-lib:OD2 is pending; the default ports the view with
unchanged figures, and the alternative is to remove it. `/sponsors` quotes
only `data/who-builds/2026-09-17/snapshot.json` and its `METHOD.md`, pinned by
the lowercase SHA-256 below; the site never recomputes them, and a check fails
the build when the committed file's digest differs. Its repository footprint
counts the snapshot's scored events per repository, busiest first and then by
repository ID, labelled with the reviewed manifest's description.

```quint
pure val whoBuildsDate = "2026-09-17"
pure val whoBuildsSha256 = "edc05b350e371c50e0b5f72d01c92ea626ed03e23474febd5ddaf0f85c7df306"
pure def whoBuildsFiguresShown(fileSha256: str): bool = fileSha256 == whoBuildsSha256
pure def lawChangedSnapshotIsNotQuoted(fileSha256: str): bool =
  fileSha256 != whoBuildsSha256 implies not(whoBuildsFiguresShown(fileSha256))
pure val fileSha256Values = Set("edc05b350e371c50e0b5f72d01c92ea626ed03e23474febd5ddaf0f85c7df306", "0")
```

### Model outcome statistics aggregate self-reported identities against accepted outcomes and never change a score

Owner decision frontend-lib:OD2 is pending, as above. Model identity stays
self-reported provenance. A declaration naming no exact model is counted as
such and never as a model. Identities fold case, known provider aliases, a
repeated provider prefix and a dashed single-digit version. A declaration
counts toward a merged pull request or an accepted review only when its
declarer is that outcome's actor; an outcome naming several models counts once
for each and splits its points evenly. Signed runs count once per device run.
Each work item's own attribution status is the
[model attribution assessment](../points/modelAttribution.md); these
statistics only add up declarations across outcomes.

```quint
type ModelDeclaration = { declarer: int, outcomeActor: int, exactModel: bool }
pure def declarationCounts(declaration: ModelDeclaration): bool =
  declaration.exactModel and declaration.declarer > 0 and declaration.declarer == declaration.outcomeActor
pure def lawOthersNeverCount(declaration: ModelDeclaration): bool =
  declaration.declarer != declaration.outcomeActor implies not(declarationCounts(declaration))
pure def lawUnnamedModelNeverCounts(declaration: ModelDeclaration): bool =
  not(declaration.exactModel) implies not(declarationCounts(declaration))
pure val declarationValues = Set(
  { declarer: 1, outcomeActor: 1, exactModel: true },
  { declarer: 1, outcomeActor: 2, exactModel: true },
  { declarer: 1, outcomeActor: 1, exactModel: false })
```

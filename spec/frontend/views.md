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
share's card reads "Points + external prize", and its project page names the
prize ("<compact advertised amount> external prize", or "External prize"
without an amount). A points-only card reads "Points only" alone. Otherwise a monthly pool with a cap above
zero shows its cap (a stablecoin pool in dollars, a token pool with its ticker
and explorer link), unless the security program is bounty-only. A security
program, separate or bounty-only, adds its own variant with its amount, status
and eligibility. A project with none of these shows Points only. A bounty-only
program replaces ordinary work: its project page is the bounty overview, its
title says "security bounty", and Home and community lists show it only while
the program is open. A card also names a separate bounty when that bounty is
open on a monthly-pool project with no cap. A monthly review budget shows
only once its funding is committed: a card adds "+<committed> reviews", the
project page a "<committed> / <cap>" Reviews meter; a pledged budget shows
nothing. Home cards carry no merge-activity line and no bounty funding
state; the project page keeps " · Pledged" or " · Funded" after a bounty's
amount (development `src/App.tsx` `ProjectCard` and `ProjectRewardSummary`,
`src/Presentation.tsx` `ReviewBudget` at `67fd54fd4`).

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
pure def reviewBudgetShown(committed: bool): bool = committed
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

### A published maintainer share shows this month's share, and next month's while a change waits

The project page, the home card and /sponsors show the project's
[maintainer share](../settlement/maintainerShare.md) only for a monthly pool
whose registry base monthly amount (not a month override) is positive, and
only while this month's share or the setting is above zero (development
`src/lib/maintainer-share.mjs` `publishedMaintainerShare`,
`maintainerShareNotice` and `maintainerShareCardLine` at `8660a6121`). This
month's share is the first history entry whose month is this month or later,
else the setting (the [registry](../backend/projects.md)'s `monthShareOf`); a change the owner made this month takes
effect next month. While the two are equal one share is shown ("Maintainer
share: 20% of the monthly amount, split among the maintainers who merge or
close outside pull requests."; the card "Maintainer share 20%"); otherwise
both, with the month the setting starts ("… 20% of the monthly amount this
month, 10% from December, …"; the card "Maintainer share 10% from
December"). A share of zero reads "none".

```quint
import payoutExclusions as X from "../settlement/payoutExclusions"
import projects as BP from "../backend/projects"
type ShareShown = NoShare | SameShare({ basisPoints: int })
  | ChangingShare({ thisMonth: int, fromNext: int, fromPeriod: int })
pure def shareShown(monthlyPool: bool, baseAmountPositive: bool, thisMonth: int, setting: int, period: int): ShareShown =
  if (not(monthlyPool) or not(baseAmountPositive) or (thisMonth == 0 and setting == 0)) NoShare
  else if (thisMonth == setting) SameShare({ basisPoints: thisMonth })
  else ChangingShare({ thisMonth: thisMonth, fromNext: setting, fromPeriod: X::nextPeriod(period) })
pure def shareHidden(shown: ShareShown): bool = match shown { | NoShare => true | _ => false }
pure def shareChanging(shown: ShareShown, period: int): bool =
  match shown { | ChangingShare(c) => c.fromPeriod == X::nextPeriod(period) and c.thisMonth != c.fromNext | _ => false }
pure def lawNoAmountNoShare(monthlyPool: bool, thisMonth: int, setting: int, period: int): bool =
  shareHidden(shareShown(monthlyPool, false, thisMonth, setting, period))
pure def lawChangeShowsBothMonths(thisMonth: int, setting: int, period: int): bool =
  (thisMonth != setting) implies shareChanging(shareShown(true, true, thisMonth, setting, period), period)
pure def lawHistoryKeepsTheOpenMonth(setting: int, period: int, basisPoints: int): bool =
  BP::monthShareOf(List({ throughMonth: period, basisPoints: basisPoints }), setting, period) == basisPoints
pure def lawNoHistoryIsTheSetting(setting: int, period: int): bool = BP::monthShareOf(List(), setting, period) == setting
pure def lawMonthShareIsAnEntryOrTheSetting(history: List[BP::ShareEntry], setting: int, period: int): bool =
  BP::monthShareOf(history, setting, period) == setting
    or history.some(e => e.throughMonth >= period and e.basisPoints == BP::monthShareOf(history, setting, period))
pure val thisMonthValues = Set(0, 2000)
pure val settingValues = Set(0, 1000, 2000)
pure val periodValues = Set(202611, 202612)
pure val basisPointsValues = Set(0, 1500)
pure val historyValues = Set(List(), List({ throughMonth: 202611, basisPoints: 2000 }),
  List({ throughMonth: 202610, basisPoints: 500 }, { throughMonth: 202612, basisPoints: 1000 }))
```

### Suggested work lists the wanted issues first, unclaimed before taken, at most ten, and a failed wanted read leaves the suggestions as before

The project page's suggested work reads the project's wanted issues from the
stored [merge activity](../backend/mergeActivity.md) rows: only rows read
with the project's current wanted label, each repository's issues in
repository order and oldest first. Issues with no open pull request that
closes them come first, then the others, each keeping that order, at most
ten (development `src/lib/merge-activity.ts` `wantedIssues`,
`src/lib/wanted-label.mjs` `WANTED_ISSUES_SHOWN` and `src/ProjectWork.tsx`
at `8660a6121`); a taken one reads "Wanted · PR open". The public snapshot's
suggestions follow, without any wanted issue's address (compared
lowercased). A pending or failed wanted read lists no wanted issue and leaves
the snapshot's suggestions as they were; the snapshot's error shows only
while no wanted issue is listed.

```quint
type WantedIssue = { url: str, openPulls: int }
type WantedRead = WantedPending | WantedFailed | WantedReady({ issues: List[WantedIssue] })
pure val wantedShown = 10
pure val noWanted: WantedIssue = { url: "", openPulls: 0 }
pure def wantedOrder(issues: List[WantedIssue]): List[WantedIssue] =
  issues.select(i => i.openPulls == 0).concat(issues.select(i => i.openPulls > 0))
    .foldl(List(), (kept, i) => if (kept.length() < wantedShown) kept.append(i) else kept)
pure def wantedListed(wantedRead: WantedRead): List[WantedIssue] =
  match wantedRead { | WantedReady(r) => wantedOrder(r.issues) | _ => List() }
pure def snapshotErrorShown(snapshotFailed: bool, wantedRead: WantedRead): bool =
  snapshotFailed and wantedListed(wantedRead).length() == 0
pure def lawUnclaimedFirst(issues: List[WantedIssue]): bool =
  issues.some(i => i.openPulls == 0) implies wantedOrder(issues).nthOr(0, { ...noWanted, openPulls: 1 }).openPulls == 0
pure def lawAtMostTen(issues: List[WantedIssue]): bool = wantedOrder(issues).length() <= wantedShown
pure def lawFailedReadChangesNothing(snapshotFailed: bool): bool =
  wantedListed(WantedFailed).length() == 0 and wantedListed(WantedPending).length() == 0
    and snapshotErrorShown(snapshotFailed, WantedFailed) == snapshotFailed
pure val issuesValues = Set(List(), List({ url: "a", openPulls: 1 }, { url: "b", openPulls: 0 }),
  List({ url: "a", openPulls: 0 }, { url: "b", openPulls: 0 }, { url: "c", openPulls: 0 }, { url: "d", openPulls: 0 },
    { url: "e", openPulls: 0 }, { url: "f", openPulls: 0 }, { url: "g", openPulls: 0 }, { url: "h", openPulls: 0 },
    { url: "i", openPulls: 0 }, { url: "j", openPulls: 2 }, { url: "k", openPulls: 0 }))
pure val wantedReadValues = Set(WantedPending, WantedFailed, WantedReady({ issues: List({ url: "a", openPulls: 1 }) }))
```

### A cycle reminds viewers to check funding from seven days before close only for an unsettled monthly pool with a non-zero cap

A public cycle record and its manifest do not establish the month's funding;
only the monthly payment run qualifies obligations against current funds. A
cycle page therefore shows a reminder, a "Check funding →" link to the
project's funding section, or "Funding unverified" when the project is no
longer in the registry (development `src/CyclePages.tsx` at `67fd54fd4`),
from 604 800 000 ms before the cycle closes onward, only for a monthly
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

## Story: Read a contributor's profile

> As a visitor or a member, I want a profile address to name the person who
> holds that login now. A profile shows the contribution record, payments and
> penalties and the projects by name, and neither it nor the account menu
> shows a recent, total or daily Points figure (development `src/Profiles.tsx`,
> `src/ProfilePage.tsx` and `src/Points.tsx` `PointsNav` at `8660a6121`).

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

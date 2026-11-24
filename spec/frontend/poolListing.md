# Monthly listing and the home grid

PRD sections 5 and 7: the registry alone decides whether a project is
listed. A monthly pool is listed while this month's configured amount is
positive; a vault read only labels the amount ([projections](./projections.md),
`fundingTag`) and never adds, removes or moves a project. Sources at Slop
development `8660a6121`: `src/lib/pool-funding.ts:420–431`
(`listedThisMonth`), `src/lib/home-projects.ts` (`homeProjects`,
`homeProjectDescription`, `homeProjectOrder`), `src/App.tsx:807–866,960–1035`
(`CommunityProjects`, `HomePage`), `src/App.tsx:1269–1323`
(`ProjectInstallPanel`), `src/PublicPages.tsx:666–678` (`SponsorsPage`) and
`src/lib/intake-cap.mjs`; the retained development model is
`formal/models/ui/ui_project_listing.qnt`. These are display filters over the
registry's listing: the Featured and Community tiers
([listing](../backend/listing.md)) and every project state are unchanged, and
so are Points, collection, scoring and the monthly close. /sponsors and agent
discovery (`/.well-known/slop/projects.json`,
[publication](../contributor/publication.md)) list by `listedThisMonth`
whatever the project's status; Home also needs an active, placed project.
Each of them also leaves out a project paused at its intake cap or
out of rotation under the [backlog rule](./backlogRule.md).

## Story: List a monthly pool only in a month it has an amount

> As a contributor, I want the lists to show only monthly pools with an
> amount this month, so that I do not pick a project that has nothing to pay.

### A monthly pool is listed only while this month's configured amount is positive

A monthly pool's amount is the registry's amount for the current UTC month,
its month override resolved (`pool.amount`). A monthly pool whose amount is
zero is left out of /sponsors, agent discovery and Home, whatever any vault
holds, whether the funding read loads, is current, stale or failed, and even
when the month is pledged. A project with an open security program and a
project with any other reward kind stay listed. Nothing a funding read
returns changes the listing.

```quint
import projections as P from "./projections"
import views as V from "./views"
import money as M from "../settlement/money"
type ListingFacts = { securityOpen: bool, pool: P::PoolFacts }
pure def listedThisMonth(listing: ListingFacts): bool =
  not(listing.pool.monthlyPool) or listing.securityOpen or M::positiveAmount(listing.pool.amount)
pure def lawFundingNeverChangesListing(listing: ListingFacts, other: P::PoolFacts): bool =
  listedThisMonth(listing) == listedThisMonth({ ...listing,
    pool: { ...other, monthlyPool: listing.pool.monthlyPool, amount: listing.pool.amount } })
pure def lawZeroAmountLeaves(listing: ListingFacts): bool =
  (listing.pool.monthlyPool and not(listing.securityOpen) and not(M::positiveAmount(listing.pool.amount)))
    implies not(listedThisMonth(listing))
pure def lawOpenSecurityProgramStaysListed(listing: ListingFacts): bool =
  listing.securityOpen implies listedThisMonth(listing)
pure def lawOtherRewardsStayListed(listing: ListingFacts): bool =
  not(listing.pool.monthlyPool) implies listedThisMonth(listing)
pure val listingValues = Set(
  { securityOpen: false, pool: P::fundedPool },
  { securityOpen: false, pool: { ...P::fundedPool, freeAtStart: List(15) } },
  { securityOpen: false, pool: { ...P::fundedPool, amount: List(0) } },
  { securityOpen: true, pool: { ...P::fundedPool, amount: List(0) } },
  { securityOpen: false, pool: { ...P::fundedPool, read: P::PoolFailed, amount: List(0) } },
  { securityOpen: false, pool: { ...P::fundedPool, pledgeSupport: true, pledged: List(10), amount: List(0) } },
  { securityOpen: false, pool: { ...P::fundedPool, monthlyPool: false, amount: List(0) } })
```

### A project left out of the lists still opens by direct link and says why

A project paused at its intake cap ([intake cap](./backend/intakeCap.md),
`paused`) or out of rotation under the [backlog rule](./backend/backlogRule.md)
(`backlogHeld`) is left out of Home and /sponsors as well, by conjunction with the
monthly listing: the browser holds a project only from a stored count it
read, so while its merge activity read is pending or failed it passes no
counts and nothing is held. The project page keeps opening by direct link and
its skills keep serving. While held, the page shows the intake cap's notice
(`IC::pausedNotice`, the merge activity line's own read) or the backlog
rule's notice (`BR::overLimitNotice`, `BR::dormantNotice`). When agent
discovery does not list the project, its install panel says why, first that
it has paused new contributors (`pausedInstallText`), else that it is not
listed this month (the status badge `notListedInstallText`), else its
clearance badges (development `src/App.tsx` `ProjectInstallPanel` at
`8660a6121`). The project page itself shows no not-listed notice.

```quint
import intakeCap as IC from "../backend/intakeCap"
import backlogRule as BR from "../backend/backlogRule"
type InstallNotice = PausedInstall | NotListedInstall | NoListingNotice
pure val pausedInstallText = "This project has paused new contributors. The prompt below picks only listed projects."
pure val notListedInstallText = "Not listed this month"
pure def intakeHeld(cap: int, active: bool, counts: List[IC::StoredCount], now: int): bool =
  IC::paused({ ...IC::initial, cap: cap, active: active, counts: counts, now: now })
pure def backlogHeld(active: bool, exempt: bool, catchingUp: bool, until: int, reads: List[BR::BacklogRead], now: int): bool =
  BR::outOfRotation({ ...BR::initial, active: active, exempt: exempt, reads: reads, now: now, catchingUp: catchingUp, catchUpUntil: until })
pure def installNotice(discoveryRefuses: bool, held: bool, listedNow: bool): InstallNotice =
  if (not(discoveryRefuses)) NoListingNotice else if (held) PausedInstall
  else if (not(listedNow)) NotListedInstall else NoListingNotice
pure def lawHeldNeedsACurrentCount(cap: int, active: bool, counts: List[IC::StoredCount], now: int): bool =
  intakeHeld(cap, active, counts, now) implies counts.some(c => c.read and now - c.observedAt <= IC::countMaxAgeHours)
pure def lawUnreadCountsHoldNothing(cap: int, active: bool, now: int): bool = not(intakeHeld(cap, active, List(), now))
pure def lawBacklogHeldNeedsACurrentRead(active: bool, exempt: bool, catchingUp: bool, until: int, reads: List[BR::BacklogRead], now: int): bool =
  backlogHeld(active, exempt, catchingUp, until, reads, now) implies BR::hasRecentRead(reads, now)
pure def lawBacklogHeldStartsInDecember(active: bool, exempt: bool, catchingUp: bool, until: int, reads: List[BR::BacklogRead], now: int): bool =
  backlogHeld(active, exempt, catchingUp, until, reads, now) implies now >= BR::startsAtHours
pure def lawPausedSentenceFirst(listedNow: bool): bool = installNotice(true, true, listedNow) == PausedInstall
pure def lawListedProjectNeedsNoNotice(held: bool, listedNow: bool): bool =
  installNotice(false, held, listedNow) == NoListingNotice
pure val countsValues = Set(List(), List(IC::unread), List({ read: true, count: 3, observedAt: 1 }),
  List(IC::unread, { read: true, count: 1, observedAt: 1 }))
pure val readsValues = Set(List(BR::unreadRead, BR::unreadRead),
  List({ read: true, waiting: 50, lastMergedAt: 498800, observedAt: 498911 }, BR::unreadRead),
  List({ read: true, waiting: 1, lastMergedAt: 0, observedAt: 498911 }, BR::unreadRead))
pure val nowValues = Set(2, 498912, 498913)
pure val untilValues = Set(0, 498913, 499248)
```

## Story: Pick a project from the Featured and Community sections

### Home shows the listed Featured and Community projects once the funding read settles, Featured as cards and Community ten to a page

Home lists a placed, open project that is listed this month, whose card does
not advertise a security bounty and that is not held at its intake cap or
out of rotation under the [backlog rule](./backend/backlogRule.md)
(development `src/App.tsx` `HomePage` and `src/lib/home-projects.ts`
`homeProjects` at `8660a6121`). While the pool funding read loads, the
section shows no project and no "No projects yet."; once the read settles,
current, stale or failed, the set no longer depends on it: funding changes the
amount a card shows and its tag, never whether it is on Home. A project
whose card would advertise a security bounty (`V::cardNamesBounty`) is listed
in the Security bounties section instead. The page shows a Featured section
as a grid of cards, then a Community section as rows, ten to a page with
previous and next controls ([pagination](../ui/pagination.md)), each holding
the entries of its tier (`tier`) and hidden when it has none; with no entry
at all, once the read settled, it says "No projects yet.". A description
longer than 500 characters shows its first 500 characters, counted by code
point, with trailing space trimmed and "..." after it. Whether the project
is active and whether its security program is open are read once, from its
card policy (`active`, and `bountyOpen`, development
`securityBounty?.status === "open"`); the entry adds its registry tier
([projects](../backend/projects.md), `Tier`; development `listingTier`),
which also says whether it is placed (a Retired project is not), and its
pool, whose `read` is the shared funding read.

```quint
import projects as BP from "../backend/projects"
type HomeEntry = { policy: V::CardPolicy, tier: BP::Tier, pool: P::PoolFacts }
pure val noProjectsText = "No projects yet."
pure val communityPageSize = 10
pure val homeDescriptionLimit = 500
pure def placed(entry: HomeEntry): bool = entry.tier != BP::Retired
pure def entryListing(entry: HomeEntry): ListingFacts = { securityOpen: entry.policy.bountyOpen, pool: entry.pool }
pure def onHome(entry: HomeEntry, held: bool): bool = entry.pool.read != P::PoolLoading and not(held) and placed(entry)
  and V::listedForDiscovery(entry.policy) and not(V::cardNamesBounty(entry.policy)) and listedThisMonth(entryListing(entry))
pure def inHomeSection(entry: HomeEntry, held: bool, tier: BP::Tier): bool = onHome(entry, held) and entry.tier == tier
pure def showsNoProjects(fundingRead: P::PoolRead, shownCount: int): bool = fundingRead != P::PoolLoading and shownCount == 0
pure def lawLoadingShowsNothing(entry: HomeEntry, held: bool, shownCount: int): bool =
  entry.pool.read == P::PoolLoading implies (not(onHome(entry, held)) and not(showsNoProjects(entry.pool.read, shownCount)))
pure def lawSettledReadNeverChangesHome(entry: HomeEntry, held: bool, other: P::PoolFacts): bool =
  (entry.pool.read != P::PoolLoading and other.read != P::PoolLoading) implies
    onHome(entry, held) == onHome({ ...entry, pool: { ...other, monthlyPool: entry.pool.monthlyPool, amount: entry.pool.amount } }, held)
pure def lawEachCardIsInOneSection(entry: HomeEntry, held: bool): bool =
  onHome(entry, held) implies (inHomeSection(entry, held, BP::Featured) iff not(inHomeSection(entry, held, BP::Community)))
pure def lawBountyCardsLeaveTheGrid(entry: HomeEntry, held: bool): bool =
  V::cardNamesBounty(entry.policy) implies not(onHome(entry, held))
pure def lawUnplacedProjectsLeaveTheGrid(entry: HomeEntry, held: bool): bool = not(placed(entry)) implies not(onHome(entry, held))
pure def lawHeldProjectLeavesHome(entry: HomeEntry): bool = not(onHome(entry, true))
pure def lawUnlistedProjectLeavesHome(entry: HomeEntry, held: bool): bool =
  not(listedThisMonth(entryListing(entry))) implies not(onHome(entry, held))
pure val entryValues = Set(
  { policy: { reward: V::MonthlyPoolReward, monthlyCapPositive: true, bounty: V::NoBounty, bountyOpen: false, active: true },
    tier: BP::Featured, pool: P::fundedPool },
  { policy: { reward: V::MonthlyPoolReward, monthlyCapPositive: true, bounty: V::NoBounty, bountyOpen: false, active: true },
    tier: BP::Community, pool: { ...P::fundedPool, freeAtStart: List(15) } },
  { policy: { reward: V::MonthlyPoolReward, monthlyCapPositive: true, bounty: V::NoBounty, bountyOpen: false, active: true },
    tier: BP::Community, pool: { ...P::fundedPool, read: P::PoolLoading } },
  { policy: { reward: V::MonthlyPoolReward, monthlyCapPositive: false, bounty: V::NoBounty, bountyOpen: false, active: true },
    tier: BP::Featured, pool: { ...P::fundedPool, amount: List(0) } },
  { policy: { reward: V::MonthlyPoolReward, monthlyCapPositive: false, bounty: V::SeparateBounty, bountyOpen: true, active: true },
    tier: BP::Community, pool: P::fundedPool },
  { policy: { reward: V::ExternalPrizeShare, monthlyCapPositive: false, bounty: V::NoBounty, bountyOpen: false, active: true },
    tier: BP::Retired, pool: { ...P::fundedPool, monthlyPool: false } })
pure val otherValues = P::poolValues
pure val fundingReadValues = Set(P::PoolLoading, P::PoolCurrent, P::PoolFailed)
pure val shownCountValues = Set(0, 1)
```

### Each home section orders stablecoin pools by shown monthly amount, then token pools, external prizes and points only, and breaks ties by Featured then registry order

Each section orders its projects by the amount the listing shows this month
([projections](./projections.md), `listedAmount`): a monthly pool's
configured amount, whatever its tag. A stablecoin pool, or a pool with no
recorded asset, sorts by its monthly amount, largest first. Equal entries
keep Featured first, then registry order (`index`) (development
`src/lib/home-projects.ts` `homeProjectOrder` over `listingPoolReward` at
`8660a6121`).

```quint
type HomeGroup = StablecoinPool | TokenPool | ExternalPrizeGroup | PointsOnlyGroup
type HomeCard = { group: HomeGroup, amount: M::Amount, featured: bool, index: int }
pure def homeGroup(reward: V::RewardKind, shownAmount: M::Amount, stablecoin: bool): HomeGroup =
  if (reward == V::ExternalPrizeShare) ExternalPrizeGroup
  else if (not(M::positiveAmount(shownAmount))) PointsOnlyGroup
  else if (stablecoin) StablecoinPool else TokenPool
pure def groupRank(group: HomeGroup): int =
  if (group == StablecoinPool) 0 else if (group == TokenPool) 1 else if (group == ExternalPrizeGroup) 2 else 3
pure def homeBefore(left: HomeCard, right: HomeCard): bool =
  if (groupRank(left.group) != groupRank(right.group)) groupRank(left.group) < groupRank(right.group)
  else if (left.group == StablecoinPool and M::compareAmounts(left.amount, right.amount) != 0)
    M::compareAmounts(left.amount, right.amount) > 0
  else if (left.featured != right.featured) left.featured
  else left.index < right.index
pure def lawHomeOrderIsIrreflexive(left: HomeCard): bool = not(homeBefore(left, left))
pure def lawHomeOrderIsAsymmetric(left: HomeCard, right: HomeCard): bool =
  homeBefore(left, right) implies not(homeBefore(right, left))
pure def lawHomeOrderSeparatesEntries(left: HomeCard, right: HomeCard): bool =
  left.index != right.index implies (homeBefore(left, right) or homeBefore(right, left))
pure def lawUnfundedPoolSortsAsPoints(reward: V::RewardKind, stablecoin: bool): bool =
  reward == V::MonthlyPoolReward implies homeGroup(reward, M::zero, stablecoin) == PointsOnlyGroup
pure def lawListedPoolSortsByItsConfiguredAmount(promise: P::PromiseFacts, stablecoin: bool): bool =
  (promise.pool.monthlyPool and M::positiveAmount(promise.pool.amount))
    implies homeGroup(V::MonthlyPoolReward, P::listedAmount(promise), stablecoin) != PointsOnlyGroup
pure val leftValues = Set({ group: StablecoinPool, amount: List(5), featured: false, index: 0 },
  { group: StablecoinPool, amount: List(9), featured: false, index: 1 },
  { group: StablecoinPool, amount: List(5), featured: true, index: 2 },
  { group: TokenPool, amount: List(9), featured: true, index: 3 },
  { group: PointsOnlyGroup, amount: List(0), featured: false, index: 1 })
pure val rightValues = leftValues
pure val shownAmountValues = Set(List(0), List(5))
```

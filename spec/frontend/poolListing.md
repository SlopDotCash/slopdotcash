# Monthly listing and the home grid

PRD section 7 (operator decision, 16 November 2026): an active project with
a monthly pool is listed only while that pool is funded this month, by the
same rule that shows its amount ([projections](./projections.md),
`poolDisplay`). Sources at Slop development `df21e37b7`:
`src/lib/pool-funding.ts:312–335` (`NOT_LISTED_NOTICE`, `listedThisMonth`),
`src/lib/home-projects.ts` (`homeProjects`, `homeProjectOrder`),
`src/App.tsx:766–822,1049–1112,1348–1353` and `src/PublicPages.tsx:640–645`;
the retained development model is `formal/models/ui/ui_project_listing.qnt`.
These are display filters over the registry's listing: the Featured and
Community tiers ([listing](../backend/listing.md)) and every project state
are unchanged, and so are Points, collection, scoring and the monthly close.
Agent discovery (`/.well-known/slop/projects.json`) applies the same
predicate to the cached vault rows on the server
([publication](../contributor/publication.md)). Home is not a filtered
list: it shows every open project whatever the funding read, and
`listedThisMonth` applies to /sponsors, agent discovery and the project
page's notice only (owner decision, 17 November 2026; Slop development
`16387a77c`, `47f9b35c1`, and `formal/models/ui/ui_project_listing.qnt` at
`67fd54fd4`).

## Story: List a monthly pool only in a month it is funded

> As a contributor, I want the lists to show only monthly pools that hold
> this month's money, so that I do not pick a project that will not pay.

### An active monthly pool without an open security program is listed only while its pool shows as funded

/sponsors and agent discovery leave out an active project whose monthly
pool reads as points only, including one with no vault or a zero amount. An
honor-system promise ([projections](./projections.md), `promiseWarning`)
never lists a pool here: a promised month is not Funded. A
project with an open security program, any other reward kind, and a project
that is not active keep their listing rules. The lists never wait for the
funding read: while it loads, and when it is stale or fails, every project
is listed as before. The listing follows each read, so a project appears
once its vault funds the month and leaves when it no longer does.

```quint
import projections as P from "./projections"
import views as V from "./views"
import money as M from "../settlement/money"
type ListingFacts = { active: bool, securityOpen: bool, pool: P::PoolFacts }
pure def fundingKnown(listing: ListingFacts): bool = listing.pool.read == P::PoolCurrent
pure def listedThisMonth(listing: ListingFacts): bool = not(fundingKnown(listing)) or not(listing.active)
  or not(listing.pool.monthlyPool) or listing.securityOpen or P::poolDisplay(listing.pool) == P::PoolFunded
pure def lawUnreadFundingListsEverything(listing: ListingFacts): bool =
  not(fundingKnown(listing)) implies listedThisMonth(listing)
pure def lawOnlyUnfundedActiveMonthlyPoolsLeave(listing: ListingFacts): bool =
  not(listedThisMonth(listing)) implies (listing.active and listing.pool.monthlyPool and not(listing.securityOpen)
    and P::poolDisplay(listing.pool) != P::PoolFunded)
pure def lawOpenSecurityProgramStaysListed(listing: ListingFacts): bool =
  listing.securityOpen implies listedThisMonth(listing)
pure def lawLockedMonthIsListed(listing: ListingFacts): bool =
  P::lockedByPledges(listing.pool) implies listedThisMonth(listing)
pure val listingValues = Set(
  { active: true, securityOpen: false, pool: P::fundedPool },
  { active: true, securityOpen: false, pool: { ...P::fundedPool, freeAtStart: List(15) } },
  { active: true, securityOpen: true, pool: { ...P::fundedPool, freeAtStart: List(15) } },
  { active: false, securityOpen: false, pool: { ...P::fundedPool, freeAtStart: List(15) } },
  { active: true, securityOpen: false, pool: { ...P::fundedPool, read: P::PoolFailed, freeAtStart: List(15) } },
  { active: true, securityOpen: false, pool: { ...P::fundedPool, monthlyPool: false } })
```

### A project left out of the lists still opens by direct link and says why

Its page states the not-listed notice only after a current read that leaves
it out, and only while no honor-system promise is shown (`promised`; the
promise carries its own warning). Its install panel, when discovery does not
list it and the read leaves it out, shows the status badge "Not listed this
month", without the setup link (development `src/App.tsx`
`ProjectInstallPanel` and `ProjectOverview`, `src/lib/pool-funding.ts`
`NOT_LISTED_NOTICE` at `67fd54fd4`). Its skills keep serving.

```quint
pure val notListedText = "This project's pool is not funded this month. Accepted work still records points."
pure val notListedInstallText = "Not listed this month"
pure def showsNotListed(listing: ListingFacts, promised: bool): bool =
  fundingKnown(listing) and not(listedThisMonth(listing)) and not(promised)
pure def lawNoticeNeedsACurrentRead(listing: ListingFacts, promised: bool): bool =
  showsNotListed(listing, promised) implies fundingKnown(listing)
pure def lawListedProjectHasNoNotice(listing: ListingFacts, promised: bool): bool =
  listedThisMonth(listing) implies not(showsNotListed(listing, promised))
pure def lawPromiseReplacesTheNotice(listing: ListingFacts): bool = not(showsNotListed(listing, true))
```

## Story: Pick a project from the Featured and Community sections

### Home shows the open Featured and Community projects in their own sections whatever this month's funding, leaving bounty cards to the security bounties section

Home lists every placed, open project whose card does not advertise a
security bounty, whatever the pool funding read says: funding changes the
amount a card shows, never whether it is on Home (development `src/App.tsx`
`HomePage` and `src/lib/home-projects.ts` `homeProjects` at `67fd54fd4`).
A project whose card would advertise a security bounty
(`V::cardNamesBounty`) is listed in the Security bounties section instead.
The page shows a Featured section, then a Community section, each holding
the entries of its tier (`tier`) and hidden when it has none; with no entry
at all it says "No projects yet.". Whether the project is active and whether
its security program is open are read once, from its card policy (`active`,
and `bountyOpen`, development `securityBounty?.status === "open"`); the
entry adds its placement, its tier and its pool.

```quint
type HomeTier = Featured | Community
type HomeEntry = { policy: V::CardPolicy, placed: bool, tier: HomeTier, pool: P::PoolFacts }
pure val noProjectsText = "No projects yet."
pure def onHomeGrid(entry: HomeEntry): bool = entry.placed and V::listedForDiscovery(entry.policy)
  and not(V::cardNamesBounty(entry.policy))
pure def inHomeSection(entry: HomeEntry, tier: HomeTier): bool = onHomeGrid(entry) and entry.tier == tier
pure def lawFundingNeverRemovesAHomeCard(entry: HomeEntry, other: P::PoolFacts): bool =
  onHomeGrid(entry) == onHomeGrid({ ...entry, pool: other })
pure def lawEachCardIsInOneSection(entry: HomeEntry): bool =
  onHomeGrid(entry) implies (inHomeSection(entry, Featured) iff not(inHomeSection(entry, Community)))
pure def lawBountyCardsLeaveTheGrid(entry: HomeEntry): bool =
  V::cardNamesBounty(entry.policy) implies not(onHomeGrid(entry))
pure def lawUnplacedProjectsLeaveTheGrid(entry: HomeEntry): bool = not(entry.placed) implies not(onHomeGrid(entry))
pure val entryValues = Set(
  { policy: { reward: V::MonthlyPoolReward, monthlyCapPositive: true, bounty: V::NoBounty, bountyOpen: false, active: true },
    placed: true, tier: Featured, pool: P::fundedPool },
  { policy: { reward: V::MonthlyPoolReward, monthlyCapPositive: true, bounty: V::NoBounty, bountyOpen: false, active: true },
    placed: true, tier: Community, pool: { ...P::fundedPool, freeAtStart: List(15) } },
  { policy: { reward: V::MonthlyPoolReward, monthlyCapPositive: false, bounty: V::SeparateBounty, bountyOpen: true, active: true },
    placed: true, tier: Community, pool: P::fundedPool },
  { policy: { reward: V::ExternalPrizeShare, monthlyCapPositive: false, bounty: V::NoBounty, bountyOpen: false, active: true },
    placed: false, tier: Community, pool: { ...P::fundedPool, monthlyPool: false } })
pure val otherValues = P::poolValues
```

### Each home section orders stablecoin pools by shown monthly amount, then token pools, external prizes and points only, and breaks ties by Featured then registry order

Each section orders its projects as shown this month (`homeShownAmount`):
the vault-backed amount when the month is Funded, the month's promised
amount while an honor-system promise shows
([projections](./projections.md), `promiseWarning`), and otherwise zero, so
an unfunded pool without a promise sorts as points only. A stablecoin pool,
or a pool with no recorded asset, sorts by its monthly amount, largest
first. Equal entries keep Featured first, then registry order (`index`)
(development `src/lib/home-projects.ts` `homeProjectOrder` over
`publicPoolReward` at `67fd54fd4`).

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
pure def homeShownAmount(promise: P::PromiseFacts): M::Amount =
  if (P::poolDisplay(promise.pool) == P::PoolFunded or P::promiseWarning(promise) != P::NoPromise) promise.pool.amount
  else M::zero
pure def lawUnfundedPoolSortsAsPoints(reward: V::RewardKind, stablecoin: bool): bool =
  reward == V::MonthlyPoolReward implies homeGroup(reward, M::zero, stablecoin) == PointsOnlyGroup
pure def lawUnpromisedUnfundedPoolShowsZero(promise: P::PromiseFacts): bool =
  (P::poolDisplay(promise.pool) != P::PoolFunded and P::promiseWarning(promise) == P::NoPromise)
    implies homeShownAmount(promise) == M::zero
pure val leftValues = Set({ group: StablecoinPool, amount: List(5), featured: false, index: 0 },
  { group: StablecoinPool, amount: List(9), featured: false, index: 1 },
  { group: StablecoinPool, amount: List(5), featured: true, index: 2 },
  { group: TokenPool, amount: List(9), featured: true, index: 3 },
  { group: PointsOnlyGroup, amount: List(0), featured: false, index: 1 })
pure val rightValues = leftValues
pure val shownAmountValues = Set(List(0), List(5))
```

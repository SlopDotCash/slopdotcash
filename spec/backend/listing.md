# Project discovery placement

PRD sections 2, 7 and 9 place Featured and Community projects in the same D1
registry. This machine is the listing-field projection of one immutable
project's revisions, not a second project inventory. The adapter reads and
appends the authoritative D1 project revision atomically, binds the permanent
project identity, and checks the current administrator role before dispatch.
Tier changes do not change funding, rewards, clearance or recorded obligations.

## Story: Find Featured and Community projects independently of funding

### A listing decision belongs to one project and its immutable revision

The project owner uses the ordinary self-service registry flow. Featured
placement is an administrator decision. Community is the default discovery
tier; a Featured project can return to Community. Retirement remains the
registry's separate lifecycle and cannot be reversed by changing placement.

```quint
import projects as P from "./projects"
type ListingTier = Community | Featured
type ListingChange = { revision: int, tier: ListingTier }
type Listing = { projectId: int, revision: int, tier: ListingTier, history: List[ListingChange] }
pure val initial: Listing = { projectId: 1, revision: 0, tier: Community, history: List() }
pure def alwaysListingIdentity(l: Listing): bool = l.projectId > 0 and l.revision >= 0
pure def alwaysListingHistory(l: Listing): bool =
  l.history.every(change => change.revision > 0 and change.revision <= l.revision)
```

### Current administrators append placement changes against the current revision

The committed revision input represents the D1 transaction's observed result.
The adapter rejects conflicting compare-and-swap writes before making this
event. A failed or unavailable authority check cannot publish placement. An
owner or maintainer role alone grants no Featured-placement authority.
An unrelated immutable project revision retains the authoritative tier and
advances this projection only after the adapter verifies the new row has that
same tier. This is observation of the registry, not another tier decision.

```quint
pure def canPlace(l: Listing, projectId: int, expectedRevision: int, committedRevision: int,
  tier: ListingTier, currentAdministrator: bool, currentRegistry: bool, retired: bool): bool =
  projectId == l.projectId and expectedRevision == l.revision and committedRevision > expectedRevision and
  tier != l.tier and currentAdministrator and currentRegistry and not(retired)
pure def place(l: Listing, projectId: int, expectedRevision: int, committedRevision: int,
  tier: ListingTier, currentAdministrator: bool, currentRegistry: bool, retired: bool): Listing =
  { ...l, revision: committedRevision, tier: tier,
    history: l.history.append({ revision: committedRevision, tier: tier }) }
pure def stepProjectFixed(before: Listing, after: Listing): bool = before.projectId == after.projectId
pure def stepListingHistoryRetained(before: Listing, after: Listing): bool =
  before.history.every(change => after.history.includes(change))
pure def stepPlacementRevisionAdvances(before: Listing, after: Listing): bool =
  before != after implies after.revision > before.revision
pure def canRetainRevision(l: Listing, projectId: int, committedRevision: int, currentRegistry: bool, tierUnchanged: bool): bool =
  projectId == l.projectId and committedRevision > l.revision and currentRegistry and tierUnchanged
pure def retainRevision(l: Listing, projectId: int, committedRevision: int, currentRegistry: bool, tierUnchanged: bool): Listing =
  { ...l, revision: committedRevision }
pure def sometimesFeatured(l: Listing): bool = l.tier == Featured
pure def sometimesReturnedToCommunity(l: Listing): bool = l.tier == Community and l.history.length() >= 2
```

### Both tiers use the registry's visibility without inferring a payment promise

The caller supplies the matching permanent project ID and the current registry
record from one authoritative snapshot. A listing projection whose revision differs from that
snapshot cannot be published. A paused project stays discoverable; a retired
project does not. Ordinary and bounty projects follow the same predicates.
Funding never decides placement, and placement never establishes funding.

```quint
pure def visible(l: Listing, projectId: int, project: P::Project): bool =
  projectId == l.projectId and l.revision == project.revision and P::listed(project)
pure def inTier(l: Listing, projectId: int, project: P::Project, tier: ListingTier): bool =
  visible(l, projectId, project) and l.tier == tier
pure def lawRetiredHidden(l: Listing, projectId: int, project: P::Project): bool =
  project.retired implies not(visible(l, projectId, project))
pure def lawPauseKeepsListing(l: Listing, projectId: int, project: P::Project): bool =
  visible(l, projectId, project) implies visible(l, projectId, { ...project, paused: true })
pure def lawFundingDoesNotChoosePlacement(l: Listing, projectId: int, project: P::Project, tier: ListingTier): bool =
  inTier(l, projectId, project, tier) == inTier(l, projectId, { ...project, funded: not(project.funded) }, tier)
pure val projectValues = Set(P::initial)
pure val projectIdValues = Set(1, 2)
pure val expectedRevisionValues = Set(0, 1, 2)
pure val committedRevisionValues = Set(0, 1, 2, 3)
```

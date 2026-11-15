# Project discovery placement

PRD sections 2, 7 and 9. Featured and Community projects share the one D1
registry. The listing tier is a field of each immutable revision of the
[project registry](./projects.md), set by an administrator's placement
revision and never by funding. This library states what the public registry
reads (`GET /api/v1/projects`, `GET /api/v1/projects/:id`, the skill
artifacts and `/.well-known/slop/projects.json`) may show for one project,
given its registry state, its [security state](../security/enforcement.md) and
the registry-wide [closure](./projectRegistry.md) of the project (the
restricted project, if any, that claims one of its repository ids or paths).
Pages never read chain or GitHub state per view; they serve the cached D1
snapshot whose cache key includes the enforcement generation, so a new
restriction replaces every cached list, skill and archive on the next request.

## Story: Find Featured and Community projects independently of funding

### A restricted project is closed on every public route and a paused one stays listed

`GET /api/v1/projects` lists every restricted project under `restrictions`,
and readers treat it as paused and retired; `GET /api/v1/projects/:id`
answers 410 for it. This covers a two-flag pause, which is a contributor-flags
quarantine without a registry revision, and a project closed by another
project's restriction on a shared repository id or path, which names that
source project for its appeal. A paused project that is not retired
and not restricted stays listed. A retired project (owner removal,
administrator delisting or the restriction's retired revision) disappears from
lists while its history still resolves.

```quint
import closureConsent as C from "./closureConsent"
import projects as P from "./projects"
import enforcement as E from "../security/enforcement"
import projectRegistry as R from "./projectRegistry"
type PublicRead = Listed | Gone | NotFound
pure def restricted(security: E::Enforcement, closure: R::Closure): bool =
  security.restriction != E::Clear or closure.project != security.projectId or closure.source != 0
pure def visible(project: P::Project, security: E::Enforcement, closure: R::Closure): bool =
  P::listed(project) and not(restricted(security, closure))
pure def inTier(project: P::Project, security: E::Enforcement, closure: R::Closure, tier: P::Tier): bool =
  visible(project, security, closure) and project.tier == tier
pure def publicRead(project: P::Project, security: E::Enforcement, closure: R::Closure): PublicRead =
  if (project.revision == 0) NotFound else if (restricted(security, closure)) Gone
  else if (project.tier == P::Retired) NotFound else Listed
pure def lawRetiredHidden(project: P::Project, security: E::Enforcement, closure: R::Closure): bool =
  project.tier == P::Retired implies (not(visible(project, security, closure)) and publicRead(project, security, closure) != Listed)
pure def lawRestrictedHidden(project: P::Project, security: E::Enforcement, closure: R::Closure): bool =
  restricted(security, closure) implies not(visible(project, security, closure)) and publicRead(project, security, closure) != Listed
pure def lawFlagPauseHidden(project: P::Project, security: E::Enforcement, closure: R::Closure): bool =
  security.restriction == E::FlagQuarantine implies not(visible(project, security, closure))
pure def lawSharedRestrictionHidden(project: P::Project, security: E::Enforcement, closure: R::Closure): bool =
  closure.source != 0 implies publicRead(project, security, closure) != Listed
pure def lawPauseKeepsListing(project: P::Project, security: E::Enforcement, closure: R::Closure): bool =
  visible(project, security, closure) implies visible({ ...project, status: P::Paused }, security, closure)
```

### Funding never decides placement and placement never establishes funding

Ordinary and bounty projects follow the same predicates. Placement changes do
not change funding, rewards, clearance or recorded obligations.

```quint
pure def lawFundingDoesNotChoosePlacement(project: P::Project, security: E::Enforcement, closure: R::Closure, tier: P::Tier): bool =
  inTier(project, security, closure, tier) == inTier({ ...project, funded: not(project.funded) }, security, closure, tier)
pure def lawPlacementLeavesFundingAndClearance(project: P::Project, by: int, tier: P::Tier): bool =
  P::canPlace(project, by, tier) implies
    (P::place(project, by, tier).funded == project.funded and P::place(project, by, tier).status == project.status and
     P::place(project, by, tier).repositories == project.repositories)
pure def lawReinstatementNeverRestoresFeatured(project: P::Project): bool =
  P::restorable(project) implies P::withCommunityRestored(true, project).tier == P::Community and
    P::withCommunityRestored(true, project).status == P::Paused
pure val listedProject: P::Project = { ...P::initial, revision: 1, creator: 1, steward: 1, branch: 1, license: P::license1,
  history: List({ number: 1, kind: P::Created, status: P::Paused, tier: P::Community, by: 1 }) }
pure val projectValues = Set(P::initial, listedProject, { ...listedProject, tier: P::Featured },
  { ...listedProject, tier: P::Retired, retirement: P::RestrictionRetired }, { ...listedProject, funded: true })
pure val securityValues = Set(E::initial, { ...E::initial, restriction: E::FlagQuarantine, epoch: 1 },
  { ...E::initial, restriction: E::ModeratorBan, epoch: 1 })
pure val closureValues = Set({ project: 1, source: 0 }, { project: 1, source: 2 }, { project: 1, source: 1 }, { project: 2, source: 0 })
pure val byValues = Set(1, 5)
pure val tierValues = Set(P::Community, P::Featured, P::Retired)
```

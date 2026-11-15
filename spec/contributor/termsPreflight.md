# Live project terms preflight

PRD sections 4 and 8. Before preparing a private report the contributor
reads the project's current `terms.json` and security page
(`skills/project-contributor-template/scripts/terms-preflight.mjs`, legacy
`contributor_terms_preflight`). Live terms, not `project.json`, set any
bounty, scope, safe testing and disclosure rules. A local cache can avoid a
download only for immutable bytes matching the expected digest; a cache
failure never grants authority and never blocks valid network bytes. The
preflight acknowledges terms; it never grants project admission, and a
paused project still accepts a private report without resuming unsafe
research: active research needs acknowledged terms and a collected project
(`frontend/projections.md` `collected`), and a later observation that the
project is not collected stops it. The project observation is the client's
own read of the cached public projection.

## Story: Acknowledge only the exact current terms

### Cached or downloaded documents must match the current policy revision and digest

```quint
import projections as F from "../frontend/projections"
type CacheState = NoCache | CacheVerified | CacheRejected
type DocumentSource = NoDocuments | FromCache | FromNetwork | NotRequired
type TermsPreflight = { policyRead: bool, revisionMatches: bool, documentsRequired: bool, cache: CacheState,
  documents: DocumentSource, acknowledged: bool, cacheCloseFailed: bool, cachePublishFailed: bool, projectActive: bool,
  researching: bool }
pure val initial: TermsPreflight = { policyRead: false, revisionMatches: false, documentsRequired: true, cache: NoCache,
  documents: NoDocuments, acknowledged: false, cacheCloseFailed: false, cachePublishFailed: false, projectActive: false,
  researching: false }
pure def haveDocuments(t: TermsPreflight): bool = t.documents != NoDocuments
pure def canReadPolicy(t: TermsPreflight): bool = not(t.policyRead)
pure def readPolicy(t: TermsPreflight, revisionMatches: bool, documentsRequired: bool): TermsPreflight =
  { ...t, policyRead: true, revisionMatches: revisionMatches, documentsRequired: documentsRequired }
pure def canReadCache(t: TermsPreflight): bool = t.policyRead and t.cache == NoCache and t.documentsRequired
pure def readCache(t: TermsPreflight, immutableSource: bool, digestMatches: bool): TermsPreflight =
  { ...t, cache: if (immutableSource and digestMatches) CacheVerified else CacheRejected }
pure def canUseCache(t: TermsPreflight): bool = t.cache == CacheVerified
pure def useCache(t: TermsPreflight): TermsPreflight = { ...t, documents: FromCache }
pure def canFailCacheClose(t: TermsPreflight): bool = t.cache != NoCache and not(t.cacheCloseFailed)
pure def failCacheClose(t: TermsPreflight): TermsPreflight = { ...t, cacheCloseFailed: true }
pure def canDownload(t: TermsPreflight, validAuthority: bool, validDigest: bool): bool =
  t.policyRead and t.documentsRequired and validAuthority and validDigest
pure def download(t: TermsPreflight, validAuthority: bool, validDigest: bool): TermsPreflight = { ...t, documents: FromNetwork }
pure def canSkipDocuments(t: TermsPreflight): bool = t.policyRead and not(t.documentsRequired)
pure def skipDocuments(t: TermsPreflight): TermsPreflight = { ...t, documents: NotRequired }
pure def canFailCachePublication(t: TermsPreflight): bool = t.documents == FromNetwork and not(t.cachePublishFailed)
pure def failCachePublication(t: TermsPreflight): TermsPreflight = { ...t, cachePublishFailed: true }
pure def observeProject(t: TermsPreflight, view: F::ProjectView): TermsPreflight =
  { ...t, projectActive: F::collected(view), researching: t.researching and F::collected(view) }
pure def canAcknowledge(t: TermsPreflight): bool = t.policyRead and t.revisionMatches and haveDocuments(t) and not(t.acknowledged)
pure def acknowledge(t: TermsPreflight): TermsPreflight = { ...t, acknowledged: true }
pure def canBeginResearch(t: TermsPreflight): bool = t.acknowledged and t.projectActive and not(t.researching)
pure def beginResearch(t: TermsPreflight): TermsPreflight = { ...t, researching: true }
pure def alwaysAcknowledgedExact(t: TermsPreflight): bool = t.acknowledged implies t.policyRead and t.revisionMatches and haveDocuments(t)
pure def alwaysCachedDocumentsVerified(t: TermsPreflight): bool = (t.documents == FromCache implies t.cache == CacheVerified)
  and (t.documents == NotRequired implies not(t.documentsRequired))
  and ((t.documents == FromNetwork or t.documents == FromCache) implies t.documentsRequired)
pure def alwaysResearchNeedsActiveProject(t: TermsPreflight): bool = t.researching implies t.acknowledged and t.projectActive
pure def stepPolicyFixed(before: TermsPreflight, after: TermsPreflight): bool =
  before.policyRead implies after.revisionMatches == before.revisionMatches and after.documentsRequired == before.documentsRequired
pure def sometimesCacheCloseFailureStillAcknowledged(t: TermsPreflight): bool = t.acknowledged and t.cacheCloseFailed
pure def sometimesRejectedCacheThenNetwork(t: TermsPreflight): bool = t.acknowledged and t.cache == CacheRejected
  and t.documents == FromNetwork
pure def sometimesResearchStoppedByPause(t: TermsPreflight): bool = t.acknowledged and not(t.projectActive) and not(t.researching)
  and t.policyRead and t.documentsRequired
pure def sometimesResearching(t: TermsPreflight): bool = t.researching
pure def sometimesPausedNoDocumentsAcknowledged(t: TermsPreflight): bool = t.acknowledged and not(t.documentsRequired) and not(t.projectActive)
pure val openView: F::ProjectView = { registered: true, retired: false, legacy: false, paused: false, flagged: false,
  quarantined: false, cleared: true, skillFields: true }
pure val viewValues = Set(openView, { ...openView, paused: true })
pure def sometimesPublicationFailureAcknowledged(t: TermsPreflight): bool = t.acknowledged and t.cachePublishFailed

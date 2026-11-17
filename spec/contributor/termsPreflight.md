# Live project terms preflight

PRD sections 4 and 8. `skills/project-contributor-template/scripts/terms-preflight.mjs`
(`preflight`, legacy `contributor_terms_preflight`, tests
`scripts/terms-preflight.test.ts`) runs when a contributor starts a measured
run with `run-receipt.mjs start --verify-policy`. `SKILL.md` does not invoke
it. It is optional: ordinary GitHub submission needs no policy
acknowledgement (CLAUDE.md "Installer and attribution"), and the
[work model](./workflow.md) imports nothing from this unit. Live terms, not
`project.json`, set any bounty, scope, safe testing and disclosure rules. The
preflight acknowledges terms; it never grants project admission, and a paused
project still accepts a private report without resuming unsafe research:
active research needs acknowledged terms and a collected project
(`frontend/projections.md` `collected`), and a later observation that the
project is not collected stops it. The project observation is the client's
own read of the cached public projection.

## Story: Acknowledge only the exact current terms

### Start without the option writes a version 1 record; with it, a version 2 record after the preflight

The preflight reads `https://slop.cash/projects/<id>/terms.json`, the only
policy authority, with redirects refused and a 1 MiB limit. The policy must
name this project with schema version 1. When repository authority is
verified, its proof's `policyRevision` equals the current terms revision, and
the receipt policy is active with `activatedAt` equal to the proof's
`verifiedAt`. The record carries `policyAcknowledgement` with the
acknowledged revision. Every refusal fails start without creating a record;
a later start, with or without the option, is a new attempt.

```quint
import projections as F from "../frontend/projections"
type Phase = Idle | ReadingTerms | VerifyingDocuments | Started | Refused
type Fetch = { ok: bool, redirected: bool, withinLimit: bool }
type Terms = { fetch: Fetch, exactIdentity: bool, authorityVerified: bool, proofRevision: int, termsRevision: int,
  receiptActive: bool, activatedAt: int, proofVerifiedAt: int, documents: int }
type Binding = { authorityVerified: bool, proofRevision: int, activatedAt: int, proofVerifiedAt: int }
type TermsPreflight = { phase: Phase, pending: int, revision: int, binding: Binding, recordVersion: int, acknowledgedRevision: int,
  refusals: int, fromCache: int, fromNetwork: int, cacheRejected: bool, cacheCloseFailed: bool, cachePublishFailed: bool,
  documentsRequired: bool, projectActive: bool, researching: bool, accepted: List[Accepted] }
pure val noBinding: Binding = { authorityVerified: false, proofRevision: 0, activatedAt: 0, proofVerifiedAt: 0 }
pure val initial: TermsPreflight = { phase: Idle, pending: 0, revision: 0, binding: noBinding, recordVersion: 0,
  acknowledgedRevision: 0,
  refusals: 0, fromCache: 0, fromNetwork: 0, cacheRejected: false, cacheCloseFailed: false, cachePublishFailed: false,
  documentsRequired: false, projectActive: false, researching: false, accepted: List() }
pure def fetched(f: Fetch): bool = f.ok and not(f.redirected) and f.withinLimit
pure def termsBound(t: Terms): bool = fetched(t.fetch) and t.exactIdentity and t.termsRevision > 0
  and 0 <= t.documents and t.documents <= 3
  and (t.authorityVerified implies
    (t.proofRevision == t.termsRevision and t.receiptActive and t.activatedAt == t.proofVerifiedAt))
pure def startable(p: TermsPreflight): bool = p.phase == Idle or p.phase == Refused
pure def canStartPlain(p: TermsPreflight): bool = startable(p)
pure def startPlain(p: TermsPreflight): TermsPreflight = { ...p, phase: Started, recordVersion: 1, acknowledgedRevision: 0 }
pure def canStartVerified(p: TermsPreflight): bool = startable(p) and p.refusals < 9007199254740000
pure def startVerified(p: TermsPreflight): TermsPreflight = { ...p, phase: ReadingTerms, pending: 0, revision: 0,
  binding: noBinding, accepted: List(), fromCache: 0, fromNetwork: 0, cacheRejected: false, cacheCloseFailed: false, cachePublishFailed: false }
pure def canReadTerms(p: TermsPreflight, terms: Terms): bool = p.phase == ReadingTerms
pure def readTerms(p: TermsPreflight, terms: Terms): TermsPreflight =
  if (termsBound(terms)) { ...p, phase: VerifyingDocuments, pending: terms.documents, revision: terms.termsRevision,
    binding: { authorityVerified: terms.authorityVerified, proofRevision: terms.proofRevision, activatedAt: terms.activatedAt,
      proofVerifiedAt: terms.proofVerifiedAt },
    documentsRequired: terms.documents > 0 }
  else { ...p, phase: Refused, pending: 0, refusals: p.refusals + 1 }
pure def alwaysAcknowledgementBindsCurrentProof(p: TermsPreflight): bool =
  ((p.recordVersion == 2 and p.binding.authorityVerified) implies
    p.binding.proofRevision == p.acknowledgedRevision and p.binding.activatedAt == p.binding.proofVerifiedAt)
  and (p.recordVersion == 1 implies p.acknowledgedRevision == 0) and p.acknowledgedRevision >= 0
  and ((p.phase == VerifyingDocuments and p.binding.authorityVerified) implies
    p.binding.proofRevision == p.revision and p.binding.activatedAt == p.binding.proofVerifiedAt)
pure def stepRefusalWritesNoRecord(before: TermsPreflight, after: TermsPreflight): bool =
  (after.phase == Refused and before.phase != Refused) implies after.recordVersion == 0 and after.acknowledgedRevision == 0
```

### Each named document is digest-verified on an allowlisted host, and the cache never grants authority

The LICENSE, inbound terms and prize rules named with a SHA-256 digest are read
only from `github.com`, `raw.githubusercontent.com` or `proximityprize.org`
over HTTPS without credentials, port or fragment, with redirects refused and a
4 MiB limit. A cached copy is reused only for an immutable
`raw.githubusercontent.com` URL pinned to a 40-character commit, and only
when its bytes match the digest. A rejected cache falls back to the network.
Failing to close a cache handle or to publish fetched bytes to the cache never
blocks valid bytes and never grants authority to unverified ones.

```quint
type Host = GitHub | RawGitHub | ProximityPrize | OtherHost
type Document = { host: Host, immutableUrl: bool, cachedMatches: bool, closeFails: bool, fetch: Fetch,
  digestMatches: bool, publishFails: bool }
type Accepted = { document: Document, cached: bool }
pure def allowedHost(h: Host): bool = h == GitHub or h == RawGitHub or h == ProximityPrize
pure def cacheable(d: Document): bool = d.host == RawGitHub and d.immutableUrl
pure def usesCache(d: Document): bool = cacheable(d) and d.cachedMatches
pure def documentVerified(d: Document): bool =
  allowedHost(d.host) and (usesCache(d) or (fetched(d.fetch) and d.digestMatches))
pure def lawOtherHostNeverVerified(d: Document): bool = d.host == OtherHost implies not(documentVerified(d))
pure def canVerifyDocument(p: TermsPreflight, d: Document): bool = p.phase == VerifyingDocuments and p.pending > 0
pure def verifyDocument(p: TermsPreflight, d: Document): TermsPreflight =
  if (not(documentVerified(d))) { ...p, phase: Refused, pending: 0, refusals: p.refusals + 1 }
  else if (usesCache(d)) { ...p, pending: p.pending - 1, fromCache: p.fromCache + 1,
    accepted: p.accepted.append({ document: d, cached: true }),
    cacheCloseFailed: p.cacheCloseFailed or d.closeFails }
  else { ...p, pending: p.pending - 1, fromNetwork: p.fromNetwork + 1,
    accepted: p.accepted.append({ document: d, cached: false }),
    cacheRejected: p.cacheRejected or cacheable(d),
    cacheCloseFailed: p.cacheCloseFailed or (cacheable(d) and d.closeFails),
    cachePublishFailed: p.cachePublishFailed or (cacheable(d) and d.publishFails) }
pure def canAcknowledge(p: TermsPreflight): bool = p.phase == VerifyingDocuments and p.pending == 0
pure def acknowledge(p: TermsPreflight): TermsPreflight =
  { ...p, phase: Started, recordVersion: 2, acknowledgedRevision: p.revision }
pure def alwaysRecordMatchesVersion(p: TermsPreflight): bool =
  ((p.phase == Started) iff (p.recordVersion > 0)) and ((p.recordVersion == 2) iff (p.acknowledgedRevision > 0))
  and (p.recordVersion == 2 implies p.acknowledgedRevision == p.revision)
  and (p.recordVersion == 0 or p.recordVersion == 1 or p.recordVersion == 2)
pure def alwaysPending(p: TermsPreflight): bool = 0 <= p.pending and p.pending <= 3
  and (p.phase != VerifyingDocuments implies p.pending == 0)
  and (p.phase == VerifyingDocuments implies p.revision > 0 and p.fromCache + p.fromNetwork + p.pending <= 3
    and (p.documentsRequired iff p.fromCache + p.fromNetwork + p.pending > 0))
  and (p.phase == ReadingTerms implies p.fromCache == 0 and p.fromNetwork == 0)
  and (p.recordVersion == 2 implies p.fromCache + p.fromNetwork <= 3 and (p.documentsRequired iff p.fromCache + p.fromNetwork > 0))
  and p.refusals >= 0 and p.fromCache >= 0 and p.fromNetwork >= 0
pure def alwaysAcceptedDocumentsVerified(p: TermsPreflight): bool =
  p.accepted.length() == p.fromCache + p.fromNetwork
  and p.accepted.every(a => allowedHost(a.document.host) and
    (if (a.cached) a.document.host == RawGitHub and a.document.immutableUrl and a.document.cachedMatches
     else fetched(a.document.fetch) and a.document.digestMatches))
pure def sometimesAcknowledged(p: TermsPreflight): bool = p.recordVersion == 2 and p.fromCache > 0
pure def sometimesRefusedWithoutRecord(p: TermsPreflight): bool = p.phase == Refused and p.recordVersion == 0
pure def sometimesPlainAfterRefusal(p: TermsPreflight): bool = p.recordVersion == 1 and p.refusals > 0
pure def sometimesCacheCloseFailureStillAcknowledged(p: TermsPreflight): bool = p.recordVersion == 2 and p.cacheCloseFailed
pure def sometimesRejectedCacheThenNetwork(p: TermsPreflight): bool = p.recordVersion == 2 and p.cacheRejected
pure def sometimesPublicationFailureAcknowledged(p: TermsPreflight): bool = p.recordVersion == 2 and p.cachePublishFailed
```

### Research needs acknowledged terms and a collected project

```quint
pure def observeProject(p: TermsPreflight, view: F::ProjectView): TermsPreflight =
  { ...p, projectActive: F::collected(view), researching: p.researching and F::collected(view) }
pure def canBeginResearch(p: TermsPreflight): bool = p.recordVersion == 2 and p.projectActive and not(p.researching)
pure def beginResearch(p: TermsPreflight): TermsPreflight = { ...p, researching: true }
pure def alwaysResearchNeedsActiveProject(p: TermsPreflight): bool = p.researching implies p.recordVersion == 2 and p.projectActive
pure def sometimesResearchStoppedByPause(p: TermsPreflight): bool = p.recordVersion == 2 and not(p.projectActive)
  and not(p.researching) and p.documentsRequired
pure def sometimesResearching(p: TermsPreflight): bool = p.researching
pure def sometimesPausedNoDocumentsAcknowledged(p: TermsPreflight): bool = p.recordVersion == 2 and not(p.documentsRequired)
  and not(p.projectActive)
pure val openView: F::ProjectView = { registered: true, retired: false, legacy: false, paused: false, flagged: false,
  quarantined: false, cleared: true, skillFields: true }
pure val viewValues = Set(openView, { ...openView, paused: true })
pure val okFetch: Fetch = { ok: true, redirected: false, withinLimit: true }
pure val boundTerms: Terms = { fetch: okFetch, exactIdentity: true, authorityVerified: true, proofRevision: 2,
  termsRevision: 2, receiptActive: true, activatedAt: 7, proofVerifiedAt: 7, documents: 1 }
pure val termsValues = Set(boundTerms, { ...boundTerms, documents: 0, authorityVerified: false, proofRevision: 1 },
  { ...boundTerms, documents: 2 }, { ...boundTerms, proofRevision: 1 }, { ...boundTerms, activatedAt: 8 },
  { ...boundTerms, receiptActive: false }, { ...boundTerms, fetch: { ...okFetch, redirected: true } },
  { ...boundTerms, fetch: { ...okFetch, withinLimit: false } })
pure val okDocument: Document = { host: RawGitHub, immutableUrl: true, cachedMatches: false, closeFails: false, fetch: okFetch,
  digestMatches: true, publishFails: false }
pure val dValues = Set(okDocument, { ...okDocument, cachedMatches: true }, { ...okDocument, cachedMatches: true, closeFails: true },
  { ...okDocument, publishFails: true }, { ...okDocument, closeFails: true },
  { ...okDocument, immutableUrl: false, cachedMatches: true, digestMatches: false },
  { ...okDocument, host: GitHub, immutableUrl: false }, { ...okDocument, host: OtherHost },
  { ...okDocument, digestMatches: false }, { ...okDocument, fetch: { ...okFetch, redirected: true } })
pure val weight_startVerified = 6
pure val weight_readTerms = 6
pure val weight_verifyDocument = 8
pure val weight_acknowledge = 6
```

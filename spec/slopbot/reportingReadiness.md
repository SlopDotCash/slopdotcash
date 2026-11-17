# Private reporting refresh runs and repository access

PRD section 4 (self-service project setup) and the private-reporting
requirements of the security area. Source at the development head:
`workers/slopbot/reporting-readiness.ts` (`refreshRegisteredReporting`),
`reporting-readiness-service.ts` (the private `ReportingReadinessRefresher`
binding called by the identity schedule) and `repository-access.ts`
(`readRepositoryAccess`, `handleRepositoryAccess`). The observation each
refresh writes, and when it is ready, is
[reporting readiness](../security/reportingReadiness.md) "A refresh writes
only a newer attempt and keeps the repository identity"; this library
decides only how a run reports its failures. The repository-access
consumer, which binds the answer to the acting account and the stored
repository, is [projects](../backend/projects.md) "Authority is one read
bound to the acting account and the stored repository". Merge activity is
[merge activity](../backend/mergeActivity.md), not this library.

This is a library: the shell runs it on each scheduled refresh and each
internal request, and these definitions decide what it records and
answers. GitHub's answers reach it only as the typed facts below, read with
the App's own credentials.

## Story: Observe private reporting and answer repository access from the App's own reads

> As a project owner, I want Slop to know from GitHub itself whether private
> vulnerability reporting is ready on my registered repository and whether
> Slopbot is installed there, without any token or stale identity leaking
> into the answer.

### A paused project without the App installed is a recorded state, never a refresh failure

Each run reads the projects in ID order, skips retired listings and
refreshes every other one through
[reporting readiness](../security/reportingReadiness.md). The run reports
how many projects it checked and how many failed. Every refresh that
records a failure for a non-retired project counts as failed, except App
not installed on a paused project: only its owner can change that, and
counting it would fail the hourly identity schedule indefinitely. An
active project without the App still counts as a failure.

```quint
import reportingReadiness as RR from "../security/reportingReadiness"
type ObservedProject = { projectId: int, retired: bool, paused: bool, read: RR::ReadKind, failure: RR::ReadFailure }
type RefreshTally = { checked: int, failed: int }
pure def countsAsFailure(p: ObservedProject): bool =
  not(p.retired) and p.failure != RR::NoFailure and not(p.read == RR::AppNotInstalled and p.paused)
pure def refreshTally(projects: List[ObservedProject]): RefreshTally =
  { checked: projects.select(p => not(p.retired)).length(), failed: projects.select(p => countsAsFailure(p)).length() }
pure def lawPausedWithoutAppIsNoFailure(sampleProject: ObservedProject): bool =
  (sampleProject.paused and sampleProject.read == RR::AppNotInstalled) implies not(countsAsFailure(sampleProject))
pure def lawActiveWithoutAppFails(sampleProject: ObservedProject): bool =
  (not(sampleProject.retired) and not(sampleProject.paused) and sampleProject.read == RR::AppNotInstalled and
    sampleProject.failure != RR::NoFailure) implies countsAsFailure(sampleProject)
pure def lawRetiredNeverFails(sampleProject: ObservedProject): bool =
  sampleProject.retired implies not(countsAsFailure(sampleProject))
pure val sampleProjectValues = Set(
  { projectId: 1, retired: false, paused: true, read: RR::AppNotInstalled, failure: RR::ReadFailed },
  { projectId: 2, retired: false, paused: false, read: RR::AppNotInstalled, failure: RR::ReadFailed },
  { projectId: 3, retired: true, paused: false, read: RR::ReadUnavailable, failure: RR::ReadFailed },
  { projectId: 4, retired: false, paused: true, read: RR::Verified, failure: RR::IdentityMismatch },
  { projectId: 5, retired: false, paused: false, read: RR::Verified, failure: RR::NoFailure })
```

### The repository-access route answers installation presence and a login's base permission and never returns a token

`GET https://slopbot.internal/v1/repository-access`, reached only through
the site's service binding; public hosts never match its origin. The query
needs `repository` as `owner/name` (each 1 to 100 of `[A-Za-z0-9_.-]`),
`repositoryId` and `githubId` as 1 to 20 digits without a leading zero, and
a GitHub `login`; otherwise 400 `invalid_request`. The App JWT finds the
repository's installation: none is `missing`, a suspended one is
`suspended` with its ID. For an active installation a metadata-read token
scoped to exactly the expected repository ID is issued and used only for
the reads behind this answer: the repository must have the expected ID,
and the login's permission must belong to the expected GitHub account ID.
A login that is not a collaborator has permission `none`; otherwise the
permission must be `admin`, `write`, `read` or `none` (GitHub maps
`maintain` to `write`), with the role name kept only when it is 1 to 64 of
`[A-Za-z0-9 _-]`. The repository identity is included only when asked
with `includeRepository=1`. Any GitHub failure, unexpected answer or
identity difference is 503 `unavailable`. Every answer is `no-store`, and
none carries a token.

```quint
type InstallationLookup = LookupMissing | LookupSuspended | LookupInstalled | LookupFailed
type GrantedPermission = PermissionAdmin | PermissionWrite | PermissionRead | PermissionNone | PermissionUnknown
type AccessKind = InvalidRequest | AccessUnavailable | NotInstalled | InstallationSuspended | Installed
type AccessQuery = { repositoryWellFormed: bool, repositoryId: int, githubId: int, loginWellFormed: bool }
type AccessFacts = { lookup: InstallationLookup, installationId: int, tokenIssued: bool, repositoryIdSeen: int,
  permissionLookupFailed: bool, collaborator: bool, permission: GrantedPermission, accountIdSeen: int }
type AccessAnswer = { httpStatus: int, accessKind: AccessKind, answeredInstallation: int,
  answeredPermission: GrantedPermission, carriesToken: bool, noStore: bool }
pure def accessQueryValid(q: AccessQuery): bool =
  q.repositoryWellFormed and q.repositoryId > 0 and q.githubId > 0 and q.loginWellFormed
pure def answerWith(httpStatus: int, accessKind: AccessKind, installationId: int, permission: GrantedPermission): AccessAnswer =
  { httpStatus: httpStatus, accessKind: accessKind, answeredInstallation: installationId,
    answeredPermission: permission, carriesToken: false, noStore: true }
pure def permissionFor(f: AccessFacts): GrantedPermission = if (f.collaborator) f.permission else PermissionNone
pure def installedAnswerable(q: AccessQuery, f: AccessFacts): bool =
  f.installationId > 0 and f.tokenIssued and f.repositoryIdSeen == q.repositoryId and not(f.permissionLookupFailed) and
  (not(f.collaborator) or f.accountIdSeen == q.githubId) and permissionFor(f) != PermissionUnknown
pure def accessAnswer(q: AccessQuery, f: AccessFacts): AccessAnswer =
  if (not(accessQueryValid(q))) answerWith(400, InvalidRequest, 0, PermissionUnknown)
  else if (f.lookup == LookupMissing) answerWith(200, NotInstalled, 0, PermissionUnknown)
  else if (f.lookup == LookupSuspended and f.installationId > 0)
    answerWith(200, InstallationSuspended, f.installationId, PermissionUnknown)
  else if (f.lookup == LookupInstalled and installedAnswerable(q, f))
    answerWith(200, Installed, f.installationId, permissionFor(f))
  else answerWith(503, AccessUnavailable, 0, PermissionUnknown)
pure def lawAccessNeverReturnsToken(sampleQuery: AccessQuery, sampleFacts: AccessFacts): bool =
  not(accessAnswer(sampleQuery, sampleFacts).carriesToken) and accessAnswer(sampleQuery, sampleFacts).noStore
pure def lawOtherRepositoryNeverAnswers(sampleQuery: AccessQuery, sampleFacts: AccessFacts): bool =
  sampleFacts.repositoryIdSeen != sampleQuery.repositoryId implies
    accessAnswer(sampleQuery, sampleFacts).accessKind != Installed
pure def lawPermissionBoundToAccountId(sampleQuery: AccessQuery, sampleFacts: AccessFacts): bool =
  (sampleFacts.collaborator and sampleFacts.accountIdSeen != sampleQuery.githubId) implies
    accessAnswer(sampleQuery, sampleFacts).accessKind != Installed
pure def lawInstalledAnswerHasKnownPermission(sampleQuery: AccessQuery, sampleFacts: AccessFacts): bool =
  accessAnswer(sampleQuery, sampleFacts).accessKind == Installed implies
    accessAnswer(sampleQuery, sampleFacts).answeredPermission != PermissionUnknown
pure val validQuery: AccessQuery = { repositoryWellFormed: true, repositoryId: 7, githubId: 5, loginWellFormed: true }
pure val installedFacts: AccessFacts = { lookup: LookupInstalled, installationId: 3, tokenIssued: true,
  repositoryIdSeen: 7, permissionLookupFailed: false, collaborator: true, permission: PermissionWrite, accountIdSeen: 5 }
pure val sampleQueryValues = Set(validQuery, { ...validQuery, loginWellFormed: false }, { ...validQuery, githubId: 0 })
pure val sampleFactsValues = Set(installedFacts, { ...installedFacts, lookup: LookupMissing },
  { ...installedFacts, lookup: LookupSuspended }, { ...installedFacts, lookup: LookupFailed },
  { ...installedFacts, repositoryIdSeen: 8 }, { ...installedFacts, accountIdSeen: 6 },
  { ...installedFacts, collaborator: false, accountIdSeen: 0 }, { ...installedFacts, permission: PermissionUnknown },
  { ...installedFacts, permissionLookupFailed: true })
```

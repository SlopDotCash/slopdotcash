# Private reporting readiness and repository access

PRD section 4 (self-service project setup) and the private-reporting
requirements of the security area. Source at the development head:
`workers/slopbot/reporting-readiness.ts` (`refreshRegisteredReporting`),
`reporting-readiness-service.ts` (the private `ReportingReadinessRefresher`
binding called by the identity schedule), `repository-access.ts`
(`readRepositoryAccess`, `handleRepositoryAccess`) and
`backend/security/reporting-readiness.ts` (`reportingTarget`,
`refreshReportingObservation`, `cachedReportingReadiness`). Slopbot owns the
`repository_reporting_status` rows. The repository-access consumer, which
binds the answer to the acting account and the stored repository, is
[projects](../backend/projects.md) "Authority is one read bound to the
acting account and the stored repository". Merge activity is
[Points merge activity](../points/mergeActivity.md), not this library.

This is a library: the shell runs it on each scheduled refresh and each
internal request, and these definitions decide what it records and
answers. GitHub's answers reach it only as the typed facts below, read with
the App's own credentials.

## Story: Observe private reporting and answer repository access from the App's own reads

> As a project owner, I want Slop to know from GitHub itself whether private
> vulnerability reporting is ready on my registered repository and whether
> Slopbot is installed there, without any token or stale identity leaking
> into the answer.

### Each registered, non-retired project gets one private-reporting observation per run from the App's own read

Each run reads the projects in ID order and skips retired listings; paused
and unfunded projects are observed. The target is the project's security
intake repository, or its first repository, from the live registry at the
current revision; only the first repository carries the registered
permanent repository ID and node ID. The App's read answers verified (with
the enabled flag and the repository's identity), unavailable, App not
installed, or identity mismatch; a thrown read is unavailable. A verified
answer whose repository ID is not a positive integer, whose node ID is not
4 to 256 characters of `[A-Za-z0-9_=-]`, or whose identity differs from the
registered one becomes an identity mismatch. The row for project, revision
and lowercased repository path is written only by a newer attempt. The
first identity written stays. A failed attempt keeps the last verified
enabled flag and time and records its failure. An attempt whose identity
differs from the stored one keeps the stored values and records an
identity mismatch, and a verified attempt is reported verified only when
the stored identity is its own. Reading the cached row is
[security intake](../security/intake.md) "The private-reporting handoff
reads the repository's cached reporting observation, and an observation
older than its interval is StaleAccess": the row yields intake's
observation (`observationOf`), with readiness from `enabledKnown`,
`rowEnabled` and a positive verified time, `identityMatches` when the row's
identity equals the target's wherever the target names one, `refreshFailed`
when the last attempt's result is not verified, and the verified time as
`verifiedAt`.

```quint
import intake as I from "../security/intake"
type ReportingResult = ReportingVerified | ReportingUnavailable | AppNotInstalled | IdentityMismatch
type ReportingTarget = { expectedRepositoryId: int, expectedNodeId: str }
type ReportingRead = { readKind: ReportingResult, readEnabled: bool, readRepositoryId: int, readNodeId: str,
  nodeWellFormed: bool }
type ReportingRow = { rowRepositoryId: int, rowNodeId: str, enabledKnown: bool, rowEnabled: bool, verifiedAt: int,
  attemptedAt: int, failure: ReportingResult }
pure val emptyRow: ReportingRow = { rowRepositoryId: 0, rowNodeId: "", enabledKnown: false, rowEnabled: false,
  verifiedAt: 0, attemptedAt: 0, failure: ReportingVerified }
pure def checkedResult(read: ReportingRead, target: ReportingTarget): ReportingResult =
  if (read.readKind != ReportingVerified) read.readKind
  else if (read.readRepositoryId <= 0 or not(read.nodeWellFormed) or
    (target.expectedRepositoryId > 0 and read.readRepositoryId != target.expectedRepositoryId) or
    (target.expectedNodeId != "" and read.readNodeId != target.expectedNodeId)) IdentityMismatch
  else ReportingVerified
pure def mergeObservation(row: ReportingRow, result: ReportingResult, read: ReportingRead, at: int): ReportingRow =
  val verified = result == ReportingVerified
  val newId = if (verified) read.readRepositoryId else 0
  val newNode = if (verified) read.readNodeId else ""
  val same = row.rowRepositoryId == 0 or newId == 0 or (row.rowRepositoryId == newId and row.rowNodeId == newNode)
  if (at <= row.attemptedAt) row
  else { rowRepositoryId: if (row.rowRepositoryId > 0) row.rowRepositoryId else newId,
    rowNodeId: if (row.rowRepositoryId > 0) row.rowNodeId else newNode,
    enabledKnown: if (same and verified) true else row.enabledKnown,
    rowEnabled: if (same and verified) read.readEnabled else row.rowEnabled,
    verifiedAt: if (same and verified) at else row.verifiedAt,
    attemptedAt: at, failure: if (same) result else IdentityMismatch }
pure def refreshOutcome(row: ReportingRow, result: ReportingResult, read: ReportingRead, at: int): ReportingResult =
  val written = mergeObservation(row, result, read, at)
  if (result == ReportingVerified and
    (written.rowRepositoryId != read.readRepositoryId or written.rowNodeId != read.readNodeId)) IdentityMismatch
  else result
pure def observationOf(row: ReportingRow, target: ReportingTarget): I::ReportingObservation =
  { readiness: if (not(row.enabledKnown) or row.verifiedAt <= 0) I::ReadinessUnobserved
      else if (row.rowEnabled) I::ReadinessEnabled else I::ReadinessDisabled,
    identityMatches: (target.expectedRepositoryId <= 0 or row.rowRepositoryId == target.expectedRepositoryId) and
      (target.expectedNodeId == "" or row.rowNodeId == target.expectedNodeId),
    refreshFailed: row.failure != ReportingVerified, verifiedAtSecond: row.verifiedAt }
pure def lawForeignRowIsUnavailable(sampleRow: ReportingRow, sampleTarget: ReportingTarget, at: int): bool =
  (sampleTarget.expectedRepositoryId > 0 and sampleRow.rowRepositoryId != sampleTarget.expectedRepositoryId) implies
    I::handoffAvailability(observationOf(sampleRow, sampleTarget), at) == I::Unavailable
pure def lawFailedAttemptRowIsNeverFresh(sampleRow: ReportingRow, sampleTarget: ReportingTarget, at: int): bool =
  sampleRow.failure != ReportingVerified implies
    (I::handoffAvailability(observationOf(sampleRow, sampleTarget), at) != I::Enabled and
      I::handoffAvailability(observationOf(sampleRow, sampleTarget), at) != I::Disabled)
pure def lawFailedRefreshKeepsVerifiedFacts(sampleRow: ReportingRow, sampleRead: ReportingRead, at: int): bool =
  val result = if (sampleRead.readKind == ReportingVerified) ReportingUnavailable else sampleRead.readKind
  val after = mergeObservation(sampleRow, result, sampleRead, at)
  after.rowEnabled == sampleRow.rowEnabled and after.verifiedAt == sampleRow.verifiedAt and
    after.enabledKnown == sampleRow.enabledKnown
pure def lawStoredIdentityNeverReplaced(sampleRow: ReportingRow, sampleRead: ReportingRead, at: int): bool =
  sampleRow.rowRepositoryId > 0 implies
    mergeObservation(sampleRow, ReportingVerified, sampleRead, at).rowRepositoryId == sampleRow.rowRepositoryId
pure def lawOlderAttemptChangesNothing(sampleRow: ReportingRow, sampleRead: ReportingRead, at: int): bool =
  at <= sampleRow.attemptedAt implies mergeObservation(sampleRow, ReportingVerified, sampleRead, at) == sampleRow
pure def lawForeignIdentityIsMismatch(sampleRead: ReportingRead, sampleTarget: ReportingTarget): bool =
  (sampleTarget.expectedRepositoryId > 0 and sampleRead.readRepositoryId != sampleTarget.expectedRepositoryId) implies
    checkedResult(sampleRead, sampleTarget) != ReportingVerified
pure val verifiedRead: ReportingRead = { readKind: ReportingVerified, readEnabled: true, readRepositoryId: 7,
  readNodeId: "R_kgDO7", nodeWellFormed: true }
pure val sampleReadValues = Set(verifiedRead, { ...verifiedRead, readEnabled: false },
  { ...verifiedRead, readRepositoryId: 8, readNodeId: "R_kgDO8" }, { ...verifiedRead, nodeWellFormed: false },
  { ...verifiedRead, readKind: ReportingUnavailable }, { ...verifiedRead, readKind: AppNotInstalled })
pure val sampleRowValues = Set(emptyRow, { rowRepositoryId: 7, rowNodeId: "R_kgDO7", enabledKnown: true,
  rowEnabled: true, verifiedAt: 10, attemptedAt: 10, failure: ReportingVerified },
  { rowRepositoryId: 7, rowNodeId: "R_kgDO7", enabledKnown: true, rowEnabled: false, verifiedAt: 10,
    attemptedAt: 20, failure: ReportingUnavailable },
  { rowRepositoryId: 8, rowNodeId: "R_kgDO8", enabledKnown: true, rowEnabled: true, verifiedAt: 10,
    attemptedAt: 10, failure: ReportingVerified })
pure val sampleTargetValues = Set({ expectedRepositoryId: 7, expectedNodeId: "R_kgDO7" },
  { expectedRepositoryId: 0, expectedNodeId: "" })
pure val atValues = Set(5, 15, 30)
```

### A paused project without the App installed is a recorded state, never a refresh failure

The run reports how many projects it checked and how many failed. Every
non-verified result of a non-retired project is a failure, except App not
installed on a paused project: only its owner can change that, and
counting it would fail the hourly identity schedule indefinitely. An
active project without the App still counts as a failure.

```quint
type ObservedProject = { projectId: int, retired: bool, paused: bool, outcome: ReportingResult }
type RefreshTally = { checked: int, failed: int }
pure def countsAsFailure(p: ObservedProject): bool =
  not(p.retired) and p.outcome != ReportingVerified and not(p.outcome == AppNotInstalled and p.paused)
pure def refreshTally(projects: List[ObservedProject]): RefreshTally =
  { checked: projects.select(p => not(p.retired)).length(), failed: projects.select(p => countsAsFailure(p)).length() }
pure def lawPausedWithoutAppIsNoFailure(sampleProject: ObservedProject): bool =
  (sampleProject.paused and sampleProject.outcome == AppNotInstalled) implies not(countsAsFailure(sampleProject))
pure def lawActiveWithoutAppFails(sampleProject: ObservedProject): bool =
  (not(sampleProject.retired) and not(sampleProject.paused) and sampleProject.outcome == AppNotInstalled) implies
    countsAsFailure(sampleProject)
pure def lawRetiredNeverFails(sampleProject: ObservedProject): bool =
  sampleProject.retired implies not(countsAsFailure(sampleProject))
pure val sampleProjectValues = Set({ projectId: 1, retired: false, paused: true, outcome: AppNotInstalled },
  { projectId: 2, retired: false, paused: false, outcome: AppNotInstalled },
  { projectId: 3, retired: true, paused: false, outcome: ReportingUnavailable },
  { projectId: 4, retired: false, paused: true, outcome: IdentityMismatch },
  { projectId: 5, retired: false, paused: false, outcome: ReportingVerified })
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

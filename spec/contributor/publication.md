# Project skill publication and site discovery files

PRD section 4 "Skill source and installation", CLAUDE.md "Add a project",
"Project skills are generated, never stored per project" and "Public pages
never read chain or GitHub state live". The legacy Pages Function
(`backend/projects/skill-publication.ts`, routed by `functions/[[path]].ts`)
answers `GET` and `HEAD` for `/projects/<id>/<artifact>` and
`/.well-known/slop/projects.json` from the current D1 revision, the
project's [public read](../backend/listing.md), its admission clearance and
the build's template index, rendering each skill per request
([rendering](./skillRendering.md), after the
[substitution checks](./rendering.md)). The site build (`scripts/prepare-site.mjs`)
publishes the template index, the three global skills, the agent discovery files
and the protocol documents. This library holds the response and build
predicates; it keeps no state.

## Story: Serve a project's skills only while it is listed and cleared

### A restricted project's artifacts answer gone and an unlisted or retired project's answer not found

An artifact path is one of `skill.md`, `mission.md`, `codex.md`,
`claude.md`, `claude-code.md`, `manual.md`, `skill-manifest.json` (each also
with a `review-` prefix), `downloads/<name>.skill` and its `.sha256`
(`<name>` of 1 to 96 characters from `a-z0-9-`), `terms.json`, and the
aliases `SKILL.md` (for `skill.md`) and `review/SKILL.md` (for
`review-skill.md`), under a valid project id. A restricted project answers
410 with `This project is <state>. Its skills, guides and archives are not
available.`; an unregistered or retired project answers 404 `Project not
found.`. Both are decided before anything else is read.

```quint
import listing as L from "../backend/listing"
import projections as F from "../frontend/projections"
type HttpMethod = GetMethod | HeadMethod | OtherMethod
type RouteKind = DiscoveryRoute | TermsRoute | SkillArtifactRoute | NotArtifactRoute
type ClearanceRead = ClearanceCleared | ClearanceUnverified | ClearanceRefused
type Answer = Served | GoneRestricted | ProjectNotFound | SkillsNotPublished | NoUsableClearance
  | ArtifactNotFound | RetryLater | PassThrough
type ArtifactFacts = { read: L::PublicRead, active: bool, skillFields: bool, clearance: ClearanceRead,
  templateLoaded: bool, templateVerified: bool, artifactExists: bool, readFailed: bool, monthListing: MonthListing,
  intake: IntakeListing }
pure def canonicalArtifact(artifactName: str): str =
  if (artifactName == "SKILL.md") "skill.md" else if (artifactName == "review/SKILL.md") "review-skill.md" else artifactName
pure def answerStatus(answer: Answer): int =
  if (answer == Served) 200 else if (answer == GoneRestricted) 410 else if (answer == RetryLater) 503
  else if (answer == PassThrough) 0 else 404
pure def projectGate(known: ArtifactFacts): Answer =
  if (known.read == L::Gone) GoneRestricted else if (known.read == L::NotFound) ProjectNotFound else Served
pure def lawRestrictedIsGone(known: ArtifactFacts, route: RouteKind): bool =
  (known.read == L::Gone and not(known.readFailed) and (route == TermsRoute or route == SkillArtifactRoute))
    implies artifactAnswer(route, known) == GoneRestricted
pure def lawUnlistedIsNotFound(known: ArtifactFacts, route: RouteKind): bool =
  (known.read == L::NotFound and not(known.readFailed) and (route == TermsRoute or route == SkillArtifactRoute))
    implies artifactAnswer(route, known) == ProjectNotFound
pure def lawAliasesNameTheSkill(artifactName: str): bool =
  (artifactName == "SKILL.md" implies canonicalArtifact(artifactName) == "skill.md")
  and (artifactName == "review/SKILL.md" implies canonicalArtifact(artifactName) == "review-skill.md")
  and (artifactName != "SKILL.md" and artifactName != "review/SKILL.md" implies canonicalArtifact(artifactName) == artifactName)
```

### terms.json is served for every listed project, paused included, and carries only public program terms

`terms.json` is `{ schemaVersion: "1", projectId, status, steward,
authority, terms, securityBounty }` from the current manifest, with
`securityBounty` null when absent. It needs neither published skill fields
nor clearance. Security cases, reports and private amounts never leave the
restricted tables.

```quint
type TermsField = SchemaVersionField | ProjectIdField | StatusField | StewardField | AuthorityField
  | ProgramTermsField | SecurityBountyField | SecurityCaseField | PrivateReportField
pure val termsFields = List(SchemaVersionField, ProjectIdField, StatusField, StewardField, AuthorityField,
  ProgramTermsField, SecurityBountyField)
pure def publicProgramField(termsField: TermsField): bool = termsField != SecurityCaseField and termsField != PrivateReportField
pure def lawTermsArePublic(termsField: TermsField): bool = termsFields.includes(termsField) implies publicProgramField(termsField)
pure def lawTermsServedForListedProjects(known: ArtifactFacts): bool =
  (known.read == L::Listed and not(known.readFailed)) implies artifactAnswer(TermsRoute, known) == Served
```

### Skill artifacts need published skill fields and current clearance, and an unverified clearance answers retry

After the project gate, a skill artifact needs published generated skill
fields (the skill source is the canonical template and the contribution
fields exist), else 404 `This project has not published its skills yet.
Its maintainers must complete the contribution fields first.`. The build's
template index is then loaded; the admission clearance is read for the
project's captured revision and the index's `templateSha256`
(`security/admission.md`, "An assessment is bound to its queued revision,
commit and template"). An unverified clearance (retained evidence that
cannot be confirmed) answers 503 `Slop cannot confirm this repository's
retained admission evidence. Try again.`; any other non-cleared state
answers 404 with the no-usable-clearance text. A missing generated file
answers 404 `Artifact not found.`. A paused but cleared project still serves
its artifacts for inspection, while discovery and the installer refuse it:
this asymmetry is the legacy behaviour, kept on purpose.

```quint
pure def artifactAnswer(route: RouteKind, known: ArtifactFacts): Answer =
  if (route == NotArtifactRoute) PassThrough
  else if (known.readFailed) RetryLater
  else if (route == DiscoveryRoute) Served
  else if (projectGate(known) != Served) projectGate(known)
  else if (route == TermsRoute) Served
  else if (not(known.skillFields)) SkillsNotPublished
  else if (not(known.templateLoaded)) RetryLater
  else if (known.clearance == ClearanceUnverified) RetryLater
  else if (known.clearance != ClearanceCleared) NoUsableClearance
  else if (not(known.templateVerified)) RetryLater
  else if (not(known.artifactExists)) ArtifactNotFound
  else Served
pure def lawSkillNeedsFieldsAndClearance(known: ArtifactFacts): bool =
  artifactAnswer(SkillArtifactRoute, known) == Served implies
    known.read == L::Listed and known.skillFields and known.clearance == ClearanceCleared and known.templateVerified
pure def lawUnverifiedClearanceRetries(known: ArtifactFacts): bool =
  (known.read == L::Listed and not(known.readFailed) and known.skillFields and known.templateLoaded
    and known.clearance == ClearanceUnverified) implies answerStatus(artifactAnswer(SkillArtifactRoute, known)) == 503
pure def lawPausedClearedProjectStillServes(known: ArtifactFacts): bool =
  (artifactAnswer(SkillArtifactRoute, { ...known, active: true }) == Served)
    implies artifactAnswer(SkillArtifactRoute, { ...known, active: false }) == Served
```

### Discovery lists one row per repository of each installable project with published generated skills

`/.well-known/slop/projects.json` is `{ schemaVersion: "1", projects }`. A
project contributes rows only when its public read is listed, its status is
active (not paused), it publishes generated skills, it is not left out as
not listed this month or paused at its intake cap (below) and its clearance for the index's
`templateSha256` is cleared; an unverified clearance leaves it out rather
than failing the index. Each of its repositories gives one row:
`project_id`, `project_url` (`https://slop.cash/projects/<id>/`),
`repository` (the repository's last alias, else its id), `review_skill`,
`review_skill_manifest`
(`https://slop.cash/projects/<id>/review-skill-manifest.json`), `skill` and
`skill_source`. Apart from the month listing and the intake cap, this gate is exactly the
installer's (`frontend/projections.md` `installable`, used by
[skill authority](./skillAuthority.md)).

```quint
type RepositoryEntry = { id: str, lastAlias: str }
type DiscoveryRow = { projectId: str, repositoryName: str }
pure def discoverable(known: ArtifactFacts): bool =
  known.read == L::Listed and known.active and known.skillFields and known.clearance == ClearanceCleared
  and known.monthListing == ListedThisMonth and known.intake != IntakePaused
pure def discoveryRows(known: ArtifactFacts, projectId: str, repositories: List[RepositoryEntry]): List[DiscoveryRow] =
  if (discoverable(known))
    repositories.listMap(x => { projectId: projectId, repositoryName: if (x.lastAlias != "") x.lastAlias else x.id })
  else List()
pure def factsOfView(view: F::ProjectView): ArtifactFacts =
  { read: if (not(F::listed(view))) L::NotFound else if (view.flagged or view.quarantined) L::Gone else L::Listed,
    active: not(view.paused), skillFields: view.skillFields,
    clearance: if (view.cleared) ClearanceCleared else ClearanceRefused,
    templateLoaded: true, templateVerified: true, artifactExists: true, readFailed: false, monthListing: ListedThisMonth,
    intake: IntakeOpen }
pure def lawDiscoveryMatchesInstallerGate(view: F::ProjectView): bool = discoverable(factsOfView(view)) iff F::installable(view)
pure def lawOneRowPerRepository(known: ArtifactFacts, projectId: str, repositories: List[RepositoryEntry]): bool =
  discoveryRows(known, projectId, repositories).length() == (if (discoverable(known)) repositories.length() else 0)
pure def lawPausedProjectNotDiscovered(known: ArtifactFacts): bool = not(known.active) implies not(discoverable(known))
```

### Discovery leaves out a monthly pool configured at zero this month or a project paused at its intake cap, and a failed count read pauses nothing

Discovery reads no vault funding (operator decision, 18 November 2026). The
month listing comes from the registry alone: a project is listed this month when `listedThisMonth` of the
[monthly listing](../frontend/poolListing.md) holds for its manifest, so an
active monthly pool with no open security program and a configured amount of
zero for the current UTC month (the month's `cycleCaps` override, else
`monthlyCapMinor`) is `NotListedThisMonth`, whatever any vault holds, and a
pool with a positive configured amount is listed whether or not it is
vaulted. Beside the project list, discovery reads the stored intake counts of
the [merge activity](../backend/mergeActivity.md) once: a project that the
[intake cap](../backend/intakeCap.md) has paused (its cap is set and a count
of one of its repositories at or above it was observed no more than 72 hours
ago) is `IntakePaused` and left out until a later count falls below the cap.
A read that is absent, empty or null, or that throws, is `IntakeUnread` and
pauses nothing; one that throws logs `project discovery intake counts
unavailable`. A project with no stored count pauses nothing. The discovery
answer is `no-store` like every other, so the next request reads the counts
again. Both gates change discovery only: the project's skills, guides,
archives and `terms.json` keep serving by direct link, and the installer's
gate is unchanged.

```quint
import poolListing as PL from "../frontend/poolListing"
import intakeCap as IC from "../backend/intakeCap"
type MonthListing = ListedThisMonth | NotListedThisMonth
type IntakeListing = IntakeOpen | IntakePaused | IntakeUnread
pure def monthListingOf(facts: PL::ListingFacts): MonthListing =
  if (PL::listedThisMonth(facts)) ListedThisMonth else NotListedThisMonth
pure def intakeListingOf(countsRead: bool, cap: int, projectActive: bool, now: int, counts: List[IC::StoredCount]): IntakeListing =
  if (not(countsRead)) IntakeUnread
  else if (IC::paused({ ...IC::initial, cap: cap, active: projectActive, now: now, counts: counts })) IntakePaused
  else IntakeOpen
pure def lawNotListedProjectNotDiscovered(known: ArtifactFacts): bool =
  known.monthListing == NotListedThisMonth implies not(discoverable(known))
pure def lawMonthListingFollowsTheRegistry(facts: PL::ListingFacts): bool =
  (monthListingOf(facts) == ListedThisMonth) iff PL::listedThisMonth(facts)
pure def lawPausedAtCapNotDiscovered(known: ArtifactFacts): bool =
  known.intake == IntakePaused implies not(discoverable(known))
pure def lawFailedCountReadPausesNothing(known: ArtifactFacts): bool =
  discoverable({ ...known, intake: IntakeUnread }) iff discoverable({ ...known, intake: IntakeOpen })
pure def lawUnreadCountsPauseNothing(cap: int, projectActive: bool, now: int, counts: List[IC::StoredCount]): bool =
  intakeListingOf(false, cap, projectActive, now, counts) == IntakeUnread
  and intakeListingOf(true, cap, projectActive, now, List()) == IntakeOpen
pure def lawRecentCountAtCapPauses(cap: int, now: int, counts: List[IC::StoredCount]): bool =
  (cap >= IC::minCap and counts.some(c => IC::countAtCap(cap, c, now)))
    implies intakeListingOf(true, cap, true, now, counts) == IntakePaused
pure def lawListingGatesServeByDirectLink(known: ArtifactFacts, route: RouteKind): bool =
  route != DiscoveryRoute implies
    artifactAnswer(route, { ...known, monthListing: NotListedThisMonth, intake: IntakePaused })
      == artifactAnswer(route, { ...known, monthListing: ListedThisMonth, intake: IntakeOpen })
pure def lawDiscoveryIsInstallerGateListedAndOpen(view: F::ProjectView, listing: MonthListing, intake: IntakeListing): bool =
  discoverable({ ...factsOfView(view), monthListing: listing, intake: intake })
    iff (F::installable(view) and listing == ListedThisMonth and intake != IntakePaused)
```

### Every artifact response is uncached, cross-origin readable, framed nowhere and has no body on HEAD

Only `GET` and `HEAD` on an artifact or discovery path are answered; every
other request passes to the site. Every answer, error included, carries
`cache-control: no-store` (clearance depends on current evidence and expiry,
so a cached response could outlive it), `access-control-allow-origin: *`,
`content-security-policy: default-src 'none'; frame-ancestors 'none'`,
`referrer-policy: no-referrer`,
`strict-transport-security: max-age=31536000; includeSubDomains` and
`x-content-type-options: nosniff`. The content type follows the extension
(`.md` Markdown, `.json` JSON, `.sha256` plain text, otherwise octet
stream) and a `downloads/*.skill` archive is an attachment. Errors are plain
text. A `HEAD` answer has the status and headers and no body. Any failure
while reading answers 503 `Project artifacts are unavailable. Try again.`.

```quint
type ArtifactResponse = { status: int, noStore: bool, anyOrigin: bool, frameAncestorsNone: bool, withBody: bool }
pure def handled(method: HttpMethod, route: RouteKind): bool =
  (method == GetMethod or method == HeadMethod) and route != NotArtifactRoute
pure def respond(method: HttpMethod, route: RouteKind, answer: Answer): ArtifactResponse =
  if (not(handled(method, route))) { status: 0, noStore: false, anyOrigin: false, frameAncestorsNone: false, withBody: false }
  else { status: answerStatus(answer), noStore: true, anyOrigin: true, frameAncestorsNone: true, withBody: method == GetMethod }
pure def lawHandledResponsesAreUncachedAndUnframed(method: HttpMethod, route: RouteKind, answer: Answer): bool =
  handled(method, route) implies
    respond(method, route, answer).noStore and respond(method, route, answer).anyOrigin
    and respond(method, route, answer).frameAncestorsNone
pure def lawHeadHasNoBody(route: RouteKind, answer: Answer): bool = not(respond(HeadMethod, route, answer).withBody)
pure def lawOtherMethodsPassThrough(route: RouteKind): bool = not(handled(OtherMethod, route))
  and not(handled(GetMethod, NotArtifactRoute))
```

## Story: Publish the build's template index with exact provenance

The site build publishes the two canonical template trees under
`/skill-templates/` with `/skill-templates/index.json`. The six renderer
source paths, their order and the `templateSha256` formula are fixed; their
digests are of the bytes the build reads (whether those equal the build
commit's is the separate revision status below), so a change to any of them (as
`development` made to `src/lib/project-schema.mjs` in b43a64dac and
47f9b35c1) yields a new `templateSha256` and every clearance then binds the
new digest (VET-07). The build commit is still no input.

### The template index binds templateSha256 to the template, renderer and accepted-revision digests

Each template tree must be 1 to 32 regular files (no symbolic link or other
special file), hold neither `PROVENANCE.json` nor `project.json`, and list
exactly the paths Git tracks under it. The index records, for each role, the
source path and every file's path and SHA-256 in sorted order; the renderer
sources `scripts/render-install-guide.mjs`, `src/lib/install-command.ts`,
`skills/project-contributor-template/scripts/skill-authority.mjs`,
`src/lib/project-skill-publication.mjs`, `src/lib/project-skill.mjs` and
`src/lib/project-schema.mjs` in that order with their SHA-256; and the
accepted revisions. `templateSha256` is the SHA-256 of
`JSON.stringify({ contributor: { sourcePath, files }, reviewer: { sourcePath,
files }, rendererSources, acceptedRevisions })`. The build commit and the
revision statuses are not inputs, so an unrelated deploy keeps every
clearance (VET-07) and staging and production share it.

```quint
type RevisionStatus = CommittedStatus | WorkingTreeStatus
type SourceFile = { path: str, working: str, committed: str }
type FileDigest = { path: str, sha256: str }
type TemplateGroup = { sourcePath: str, files: List[SourceFile], trackedPaths: List[str], committedPaths: List[str],
  regularFiles: bool }
type TemplateIndexBuild = { commit: str, contributor: TemplateGroup, reviewer: TemplateGroup,
  rendererSources: List[SourceFile], acceptedRevisions: List[str] }
type TemplateBinding = { contributorPath: str, contributorFiles: List[FileDigest], reviewerPath: str,
  reviewerFiles: List[FileDigest], rendererDigests: List[FileDigest], accepted: List[str] }
pure val frozenRendererPaths = List("scripts/render-install-guide.mjs", "src/lib/install-command.ts",
  "skills/project-contributor-template/scripts/skill-authority.mjs", "src/lib/project-skill-publication.mjs",
  "src/lib/project-skill.mjs", "src/lib/project-schema.mjs")
pure val maxTemplateFiles = 32
pure def groupPaths(g: TemplateGroup): List[str] = g.files.listMap(x => x.path)
pure def digests(sourceFiles: List[SourceFile]): List[FileDigest] = sourceFiles.listMap(x => { path: x.path, sha256: x.working })
pure def groupPublishable(g: TemplateGroup): bool = g.regularFiles and g.files.length() >= 1
  and g.files.length() <= maxTemplateFiles and not(groupPaths(g).includes("PROVENANCE.json"))
  and not(groupPaths(g).includes("project.json")) and groupPaths(g) == g.trackedPaths
pure def indexPublishable(i: TemplateIndexBuild): bool = groupPublishable(i.contributor) and groupPublishable(i.reviewer)
  and i.contributor.sourcePath == "skills/project-contributor-template"
  and i.reviewer.sourcePath == "skills/project-reviewer-template"
  and i.rendererSources.listMap(x => x.path) == frozenRendererPaths
pure def templateBinding(i: TemplateIndexBuild): TemplateBinding =
  { contributorPath: i.contributor.sourcePath, contributorFiles: digests(i.contributor.files),
    reviewerPath: i.reviewer.sourcePath, reviewerFiles: digests(i.reviewer.files),
    rendererDigests: digests(i.rendererSources), accepted: i.acceptedRevisions }
pure def lawBindingIgnoresBuildCommit(i: TemplateIndexBuild, commit: str): bool =
  templateBinding({ ...i, commit: commit }) == templateBinding(i)
pure def lawPublishedIndexUsesFrozenRenderers(i: TemplateIndexBuild): bool =
  indexPublishable(i) implies i.rendererSources.listMap(x => x.path) == frozenRendererPaths
```

### Only bytes equal to the build commit's tracked tree are labelled committed

A template tree is `committed` only when the build commit's tree lists
exactly its paths and every working file equals its committed blob byte for
byte; the index is `committed` only when both trees are. The renderer is
`committed` only when the three guide renderer files (the first three
renderer sources) equal their committed bytes. Anything else, a missing
committed file included, is `working-tree`, and installers refuse
working-tree provenance ([skill authority](./skillAuthority.md)).

```quint
pure def sourceStatus(sourceFiles: List[SourceFile]): RevisionStatus =
  if (sourceFiles.length() > 0 and sourceFiles.every(x => x.committed != "" and x.working == x.committed)) CommittedStatus
  else WorkingTreeStatus
pure def groupStatus(g: TemplateGroup): RevisionStatus =
  if (g.committedPaths == groupPaths(g)) sourceStatus(g.files) else WorkingTreeStatus
pure def indexStatus(i: TemplateIndexBuild): RevisionStatus =
  if (groupStatus(i.contributor) == CommittedStatus and groupStatus(i.reviewer) == CommittedStatus) CommittedStatus
  else WorkingTreeStatus
pure def guideRendererStatus(i: TemplateIndexBuild): RevisionStatus =
  sourceStatus(i.rendererSources.select(x => guideRendererPaths.includes(x.path)))
pure def lawCommittedMeansExactBytes(g: TemplateGroup): bool =
  groupStatus(g) == CommittedStatus implies
    g.files.length() > 0 and g.committedPaths == groupPaths(g) and g.files.every(x => x.committed != "" and x.working == x.committed)
pure def lawIndexCommittedNeedsBothTrees(i: TemplateIndexBuild): bool =
  indexStatus(i) == CommittedStatus implies groupStatus(i.contributor) == CommittedStatus and groupStatus(i.reviewer) == CommittedStatus
```

### The server renders only template files whose bytes match the index digest

Before rendering a role, the server checks that the index names the role's
template path and a full 40-character commit, and reads each listed file
(path separators normalized to `/`) from the build's static assets: a file
larger than 1 MiB, missing, or whose SHA-256 differs from the index entry
fails the request with 503. Only verified bytes reach the renderer.

```quint
type ServedTemplateFile = { indexed: str, servedSha256: str, size: int, present: bool }
pure val maxTemplateFileBytes = 1048576
pure def templateFilesVerified(files: List[ServedTemplateFile]): bool =
  files.every(x => x.present and x.size <= maxTemplateFileBytes and x.servedSha256 == x.indexed)
pure def lawServedSkillUsesVerifiedTemplate(known: ArtifactFacts): bool =
  artifactAnswer(SkillArtifactRoute, known) == Served implies known.templateLoaded and known.templateVerified
pure def lawMismatchedTemplateRetries(known: ArtifactFacts): bool =
  (known.read == L::Listed and not(known.readFailed) and known.skillFields and known.templateLoaded
    and known.clearance == ClearanceCleared and not(known.templateVerified))
    implies artifactAnswer(SkillArtifactRoute, known) == RetryLater
```

## Story: Publish the three global skills and agent discovery files from one source

The bootstrap was revised into an entry skill and two role skills
(`development` 52fc7cd79, 13 November 2026): `skills/slop/SKILL.md` routes
to `skills/slop-contributor/SKILL.md`, which carries the renderer contract,
and to `skills/slop-maintainer/SKILL.md`. The renderer paths did not change.

### Each global skill, its discovery copy, its index entry and llms.txt carry the same digest

The global skills, in this fixed order, are `slop` at `/SKILL.md` ("Slop
entry skill"), `slop-contributor` at `/contribute/SKILL.md` ("Contributor
skill") and `slop-maintainer` at `/maintain/SKILL.md` ("Maintainer skill").
Each source is exactly one regular file, `skills/<name>/SKILL.md`, accepted
by the skill validator, named `<name>` in its front matter and with a
description. Every role is validated before any published skill file is
removed, so one refused source fails the build and leaves the old
`/.well-known/agent-skills/`, `/contribute/` and `/maintain/` trees in place.
The build then removes those three trees and, role by role, copies each
source unchanged to its path and then to
`/.well-known/agent-skills/<name>/SKILL.md`; after every copy it writes
`/.well-known/agent-skills/index.json` (schema
`https://schemas.agentskills.io/discovery/0.2.0/schema.json`) listing the
three in order, each with its name, type `skill-md`, description, URL
`https://slop.cash/<path>` and digest `sha256:<SHA-256 of the source
bytes>`; then `llms.txt`, which lists each with its label, URL, description
and the same SHA-256; and last `skill-manifest.json`. A write that fails
before the index leaves neither a new index nor a new manifest, and one that
fails after it leaves no new manifest.

```quint
type GlobalRole = SlopEntry | SlopContributor | SlopMaintainer
type GlobalSource = { role: GlobalRole, files: List[str], name: str, validated: bool, bytes: SourceFile }
type GlobalOutput = { role: GlobalRole, canonicalDigest: str, aliasDigest: str, indexDigest: str, manifestDigest: str,
  llmsDigest: str, revision: str, status: RevisionStatus }
type WriteKind = RemoveTree | CanonicalCopy | DiscoveryAlias | DiscoveryIndex | LlmsText | SkillManifest
type GlobalWrite = { kind: WriteKind, path: str }
pure val globalRoles = List(SlopEntry, SlopContributor, SlopMaintainer)
pure def roleName(role: GlobalRole): str =
  if (role == SlopEntry) "slop" else if (role == SlopContributor) "slop-contributor" else "slop-maintainer"
pure def rolePath(role: GlobalRole): str =
  if (role == SlopEntry) "SKILL.md" else if (role == SlopContributor) "contribute/SKILL.md" else "maintain/SKILL.md"
pure def roleAlias(role: GlobalRole): str =
  if (role == SlopEntry) ".well-known/agent-skills/slop/SKILL.md"
  else if (role == SlopContributor) ".well-known/agent-skills/slop-contributor/SKILL.md"
  else ".well-known/agent-skills/slop-maintainer/SKILL.md"
pure def roleSource(role: GlobalRole): str =
  if (role == SlopEntry) "skills/slop/SKILL.md" else if (role == SlopContributor) "skills/slop-contributor/SKILL.md"
  else "skills/slop-maintainer/SKILL.md"
pure def roleLabel(role: GlobalRole): str =
  if (role == SlopEntry) "Slop entry skill" else if (role == SlopContributor) "Contributor skill" else "Maintainer skill"
pure val removedTrees = List(".well-known/agent-skills", "contribute", "maintain")
pure val noWrite: GlobalWrite = { kind: RemoveTree, path: "" }
pure def globalSourcePublishable(source: GlobalSource): bool =
  source.files == List("SKILL.md") and source.name == roleName(source.role) and source.validated
  and source.bytes.working != ""
pure def globalSourcesValid(sources: List[GlobalSource]): bool =
  sources.listMap(x => x.role) == globalRoles and sources.every(x => globalSourcePublishable(x))
pure def globalOutput(source: GlobalSource, commit: str): GlobalOutput =
  { role: source.role, canonicalDigest: source.bytes.working, aliasDigest: source.bytes.working,
    indexDigest: source.bytes.working, manifestDigest: source.bytes.working, llmsDigest: source.bytes.working,
    revision: commit, status: sourceStatus(List(source.bytes)) }
pure def globalOutputs(sources: List[GlobalSource], commit: str): List[GlobalOutput] =
  sources.listMap(x => globalOutput(x, commit))
pure def roleWrites(role: GlobalRole): List[GlobalWrite] =
  List({ kind: CanonicalCopy, path: rolePath(role) }, { kind: DiscoveryAlias, path: roleAlias(role) })
pure def globalWrites(sources: List[GlobalSource]): List[GlobalWrite] =
  if (not(globalSourcesValid(sources))) List()
  else removedTrees.listMap(x => { kind: RemoveTree, path: x })
    .concat(globalRoles.foldl(List(), (written, r) => written.concat(roleWrites(r))))
    .concat(List({ kind: DiscoveryIndex, path: ".well-known/agent-skills/index.json" }, { kind: LlmsText, path: "llms.txt" },
      { kind: SkillManifest, path: "skill-manifest.json" }))
pure def lawGlobalDigestsAgree(sources: List[GlobalSource], commit: str): bool =
  globalOutputs(sources, commit).every(o => o.canonicalDigest == o.indexDigest and o.aliasDigest == o.indexDigest
    and o.manifestDigest == o.indexDigest and o.llmsDigest == o.indexDigest and o.revision == commit)
  and globalOutputs(sources, commit).listMap(o => o.indexDigest) == sources.listMap(x => x.bytes.working)
pure def lawGlobalOrderIsFixed(sources: List[GlobalSource], commit: str): bool =
  globalSourcesValid(sources) implies globalOutputs(sources, commit).listMap(o => o.role) == globalRoles
pure def lawOneRefusedRolePublishesNothing(sources: List[GlobalSource]): bool =
  sources.some(x => not(globalSourcePublishable(x))) implies not(globalSourcesValid(sources)) and globalWrites(sources) == List()
pure def lawEachAliasFollowsItsCopyAndMetadataComesLast(sources: List[GlobalSource]): bool =
  val w = globalWrites(sources)
  globalSourcesValid(sources) implies
    w.length() == 12 and List(0, 1, 2).every(i => w.nthOr(i, noWrite).kind == RemoveTree
      and w.nthOr(3 + 2 * i, noWrite) == { kind: CanonicalCopy, path: rolePath(globalRoles.nthOr(i, SlopEntry)) }
      and w.nthOr(4 + 2 * i, noWrite) == { kind: DiscoveryAlias, path: roleAlias(globalRoles.nthOr(i, SlopEntry)) })
    and w.nthOr(9, noWrite).kind == DiscoveryIndex and w.nthOr(10, noWrite).kind == LlmsText
    and w.nthOr(11, noWrite).kind == SkillManifest
```

### llms.txt and skill-manifest.json state the build commit and its committed or working-tree status

Each skill's line in `/llms.txt` names its source revision as the full build
commit followed by `(committed)` when its bytes equal the commit's
`skills/<name>/SKILL.md`, else `(working-tree)`; `llms.txt` also links the
discovery index and the skill manifest. `/skill-manifest.json` is
`{ schemaVersion: "1", name: null, repository: "SlopDotCash/slopdotcash",
revision: <commit>, revisionStatus, skills, generatedAt }`, where `skills`
lists the three in order as `{ name, source: skills/<name>/SKILL.md, url,
digest, revision, revisionStatus }` with each skill's own status, and the
top-level `revisionStatus` is `committed` only when every skill's is. The
build refuses a commit that is not 40 lowercase hexadecimal characters.

```quint
pure def manifestStatus(sources: List[GlobalSource]): RevisionStatus =
  if (sources.every(x => sourceStatus(List(x.bytes)) == CommittedStatus)) CommittedStatus else WorkingTreeStatus
pure def lawGlobalStatusIsExact(source: GlobalSource, commit: str): bool =
  (globalOutput(source, commit).status == CommittedStatus iff
    (source.bytes.committed != "" and source.bytes.working == source.bytes.committed))
  and globalOutput(source, commit).revision == commit
pure def lawManifestCommittedNeedsEverySkill(sources: List[GlobalSource]): bool =
  (manifestStatus(sources) == CommittedStatus) iff
    sources.every(x => x.bytes.committed != "" and x.bytes.working == x.bytes.committed)
```

### The bootstrap's renderer contract names files that exist byte-identical at the build commit

The contributor skill (`skills/slop-contributor/SKILL.md`) carries the
renderer contract: it rebuilds each install guide from
`SlopDotCash/slopdotcash` at the manifest's revision with the entrypoint
`scripts/render-install-guide.mjs` and the paths
`scripts/render-install-guide.mjs`, `src/lib/install-command.ts` and, where
`install-command.ts` imports it,
`skills/project-contributor-template/scripts/skill-authority.mjs`. A guide
record names the build commit as its renderer revision only when those
files are committed at it; otherwise the revision is null and the
contributor skill refuses the guide. The build also fails when the template
paths inlined in `install-command.ts` differ from the project schema's; it
compares them after writing the global skills, so a failed build is never
deployed.

```quint
pure val guideRendererPaths = List("scripts/render-install-guide.mjs", "src/lib/install-command.ts",
  "skills/project-contributor-template/scripts/skill-authority.mjs")
pure def globalSetPublishable(sources: List[GlobalSource], templatePathsAgree: bool): bool =
  globalSourcesValid(sources) and templatePathsAgree
pure def guideRendererRevision(i: TemplateIndexBuild): str =
  if (guideRendererStatus(i) == CommittedStatus) i.commit else ""
pure def lawGuideRevisionOnlyWhenCommitted(i: TemplateIndexBuild): bool =
  guideRendererRevision(i) != "" implies guideRendererStatus(i) == CommittedStatus and guideRendererRevision(i) == i.commit
pure def lawGuidePathsAreRendererSources(i: TemplateIndexBuild): bool =
  indexPublishable(i) implies guideRendererPaths.every(x => i.rendererSources.listMap(y => y.path).includes(x))
pure def lawGlobalSetNeedsAgreeingTemplatePaths(sources: List[GlobalSource]): bool = not(globalSetPublishable(sources, false))
```

### Protocol documents are generated from their one maintained source and historical protocol links stay immutable

`/protocol/private-trace-v1.md` is `# Private trace privacy contract v1`, a
blank line, and the one maintained section `## Private trace privacy
contract` (in the legacy tree, of `backend/trace/README.md`), trimmed, with
its `###` headings raised to `##`. `/protocol/points-v1.md` and
`/protocol/scoring-v2.md` are `# Slop Points`, a link to PRD section 7 on the
`development` branch, that section with headings raised, and a historical
record section linking the former document at the immutable commit
`ebf468873147a7ec119858915deca6cb3177eb0d` (`protocol/<name>`).
`/protocol/identity-v1.json` is the validated identity record
(`scripts/protocol-identity.mjs` `IDENTITY_RECORD`) as two-space JSON with a
final newline. A missing source section or an invalid identity record fails
the build; no second copy of any of them is maintained.

```quint
type ProtocolDocument = PrivateTraceV1 | PointsV1 | ScoringV2 | IdentityV1
type DocumentSource = PrivacyContractSection | PrdSectionSeven | IdentityRecordSource
pure val historicalProtocolCommit = "ebf468873147a7ec119858915deca6cb3177eb0d"
pure def documentSource(doc: ProtocolDocument): DocumentSource =
  if (doc == PrivateTraceV1) PrivacyContractSection else if (doc == IdentityV1) IdentityRecordSource else PrdSectionSeven
pure def historicalLink(doc: ProtocolDocument): str =
  if (doc == PointsV1 or doc == ScoringV2) historicalProtocolCommit else ""
pure def protocolPublishable(sectionsFound: bool, identityValid: bool): bool = sectionsFound and identityValid
pure def lawPointsDocumentsKeepImmutableLink(doc: ProtocolDocument): bool =
  documentSource(doc) == PrdSectionSeven implies historicalLink(doc) == historicalProtocolCommit
pure def lawPrivacyContractHasOneSource(doc: ProtocolDocument): bool =
  documentSource(doc) == PrivacyContractSection iff doc == PrivateTraceV1
pure def lawMissingSourceFailsBuild(identityValid: bool): bool = not(protocolPublishable(false, identityValid))
```

### Simulation samples cover listed, paused, restricted and unverified projects and committed and working-tree builds

```quint
pure val servedFacts: ArtifactFacts = { read: L::Listed, active: true, skillFields: true, clearance: ClearanceCleared,
  templateLoaded: true, templateVerified: true, artifactExists: true, readFailed: false, monthListing: ListedThisMonth,
  intake: IntakeOpen }
pure val knownValues = Set(servedFacts, { ...servedFacts, active: false }, { ...servedFacts, read: L::Gone },
  { ...servedFacts, monthListing: NotListedThisMonth }, { ...servedFacts, intake: IntakePaused },
  { ...servedFacts, intake: IntakeUnread },
  { ...servedFacts, read: L::NotFound }, { ...servedFacts, clearance: ClearanceUnverified },
  { ...servedFacts, clearance: ClearanceRefused }, { ...servedFacts, skillFields: false },
  { ...servedFacts, templateVerified: false }, { ...servedFacts, readFailed: true })
pure val openProjectView: F::ProjectView = { registered: true, retired: false, legacy: false, paused: false, flagged: false,
  quarantined: false, cleared: true, skillFields: true }
pure val viewValues = Set(openProjectView, { ...openProjectView, paused: true }, { ...openProjectView, flagged: true },
  { ...openProjectView, retired: true }, { ...openProjectView, cleared: false })
pure val repositoriesValues = Set(List(), List({ id: "o/r", lastAlias: "" }, { id: "o/s", lastAlias: "n/s" }))
pure val listingValues = Set(ListedThisMonth, NotListedThisMonth)
pure val intakeValues = Set(IntakeOpen, IntakePaused, IntakeUnread)
pure val capValues = Set(0, 1, 3, 4)
pure val nowValues = Set(0)
pure val countsValues = Set(List(), List(IC::unread), List({ read: true, count: 3, observedAt: 0 }),
  List(IC::unread, { read: true, count: 3, observedAt: -72 }), List({ read: true, count: 3, observedAt: -73 }))
pure val factsValues = PL::listingValues
pure val projectIdValues = Set("p")
pure val artifactNameValues = Set("SKILL.md", "review/SKILL.md", "terms.json")
pure val committedFile: SourceFile = { path: "SKILL.md", working: "a", committed: "a" }
pure val groupA: TemplateGroup = { sourcePath: "skills/project-contributor-template", files: List(committedFile),
  trackedPaths: List("SKILL.md"), committedPaths: List("SKILL.md"), regularFiles: true }
pure val gValues = Set(groupA, { ...groupA, files: List({ ...committedFile, working: "b" }) },
  { ...groupA, committedPaths: List() }, { ...groupA, files: List(committedFile, { ...committedFile, path: "project.json" }) })
pure val rendererFiles = frozenRendererPaths.listMap(x => { path: x, working: "r", committed: "r" })
pure val indexA: TemplateIndexBuild = { commit: "0123456789abcdef0123456789abcdef01234567", contributor: groupA,
  reviewer: { ...groupA, sourcePath: "skills/project-reviewer-template" }, rendererSources: rendererFiles,
  acceptedRevisions: List("any committed template revision") }
pure val iValues = Set(indexA, { ...indexA, rendererSources: List() }, { ...indexA, reviewer: { ...groupA, committedPaths: List() } })
pure val commitValues = Set("0123456789abcdef0123456789abcdef01234567", "fedcba9876543210fedcba9876543210fedcba98")
pure val entrySource: GlobalSource = { role: SlopEntry, files: List("SKILL.md"), name: "slop", validated: true,
  bytes: committedFile }
pure val contributorSource: GlobalSource = { ...entrySource, role: SlopContributor, name: "slop-contributor" }
pure val maintainerSource: GlobalSource = { ...entrySource, role: SlopMaintainer, name: "slop-maintainer" }
pure val sourceValues = Set(entrySource, { ...entrySource, bytes: { ...committedFile, committed: "" } },
  { ...entrySource, files: List("SKILL.md", "extra.md") }, { ...maintainerSource, validated: false },
  { ...contributorSource, name: "slop" })
pure val sourcesValues = Set(List(entrySource, contributorSource, maintainerSource),
  List(entrySource, { ...contributorSource, bytes: { ...committedFile, working: "b" } }, maintainerSource),
  List(entrySource, contributorSource, { ...maintainerSource, validated: false }),
  List(entrySource, maintainerSource, contributorSource), List())
pure val filesValues = Set(List({ indexed: "a", servedSha256: "a", size: 1, present: true }),
  List({ indexed: "a", servedSha256: "b", size: 1, present: true }))
```

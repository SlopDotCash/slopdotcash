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
publishes the template index, the bootstrap skill, the agent discovery files
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
  templateLoaded: bool, templateVerified: bool, artifactExists: bool, readFailed: bool, monthListing: MonthListing }
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
unfunded this month (below) and its clearance for the index's
`templateSha256` is cleared; an unverified clearance leaves it out rather
than failing the index. Each of its repositories gives one row:
`project_id`, `project_url` (`https://slop.cash/projects/<id>/`),
`repository` (the repository's last alias, else its id), `review_skill`,
`review_skill_manifest`
(`https://slop.cash/projects/<id>/review-skill-manifest.json`), `skill` and
`skill_source`. Apart from the month listing, this gate is exactly the
installer's (`frontend/projections.md` `installable`, used by
[skill authority](./skillAuthority.md)).

```quint
type RepositoryEntry = { id: str, lastAlias: str }
type DiscoveryRow = { projectId: str, repositoryName: str }
pure def discoverable(known: ArtifactFacts): bool =
  known.read == L::Listed and known.active and known.skillFields and known.clearance == ClearanceCleared
  and known.monthListing != UnfundedThisMonth
pure def discoveryRows(known: ArtifactFacts, projectId: str, repositories: List[RepositoryEntry]): List[DiscoveryRow] =
  if (discoverable(known))
    repositories.listMap(x => { projectId: projectId, repositoryName: if (x.lastAlias != "") x.lastAlias else x.id })
  else List()
pure def factsOfView(view: F::ProjectView): ArtifactFacts =
  { read: if (not(F::listed(view))) L::NotFound else if (view.flagged or view.quarantined) L::Gone else L::Listed,
    active: not(view.paused), skillFields: view.skillFields,
    clearance: if (view.cleared) ClearanceCleared else ClearanceRefused,
    templateLoaded: true, templateVerified: true, artifactExists: true, readFailed: false, monthListing: ListedThisMonth }
pure def lawDiscoveryMatchesInstallerGate(view: F::ProjectView): bool = discoverable(factsOfView(view)) iff F::installable(view)
pure def lawOneRowPerRepository(known: ArtifactFacts, projectId: str, repositories: List[RepositoryEntry]): bool =
  discoveryRows(known, projectId, repositories).length() == (if (discoverable(known)) repositories.length() else 0)
pure def lawPausedProjectNotDiscovered(known: ArtifactFacts): bool = not(known.active) implies not(discoverable(known))
```

### Discovery leaves out a project not listed this month, and a failed funding read lists every cleared project

An unfunded monthly pool is not listed this month (operator decision,
16 November 2026). Discovery reads, on the server and beside the project
list, the cached vault rows behind `GET /api/v1/pool-funding`. A read that
throws or returns nothing is `FundingUnread`: it logs `project discovery pool
funding unavailable` and lists every cleared project as before, so a funding
outage never empties discovery. A successful read, an empty one included,
gives each candidate `ListedThisMonth` when `listedThisMonth` of the
[public projections](../frontend/projections.md) holds (a project whose
status is not active, any reward kind other than a monthly pool, an open
security program, or a monthly pool whose `poolDisplay` is `PoolFunded` for
the current period) and `UnfundedThisMonth` otherwise; the shell evaluates it
on the funding read and passes the result to `monthListingOf`. The discovery answer is `no-store` like every other, so the next
request reads the funding again. The month listing changes discovery only:
the project's skills, guides, archives and `terms.json` keep serving by
direct link, and the installer's gate is unchanged.

```quint
type MonthListing = ListedThisMonth | UnfundedThisMonth | FundingUnread
pure def monthListingOf(fundingRead: bool, predicateHolds: bool): MonthListing =
  if (not(fundingRead)) FundingUnread else if (predicateHolds) ListedThisMonth else UnfundedThisMonth
pure def lawUnfundedProjectNotDiscovered(known: ArtifactFacts): bool =
  known.monthListing == UnfundedThisMonth implies not(discoverable(known))
pure def lawFailedFundingReadListsAsBefore(known: ArtifactFacts): bool =
  discoverable({ ...known, monthListing: FundingUnread }) iff discoverable({ ...known, monthListing: ListedThisMonth })
pure def lawFundingReadDecidesOnlyWhenRead(predicateHolds: bool): bool =
  monthListingOf(false, predicateHolds) == FundingUnread
  and (monthListingOf(true, predicateHolds) == UnfundedThisMonth iff not(predicateHolds))
pure def lawUnfundedProjectServesByDirectLink(known: ArtifactFacts, route: RouteKind): bool =
  route != DiscoveryRoute implies
    artifactAnswer(route, { ...known, monthListing: UnfundedThisMonth })
      == artifactAnswer(route, { ...known, monthListing: ListedThisMonth })
pure def lawDiscoveryIsInstallerGateListedThisMonth(view: F::ProjectView, listing: MonthListing): bool =
  discoverable({ ...factsOfView(view), monthListing: listing }) iff (F::installable(view) and listing != UnfundedThisMonth)
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
`/skill-templates/` with `/skill-templates/index.json`. The owner's decision
on revising the renderer inputs is pending (inventory D3, ARCHITECTURE O7);
until it is made, the six renderer source paths and their bytes stay frozen
and the `templateSha256` formula is unchanged, so no project's clearance pin
changes. The alternative is a new template input set, which would re-queue
every clearance.

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

## Story: Publish the bootstrap skill and agent discovery files from one source

The owner's decision on revising the bootstrap is pending (inventory D1,
ARCHITECTURE O7). Until it is made, `scripts/render-install-guide.mjs`,
`src/lib/install-command.ts` and `skill-authority.mjs` keep their paths and
bytes and the bootstrap `skills/slop/SKILL.md` is not revised; the
alternative is a revised bootstrap with a new renderer contract, which every
installed bootstrap would then have to accept.

### The served bootstrap skill and the agent-skills index carry the same digest

The bootstrap source is exactly one regular file, `skills/slop/SKILL.md`,
named `slop` in its front matter and accepted by the skill validator. The
build copies it unchanged to `/SKILL.md` and
`/.well-known/agent-skills/slop/SKILL.md`, and writes
`/.well-known/agent-skills/index.json` (schema
`https://schemas.agentskills.io/discovery/0.2.0/schema.json`) with one
`skill-md` entry: its name, description, URL `https://slop.cash/SKILL.md`
and digest `sha256:<SHA-256 of the source bytes>`. `llms.txt` states the
same digest.

```quint
type BootstrapSource = { files: List[str], name: str, validated: bool, bytes: SourceFile }
type BootstrapOutputs = { rootDigest: str, discoveryCopyDigest: str, indexDigest: str, llmsDigest: str,
  revision: str, status: RevisionStatus }
pure def bootstrapPublishable(source: BootstrapSource, templatePathsAgree: bool): bool =
  source.files == List("SKILL.md") and source.name == "slop" and source.validated and source.bytes.working != ""
  and templatePathsAgree
pure def bootstrapOutputs(source: BootstrapSource, commit: str): BootstrapOutputs =
  { rootDigest: source.bytes.working, discoveryCopyDigest: source.bytes.working, indexDigest: source.bytes.working,
    llmsDigest: source.bytes.working, revision: commit, status: sourceStatus(List(source.bytes)) }
pure def lawBootstrapDigestsAgree(source: BootstrapSource, commit: str): bool =
  val outputs = bootstrapOutputs(source, commit)
  outputs.rootDigest == outputs.indexDigest and outputs.discoveryCopyDigest == outputs.indexDigest
  and outputs.llmsDigest == outputs.indexDigest and outputs.indexDigest == source.bytes.working
```

### llms.txt and skill-manifest.json state the build commit and its committed or working-tree status

`/llms.txt` names the bootstrap source revision as the full build commit
followed by `(committed)` when the bootstrap bytes equal the commit's
`skills/slop/SKILL.md`, else `(working-tree)`. `/skill-manifest.json` is
`{ schemaVersion: "1", name: null, repository: "SlopDotCash/slopdotcash",
revision: <commit>, revisionStatus, generatedAt }` with the same status. The
build refuses a commit that is not 40 lowercase hexadecimal characters.

```quint
pure def lawBootstrapStatusIsExact(source: BootstrapSource, commit: str): bool =
  (bootstrapOutputs(source, commit).status == CommittedStatus iff
    (source.bytes.committed != "" and source.bytes.working == source.bytes.committed))
  and bootstrapOutputs(source, commit).revision == commit
```

### The bootstrap's renderer contract names files that exist byte-identical at the build commit

The bootstrap rebuilds each install guide from `SlopDotCash/slopdotcash` at
the manifest's revision with the entrypoint `scripts/render-install-guide.mjs`
and the paths `scripts/render-install-guide.mjs`,
`src/lib/install-command.ts` and, where `install-command.ts` imports it,
`skills/project-contributor-template/scripts/skill-authority.mjs`. A guide
record names the build commit as its renderer revision only when those
files are committed at it; otherwise the revision is null and the bootstrap
refuses the guide. The build also refuses to publish when the template paths
inlined in `install-command.ts` differ from the project schema's.

```quint
pure val guideRendererPaths = List("scripts/render-install-guide.mjs", "src/lib/install-command.ts",
  "skills/project-contributor-template/scripts/skill-authority.mjs")
pure def guideRendererRevision(i: TemplateIndexBuild): str =
  if (guideRendererStatus(i) == CommittedStatus) i.commit else ""
pure def lawGuideRevisionOnlyWhenCommitted(i: TemplateIndexBuild): bool =
  guideRendererRevision(i) != "" implies guideRendererStatus(i) == CommittedStatus and guideRendererRevision(i) == i.commit
pure def lawGuidePathsAreRendererSources(i: TemplateIndexBuild): bool =
  indexPublishable(i) implies guideRendererPaths.every(x => i.rendererSources.listMap(y => y.path).includes(x))
pure def lawBootstrapNeedsAgreeingTemplatePaths(source: BootstrapSource): bool = not(bootstrapPublishable(source, false))
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
  templateLoaded: true, templateVerified: true, artifactExists: true, readFailed: false, monthListing: ListedThisMonth }
pure val knownValues = Set(servedFacts, { ...servedFacts, active: false }, { ...servedFacts, read: L::Gone },
  { ...servedFacts, monthListing: UnfundedThisMonth }, { ...servedFacts, monthListing: FundingUnread },
  { ...servedFacts, read: L::NotFound }, { ...servedFacts, clearance: ClearanceUnverified },
  { ...servedFacts, clearance: ClearanceRefused }, { ...servedFacts, skillFields: false },
  { ...servedFacts, templateVerified: false }, { ...servedFacts, readFailed: true })
pure val openProjectView: F::ProjectView = { registered: true, retired: false, legacy: false, paused: false, flagged: false,
  quarantined: false, cleared: true, skillFields: true }
pure val viewValues = Set(openProjectView, { ...openProjectView, paused: true }, { ...openProjectView, flagged: true },
  { ...openProjectView, retired: true }, { ...openProjectView, cleared: false })
pure val repositoriesValues = Set(List(), List({ id: "o/r", lastAlias: "" }, { id: "o/s", lastAlias: "n/s" }))
pure val listingValues = Set(ListedThisMonth, UnfundedThisMonth, FundingUnread)
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
pure val bootstrapA: BootstrapSource = { files: List("SKILL.md"), name: "slop", validated: true, bytes: committedFile }
pure val sourceValues = Set(bootstrapA, { ...bootstrapA, bytes: { ...committedFile, committed: "" } },
  { ...bootstrapA, files: List("SKILL.md", "extra.md") })
pure val filesValues = Set(List({ indexed: "a", servedSha256: "a", size: 1, present: true }),
  List({ indexed: "a", servedSha256: "b", size: 1, present: true }))
```

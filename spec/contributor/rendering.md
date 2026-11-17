# Generated project skill rendering

PRD section 4 "Skill source and installation" and SKL-03, and CLAUDE.md
"Project skills are generated, never stored per project". A project's
contributor and reviewer skills are rendered from the canonical template of
the role (`skills/project-contributor-template` or
`skills/project-reviewer-template`), the manifest of the project's approved
registry revision, and that revision's number and SHA-256 digest. Nothing
else is an input: not the provenance commit, the request, the clock or the
site build. The server renderer (`renderProjectSkill` in the frozen
`src/lib/project-skill.mjs`) and the installer's Python authority
(`render_project_skill` in the frozen
`skills/project-contributor-template/scripts/skill-authority.mjs`) are two
implementations of this one function. [Skill authority](./skillAuthority.md)
admits a generated skill only when this rendering equals the approved
registry digest, and [publication](./publication.md) serves it.

This library models the structure of a rendering: which files it has, which
text `SKILL.md` receives and which fields `project.json` carries. The parse of
`SKILL.md` into segments, the code-unit sort of paths and the exact bytes are
those of the frozen server renderer, checked against the Python authority by
the renderer parity journey.

## Story: Render the same skill from the same approved inputs

### The same template files, approved manifest, revision and digest render the same sorted bytes

A rendering is the template's files, with `SKILL.md` replaced by its
substituted text and `project.json` added, sorted by path in UTF-16 code-unit
order (Python's code-point order agrees for every committed template path).
Every other template file is copied byte for byte. `project.json` is
`JSON.stringify(record, null, 2)` followed by one newline, with keys in this
order: `schemaVersion` `"1"`, `projectId`, `repositoryId`, `skillName`,
`skillSourcePath` (the role's template path), `publicOrigin`
(`https://slop.cash/projects/<projectId>`), `policyAuthority`
(`https://slop.cash`), `usageAdapters` (`codex` to `codex`, `claude-code` to
`claude`, `grok-build` to `grok`), `registry` (`revision`, `manifestSha256`)
and `contribution`, the eight maintainer fields in the order `approvedScope`,
`contributionGuide`, `supportedTasks`, `requiredTests`,
`reviewExpectations`, `securityContact`, `closurePolicy`,
`maintainerNotes`. Because `render` takes no other parameter, equal inputs
give equal renderings.

```quint
type Role = ContributorRole | ReviewerRole
type SegmentKind = Literal | NamedToken | FencedBranchToken | StrayToken
type Segment = { kind: SegmentKind, text: str }
type PieceKind = Plain | BranchCodeSpan
type Piece = { piece: PieceKind, value: str }
type TemplateFile = { path: str, sha256: str }
type SkillTemplate = { role: Role, sourcePath: str, files: List[TemplateFile], skillText: List[Segment] }
type Manifest = { projectId: str, skillName: str, contributorSource: str, reviewerSource: str, repository: str, branch: str,
  idValid: bool, skillNameMatches: bool, repositoryValid: bool, branchValid: bool, contributionValid: bool,
  contribution: List[str] }
type RegistryBinding = { revision: int, manifestSha256: str, digestValid: bool }
type ProjectRecord = { projectId: str, repositoryId: str, skillName: str, skillSourcePath: str,
  registryRevision: int, registryDigest: str, contribution: List[str] }
type RenderOutcome = RenderedSkill | RefusedManifest | RefusedTemplate | RefusedPlaceholder
type Rendering = { outcome: RenderOutcome, copied: List[TemplateFile], skill: List[Piece], projectJson: ProjectRecord }
pure val contributorTemplatePath = "skills/project-contributor-template"
pure val reviewerTemplatePath = "skills/project-reviewer-template"
pure val contributionFieldCount = 8
pure def templatePath(role: Role): str = if (role == ContributorRole) contributorTemplatePath else reviewerTemplatePath
pure def declaredSource(m: Manifest, role: Role): str = if (role == ContributorRole) m.contributorSource else m.reviewerSource
pure val noProjectRecord: ProjectRecord = { projectId: "", repositoryId: "", skillName: "", skillSourcePath: "",
  registryRevision: 0, registryDigest: "", contribution: List() }
pure def projectRecord(t: SkillTemplate, m: Manifest, binding: RegistryBinding): ProjectRecord =
  { projectId: m.projectId, repositoryId: m.repository, skillName: m.skillName, skillSourcePath: templatePath(t.role),
    registryRevision: binding.revision, registryDigest: binding.manifestSha256, contribution: m.contribution }
pure def render(t: SkillTemplate, m: Manifest, binding: RegistryBinding): Rendering =
  val renderResult = renderOutcome(t, m, binding)
  if (renderResult == RenderedSkill)
    { outcome: renderResult, copied: t.files.select(f => f.path != "SKILL.md"), skill: substituted(t, m),
      projectJson: projectRecord(t, m, binding) }
  else { outcome: renderResult, copied: List(), skill: List(), projectJson: noProjectRecord }
pure def lawSameInputsSameRendering(t: SkillTemplate, other: SkillTemplate, m: Manifest, binding: RegistryBinding): bool =
  t == other implies render(t, m, binding) == render(other, m, binding)
pure def lawRenderingAddsOnlyProjectJson(t: SkillTemplate, m: Manifest, binding: RegistryBinding): bool =
  render(t, m, binding).copied.every(f => t.files.includes(f) and f.path != "SKILL.md" and f.path != "project.json")
  and t.files.every(f => f.path == "SKILL.md" or render(t, m, binding).outcome != RenderedSkill
    or render(t, m, binding).copied.includes(f))
```

### Substitution is one pass over the four published placeholders and any other SLOP placeholder refuses

`SKILL.md` is valid UTF-8 and is read as segments: literal text,
`{{SLOP_SKILL_NAME}}`, `{{SLOP_PROJECT_ID}}`, `{{SLOP_REPOSITORY}}`,
`{{SLOP_INTEGRATION_BRANCH}}`, and the integration-branch token written as
inline code (`` `{{SLOP_INTEGRATION_BRANCH}}` ``), which becomes the branch
in an inline code span fenced by one more backtick than the longest backtick
run in the branch name, with a space inside each fence when the name holds a
backtick (`branchCode`). Each token is replaced once, left to right, and a
substituted value is never scanned again: a branch name such as
`x{{SLOP_PROJECT_ID}}` is a valid Git branch and stays literal. Any other
`{{SLOP_[A-Z_]+}}` token refuses the rendering, and so does any other text
holding `{{SLOP_`, which the installer authority refuses; the legacy server
renderer left such text in place, and the server now adopts the
installer's refusal as a check before the frozen renderer runs (no committed
template holds such text; the owner's decision is pending, see the renderer
parity rule).

```quint
pure val placeholderNames = Set("SLOP_SKILL_NAME", "SLOP_PROJECT_ID", "SLOP_REPOSITORY", "SLOP_INTEGRATION_BRANCH")
pure def knownSegment(s: Segment): bool =
  s.kind == Literal or s.kind == FencedBranchToken or (s.kind == NamedToken and placeholderNames.contains(s.text))
pure def tokenValue(token: str, m: Manifest): str =
  if (token == "SLOP_SKILL_NAME") m.skillName else if (token == "SLOP_PROJECT_ID") m.projectId
  else if (token == "SLOP_REPOSITORY") m.repository else m.branch
pure def substitute(s: Segment, m: Manifest): Piece =
  if (s.kind == FencedBranchToken) { piece: BranchCodeSpan, value: m.branch }
  else if (s.kind == NamedToken) { piece: Plain, value: tokenValue(s.text, m) }
  else { piece: Plain, value: s.text }
pure def substituted(t: SkillTemplate, m: Manifest): List[Piece] = t.skillText.listMap(s => substitute(s, m))
pure def placeholdersKnown(t: SkillTemplate): bool = t.skillText.every(s => knownSegment(s))
pure def lawUnknownPlaceholderRefuses(t: SkillTemplate, m: Manifest, binding: RegistryBinding): bool =
  not(placeholdersKnown(t)) implies render(t, m, binding).outcome != RenderedSkill
pure def lawSubstitutedValueIsNotRescanned(m: Manifest): bool =
  substitute({ kind: NamedToken, text: "SLOP_INTEGRATION_BRANCH" }, m) == { piece: Plain, value: m.branch }
  and substitute({ kind: FencedBranchToken, text: "SLOP_INTEGRATION_BRANCH" }, m) == { piece: BranchCodeSpan, value: m.branch }
pure def lawSubstitutionKeepsLength(t: SkillTemplate, m: Manifest): bool = substituted(t, m).length() == t.skillText.length()
```

### A template that carries project.json or lacks SKILL.md, or a manifest that fails the field checks, refuses

The template must contain `SKILL.md` and must not contain `project.json`:
that file is always generated. The manifest's skill source for the role must
be the role's template path. The project id matches
`^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$`, the skill name is
`contribute-to-<id>` for a contributor and `review-<id>-contributions` for a
reviewer, the first repository id matches
`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`, its integration branch is a valid Git
branch name (`validIntegrationBranch`: 1 to 255 well-formed characters, not
`@` or `HEAD`, no leading `-`, trailing `.`, `..`, `@{`, `~^:?*[\`, control
character, empty or dot-led component or `.lock` component suffix), and all
eight contribution fields are present well-formed strings. The registry
revision is a whole number of at least 1 and its digest 64 lowercase
hexadecimal characters.

```quint
pure def manifestRenders(t: SkillTemplate, m: Manifest, binding: RegistryBinding): bool =
  t.sourcePath == templatePath(t.role) and declaredSource(m, t.role) == templatePath(t.role)
  and m.idValid and m.skillNameMatches and m.repositoryValid and m.branchValid
  and m.contributionValid and m.contribution.length() == contributionFieldCount
  and binding.revision >= 1 and binding.digestValid
pure def templateRenders(t: SkillTemplate): bool =
  t.files.some(f => f.path == "SKILL.md") and not(t.files.some(f => f.path == "project.json"))
pure def renderOutcome(t: SkillTemplate, m: Manifest, binding: RegistryBinding): RenderOutcome =
  if (not(manifestRenders(t, m, binding))) RefusedManifest
  else if (not(templateRenders(t))) RefusedTemplate
  else if (not(placeholdersKnown(t))) RefusedPlaceholder
  else RenderedSkill
pure def lawTemplateProjectJsonRefuses(t: SkillTemplate, m: Manifest, binding: RegistryBinding): bool =
  t.files.some(f => f.path == "project.json") implies render(t, m, binding).outcome != RenderedSkill
pure def lawRenderedNeedsCheckedFields(t: SkillTemplate, m: Manifest, binding: RegistryBinding): bool =
  render(t, m, binding).outcome == RenderedSkill implies
    m.idValid and m.skillNameMatches and m.repositoryValid and m.branchValid and m.contributionValid
    and binding.revision >= 1 and binding.digestValid and templateRenders(t)
```

### Maintainer fields appear only in project.json and never change template text

The eight contribution fields are maintainer-authored data. They are copied
into `project.json` and nowhere else: they cannot add, remove or reword any
template rule, and `SKILL.md` and every copied file are the same whatever
they say.

```quint
pure def lawContributionOnlyInProjectJson(t: SkillTemplate, m: Manifest, binding: RegistryBinding, contributionFields: List[str]): bool =
  val changed = { ...m, contribution: contributionFields }
  (contributionFields.length() == contributionFieldCount and m.contribution.length() == contributionFieldCount) implies
    (render(t, changed, binding).outcome == render(t, m, binding).outcome
     and render(t, changed, binding).skill == render(t, m, binding).skill
     and render(t, changed, binding).copied == render(t, m, binding).copied)
pure def lawContributionReachesProjectJson(t: SkillTemplate, m: Manifest, binding: RegistryBinding): bool =
  render(t, m, binding).outcome == RenderedSkill implies render(t, m, binding).projectJson.contribution == m.contribution
```

### The server renderer and the installer's Python renderer produce identical bytes for every committed template

The two legacy implementations checked slightly different things: only the
installer checked the generated skill name and refused stray `{{SLOP_` text,
and only the server checked the registry binding inside the renderer (the
installer validates the binding before it renders). Every approved revision
already carries the generated names (project schema validation), and no
committed template holds stray text, so on those inputs the two accept the
same renderings. The server applies the union of both checks
(`renderOutcome`): it refuses a misnamed skill or stray `{{SLOP_` text before
it renders, and otherwise produces its bytes by running the frozen
`src/lib/project-skill.mjs`, so the extra refusals never change a rendered
byte and the `templateSha256` pin, which hashes that file, still covers what
is served. The owner's decision on revising the renderer inputs is pending
(inventory D3, ARCHITECTURE O7): replacing the frozen file with a new
renderer, such as `//@` TypeScript in `apps/contributor`, waits on it,
because the new renderer's bytes are not among the `templateSha256` inputs.
Until it is made, the server must run, or byte-match, the frozen
`src/lib/project-skill.mjs`. The alternative to the union is the legacy
server's own acceptance (`serverRendererAccepts`: no skill-name check, stray
text left in place). Byte equality of the output (JSON escaping, UTF-8
encoding, path order) is the parity journey, which runs the frozen Python
authority on every committed template revision and every approved registry
revision in its fixture.

```quint
pure def serverRendererAccepts(t: SkillTemplate, m: Manifest, binding: RegistryBinding): bool =
  t.sourcePath == templatePath(t.role) and declaredSource(m, t.role) == templatePath(t.role)
  and m.idValid and m.repositoryValid and m.branchValid and m.contributionValid
  and m.contribution.length() == contributionFieldCount and binding.revision >= 1 and binding.digestValid
  and templateRenders(t) and t.skillText.every(s => s.kind != NamedToken or placeholderNames.contains(s.text))
pure def installerRendererAccepts(t: SkillTemplate, m: Manifest): bool =
  declaredSource(m, t.role) == templatePath(t.role) and m.idValid and m.skillNameMatches and m.repositoryValid
  and m.branchValid and m.contributionValid and m.contribution.length() == contributionFieldCount
  and templateRenders(t) and placeholdersKnown(t)
pure def committedInputs(t: SkillTemplate, m: Manifest, binding: RegistryBinding): bool =
  t.sourcePath == templatePath(t.role) and m.skillNameMatches and binding.revision >= 1 and binding.digestValid
  and t.skillText.every(s => s.kind != StrayToken)
pure def lawRenderersAgreeOnCommittedInputs(t: SkillTemplate, m: Manifest, binding: RegistryBinding): bool =
  committedInputs(t, m, binding) implies
    (serverRendererAccepts(t, m, binding) iff installerRendererAccepts(t, m))
    and (installerRendererAccepts(t, m) iff render(t, m, binding).outcome == RenderedSkill)
```

### Simulation samples cover clean, stray, misnamed and project.json templates

```quint
pure val skillFile: TemplateFile = { path: "SKILL.md", sha256: "s" }
pure val scriptFile: TemplateFile = { path: "scripts/run-receipt.mjs", sha256: "r" }
pure val cleanText = List({ kind: Literal, text: "Work on " }, { kind: NamedToken, text: "SLOP_REPOSITORY" },
  { kind: FencedBranchToken, text: "SLOP_INTEGRATION_BRANCH" })
pure val cleanTemplate: SkillTemplate = { role: ContributorRole, sourcePath: contributorTemplatePath,
  files: List(scriptFile, skillFile), skillText: cleanText }
pure val tValues = Set(cleanTemplate, { ...cleanTemplate, role: ReviewerRole, sourcePath: reviewerTemplatePath },
  { ...cleanTemplate, files: List(skillFile, { path: "project.json", sha256: "p" }) },
  { ...cleanTemplate, files: List(scriptFile) },
  { ...cleanTemplate, skillText: cleanText.append({ kind: NamedToken, text: "SLOP_OTHER" }) },
  { ...cleanTemplate, skillText: cleanText.append({ kind: StrayToken, text: "{{SLOP_x}}" }) })
pure val otherValues = tValues
pure val goodManifest: Manifest = { projectId: "p", skillName: "contribute-to-p", contributorSource: contributorTemplatePath,
  reviewerSource: reviewerTemplatePath, repository: "o/r", branch: "x{{SLOP_PROJECT_ID}}", idValid: true,
  skillNameMatches: true, repositoryValid: true, branchValid: true, contributionValid: true,
  contribution: List("a", "b", "c", "d", "e", "f", "g", "h") }
pure val mValues = Set(goodManifest, { ...goodManifest, skillNameMatches: false }, { ...goodManifest, branchValid: false },
  { ...goodManifest, contributorSource: "skills/contribute-to-p" }, { ...goodManifest, contribution: List("a") })
pure val bindingValues = Set({ revision: 1, manifestSha256: "m1", digestValid: true },
  { revision: 0, manifestSha256: "m1", digestValid: true }, { revision: 2, manifestSha256: "M", digestValid: false })
pure val contributionFieldsValues = Set(List("a", "b", "c", "d", "e", "f", "g", "h"), List("h", "g", "f", "e", "d", "c", "b", "a"), List())
```

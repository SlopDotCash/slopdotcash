# Skill template substitution and refusals

PRD section 4 "Skill source and installation" and SKL-03, and CLAUDE.md
"Project skills are generated, never stored per project". The
[skill rendering](./skillRendering.md) model states what a project skill is
rendered from (the canonical template of the role at its commit and the
approved D1 revision) and leaves placeholder substitution, encoding, archive
layout and file order to the shell. This library states the checks that
shell applies before it renders: which templates and manifests may be
rendered, and how the four published placeholders of `SKILL.md` are
substituted. The canonical templates are `skills/project-contributor-template`
and `skills/project-reviewer-template`. The server renderer
(`renderProjectSkill` in the frozen `src/lib/project-skill.mjs`) and the
installer's Python authority (`render_project_skill` in the frozen
`skills/project-contributor-template/scripts/skill-authority.mjs`) are two
implementations of the one rendering. [Skill authority](./skillAuthority.md)
admits a generated skill only when it equals that rendering, and
[publication](./publication.md) serves it.

The parse of `SKILL.md` into segments, the code-unit sort of paths and the
exact bytes are those of the frozen server renderer, checked against the
Python authority by the renderer parity journey.

## Story: Render the same skill from the same approved inputs

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
type RenderOutcome = RenderedSkill | RefusedManifest | RefusedTemplate | RefusedPlaceholder
pure val contributorTemplatePath = "skills/project-contributor-template"
pure val reviewerTemplatePath = "skills/project-reviewer-template"
pure val contributionFieldCount = 8
pure def templatePath(role: Role): str = if (role == ContributorRole) contributorTemplatePath else reviewerTemplatePath
pure def declaredSource(m: Manifest, role: Role): str = if (role == ContributorRole) m.contributorSource else m.reviewerSource
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
  not(placeholdersKnown(t)) implies renderOutcome(t, m, binding) != RenderedSkill
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
  t.files.some(f => f.path == "project.json") implies renderOutcome(t, m, binding) != RenderedSkill
pure def lawRenderedNeedsCheckedFields(t: SkillTemplate, m: Manifest, binding: RegistryBinding): bool =
  renderOutcome(t, m, binding) == RenderedSkill implies
    m.idValid and m.skillNameMatches and m.repositoryValid and m.branchValid and m.contributionValid
    and binding.revision >= 1 and binding.digestValid and templateRenders(t)
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
    and (installerRendererAccepts(t, m) iff renderOutcome(t, m, binding) == RenderedSkill)
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
pure val goodManifest: Manifest = { projectId: "p", skillName: "contribute-to-p", contributorSource: contributorTemplatePath,
  reviewerSource: reviewerTemplatePath, repository: "o/r", branch: "x{{SLOP_PROJECT_ID}}", idValid: true,
  skillNameMatches: true, repositoryValid: true, branchValid: true, contributionValid: true,
  contribution: List("a", "b", "c", "d", "e", "f", "g", "h") }
pure val mValues = Set(goodManifest, { ...goodManifest, skillNameMatches: false }, { ...goodManifest, branchValid: false },
  { ...goodManifest, contributorSource: "skills/contribute-to-p" }, { ...goodManifest, contribution: List("a") })
pure val bindingValues = Set({ revision: 1, manifestSha256: "m1", digestValid: true },
  { revision: 0, manifestSha256: "m1", digestValid: true }, { revision: 2, manifestSha256: "M", digestValid: false })
```

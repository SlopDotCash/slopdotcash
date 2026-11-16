# Generated project skill rendering

PRD section 4 (owner decision of 18 October 2026, SKL-03) and CLAUDE.md
"Project skills are generated" define one canonical generic template per
role and the approved D1 project revision as the only inputs of a project
skill. The source is `src/lib/project-skill.mjs` (`renderProjectSkill`) and
`src/lib/project-skill-publication.mjs`, which `scripts/prepare-site.mjs`
publishes as raw Markdown endpoints and `.skill` archives. No project keeps a
skill folder or copy of its own. The [authority component](./skillAuthority.md)
compares downloaded bytes with this rendering of the pair it admits.

## Story: Render one skill from the template commit and the approved revision

### Rendering depends only on the template commit and the approved revision

The rendered skill names the exact template commit and revision digest it
came from. Rendering is a pure function of those two inputs: the request
time, host and requester never reach it, so the same template revision and
D1 revision give the same bytes. Placeholder substitution, encoding and file
order are the shell's and need conformance evidence.

```quint
type Template = { commit: str, rules: List[str] }
type Revision = { digest: str, notes: List[str] }
type Rendered = { templateCommit: str, revisionDigest: str, rules: List[str], notes: List[str] }
type RenderRequest = { template: Template, revision: Revision, requestedAt: int, host: str }
pure def render(t: Template, r: Revision): Rendered =
  { templateCommit: t.commit, revisionDigest: r.digest, rules: t.rules, notes: r.notes }
pure def renderRequest(q: RenderRequest): Rendered = render(q.template, q.revision)
pure def lawRenderBindsInputs(t: Template, r: Revision): bool =
  render(t, r).templateCommit == t.commit and render(t, r).revisionDigest == r.digest
pure def lawSameInputsSameBytes(q: RenderRequest, other: RenderRequest): bool =
  (q.template == other.template and q.revision == other.revision) implies renderRequest(q) == renderRequest(other)
```

### Maintainer fields only follow the template rules

The maintainer-authored fields of the revision (scope, contribution guide,
supported tasks, required tests, review expectations, security contact,
closure policy and maintainer notes) come after every template rule. They
never remove, reorder or replace one, so a maintainer note cannot weaken a
template rule: a rule is read from the template part first.

```quint
pure def effectiveRules(rd: Rendered): List[str] = rd.rules.concat(rd.notes)
pure def lawMaintainerFieldsOnlyAppend(t: Template, r: Revision, k: int): bool =
  effectiveRules(render(t, r)).length() == t.rules.length() + r.notes.length()
    and ((0 <= k and k < t.rules.length()) implies effectiveRules(render(t, r)).nthOr(k, "") == t.rules.nthOr(k, ""))
    and ((0 <= k and k < r.notes.length()) implies
      effectiveRules(render(t, r)).nthOr(t.rules.length() + k, "") == r.notes.nthOr(k, ""))
```

## Story: Publish the same bytes as raw Markdown and inside the archive

### The raw Markdown endpoint and the archived skill hold identical bytes

One rendering feeds both outputs. The archive also carries the provenance
pair, and the checksum beside it detects corruption only.

```quint
type Publication = { rawMarkdown: Rendered, archivedSkill: Rendered, provenanceCommit: str, provenanceDigest: str }
pure def publish(t: Template, r: Revision): Publication =
  { rawMarkdown: render(t, r), archivedSkill: render(t, r), provenanceCommit: t.commit, provenanceDigest: r.digest }
pure def lawRawEqualsArchive(t: Template, r: Revision): bool =
  publish(t, r).rawMarkdown == publish(t, r).archivedSkill and publish(t, r).archivedSkill == render(t, r)
    and publish(t, r).provenanceCommit == t.commit and publish(t, r).provenanceDigest == r.digest
pure val templateA: Template = { commit: "c1", rules: List("test first") }
pure val tValues = Set(templateA, { commit: "c2", rules: List("test first", "disclose model") })
pure val rValues = Set({ digest: "d1", notes: List() }, { digest: "d2", notes: List("skip tests") })
pure val kValues = Set(-1, 0, 1, 2)
pure val qValues = Set({ template: templateA, revision: { digest: "d1", notes: List() }, requestedAt: 1, host: "slop.cash" },
  { template: templateA, revision: { digest: "d1", notes: List() }, requestedAt: 2, host: "slop.tech" },
  { template: templateA, revision: { digest: "d2", notes: List("skip tests") }, requestedAt: 1, host: "slop.cash" })
pure val otherValues = qValues
```

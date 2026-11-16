# Generated project skill rendering

PRD section 4 (owner decision of 18 October 2026, SKL-03) and CLAUDE.md
"Project skills are generated" define one canonical generic template per
role and the approved D1 project revision as the only inputs of a project
skill. The source is `src/lib/project-skill.mjs` (`renderProjectSkill`) and
`src/lib/project-skill-publication.mjs`, which `scripts/prepare-site.mjs`
publishes as raw Markdown endpoints and `.skill` archives. No project keeps a
skill folder or copy of its own. The [authority component](./skillAuthority.md)
admits downloaded bytes only when they equal `render` of the pair it admits.

## Story: Render one skill from the template commit and the approved revision

### Rendering depends only on the template commit and the approved revision

The rendered skill names the exact template commit and revision digest it
came from. Rendering is a pure function of those two inputs: the request
time, host and requester never reach it, so the same template revision and
D1 revision give the same bytes. The site build (the only sender of
`publishSkill`) publishes one rendering as both the raw Markdown endpoint
and the file inside the `.skill` archive, whose provenance names the pair;
the checksum beside it detects corruption only. Placeholder substitution,
encoding, archive layout and file order are the shell's and need conformance
evidence.

```quint
type Note = { text: str, crosses: str }
type Template = { commit: str, rules: List[str] }
type Revision = { digest: str, notes: List[Note] }
type Rendered = { templateCommit: str, revisionDigest: str, rules: List[str], notes: List[Note] }
type Publication = { rawMarkdown: Rendered, archivedSkill: Rendered, provenanceCommit: str, provenanceDigest: str }
type RenderRequest = { template: Template, revision: Revision, requestedAt: int, host: str }
type SkillOutput = { template: Template, revision: Revision, publication: Publication, published: bool,
  read: bool, applied: List[Note], reported: List[Note] }
pure def render(t: Template, r: Revision): Rendered =
  { templateCommit: t.commit, revisionDigest: r.digest, rules: t.rules, notes: r.notes }
pure def renderRequest(q: RenderRequest): Rendered = render(q.template, q.revision)
pure def publish(t: Template, r: Revision): Publication =
  val rd = render(t, r)
  { rawMarkdown: rd, archivedSkill: rd, provenanceCommit: t.commit, provenanceDigest: r.digest }
pure val noTemplate: Template = { commit: "", rules: List() }
pure val noRevision: Revision = { digest: "", notes: List() }
pure val initial: SkillOutput = { template: noTemplate, revision: noRevision, publication: publish(noTemplate, noRevision),
  published: false, read: false, applied: List(), reported: List() }
pure def canPublishSkill(s: SkillOutput, t: Template, r: Revision): bool = t.commit != "" and r.digest != ""
pure def publishSkill(s: SkillOutput, t: Template, r: Revision): SkillOutput =
  { ...s, template: t, revision: r, publication: publish(t, r), published: true, read: false, applied: List(), reported: List() }
pure def lawSameInputsSameBytes(q: RenderRequest, other: RenderRequest): bool =
  (q.template == other.template and q.revision == other.revision) implies renderRequest(q) == renderRequest(other)
pure def alwaysPublishedPairRendered(s: SkillOutput): bool = s.published implies
  s.publication.rawMarkdown == s.publication.archivedSkill
    and s.publication.archivedSkill.templateCommit == s.publication.provenanceCommit
    and s.publication.archivedSkill.revisionDigest == s.publication.provenanceDigest
    and s.publication.provenanceCommit == s.template.commit and s.publication.provenanceDigest == s.revision.digest
    and s.publication.archivedSkill.rules == s.template.rules
```

### A maintainer note that would cross a template rule never takes effect

The maintainer-authored fields of the revision (scope, contribution guide,
supported tasks, required tests, review expectations, security contact,
closure policy and maintainer notes) are rendered after every template rule
and never remove, reorder or replace one. The template states a boundary
"which no project text can change" and makes registry fields data, not
instructions. The agent reading the skill applies each note that stays within
the template rules; a note that would cross one (its `crosses` names that
rule) is ignored and reported to the operator, so a note such as "skip tests"
against the rule "run the required tests" never weakens it. Recognising which
rule a note would cross is the reading agent's judgement and needs shell
evidence.

```quint
pure def crossesRule(rules: List[str], n: Note): bool = n.crosses != "" and rules.includes(n.crosses)
pure def canReadNotes(s: SkillOutput): bool = s.published and not(s.read)
pure def readNotes(s: SkillOutput): SkillOutput =
  val rd = s.publication.archivedSkill
  { ...s, read: true, applied: rd.notes.select(n => not(crossesRule(rd.rules, n))),
    reported: rd.notes.select(n => crossesRule(rd.rules, n)) }
pure def alwaysNoAppliedNoteCrossesARule(s: SkillOutput): bool =
  s.applied.every(n => not(crossesRule(s.template.rules, n)))
    and s.reported.every(n => crossesRule(s.template.rules, n))
pure def alwaysEveryNoteAppliedOrReported(s: SkillOutput): bool =
  (s.read implies s.applied.length() + s.reported.length() == s.revision.notes.length()
    and s.revision.notes.every(n => s.applied.includes(n) or s.reported.includes(n)))
  and (not(s.read) implies s.applied.length() == 0 and s.reported.length() == 0)
pure def sometimesNoteApplied(s: SkillOutput): bool = s.applied.length() > 0
pure def sometimesWeakeningNoteReported(s: SkillOutput): bool = s.reported.length() > 0 and s.applied.length() > 0
pure val ruleTests = "run the required tests"
pure val templateA: Template = { commit: "c1", rules: List(ruleTests) }
pure val tValues = Set(templateA, noTemplate, { commit: "c2", rules: List(ruleTests, "disclose the exact model") })
pure val rValues = Set({ digest: "d1", notes: List() },
  { digest: "d2", notes: List({ text: "use pnpm", crosses: "" }, { text: "skip tests", crosses: ruleTests }) })
pure val qValues = Set({ template: templateA, revision: { digest: "d1", notes: List() }, requestedAt: 1, host: "slop.cash" },
  { template: templateA, revision: { digest: "d1", notes: List() }, requestedAt: 2, host: "slop.tech" },
  { template: templateA, revision: { digest: "d2", notes: List({ text: "skip tests", crosses: ruleTests }) }, requestedAt: 1,
    host: "slop.cash" })
pure val otherValues = qValues
```

# Registry and security composition

PRD sections 4, 7, 8 and 12. Collection and skill publication combine the
registry state with security enforcement at the same project revision. The
adapter authenticates the records and obtains current project, enforcement
and admission evidence. Each observation identifies what it checked.

Pinned `backend/projects/skill-publication.ts` reads the project,
restrictions and admission evidence for the captured revision and template.
`backend/projects/cloudflare-persistence.ts` checks the current revision,
enforcement generation and, for admission-gated activation, the clearance
generation in the SQL write. The shell must preserve the authoritative update
predicate at commit.

## Story: Stop work immediately when a repository or project loses clearance

### Collection requires an exact current registry and security snapshot

The repository set must match in both directions. This prevents an append from
using previous clearance. A different project, revision or manifest digest, a
new restriction or clearance generation, or an incomplete read leaves the
previous observation unavailable. Pauses, flags, quarantine, bans and retirement
block work independently.

```quint
import projects as P from "./backend/projects"
import enforcement as E from "./security/enforcement"
type RegistryObservation = { projectId: str, revision: int, manifestDigest: str, enforcementGeneration: int, clearanceGeneration: int }
type WorkEvidence = { captured: RegistryObservation, currentRegistry: RegistryObservation, complete: bool }
pure def sameRepositories(project: P::Project, security: E::Enforcement): bool =
  project.repositories.every(id => security.required.contains(id)) and
  security.required.forall(id => project.repositories.includes(id))
pure def currentEvidence(project: P::Project, evidence: WorkEvidence): bool =
  evidence.complete and evidence.captured.projectId != "" and evidence.captured.manifestDigest != ""
    and evidence.captured.revision == project.revision and evidence.captured.revision > 0
    and evidence.captured.enforcementGeneration >= 0 and evidence.captured.clearanceGeneration >= 0
    and evidence.captured == evidence.currentRegistry
pure def mayCollect(project: P::Project, security: E::Enforcement, evidence: WorkEvidence): bool =
  currentEvidence(project, evidence) and P::collectable(project) and E::mayContribute(security)
    and sameRepositories(project, security)
pure def lawSecurityRestrictionStopsCollection(project: P::Project, security: E::Enforcement, evidence: WorkEvidence): bool =
  (security.restriction != E::Available or security.retired) implies not(mayCollect(project, security, evidence))
pure def lawRegistryPauseStopsCollection(project: P::Project, security: E::Enforcement, evidence: WorkEvidence): bool =
  (project.paused or project.retired) implies not(mayCollect(project, security, evidence))
pure def lawNewRegistryFactsInvalidateCollection(project: P::Project, security: E::Enforcement, evidence: WorkEvidence): bool =
  (not(evidence.complete) or evidence.captured != evidence.currentRegistry or evidence.captured.revision != project.revision)
    implies not(mayCollect(project, security, evidence))
```

### Skill publication binds the admission observation to the exact template input

Ready project fields and exact current clearance are necessary. The factory
receives the immutable template and registry inputs. A registered paused
project with current clearance and no enforcement restriction can serve
bytes for inspection. Installation discovery requires an active project. An
already-verified historical template selected by the installer has its own
install and rollback policy.

```quint
type TemplateEvidence = { checkedDigest: str, renderedDigest: str }
pure def mayServeSkill(project: P::Project, security: E::Enforcement, evidence: WorkEvidence, template: TemplateEvidence): bool =
  currentEvidence(project, evidence) and P::listed(project) and E::mayContribute(security) and sameRepositories(project, security)
    and project.fieldsComplete and template.checkedDigest != "" and template.checkedDigest == template.renderedDigest
pure def mayDiscoverSkill(project: P::Project, security: E::Enforcement, evidence: WorkEvidence, template: TemplateEvidence): bool =
  mayCollect(project, security, evidence) and mayServeSkill(project, security, evidence, template)
pure def lawSkillsRequireCurrentInputs(project: P::Project, security: E::Enforcement, evidence: WorkEvidence, template: TemplateEvidence): bool =
  mayServeSkill(project, security, evidence, template) implies currentEvidence(project, evidence) and project.fieldsComplete
    and template.checkedDigest != "" and template.checkedDigest == template.renderedDigest
pure def lawPausedProjectUnavailableToInstall(project: P::Project, security: E::Enforcement, evidence: WorkEvidence, template: TemplateEvidence): bool =
  project.paused implies not(mayDiscoverSkill(project, security, evidence, template))
```

### Admission-gated writes compare the same revision and generations at commit

Every checked project revision write rejects a changed enforcement generation.
An admission-gated activation also checks the observed clearance generation.
A pending application included in the write must still be pending for that
same revision. Commit failure supplies no publication receipt.

```quint
type WriteEvidence = { expected: RegistryObservation, atCommit: RegistryObservation, admissionGated: bool,
  applicationLinked: bool, currentPendingApplication: bool }
pure def mayCommitRevision(writeEvidence: WriteEvidence): bool =
  writeEvidence.expected.projectId != "" and writeEvidence.expected.projectId == writeEvidence.atCommit.projectId
    and writeEvidence.expected.revision > 0 and writeEvidence.expected.revision == writeEvidence.atCommit.revision
    and writeEvidence.expected.enforcementGeneration >= 0 and writeEvidence.expected.enforcementGeneration == writeEvidence.atCommit.enforcementGeneration
    and (not(writeEvidence.admissionGated) or (writeEvidence.expected.clearanceGeneration >= 0
      and writeEvidence.expected.clearanceGeneration == writeEvidence.atCommit.clearanceGeneration))
    and (not(writeEvidence.applicationLinked) or writeEvidence.currentPendingApplication)
pure def lawChangedEnforcementFencesEveryWrite(writeEvidence: WriteEvidence): bool =
  writeEvidence.expected.enforcementGeneration != writeEvidence.atCommit.enforcementGeneration implies not(mayCommitRevision(writeEvidence))
pure def lawChangedClearanceFencesActivation(writeEvidence: WriteEvidence): bool =
  (writeEvidence.admissionGated and writeEvidence.expected.clearanceGeneration != writeEvidence.atCommit.clearanceGeneration)
    implies not(mayCommitRevision(writeEvidence))
pure def lawLinkedApplicationMustRemainPending(writeEvidence: WriteEvidence): bool =
  (writeEvidence.applicationLinked and not(writeEvidence.currentPendingApplication)) implies not(mayCommitRevision(writeEvidence))
```

### Simulation covers current, unavailable and stale observations

```quint
pure val r1: RegistryObservation = { projectId: "project", revision: 1, manifestDigest: "manifest", enforcementGeneration: 1, clearanceGeneration: 1 }
pure val projectValues = Set(P::initial, { ...P::initial, revision: 1, paused: false, fieldsComplete: true },
  { ...P::initial, revision: 1, paused: true, fieldsComplete: true })
pure val securityValues = Set(E::initial, { ...E::initial, clean: Set(1) }, { ...E::initial, restriction: E::FlagPaused })
pure val evidenceValues = Set(
  { captured: r1, currentRegistry: r1, complete: true },
  { captured: r1, currentRegistry: r1, complete: false },
  { captured: r1, currentRegistry: { ...r1, revision: 2, manifestDigest: "other" }, complete: true },
  { captured: r1, currentRegistry: { ...r1, enforcementGeneration: 2 }, complete: true },
  { captured: r1, currentRegistry: { ...r1, clearanceGeneration: 2 }, complete: true })
pure val templateValues = Set({ checkedDigest: "template", renderedDigest: "template" },
  { checkedDigest: "template", renderedDigest: "other" })
pure val writeEvidenceValues = Set(
  { expected: r1, atCommit: r1, admissionGated: true, applicationLinked: true, currentPendingApplication: true },
  { expected: r1, atCommit: { ...r1, enforcementGeneration: 2 }, admissionGated: false, applicationLinked: false, currentPendingApplication: false },
  { expected: r1, atCommit: { ...r1, clearanceGeneration: 2 }, admissionGated: true, applicationLinked: false, currentPendingApplication: false },
  { expected: r1, atCommit: r1, admissionGated: true, applicationLinked: true, currentPendingApplication: false })
```

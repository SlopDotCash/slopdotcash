# Project automatic-closure consent

PRD section 5 and the migration decision of 13 November 2026 govern this
project-level setting. The new-project control starts unchecked. Legacy
`src/ProjectProposalPage.tsx` starts it checked. Existing approved values are
preserved on edit and a missing field remains false. The
[Slopbot closure decision](../slopbot/closure.md) consumes the effective
saved choice and checks its own current review, production and scope gates.

## Story: An authorized maintainer may explicitly enable or disable closure

### The new draft starts unchecked and an existing form reflects only its exact saved setting

The standard setup control appears for non-bounty funding modes. Switching
to a bounty-only setup suppresses automatic closure from the new project's
payload. An existing edit reflects the approved registry revision. Proceeding
through setup or installing the App supplies no consent on its own.

```quint
type SavedConsent = Absent | Enabled | Disabled
type FundingChoice = OrdinarySetup | BountyOnly
pure val defaultNewDraft = false
pure def checkedOnLoad(saved: SavedConsent): bool = saved == Enabled
pure def newProjectConsent(fundingChoice: FundingChoice, checked: bool): SavedConsent =
  if (fundingChoice == OrdinarySetup and checked) Enabled else Absent
pure def lawNewDraftBeginsUnchecked(fundingChoice: FundingChoice): bool =
  not(defaultNewDraft) and newProjectConsent(fundingChoice, defaultNewDraft) == Absent
pure def lawOnlyPersistedYesChecksExistingForm(saved: SavedConsent): bool = checkedOnLoad(saved) iff saved == Enabled
pure def lawNewBountySetupHasNoClosureConsent(checked: bool): bool = newProjectConsent(BountyOnly, checked) == Absent
```

### A saved change belongs only to the exact current project revision and its current GitHub authority

Editing an existing explicitly enabled setting and unchecking it records
false. An unchanged missing setting remains absent. The shell authenticates
the current maintainer, verifies repository authority and executes the
immutable revision append at the expected revision.

```quint
type ConsentEvidence = { project: str, currentProject: str, expectedRevision: int, currentRevision: int,
  actor: int, currentAuthority: bool }
pure def savedEdit(prior: SavedConsent, checked: bool): SavedConsent =
  if (checked) Enabled else if (prior == Absent) Absent else Disabled
pure def canAppendConsent(evidence: ConsentEvidence): bool =
  evidence.project != "" and evidence.project == evidence.currentProject and evidence.expectedRevision > 0
    and evidence.expectedRevision == evidence.currentRevision and evidence.actor > 0 and evidence.currentAuthority
pure def applyConsent(prior: SavedConsent, checked: bool, evidence: ConsentEvidence): SavedConsent =
  if (canAppendConsent(evidence)) savedEdit(prior, checked) else prior
pure def lawRefusedWritePreservesConsent(prior: SavedConsent, checked: bool, evidence: ConsentEvidence): bool =
  not(canAppendConsent(evidence)) implies applyConsent(prior, checked, evidence) == prior
pure def lawCurrentUncheckedChangeDisablesClosure(prior: SavedConsent, evidence: ConsentEvidence): bool =
  canAppendConsent(evidence) implies not(checkedOnLoad(applyConsent(prior, false, evidence)))
pure def lawUntouchedExistingConsentRetainsMeaning(prior: SavedConsent): bool =
  savedEdit(prior, checkedOnLoad(prior)) == prior
```

### Samples exercise the current maintainer and stale or crossed revisions

```quint
pure val verifiedEdit: ConsentEvidence = { project: "project", currentProject: "project", expectedRevision: 1,
  currentRevision: 1, actor: 9, currentAuthority: true }
pure val evidenceValues = Set(verifiedEdit, { ...verifiedEdit, currentRevision: 2 },
  { ...verifiedEdit, currentProject: "other" }, { ...verifiedEdit, currentAuthority: false })
```

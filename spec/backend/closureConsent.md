# Project automatic-closure consent

PRD section 5 and the owner decision of 13 November 2026 govern this
project-level setting. The new-project control starts unchecked and a
missing saved value means no consent. Legacy `src/ProjectProposalPage.tsx`
started it checked; that default is superseded. The saved value is a field of
every immutable revision of the [project registry](./projects.md): creation
records it from the new-project form, and only an owner revision
(`publishOwnerRevision`, alone or with other changes of the same save), at
the expected revision under a current authority read on
an unrestricted project whose acting account is not banned
([composition](./projectComposition.md)), or an administrator exception,
which replaces the whole manifest and records its saved value as it stands
(`PUT /api/v1/admin/projects/:id/manifest`), changes it. The
[Slopbot closure decision](../slopbot/closure.md) consumes the saved value of
the current revision and checks its own review, production and scope gates
(composition obligation recorded in the area report).

## Story: An authorized maintainer may explicitly enable or disable closure

### The new form starts unchecked and an existing form reflects only its exact saved setting

The standard setup control appears for non-bounty funding modes. Switching
to a bounty-only setup suppresses automatic closure from the new project's
payload. An existing edit reflects the approved registry revision. Proceeding
through setup or installing the App supplies no consent on its own. A saved
`slopbot` settings object may omit `automaticClosure` while it carries any of
the other Slopbot settings (ready label, intake cap, submission fee, wanted
issues); the omitted field is the absent consent, never a given one, so a
project without consent can still save every other Slopbot setting.

```quint
type SavedConsent = Absent | Enabled | Disabled
type FundingChoice = OrdinarySetup | BountyOnly
pure val defaultNewDraft = false
pure def checkedOnLoad(saved: SavedConsent): bool = saved == Enabled
pure def consents(saved: SavedConsent): bool = saved == Enabled
pure def newProjectConsent(fundingChoice: FundingChoice, checked: bool): SavedConsent =
  if (fundingChoice == OrdinarySetup and checked) Enabled else Absent
pure def lawNewDraftBeginsUnchecked(fundingChoice: FundingChoice): bool =
  not(defaultNewDraft) and newProjectConsent(fundingChoice, defaultNewDraft) == Absent
pure def lawOnlyPersistedYesChecksExistingForm(saved: SavedConsent): bool = checkedOnLoad(saved) iff saved == Enabled
pure def lawNewBountySetupHasNoClosureConsent(checked: bool): bool = newProjectConsent(BountyOnly, checked) == Absent
pure def lawMissingConsentIsFalse(saved: SavedConsent): bool = saved == Absent implies not(consents(saved))
```

### A saved edit records an explicit No only after an explicit Yes

Editing an existing explicitly enabled setting and unchecking it records
No. An unchanged missing setting remains absent, and an untouched form never
changes the saved meaning.

```quint
pure def savedEdit(prior: SavedConsent, checked: bool): SavedConsent =
  if (checked) Enabled else if (prior == Absent) Absent else Disabled
pure def lawUncheckingDisablesClosure(prior: SavedConsent): bool = not(consents(savedEdit(prior, false)))
pure def lawUntouchedExistingConsentRetainsMeaning(prior: SavedConsent): bool =
  savedEdit(prior, checkedOnLoad(prior)) == prior
pure def lawCheckingEnablesClosure(prior: SavedConsent): bool = consents(savedEdit(prior, true))
```

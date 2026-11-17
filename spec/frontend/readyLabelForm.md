# Ready-label settings control

The project settings page lets the owner turn on the `slopbot:ready` label
(PRD section 5, operator decision of 16 November 2026). The setting, its
bounds and its defaults are the backend's
[ready-label settings](../backend/readyLabelSettings.md); what Slopbot does
with it is the [`slopbot:ready` label](../slopbot/readyLabel.md). The saved
change is an owner revision like any other presentation field. Source is
the update form of `src/ProjectProposalPage.tsx` at Slop development
`df21e37b7` (`readyLabelDraft`, `ReadyLabelFields`, lines 689–860, the
form's start at 2428–2442 and the next setting at 2564–2573).

## Story: Turn the ready label on in project settings

> As a project owner, I want to turn the ready label on with numbers inside
> Slop's bounds, and to turn it off without losing them.

### The control starts off with the defaults when nothing is saved, saves only bounded settings while on, and keeps the owner's numbers when turned off

The form starts from the saved setting, or, when none is saved, off with 1
approval, 400 changed lines, 20 changed files and no added paths. The
numbers and the added protected paths show only while the box is checked.
The shell reads each number as a whole number of at most six digits (other
text reads as 0, outside every bound) and the paths one per line, trimmed,
blank lines dropped and duplicates removed. While the box is checked the
form is saved only when the settings are within their bounds, and each field
out of bounds says its range or its first bad path; while it is unchecked
these fields block nothing. Turning the label off saves the owner's last
saved numbers with `enabled` false, so turning it on again restores them; a
project that never saved the setting keeps none.

```quint
import readyLabelSettings as RLS from "../backend/readyLabelSettings"
pure val formDefaults: RLS::ReadyLabelConfig = { enabled: false, approvals: RLS::defaultApprovals,
  maxChangedLines: RLS::defaultMaxChangedLines, maxChangedFiles: RLS::defaultMaxChangedFiles, protectedPaths: List() }
pure def formStart(saved: bool, settings: RLS::ReadyLabelConfig): RLS::ReadyLabelConfig = if (saved) settings else formDefaults
pure def draftSavable(draft: RLS::ReadyLabelConfig): bool =
  not(draft.enabled) or RLS::readyLabelValid(RLS::presentSetting(draft))
pure def savedReadyLabel(saved: bool, settings: RLS::ReadyLabelConfig, draft: RLS::ReadyLabelConfig): RLS::ReadyLabelSetting =
  if (draft.enabled) RLS::presentSetting(draft)
  else if (saved) RLS::presentSetting({ ...settings, enabled: false })
  else RLS::ReadyLabelAbsent
pure def lawFormStartsOffWithoutSettings(settings: RLS::ReadyLabelConfig): bool = not(formStart(false, settings).enabled)
pure def lawOnOnlyWhenChecked(saved: bool, settings: RLS::ReadyLabelConfig, draft: RLS::ReadyLabelConfig): bool =
  RLS::readyLabelOn(savedReadyLabel(saved, settings, draft)) == draft.enabled
pure def lawSavedSettingIsValid(saved: bool, settings: RLS::ReadyLabelConfig, draft: RLS::ReadyLabelConfig): bool =
  (draftSavable(draft) and RLS::readyLabelValid(RLS::presentSetting(settings)))
    implies RLS::readyLabelValid(savedReadyLabel(saved, settings, draft))
pure def lawTurningOffKeepsTheNumbers(settings: RLS::ReadyLabelConfig, draft: RLS::ReadyLabelConfig): bool =
  not(draft.enabled) implies savedReadyLabel(true, settings, draft) == RLS::presentSetting({ ...settings, enabled: false })
pure val savedValues = Set(false, true)
pure val settingsValues = Set(RLS::sampleSettings, { ...RLS::sampleSettings, enabled: false, approvals: 3 })
pure val draftValues = Set(formDefaults, { ...formDefaults, enabled: true }, { ...RLS::sampleSettings, approvals: 11 },
  { ...RLS::sampleSettings, approvals: 11, enabled: false })
```

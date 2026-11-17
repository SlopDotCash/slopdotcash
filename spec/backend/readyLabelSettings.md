# Slopbot ready-label settings

The operator decision of 16 November 2026 (PRD section 5, Slop development
`7ec6e8e24`) lets a project owner turn on the `slopbot:ready` label in
project settings. The setting is `project.slopbot.readyLabel` of the project
manifest (`src/lib/slopbot-ready.mjs`, validated by
`validateProjectDefinition` in `src/lib/project-schema.mjs:1266–1283`). This
library is the one model of that setting: its fields, bounds, defaults and
validity, which the backend's manifest validator checks. What Slopbot does
with it on a pull request is the Slopbot area's, which takes the setting
from this library rather than defining its own.

`slopbot` is a presentation field of the revision classifier
(`src/lib/project-revision-changes.ts`), so an owner sets, changes or clears
the ready-label settings, like the website and X links, by an owner revision
that publishes at once against the expected revision
([project registration](./projects.md), "Owner revisions publish at once
against the expected revision"); they are never material terms.

## Story: Owners turn on the ready label within fixed bounds

> As a project owner, I want to choose how many approvals and how large a
> change Slopbot accepts before it marks a pull request ready, and which
> paths it must never mark ready, without loosening what Slop always
> protects.

### Ready-label settings are bounded, off when absent or disabled, and only add protected paths

When present, `readyLabel` has exactly the fields `enabled`, `approvals`,
`maxChangedLines`, `maxChangedFiles` and `protectedPaths`, every one
required. `approvals` is a whole number from 1 to 10, `maxChangedLines` from
1 to 5000 and `maxChangedFiles` from 1 to 300. `protectedPaths` lists at most
50 distinct patterns of 1 to 200 characters each. A pattern is well formed
when it uses only letters, digits and `.`, `_`, `-`, `/`, `*`, `@` or `+`, is
relative to the repository root (no leading `/` and no `//`), has no `.` or
`..` segment and no run of three or more `*`; the shell computes `length` and
`wellFormed` from the exact text with `protectedPathProblem` and the
manifest is refused otherwise. An absent setting, or one with `enabled`
false, means the setting is off (`readyLabelSettings` of
`src/lib/slopbot-ready.mjs`); Slopbot additionally labels only while the
project offers contributor work ([the `slopbot:ready`
label](../slopbot/readyLabel.md)). The settings form starts from 1 approval, 400
changed lines and 20 changed files when the project has none. The owner's
patterns only add to the built-in protected set of Slopbot
(`workers/slopbot/ready-label.ts`), which always applies and cannot be
shrunk.

```quint
import projects as P from "./projects"
type ProtectedPath = { pattern: str, length: int, wellFormed: bool }
type ReadyLabelConfig = { enabled: bool, approvals: int, maxChangedLines: int, maxChangedFiles: int,
  protectedPaths: List[ProtectedPath] }
type ReadyLabelSetting = ReadyLabelAbsent | ReadyLabelPresent(ReadyLabelConfig)
pure val minApprovals = 1
pure val maxApprovals = 10
pure val minChangedLines = 1
pure val maxChangedLinesLimit = 5000
pure val minChangedFiles = 1
pure val maxChangedFilesLimit = 300
pure val maxProtectedPaths = 50
pure val maxProtectedPathLength = 200
pure val defaultApprovals = 1
pure val defaultMaxChangedLines = 400
pure val defaultMaxChangedFiles = 20
pure def boundsHold(approvals: int, maxChangedLines: int, maxChangedFiles: int, protectedPaths: List[ProtectedPath]): bool =
  approvals >= minApprovals and approvals <= maxApprovals and
  maxChangedLines >= minChangedLines and maxChangedLines <= maxChangedLinesLimit and
  maxChangedFiles >= minChangedFiles and maxChangedFiles <= maxChangedFilesLimit and
  protectedPaths.length() <= maxProtectedPaths and
  protectedPaths.every(path => path.wellFormed and path.length >= 1 and path.length <= maxProtectedPathLength and
    protectedPaths.select(other => other.pattern == path.pattern).length() == 1)
pure def readyLabelValid(setting: ReadyLabelSetting): bool = match setting {
  | ReadyLabelAbsent => true
  | ReadyLabelPresent(x) => boundsHold(x.approvals, x.maxChangedLines, x.maxChangedFiles, x.protectedPaths)
}
pure def readyLabelOn(setting: ReadyLabelSetting): bool = match setting {
  | ReadyLabelAbsent => false
  | ReadyLabelPresent(x) => x.enabled
}
pure def protectedPatterns(builtIn: Set[str], setting: ReadyLabelSetting): Set[str] = match setting {
  | ReadyLabelAbsent => builtIn
  | ReadyLabelPresent(x) => x.protectedPaths.foldl(builtIn, (patterns, path) => patterns.union(Set(path.pattern)))
}
pure def lawAbsentMeansOff(setting: ReadyLabelSetting): bool =
  setting == ReadyLabelAbsent implies not(readyLabelOn(setting)) and readyLabelValid(setting)
pure def lawDefaultsAreValid(enabled: bool): bool =
  readyLabelValid(ReadyLabelPresent({ enabled: enabled, approvals: defaultApprovals, maxChangedLines: defaultMaxChangedLines,
    maxChangedFiles: defaultMaxChangedFiles, protectedPaths: List() }))
pure def lawOwnerPatternsOnlyAdd(builtIn: Set[str], setting: ReadyLabelSetting): bool =
  builtIn.subseteq(protectedPatterns(builtIn, setting))
pure def lawSettingsChangePublishAsPresentation(p: P::Project, by: int, change: P::OwnerChange): bool =
  (P::canPublishOwnerRevision(p, by, change) and change.presentation and not(change.executable) and not(change.financial)) implies
    (P::publishOwnerRevision(p, by, change).status == p.status and P::publishOwnerRevision(p, by, change).economic == p.economic and
     P::publishOwnerRevision(p, by, change).revision == p.revision + 1)
pure val ownerPath: ProtectedPath = { pattern: "deploy/**", length: 9, wellFormed: true }
pure val sampleSettings: ReadyLabelConfig = { enabled: true, approvals: 1, maxChangedLines: 400, maxChangedFiles: 20, protectedPaths: List(ownerPath) }
pure val settingValues = Set(ReadyLabelAbsent, ReadyLabelPresent(sampleSettings),
  ReadyLabelPresent({ ...sampleSettings, enabled: false }), ReadyLabelPresent({ ...sampleSettings, approvals: 0 }),
  ReadyLabelPresent({ ...sampleSettings, approvals: 11 }), ReadyLabelPresent({ ...sampleSettings, maxChangedLines: 5001 }),
  ReadyLabelPresent({ ...sampleSettings, maxChangedFiles: 301 }),
  ReadyLabelPresent({ ...sampleSettings, protectedPaths: List(ownerPath, ownerPath) }),
  ReadyLabelPresent({ ...sampleSettings, protectedPaths: List({ ...ownerPath, wellFormed: false }) }),
  ReadyLabelPresent({ ...sampleSettings, protectedPaths: List({ ...ownerPath, length: 201 }) }))
pure val builtInValues = Set(Set("workflows"), Set("workflows", "deploy/**"))
```

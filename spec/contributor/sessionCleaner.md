# Session export cleaner and kept contents

Private trace contract v3 (operator decision of 23 November 2026) allows a
cleaned session export to keep file contents inside an openly licensed public
project repository while continuing to redact credentials, ignored files,
unlicensed repositories and anything outside the repository. The pinned sources
are `skills/project-contributor-template/scripts/session-export.mjs`,
`skills/project-contributor-template/references/session-log.md`,
`apps/contributor/docs/private-trace-v1.md` (`## Private trace privacy contract v3`),
and the legacy model `formal/models/contributor/contributor_session_cleaner.qnt`.

## Story: Keep only openly licensed in-repo content and redact everything else

> As a contributor exporting an agent session under v3, I want only tracked
> files and in-repo name-only command listings from an openly licensed
> repository to leave my machine, and every unlicensed, untracked content or
> outside-repository reference to be redacted.

### Only an openly licensed in-repo tracked read or name-only listing is kept

A read result leaves the machine only when the repository is openly licensed
(GitHub reports an OSI-approved licence at the time of the run) and the file is
inside the repository and tracked (or created by the agent and not ignored). A
name-only command (`ls`, `tree`, `git status`, `git log` without a patch,
`git diff` names, `git branch`, `find` without actions) keeps its output of
names when every path it names is inside the repo, even if the names include
untracked files. Any event naming a path outside the repo is replaced whole
with `[REDACTED:OUTSIDE_REPO]`. Any other outcome is replaced with a redaction
marker.

```quint
type CleanOutcome = CleanPending | CleanKept | CleanRedacted
type Cleaner = { licensed: bool, tracked: bool, nameOnly: bool, inside: bool, outside: bool, outcome: CleanOutcome }
pure val initial: Cleaner = { licensed: false, tracked: false, nameOnly: false, inside: false, outside: false, outcome: CleanPending }
pure def keeps(licensed: bool, tracked: bool, nameOnly: bool, inside: bool, outside: bool): bool =
  not(outside) and licensed and inside and (tracked or nameOnly)
pure def canClassify(c: Cleaner): bool = c.outcome == CleanPending
pure def classify(c: Cleaner, licensed: bool, tracked: bool, nameOnly: bool, inside: bool, outside: bool): Cleaner =
  { licensed: licensed, tracked: tracked, nameOnly: nameOnly, inside: inside, outside: outside,
    outcome: if (keeps(licensed, tracked, nameOnly, inside, outside)) CleanKept else CleanRedacted }
pure def alwaysKeptRequiresOpenInRepoContent(c: Cleaner): bool =
  c.outcome == CleanKept implies (c.licensed and c.inside and not(c.outside) and (c.tracked or c.nameOnly))
pure def alwaysClassifiedIsKeptOrRedacted(c: Cleaner): bool =
  c.outcome != CleanPending implies (c.outcome == CleanKept iff keeps(c.licensed, c.tracked, c.nameOnly, c.inside, c.outside))
pure def lawOutsideOrUnlicensedRedacted(licensed: bool, tracked: bool, nameOnly: bool, inside: bool, outside: bool): bool =
  (outside or not(licensed) or not(inside)) implies not(keeps(licensed, tracked, nameOnly, inside, outside))
pure def sometimesKeptTracked(c: Cleaner): bool = c.outcome == CleanKept and c.tracked
pure def sometimesKeptNameOnly(c: Cleaner): bool = c.outcome == CleanKept and c.nameOnly and not(c.tracked)
pure def sometimesRedacted(c: Cleaner): bool = c.outcome == CleanRedacted
```

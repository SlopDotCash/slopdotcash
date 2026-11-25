# Session export under trace terms v3

PRD sections 4 and 8, [Server-side trace run and progress events](./traceServer.md) and the private trace privacy contract v3 in `apps/contributor/docs/private-trace-v1.md` ("Private trace privacy contract v3"). The contributor skill exports one cleaned local agent session under trace terms `private-trace-v3`. The export runs on the contributor's machine before any upload, and the contributor reviews the cleaned file before it is sent. The raw session file never leaves the machine.

## Story: Export one cleaned agent session per run without leaking secrets or unlicensed source

The exporter finds the session file by the `slop-run:<id>` marker, where `<id>` is the run id, reads one snapshot of that file, cleans it locally with cleaner `slop-session-cleaner-1`, and writes the cleaned file for review. Cleaning follows `keeps` below: a read result leaves the machine only when the repository is openly licensed and the file is inside the repository and tracked, or when a name-only command names only paths inside the repository. An event naming a path outside the repository is replaced whole. Any other outcome is a redaction marker. When a read result is not kept, every content field it carries (`result` and `output`) is replaced with the marker. Paths are normalised to repository-relative form before the tracked check, and symlinks are resolved to their target before the inside and tracked checks. The cleaned file is tagged with terms version `private-trace-v3`; the run records that version in D1 through migration `0151_trace_terms_v3.sql`.

A name-only command is `ls`, `tree`, `git status`, `git log` with only listing flags, `git diff --name-only` or `--name-status`, `git branch`, or `find` without actions. A command that pipes, redirects, chains or substitutes another command is not name-only. Its output of names is kept when every path it names is inside the repository, even when the names include untracked files.

Repository file contents are kept only when the repository licence is one of the OSI licences in `osiLicences` below. A trace uploaded under version 2 does not carry over: a licensing setting confirmed under `private-trace-v2` does not cover a trace uploaded under `private-trace-v3`, and upload licence and opt-in refuse with `confirm_again` until the contributor confirms again under version 3. A banned account cannot confirm under version 3. Licensing itself ships with the trace licensing consent records (issue #3295); this spec covers only the exporter and the v3 terms, and the refusal is enforced by that port, not by the exporter.

The cleaned file keeps the 8 MiB bound of [traceServer](./traceServer.md) (`maxTraceBytes`). The exporter refuses a session file larger than that bound and a run id with no session file carrying its marker. A line that is not newline-delimited JSON is replaced with a redaction marker and counted as redacted. Redaction is pattern matching, never a guarantee: the exporter discloses its rules and the contributor inspects the cleaned file before authorizing the upload.

### The session cleaner keeps a read result only when it is licensed, inside the repository and tracked or name-only

```quint
type CleanFlags = { licensed: bool, tracked: bool, nameOnly: bool, inside: bool, outside: bool }
type CleanOutcome = { kept: bool, redacted: bool }

pure val cleanerVersion = "slop-session-cleaner-1"
pure val traceTermsVersion = "private-trace-v3"
pure val maxSessionBytes = 8388608

pure val osiLicences: Set[str] = Set(
  "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MPL-2.0",
  "GPL-2.0", "GPL-2.0-only", "GPL-2.0-or-later",
  "GPL-3.0", "GPL-3.0-only", "GPL-3.0-or-later",
  "LGPL-2.1", "LGPL-2.1-only", "LGPL-2.1-or-later",
  "LGPL-3.0", "LGPL-3.0-only", "LGPL-3.0-or-later",
  "AGPL-3.0", "AGPL-3.0-only", "AGPL-3.0-or-later",
  "EPL-2.0", "Unlicense", "0BSD", "Zlib", "BSL-1.0"
)

pure def keeps(flags: CleanFlags): bool =
  not(flags.outside) and flags.licensed and flags.inside and (flags.tracked or flags.nameOnly)

pure def classify(flags: CleanFlags): CleanOutcome = {
  kept: keeps(flags),
  redacted: not(keeps(flags))
}

pure def termsVersionCovers(confirmed: str, uploaded: str): bool =
  confirmed == uploaded

law lawCleanKeptOnlyLicensedInside(flags: CleanFlags): bool =
  not(classify(flags).kept) or (flags.licensed and flags.inside and not(flags.outside) and (flags.tracked or flags.nameOnly))

law lawCleanKeptExcludesRedacted(flags: CleanFlags): bool =
  not(classify(flags).kept and classify(flags).redacted)

law lawV2ConfirmationDoesNotCoverV3: bool =
  not(termsVersionCovers("private-trace-v2", "private-trace-v3"))

law lawV3ConfirmationCoversV3: bool =
  termsVersionCovers("private-trace-v3", "private-trace-v3")
```

## Simulation samples

### The simulation samples cover the kept and redacted cases

```quint
val keptWhenLicensedSample = classify({ licensed: true, tracked: true, nameOnly: false, inside: true, outside: false })
val unlicensedRedactedSample = classify({ licensed: false, tracked: true, nameOnly: false, inside: true, outside: false })
val outsideRedactedSample = classify({ licensed: true, tracked: true, nameOnly: false, inside: true, outside: true })
val nameOnlyKeptSample = classify({ licensed: true, tracked: false, nameOnly: true, inside: true, outside: false })
val nameOnlyUnlicensedSample = classify({ licensed: false, tracked: false, nameOnly: true, inside: true, outside: false })
val nameOnlyOutsidePathSample = classify({ licensed: true, tracked: false, nameOnly: true, inside: false, outside: false })

test keptWhenLicensedTest = {
  assert(keptWhenLicensedSample.kept)
  assert(not(keptWhenLicensedSample.redacted))
}

test unlicensedRedactedTest = {
  assert(unlicensedRedactedSample.redacted)
  assert(not(unlicensedRedactedSample.kept))
}

test outsideRedactedTest = {
  assert(outsideRedactedSample.redacted)
  assert(not(outsideRedactedSample.kept))
}

test nameOnlyKeptTest = {
  assert(nameOnlyKeptSample.kept)
  assert(not(nameOnlyKeptSample.redacted))
}

test nameOnlyUnlicensedTest = {
  assert(nameOnlyUnlicensedSample.redacted)
  assert(not(nameOnlyUnlicensedSample.kept))
}

test nameOnlyOutsidePathTest = {
  assert(nameOnlyOutsidePathSample.redacted)
  assert(not(nameOnlyOutsidePathSample.kept))
}
```

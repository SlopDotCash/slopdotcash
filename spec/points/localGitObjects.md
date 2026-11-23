# Local Git object reads

PRD section 9, operator decision 20 November 2026: a trusted main collection
may answer exact Git tree and commit reads from bare clones of the
repositories it collects, so that immutable objects do not spend the GitHub
allowance (`scripts/local-git-objects.ts`, the local branch of
`githubIngestionReadTransport` in `scripts/github-ingestion-read.ts`; main
0fe8fe7a3, development 7f71c6ce9; the legacy `local_git_objects` model).
The release workflow clones the repository and `vars.LOCAL_GIT_REPOSITORIES`
anonymously into the runner's temporary directory (never into the bundle)
and names them with `SLOP_LOCAL_GIT_DIR` (`<root>/<owner>/<repo>.git`). This
machine is the collector's local reader. Everything it does not answer
locally is the [ingestion read](./ingestion.md) to GitHub, unchanged.

## Story: Read immutable Git objects without spending the GitHub allowance

> As the operator, I want the collector to answer a Git tree or commit read
> from a local clone only when the answer is certain to equal GitHub's, so
> that a collection spends fewer GitHub requests and never reads different
> data.

### A Git tree or commit read is answered from a local clone only when the answer is certain to equal GitHub's

Only a GET of `https://api.github.com/repos/<owner>/<repo>/git/trees/<40-hex>`
(with no query, or exactly `?recursive=1`) or `/git/commits/<40-hex>` (with no
query), whose address carries no credentials or fragment, whose `Accept` is
absent or `application/vnd.github+json` and which has no `Range` and no
`If-*` header, is offered to the clones, after the read's deadline check. A
clone answers only an object of the right type that it holds, whose every
served field it is certain of: a tree whose entries all have the modes
`040000`, `100644`, `100755` or `120000`, with UTF-8 names and at most 20,000
entries; a commit in UTF-8 with no carriage
return, one tree, its parents, one author and one committer of the form
`name <email> seconds ±zone`, only signature or merge-tag headers besides,
and no two trailing newlines in its message; and, served, either body is at
most 5 MiB. Anything else (an unknown
repository, a missing object, a submodule, an encoding header, an odd
identity) is declined and the read goes to GitHub. A local answer is a 200
`application/json; charset=utf-8` response that bypasses the immutable and
discussion caches.

Each clone keeps two long-lived `git cat-file` readers, `--batch` for
objects and `--batch-check` for blob sizes, with lazy fetching off; this
machine is one of them. A reader answers pipelined requests in order. If it
dies, every waiting request is declined to GitHub, and the next request
starts a fresh reader. Nothing is
lost or answered twice: every request offered is served locally, declined to
GitHub or still waiting. The shell logs `local git objects: <served> served
from local clones, <declined> read from GitHub instead`, where `declined`
counts only the reads of a cloned repository it could not serve.

```quint
pure val maxTreeEntries = 20000
pure val maxLocalBytes = 5242880
type ReaderState = ReaderIdle | ReaderRunning | ReaderDead
type GitObjectKind = TreeObject | CommitObject
type GitQuery = NoQuery | RecursiveQuery | OtherQuery
type GitRead = { isGet: bool, apiOrigin: bool, exactAddress: bool, objectPath: bool, kind: GitObjectKind, query: GitQuery,
  plainAccept: bool, rangeOrConditional: bool }
type LocalObject = { held: bool, rightType: bool, certainFields: bool, entries: int, bytes: int }
type LocalReads = { reader: ReaderState, pending: int, localServed: int, declined: int, asked: int }
pure val initial: LocalReads = { reader: ReaderIdle, pending: 0, localServed: 0, declined: 0, asked: 0 }
pure def offeredLocally(q: GitRead): bool =
  q.isGet and q.apiOrigin and q.exactAddress and q.objectPath and q.plainAccept and not(q.rangeOrConditional) and
    (q.query == NoQuery or (q.query == RecursiveQuery and q.kind == TreeObject))
pure def certain(found: LocalObject): bool =
  found.held and found.rightType and found.certainFields and found.entries >= 0 and found.entries <= maxTreeEntries and
    found.bytes >= 0 and found.bytes <= maxLocalBytes
pure def canOffer(s: LocalReads, gitRead: GitRead): bool = offeredLocally(gitRead)
pure def offer(s: LocalReads, gitRead: GitRead): LocalReads =
  { ...s, reader: ReaderRunning, pending: s.pending + 1, asked: s.asked + 1 }
pure def canSettle(s: LocalReads, found: LocalObject): bool = s.reader == ReaderRunning and s.pending > 0
pure def settle(s: LocalReads, found: LocalObject): LocalReads =
  if (certain(found)) { ...s, pending: s.pending - 1, localServed: s.localServed + 1 }
  else { ...s, pending: s.pending - 1, declined: s.declined + 1 }
pure def canCrash(s: LocalReads): bool = s.reader == ReaderRunning
pure def crash(s: LocalReads): LocalReads = { ...s, reader: ReaderDead, declined: s.declined + s.pending, pending: 0 }
pure def alwaysAccounted(s: LocalReads): bool =
  s.pending >= 0 and s.localServed >= 0 and s.declined >= 0 and s.localServed + s.declined + s.pending == s.asked
pure def alwaysOnlyRunningReaderWaits(s: LocalReads): bool = s.reader != ReaderRunning implies s.pending == 0
pure def stepAnswersNeverWithdrawn(before: LocalReads, after: LocalReads): bool =
  after.localServed >= before.localServed and after.declined >= before.declined and after.asked >= before.asked
pure def lawOnlyExactReadsOffered(q: GitRead): bool =
  (not(q.isGet) or not(q.apiOrigin) or not(q.exactAddress) or q.rangeOrConditional or not(q.plainAccept) or
    q.query == OtherQuery or (q.kind == CommitObject and q.query != NoQuery)) implies not(offeredLocally(q))
pure def lawUncertainObjectDeclined(found: LocalObject): bool =
  (not(found.held) or not(found.rightType) or not(found.certainFields) or found.entries > maxTreeEntries or
    found.bytes > maxLocalBytes) implies not(certain(found))
pure def sometimesServedLocally(s: LocalReads): bool = s.localServed > 0 and s.declined > 0
pure def sometimesCrashDeclinedWaiting(s: LocalReads): bool = s.reader == ReaderDead and s.declined >= 2
pure def sometimesRestartedAfterCrash(s: LocalReads): bool = s.reader == ReaderRunning and s.declined > 0 and s.localServed > 0
```

### Simulation samples include exact, conditional and recursive commit reads and uncertain objects

```quint
pure val treeRead: GitRead = { isGet: true, apiOrigin: true, exactAddress: true, objectPath: true, kind: TreeObject,
  query: RecursiveQuery, plainAccept: true, rangeOrConditional: false }
pure val gitReadValues = Set(treeRead, { ...treeRead, kind: CommitObject, query: NoQuery },
  { ...treeRead, kind: CommitObject }, { ...treeRead, rangeOrConditional: true }, { ...treeRead, exactAddress: false })
pure val qValues = gitReadValues
pure val heldObject: LocalObject = { held: true, rightType: true, certainFields: true, entries: 3, bytes: 900 }
pure val foundValues = Set(heldObject, { ...heldObject, held: false }, { ...heldObject, certainFields: false },
  { ...heldObject, entries: 20001 }, { ...heldObject, bytes: 5242881 })
```

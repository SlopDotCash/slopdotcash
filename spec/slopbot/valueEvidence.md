# Value evidence integrity

PRD sections 5 and 7 require exact registered sources and a recoverable
assessment before Points publication: a value assessment may read only
complete, immutable evidence. Source at the development head:
`workers/slopbot/value-evidence.ts` (`commitChangeEvidence`, `pages`,
`pullCommits`, `relatedPullRequests`), `value-evidence-types.ts`,
`value-tree.ts`, `value-blob.ts`, `value-binary.ts`, `value-patch.ts`,
`value-patch-replay.ts`, `value-comparison-counts.ts`,
`value-manifest-identity.ts`, `value-json-digest.ts`,
`value-accepted-commit-census.ts` and `git-object.ts`.

This is a library. Its definitions decide when collected evidence is
complete; everything short of that is a named limitation, and any
limitation makes the request's outcome `SourceIncomplete` in
[value requests](./valueRequests.md) "The outcome follows the consumer's
checks in order", so no model is called on it. The byte work (Git object
hashing, tree digests, Myers line counts, hunk replay, canonical JSON
digests) is hand-written TypeScript under `//@` contracts in
`apps/slopbot`; it reaches these definitions only as the typed results
below.

## Story: Value only evidence that is complete and hash-verified

> As a contributor, I want my work valued from every page, file and commit
> GitHub actually holds, verified byte for byte, so that a truncated
> listing or a missing file never becomes a low score.

### Evidence is complete only when every listed page was read; a page cap never implies coverage

Every listing is read in pages of 100 until a page holds fewer than 100. A
page that is not a list, a repeated GraphQL cursor or a changed reported
total stops the collection. The items read must equal the count GitHub
reports for files, commits, comments and review comments of the PR, and the
per-commit file listing stops with the limitation "file limit reached; Git
evidence required" at 3,000 files. A repeated file path is incomplete too.
The PR commit route stops at 250, so a larger PR is read through the
immutable compare range, which must report the same total and contain
every listed commit. A related private PR is withheld, which is a
limitation.

```quint
type PageListing = { pageSizes: List[int], unavailable: bool, reported: int, itemCap: int, repeatedKeys: bool }
pure val evidencePageSize = 100
pure val commitFileCap = 3000
pure val pullCommitRouteLimit = 250
pure def listedItems(l: PageListing): int = l.pageSizes.foldl(0, (n, s) => n + s)
pure def lastPage(l: PageListing): int = l.pageSizes.nthOr(l.pageSizes.length() - 1, evidencePageSize)
pure def pagesWellFormed(l: PageListing): bool =
  l.pageSizes.length() > 0 and l.pageSizes.every(s => s >= 0 and s <= evidencePageSize) and
  lastPage(l) < evidencePageSize and
  l.pageSizes.removeAt(l.pageSizes.length() - 1).every(s => s == evidencePageSize)
pure def capReached(l: PageListing): bool = l.itemCap > 0 and listedItems(l) >= l.itemCap
pure def listingComplete(l: PageListing): bool =
  not(l.unavailable) and not(l.repeatedKeys) and pagesWellFormed(l) and not(capReached(l)) and
  listedItems(l) == l.reported
pure def lawUnavailablePageIsIncomplete(sampleListing: PageListing): bool =
  sampleListing.unavailable implies not(listingComplete(sampleListing))
pure def lawCapNeverImpliesCoverage(sampleListing: PageListing): bool =
  capReached(sampleListing) implies not(listingComplete(sampleListing))
pure def lawFullLastPageIsIncomplete(sampleListing: PageListing): bool =
  lastPage(sampleListing) >= evidencePageSize implies not(listingComplete(sampleListing))
pure def lawCountMismatchIsIncomplete(sampleListing: PageListing): bool =
  listedItems(sampleListing) != sampleListing.reported implies not(listingComplete(sampleListing))
pure val sampleListingValues = Set(
  { pageSizes: List(100, 7), unavailable: false, reported: 107, itemCap: 0, repeatedKeys: false },
  { pageSizes: List(100, 100), unavailable: false, reported: 200, itemCap: 0, repeatedKeys: false },
  { pageSizes: List(100, 7), unavailable: false, reported: 120, itemCap: 0, repeatedKeys: false },
  { pageSizes: List(100, 7), unavailable: true, reported: 107, itemCap: 0, repeatedKeys: false },
  { pageSizes: List(0), unavailable: false, reported: 0, itemCap: 3000, repeatedKeys: false },
  { pageSizes: List(100, 7), unavailable: false, reported: 107, itemCap: 50, repeatedKeys: false },
  { pageSizes: List(3), unavailable: false, reported: 3, itemCap: 0, repeatedKeys: true })
```

### Absence is proved only by a hash-verified tree, never by a 404

Source `readValueTreeProof`, `readValueTreeRootProof` and `readValuePaths`.
A tree counts only when the commit read back has the requested SHA, the
tree read back has that commit's tree SHA, GitHub reports it not
truncated, it has at most 20,000 entries, every entry has a safe relative
path (at most 1,024 characters, no backslash, control character, empty,
`.` or `..` segment), a unique path, a 40-hex object ID and a mode that
matches its type (`040000` tree; `100644`, `100755`, `120000` blob;
`160000` commit), and the Git tree object rebuilt from the entries hashes
to the expected tree SHA at the root and at every listed subtree. A path
lookup verifies the tree at every ancestor of at most 16 paths. Absence is
proved only by a verified parent tree without that child. A 404 from the
contents route proves nothing.

```quint
type TreeRead = { commitMatches: bool, treeShaMatches: bool, truncated: bool, entries: int,
  entriesWellFormed: bool, digestsMatch: bool }
type PathLookup = { ancestors: List[TreeRead], childListed: bool, contentsNotFound: bool, lookupPaths: int }
pure val treeEntryLimit = 20000
pure val pathLookupLimit = 16
pure def treeVerified(t: TreeRead): bool =
  t.commitMatches and t.treeShaMatches and not(t.truncated) and t.entries >= 0 and t.entries <= treeEntryLimit and
  t.entriesWellFormed and t.digestsMatch
pure def absenceProved(l: PathLookup): bool =
  l.lookupPaths > 0 and l.lookupPaths <= pathLookupLimit and l.ancestors.length() > 0 and
  l.ancestors.every(t => treeVerified(t)) and not(l.childListed)
pure def lawNotFoundAloneProvesNothing(sampleLookup: PathLookup): bool =
  sampleLookup.ancestors.some(t => not(treeVerified(t))) implies not(absenceProved(sampleLookup))
pure def lawTruncatedTreeProvesNothing(sampleLookup: PathLookup): bool =
  sampleLookup.ancestors.some(t => t.truncated) implies not(absenceProved(sampleLookup))
pure def lawListedChildIsPresent(sampleLookup: PathLookup): bool =
  sampleLookup.childListed implies not(absenceProved(sampleLookup))
pure val verifiedTree: TreeRead = { commitMatches: true, treeShaMatches: true, truncated: false, entries: 12,
  entriesWellFormed: true, digestsMatch: true }
pure val sampleLookupValues = Set(
  { ancestors: List(verifiedTree), childListed: false, contentsNotFound: true, lookupPaths: 1 },
  { ancestors: List(), childListed: false, contentsNotFound: true, lookupPaths: 1 },
  { ancestors: List({ ...verifiedTree, truncated: true }), childListed: false, contentsNotFound: true, lookupPaths: 1 },
  { ancestors: List(verifiedTree, { ...verifiedTree, digestsMatch: false }), childListed: false,
    contentsNotFound: true, lookupPaths: 2 },
  { ancestors: List(verifiedTree), childListed: true, contentsNotFound: false, lookupPaths: 1 },
  { ancestors: List(verifiedTree), childListed: false, contentsNotFound: true, lookupPaths: 17 })
```

### A blob, tree or binary claim counts only when its git object hash matches the bytes read

Source `gitObjectSha1`, `valueFileReader` and `binarySourceLimitations`.
The hash is SHA-1 of `<type> <length>\0` followed by the bytes. A blob is
read by a 40-hex commit and a safe path through the contents route as
base64; it counts only when its reported size equals the decoded length,
the size is at most 512 KiB, at most 48 reads and 2 MiB have been spent in
the one reader, and the computed hash equals the reported blob SHA. A
blob the collector already verified is reused without spending the
budget. A tree counts by the digest check above. Binary content counts
only when both its Git blob SHA and its SHA-256 match the bytes. Text used
to recover line counts must also contain no NUL byte. The text of an added
file whose patch GitHub omitted (`valuePatch` recovery in `value-patch.ts`)
has its own reader: at most 16 reads and 2 MiB in all, with no limit per
object below that, and a file the collector already verified is reused
without spending it.

```quint
type ObjectKind = BlobObject | TreeObject | BinaryObject | AddedPatchObject
type ObjectRead = { objectKind: ObjectKind, claimedSha: str, computedSha: str, claimedSha256: str,
  computedSha256: str, reportedSize: int, bytesRead: int, readNumber: int, bytesSoFar: int, reused: bool }
pure val blobReadLimit = 48
pure val blobByteLimit = 524288
pure val blobSessionByteLimit = 2097152
pure val addedPatchReadLimit = 16
pure val addedPatchSessionByteLimit = 2097152
pure def withinBlobBudget(o: ObjectRead): bool =
  o.reused or (o.reportedSize >= 0 and o.reportedSize <= blobByteLimit and o.bytesRead == o.reportedSize and
    o.readNumber >= 1 and o.readNumber <= blobReadLimit and o.bytesSoFar <= blobSessionByteLimit)
pure def withinAddedPatchBudget(o: ObjectRead): bool =
  o.reused or (o.reportedSize >= 0 and o.bytesRead == o.reportedSize and o.readNumber >= 1 and
    o.readNumber <= addedPatchReadLimit and o.bytesSoFar <= addedPatchSessionByteLimit)
pure def objectVerified(o: ObjectRead): bool =
  o.claimedSha != "" and o.computedSha == o.claimedSha and
  (o.objectKind != BinaryObject or (o.claimedSha256 != "" and o.computedSha256 == o.claimedSha256)) and
  (o.objectKind != BlobObject or withinBlobBudget(o)) and
  (o.objectKind != AddedPatchObject or withinAddedPatchBudget(o))
pure def lawMismatchedHashNeverCounts(sampleObject: ObjectRead): bool =
  sampleObject.computedSha != sampleObject.claimedSha implies not(objectVerified(sampleObject))
pure def lawBinaryNeedsBothDigests(sampleObject: ObjectRead): bool =
  (sampleObject.objectKind == BinaryObject and sampleObject.computedSha256 != sampleObject.claimedSha256) implies
    not(objectVerified(sampleObject))
pure def lawBlobOverBudgetNeverCounts(sampleObject: ObjectRead): bool =
  (sampleObject.objectKind == BlobObject and not(sampleObject.reused) and sampleObject.readNumber > blobReadLimit)
    implies not(objectVerified(sampleObject))
pure def lawAddedPatchOverBudgetNeverCounts(sampleObject: ObjectRead): bool =
  (sampleObject.objectKind == AddedPatchObject and not(sampleObject.reused) and
    (sampleObject.readNumber > addedPatchReadLimit or sampleObject.bytesSoFar > addedPatchSessionByteLimit))
    implies not(objectVerified(sampleObject))
pure val verifiedBlob: ObjectRead = { objectKind: BlobObject, claimedSha: "b1", computedSha: "b1", claimedSha256: "",
  computedSha256: "", reportedSize: 10, bytesRead: 10, readNumber: 1, bytesSoFar: 10, reused: false }
pure val sampleObjectValues = Set(verifiedBlob, { ...verifiedBlob, computedSha: "b2" },
  { ...verifiedBlob, readNumber: 49 }, { ...verifiedBlob, reportedSize: 524289, bytesRead: 524289 },
  { ...verifiedBlob, readNumber: 49, reused: true },
  { ...verifiedBlob, objectKind: BinaryObject, claimedSha256: "s1", computedSha256: "s2" },
  { ...verifiedBlob, objectKind: TreeObject },
  { ...verifiedBlob, objectKind: AddedPatchObject, reportedSize: 524289, bytesRead: 524289, bytesSoFar: 524289 },
  { ...verifiedBlob, objectKind: AddedPatchObject, readNumber: 17 },
  { ...verifiedBlob, objectKind: AddedPatchObject, bytesSoFar: 2097153 })
```

### Line counts come from the exact patch or from hash-verified file text, and must sum to the commit's totals

Source `valuePatch`, `hasCompleteValuePatch`, `valueAdditionCount`,
`valueDeletionCount` and `fullComparisonCounts`. A file's counts come from
GitHub's patch when its `+` and `-` lines match the reported counts; from
the verified text of an added or removed file; or, for a modified file
GitHub reports with zero counts, from a Myers comparison of the verified
before and after text, given up past 200,000 changed lines or 2,000,000
comparisons. Otherwise the file needs its full diff and the evidence is
incomplete. Each commit's per-file additions and deletions must sum to
its reported totals.

For a registered merged pull request with a positive-count modification
omitted from the JSON patch listing, the producer can recover the exact
patch from a bounded GitHub diff response. It reads the immutable
base-to-head comparison or the reported accepted commit against its first
parent. The file path and mode must agree with hash-verified trees, the
diff's blob IDs must match those trees, and the new blob must match the
JSON file listing. Require a single complete section, valid ordered hunks
and matching addition and deletion counts. Existing JSON patches and
verified full comparisons retain precedence. The collector can use the
recovered patch for an existing assessment only if the recomputed source
digest matches that assessment. The regular file, binary and publication
checks still apply.

An ordinary one-parent commit can use the same diff response when one
modified file has no patch and both JSON counts are zero, and the existing
text comparison cannot account for the commit's totals. The parent must
match the submitted commit listing. The complete hash-verified parent and
commit trees must differ only at the listed regular-file modifications,
with each new blob matching its listed identity and each mode unchanged.
Every recovered patch must reproduce the verified text at its stated hunk
positions. The other files keep their known counts and all counts must sum
to the commit totals before any recovered count is used.

```quint
type LineSource = ExactPatch | AddedText | RemovedText | ComparedText | NoLineSource
type FileLines = { lineSource: LineSource, patchAdded: int, patchRemoved: int, additions: int, deletions: int,
  textVerified: bool }
type CommitLines = { fileLines: List[FileLines], statAdditions: int, statDeletions: int }
pure val comparedLineLimit = 200000
pure val comparisonStepLimit = 2000000
pure def fileLinesComplete(f: FileLines): bool =
  f.additions >= 0 and f.deletions >= 0 and
  (if (f.lineSource == ExactPatch) f.patchAdded == f.additions and f.patchRemoved == f.deletions
   else f.lineSource != NoLineSource and f.textVerified)
pure def commitLinesComplete(c: CommitLines): bool =
  c.fileLines.every(f => fileLinesComplete(f)) and
  c.fileLines.foldl(0, (n, f) => n + f.additions) == c.statAdditions and
  c.fileLines.foldl(0, (n, f) => n + f.deletions) == c.statDeletions
pure def lawMissingPatchNeverCounts(sampleLines: FileLines): bool =
  sampleLines.lineSource == NoLineSource implies not(fileLinesComplete(sampleLines))
pure def lawUnverifiedTextNeverCounts(sampleLines: FileLines): bool =
  (sampleLines.lineSource != ExactPatch and not(sampleLines.textVerified)) implies not(fileLinesComplete(sampleLines))
pure def lawPatchMismatchNeverCounts(sampleLines: FileLines): bool =
  (sampleLines.lineSource == ExactPatch and sampleLines.patchAdded != sampleLines.additions) implies
    not(fileLinesComplete(sampleLines))
pure val patchLines: FileLines = { lineSource: ExactPatch, patchAdded: 3, patchRemoved: 1, additions: 3, deletions: 1,
  textVerified: false }
pure val sampleLinesValues = Set(patchLines, { ...patchLines, patchAdded: 2 },
  { ...patchLines, lineSource: NoLineSource }, { ...patchLines, lineSource: ComparedText, textVerified: true },
  { ...patchLines, lineSource: AddedText })
pure val sampleCommitValues = Set({ fileLines: List(patchLines), statAdditions: 3, statDeletions: 1 },
  { fileLines: List(patchLines), statAdditions: 4, statDeletions: 1 },
  { fileLines: List(patchLines, { ...patchLines, lineSource: NoLineSource }), statAdditions: 6, statDeletions: 2 })
pure def lawCommitTotalsMustAgree(sampleCommit: CommitLines): bool =
  sampleCommit.fileLines.foldl(0, (n, f) => n + f.additions) != sampleCommit.statAdditions implies
    not(commitLinesComplete(sampleCommit))
```

### An accepted-patch replay counts only when every submitted file replays onto the accepted parent to the exact accepted bytes

Source `collectAcceptedPatchReplay`. The accepted commit has one parent,
and the submitted and accepted file sets are the same non-empty set of
paths, replayed one file at a time. Each file is added or modified with
the same status, no rename and no full-comparison recovery on either side,
the same addition and deletion counts, and identical hunks. Its head,
parent and accepted paths are found through verified trees, with regular
file modes that agree, and the accepted blob is read and hash-verified. An
added file's single hunk equals the accepted text and the head and accepted
blobs are the same. A modified file's head text contains every submitted
postimage, and replaying the hunks onto the hash-verified parent text
reproduces the accepted text exactly. One failure discards the whole
proof.

```quint
type ReplayFile = { sameShape: bool, sameHunks: bool, treesVerified: bool, modesAgree: bool,
  acceptedVerified: bool, sourceVerified: bool, replayEqualsAccepted: bool }
type ReplayProof = { singleParent: bool, submittedPaths: int, acceptedPaths: int, distinctPaths: bool,
  replayed: List[ReplayFile] }
pure def replayFileHolds(f: ReplayFile): bool =
  f.sameShape and f.sameHunks and f.treesVerified and f.modesAgree and f.acceptedVerified and f.sourceVerified and
  f.replayEqualsAccepted
pure def replayComplete(r: ReplayProof): bool =
  r.singleParent and r.distinctPaths and r.submittedPaths > 0 and r.submittedPaths == r.acceptedPaths and
  r.replayed.length() == r.submittedPaths and r.replayed.every(f => replayFileHolds(f))
pure def lawOneFailedFileDiscardsTheProof(sampleReplay: ReplayProof): bool =
  sampleReplay.replayed.some(f => not(f.replayEqualsAccepted)) implies not(replayComplete(sampleReplay))
pure def lawMergeWithTwoParentsNeverReplays(sampleReplay: ReplayProof): bool =
  not(sampleReplay.singleParent) implies not(replayComplete(sampleReplay))
pure val replayedFile: ReplayFile = { sameShape: true, sameHunks: true, treesVerified: true, modesAgree: true,
  acceptedVerified: true, sourceVerified: true, replayEqualsAccepted: true }
pure val sampleReplayValues = Set(
  { singleParent: true, submittedPaths: 1, acceptedPaths: 1, distinctPaths: true, replayed: List(replayedFile) },
  { singleParent: true, submittedPaths: 2, acceptedPaths: 2, distinctPaths: true,
    replayed: List(replayedFile, { ...replayedFile, replayEqualsAccepted: false }) },
  { singleParent: false, submittedPaths: 1, acceptedPaths: 1, distinctPaths: true, replayed: List(replayedFile) },
  { singleParent: true, submittedPaths: 1, acceptedPaths: 2, distinctPaths: true, replayed: List(replayedFile) })
```

### Accepted-commit census pages past the GraphQL limit through compare and refuses an overflow

Source `collectAcceptedCommitCensus`. The census searches the repository's
merged PRs from the API start, 100 per page with fresh cursors and a
stable issue count. A query reporting more than 1,000 results is split at
the midpoint of its merged-time range into two disjoint halves whose
counts must add up to it. Each PR must belong to the registered public
repository by node ID, database ID and current name, with a URL that
matches, and a merge time inside the range. Its commits are paged 100 at a
time without repeats until their count equals its reported total; the only
recoverable shortfall is GitHub's 250-commit listing limit, read through
the compare range, which must report the same total, list exactly that
many distinct commits and include every listed one. Any other shortfall
or excess refuses the whole census, and the merge commit is added to the
PR's accepted set.

```quint
type CensusPull = { identityMatches: bool, listedCommits: int, totalCommits: int, distinctCommits: bool,
  compareTotal: int, compareDistinct: int, compareCoversListed: bool }
type CensusQuery = { issueCount: int, countsStable: bool, cursorsFresh: bool, pulls: List[CensusPull] }
pure val searchResultLimit = 1000
pure def pullCommitsComplete(p: CensusPull): bool =
  p.identityMatches and p.distinctCommits and p.totalCommits >= 0 and
  (p.listedCommits == p.totalCommits or
    (p.listedCommits == pullCommitRouteLimit and p.totalCommits > pullCommitRouteLimit and
      p.compareTotal == p.totalCommits and p.compareDistinct == p.totalCommits and p.compareCoversListed))
pure def censusPageComplete(q: CensusQuery): bool =
  q.issueCount >= 0 and q.issueCount <= searchResultLimit and q.countsStable and q.cursorsFresh and
  q.pulls.length() == q.issueCount and q.pulls.every(p => pullCommitsComplete(p))
pure def splitAgrees(issueCount: int, leftIds: int, rightIds: int, overlapping: bool): bool =
  issueCount > searchResultLimit and leftIds + rightIds == issueCount and not(overlapping)
pure def lawOverflowRefused(sampleCensus: CensusQuery): bool =
  sampleCensus.pulls.some(p => p.listedCommits != p.totalCommits and
    not(p.listedCommits == pullCommitRouteLimit and p.totalCommits > pullCommitRouteLimit)) implies
    not(censusPageComplete(sampleCensus))
pure def lawOverLimitQueryMustSplit(sampleCensus: CensusQuery): bool =
  sampleCensus.issueCount > searchResultLimit implies not(censusPageComplete(sampleCensus))
pure def lawListingLimitNeedsCompare(sampleCensus: CensusQuery): bool =
  censusPageComplete(sampleCensus) implies sampleCensus.pulls.every(p =>
    p.listedCommits == p.totalCommits or p.compareTotal == p.totalCommits)
pure val smallPull: CensusPull = { identityMatches: true, listedCommits: 3, totalCommits: 3, distinctCommits: true,
  compareTotal: 0, compareDistinct: 0, compareCoversListed: false }
pure val largePull: CensusPull = { identityMatches: true, listedCommits: 250, totalCommits: 400, distinctCommits: true,
  compareTotal: 400, compareDistinct: 400, compareCoversListed: true }
pure val sampleCensusValues = Set(
  { issueCount: 2, countsStable: true, cursorsFresh: true, pulls: List(smallPull, largePull) },
  { issueCount: 1, countsStable: true, cursorsFresh: true, pulls: List({ ...largePull, compareTotal: 399 }) },
  { issueCount: 1, countsStable: true, cursorsFresh: true, pulls: List({ ...smallPull, listedCommits: 2 }) },
  { issueCount: 1001, countsStable: true, cursorsFresh: true, pulls: List() },
  { issueCount: 1, countsStable: false, cursorsFresh: true, pulls: List(smallPull) })
```

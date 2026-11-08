# Complete local work-unit history ancestry

This small cohort starts at `6aeeba78b069860d55757db00b3305971e8926d9`.
Current PRD sections 5 and 7 require source-bound accepted-work records and
no duplicate credit. The per-record ownership transition was already
proved, but `readWorkUnitHistory` still used a separate native ancestry walk
for its final whole-history coverage check. The caller now reuses the existing
proved `retainedAncestors` algorithm. No new runtime function, proof target,
policy, schema or error is added. No production defect is claimed.

## Existing proof, actual new caller

`workers/slopbot/value-work-unit-consumption.ts` already builds a unique
record digest map and an append-only digest-to-index map. Each row's digest,
sequence, bytes, schema, predecessors and ownership transition are checked
before both maps and the history array are updated together. The current
record is selected through its actual source key, as before.

The final check projects each record's exact `supersedes` list into an
adjacency list. Known record indices remain their existing dense indices.
Every unknown nonempty predecessor receives an explicit extra vertex with
no outgoing edges. The caller invokes `retainedAncestors` with the current
record's actual index.

The existing theorem establishes that the returned flags identify exactly
the vertices reachable by following parent edges. It supports cycles,
repeated edges and missing record vertices without assuming a Git DAG.
The returned sequence has exactly the graph's length, and the existing
algorithm proves all edge accesses and its bounded visited-queue traversal.

The new caller interprets those flags in the same order of refusal as the
old walk:

1. A reachable unknown predecessor throws `Joint history ancestor is missing`.
2. Otherwise, a count different from the loaded history length throws
   `Joint history contains unrelated records`.
3. Otherwise, return the unchanged history, through-sequence and original
   current record object.

An unreachable unknown predecessor does not cause an early missing-ancestor
error. Empty predecessor values retain the old skip behavior. Neither is a
valid value in the already-validated current record domain, but the projection
still preserves those graph semantics.

## Caller domain and limits

The native maps establish exact digest identity and the dense index relation.
Their semantics and the small returned-flag interpretation loop remain
reviewed adapter code, not a separate compiled map theorem. Known indices
are contiguous because each accepted row receives `used.length` before a
single append. Unknown indices use the next graph length. Every edge and
the selected start index therefore satisfy the reused theorem's domain.

The projection reads all loaded records eagerly. Those are plain objects
created by `JSON.parse` and checked by `assertRecord`; their predecessor
arrays contain validated digests. The proof does not promise getter/proxy
or arbitrary malformed object exception-order equivalence. The original
pagination, digest verification, schema errors, current-target selection,
per-record ownership operations and original object references are unchanged.

This closes the remaining *local graph traversal* in this reader using the
same exact reachability kernel as retained-copy matching. It does not prove
page acquisition, cryptographic digests, native Map identity, JSON/schema
validation, database completeness, concurrent publication or GitHub authority.
It is not a proof that the whole effectful reader refines a Quint model.

## Evidence and cost

The existing five-function retained-binding module passes **536 isolated
Dafny obligations, zero errors** from this worktree. Its source and checked
proof are unchanged by this cohort. The command is:

```sh
lsc check --backend=dafny --time-limit=30 --extra-flags=--isolate-assertions \
  workers/slopbot/verified-retained-binding.ts
```

Pinned tools are Bun 1.3.14, Node 24.15.0, LemmaScript 0.6.6 and Dafny 4.11.0.
Type checking and the scoped formatter/linter pass.

The existing real history, promotion and shared-source collection workflows
pass **44 tests and 248 assertions**. An exact before/after comparison passes
**690 complete paginated history reads** and **3,000 final graph checks**.
The complete reads preserve return values, error text and page-call arguments
for page sizes 1, 2 and 100. Graph cases include cycles, repeated edges,
missing and empty references, reachable/unreachable gaps and unrelated
records. They produced 1,895 matching missing-ancestor refusals, 1,011 matching
unrelated-history refusals and 94 matching accepted graphs.

The new representation adds one adjacency array, a digest index copy and
visited/queue arrays. Its space remains linear in vertices and edges. The old
walk also retained a digest Set and pending stack. A seven-sample alternating
local benchmark of complete one-claim revision-chain reads measured:

| Records | Before median (ms) | After median (ms) |
| --- | ---: | ---: |
| 10 | 0.72 | 0.81 |
| 100 | 4.80 | 3.19 |
| 1,000 | 53.29 | 44.69 |

These controlled page-provider measurements include JSON, hashing and earlier
validation. They are not a live-service speedup claim; this change is justified
by reuse of the complete graph contract. A read-only peer review found no
substantive issue in index identity, unknown-node refusal or returned metadata.
Ignored `evidence/history-coverage/` retains sources, drivers, results, proof,
workflow/typecheck logs, benchmark and commit receipt. Captured evidence is
not committed.

## Remaining source-specific candidates

The final review did not reclassify all original high-priority files as done.
`sameAuthorReopen` and the duplicate-key/numeric-token-preserving manifest
parser still have substantive ordered identity algorithms outside the current
retained-hunk theorem. Simple merge/binary field equality wrappers would not
prove the Git reconstruction, patch or cryptographic acquisition on which
those records depend.

The separate [route-credit cohort](lemmascript-route-credit.md) now covers
`finalizedRouteCredit`'s complete pre/post account-index join, exact
input/minimum-output check and unrelated-holding protection. Signature, ATA
and provider evidence remain separate.

The EVM recovery planner is proved; successor record construction, complete
award/source joins and frontend archived/open source selection are separate
algorithms. Their existing workflow evidence does not make them formally
proved. The candidate ledger should retain these distinctions when it is
refreshed after integration.

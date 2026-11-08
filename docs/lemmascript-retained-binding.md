# Retained-copy ancestry and unique hunk bindings

This cohort starts at `f18d893779762e93ad29d7d8f293456017380822` in an
isolated worktree. Current PRD sections 5 and 7 require accepted-work scoring,
verified commit authors and no repeated reward for the same work. The
existing retained-copy path binds a copied change to its original source.
This change proves its substantial ancestry and unique-hunk selection
algorithms. It adds no scoring, acceptance or ownership policy. No production
defect is claimed.

## Production path

`value-retained-copy.ts:preexistingHunks` handles a copy that omits a hunk
already introduced by another accepted fix. It now uses five verified
functions from `verified-retained-binding.ts`:

| Function | Complete proved result |
| --- | --- |
| `retainedAncestors` | Exactly the vertices reachable by following captured parent edges from the accepted commit; a missing start reaches none. |
| `hunkListed` | Exact string membership, used by the two matching scans. |
| `orderedHunkDifference` | Accepts exactly a nonempty proper subset in original hunk order; returns every missing original index. |
| `candidateHasHunk` | Whether one actual candidate file at the exact path contains the exact parsed hunk. |
| `uniqueHunkBindings` | A binding exists exactly when each missing hunk has one eligible attribution record; returns its original candidate index for each missing hunk. |

The original file-name/status check and `changedHunks` parsing remain before
these decisions. Missing or invalid parsed hunks still refuse the copy.
The existing exact-edit and manifest-edit matches still run before this
fallback. The result still passes through the original distinct-SHA set and
native string sort. Returned attribution indices select the original source
records; the kernel does not manufacture a commit or actor identity.

## Full graph contract

The graph adapter preserves the original `new Map(commits.map(...))`
semantics. The last record with a repeated SHA supplies its parent list.
Native Map insertion order is not an ancestry claim. Every nonempty SHA
mentioned by a captured parent or attribution gets a vertex, including a
parent without its own captured commit record. Such a vertex has no outgoing
edges, but can still be reached. The old traversal compared the pending SHA
before looking up its record; that behavior is retained. Empty pending SHAs
were skipped before comparison and remain excluded.

The proof does not assume a Git DAG. Cycles, self-edges, repeated edges and
missing parent records are all supported. The runtime uses visited flags and
a queue, marking a vertex when it is added. Each vertex enters the queue at
most once. The queue never exceeds the graph's vertex count and all accesses
are in range.

The mathematical reachability predicate is the least parent-closed set that
contains the start: a vertex is reachable exactly when every parent-closed
set containing the start contains that vertex. The proof establishes both
directions. Every enqueued vertex is reachable, and the final visited set is
parent-closed and contains the start. This is a complete reachability proof,
not merely a bounds check or a supplied `isAncestor` Boolean. A checked ghost
predicate expresses the mathematical set property; it is not an axiom or an
external oracle.

The native adapter constructs only in-range edges. Its index map, exact
SHA-to-record association and native string identity remain reviewed
boundaries. They do not prove that the captured records are authentic Git
objects or that the capture is complete.

## Ordered hunk and unique-source contracts

The copied hunk list must be nonempty and shorter than the original list.
Filtering the original list by copied-hunk membership must produce exactly
the copied list. This preserves the old subset and ordering checks, including
exact whitespace and string content. The output contains every omitted
original hunk index, in original order.

For each missing hunk, a matching attribution record must:

- Name a SHA different from the accepted commit.
- Have no recorded limitations.
- Name a vertex reachable in the captured parent graph.
- Contain a parsed file at the exact original path with the exact hunk.

All candidate records are counted. Two matching attribution records remain
ambiguous even when they have the same SHA. Multiple matching files within
one record still count as one candidate, as the old `some` did. Exactly one
record must match every omitted hunk. Different missing hunks may select the
same record; final SHA deduplication remains the native wrapper's job.

The wrapper obtains one proved ancestry vector before parsing eligible
candidate files. SHA, limitation, ancestry and path checks still precede
that parsing. `uniqueHunkBindings` computes reachability from the same graph
again inside its checked composition; it does not trust the wrapper's
Boolean results. Parsed candidate hunks are reused across missing hunks.

## Native and effectful boundaries

`changedHunks` and `retainedEditIdentity` remain the existing native parser
boundary. They validate complete changed-line counts, refuse unsupported
rename/status cases, preserve exact changed-line strings and reject repeated
hunks. This cohort does not prove the patch tokenizer, generated added or
removed patches, JSON encoding, or native final string sorting.

Production collectors normalize every commit's parents to plain SHA records
before this path. Inputs are captured typed records with ordinary arrays
and strings. The graph adapter and candidate projections read those fields
eagerly. The proof does not promise exception-order equivalence for arbitrary
malformed objects, getters, proxies or mutation during a synchronous match.
It introduces no new public validation rule or fallback for such objects.
Every supplied array index/count comes from a native array or Map size and
is an exact JavaScript integer. No money arithmetic is involved.

Authenticated comment/merge references, same-author reopen qualification,
Git reconstruction, source capture completeness, cryptographic hashes,
manifest parsing, legal ownership, accepted-work policy and publication
remain external evidence or other existing algorithms. This proof does not
turn a captured SHA or matching patch into proof of GitHub authority.

## Validation

Pinned tools are Bun 1.3.14, Node 24.15.0, LemmaScript 0.6.6 and Dafny 4.11.0.

```sh
lsc check --backend=dafny --time-limit=30 --extra-flags=--isolate-assertions \
  workers/slopbot/verified-retained-binding.ts
lsc check --backend=dafny --time-limit=30 workers/slopbot/verified-retained-binding.ts
bun test --timeout 30000 workers/slopbot/accepted-promotion.test.ts \
  workers/slopbot/value-pipeline.test.ts workers/slopbot/value-group-collection.test.ts \
  workers/slopbot/value-shared-commit-group.test.ts
bun run typecheck
```

The five functions pass **536 isolated obligations**, or **30 default-grouped
verifier results**, with zero errors or warnings. The complete generated
headers and executable bodies remain unchanged in the proof. Additions are
checked definitions, lemmas and assertion blocks. There are no axioms,
assumptions, extern functions, omitted obligations or unproved bodies.
The integrity and selected-function obligation checks pass.

The separate integrity-tool commit `adafcf763c80e644053dc4e1c3283900ce015a4c`
adds only support for defined `ghost function` and `ghost predicate` headers.
It preserves full tokens and rejects bodyless helpers, generated-body/header
changes, mixed or repeated modifiers, ghost methods/lemmas, attributes,
includes and assumptions. Its adversarial suite passes 13 tests and 50
assertions; all 23 existing committed proof pairs still pass integrity.

The final runtime passes **42 existing tests and 231 assertions**. These
exercise collection, retained-copy promotion, shared source discovery and
SQLite-backed publication recovery. Type checking and the scoped formatter
and linter pass.

Saved comparisons use exact original and changed function bodies:

- 4,496 reachability comparisons on 500 graph/start cases, including cycles.
- 2,200 complete `preexistingHunks` calls: 303 bindings and 1,897 refusals,
  including missing, duplicate, limited and wrong-path candidates.
- Nine full `retainedCopyBindings` workflows agree on complete bindings,
  limitations and unchanged input. They include retained omitted hunks,
  duplicate attribution, unknown parent records, cycles, last-duplicate SHA
  precedence and missing acknowledgement. Three produce a binding; the
  ordinary retained case binds the omitted hunk to the exact prior SHA.

These 6,705 comparisons supplement the real application workflows; they do
not replace them or establish live provider correctness. A separate read-only
peer review found no substantive issue in the graph, parser gates, duplicate
handling or returned original identities.

## Cost and remaining candidate disposition

The previous implementation rebuilt the commit map and traversed ancestry
for every missing-hunk/candidate pair. The new implementation builds one
graph and performs two linear reachability traversals, then reuses parsed
candidate hunks. It allocates graph/queue/visited arrays and candidate hunk
records. A seven-sample alternating local benchmark of the actual old/new
matching functions used 50 attribution records and four missing hunks:

| Captured commits | Before median (ms) | After median (ms) |
| --- | ---: | ---: |
| 64 | 1.15 | 0.11 |
| 256 | 14.24 | 0.16 |
| 1,024 | 52.80 | 0.25 |

This is a measured improvement for those controlled matching inputs, not a
whole-service latency claim or a bound on provider, Git or storage work.

The research also re-read `value-merge-resolution.ts`, `value-binary.ts`,
`value-patch.ts` and `value-manifest-identity.ts`. The remaining merge
validator compares metadata and path/hex grammar; proving one equality
would not prove its Git reconstruction. Binary admission combines budget
reduction and field agreement with base64/UTF-8 decoding, Git blob SHA-1,
SHA-256, authenticated tree acquisition and content classification. Those
acquisition and cryptographic claims remain effectful boundaries. The
native manifest parser's duplicate-key and numeric-token preservation and
the same-author reopen history comparison remain possible separate pure
projects; neither is claimed proved here. No trivial equality wrapper was
added merely to increase the selected-function count.

Ignored `evidence/retained-binding/` retains baseline sources, drivers,
comparison results, benchmark, proof and workflow logs, tool versions and a
commit receipt. Captured evidence is not committed. Shared inventories,
Quint mappings, merge and push remain under the integration owner.

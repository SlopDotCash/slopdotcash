# Accepted commits and work-unit source ownership

This cohort starts at `4008930a58beeb65ee3eda9316453a8b6633159f` in an
isolated worktree. PRD sections5 and7 and the existing Slopbot work-unit contract require
one accepted source scope and no duplicate source or claim ownership. This
change proves two existing algorithms used by discovery and journal reading.
It adds no acceptance policy or new refusal. No production defect is claimed.

## Complete accepted-commit selection

`acceptedWorkUnitCommits` in `workers/slopbot/value-work-unit.ts` calls
`selectAcceptedCommitIndices` from `verified-source-ownership.ts`. The kernel
keeps a commit exactly when both original conditions hold:

- It has at most one parent, or a merge-resolution record names its exact SHA.
- Acceptance is direct, or the indirect acceptance list contains its exact SHA.

The contract returns the complete selected index sequence, in original order,
with valid and strictly increasing indices. Duplicate SHAs retain every
qualifying original position. The wrapper maps those indices back to the
original commit objects. Discovery and valuation still call the same wrapper.

The adapter projects actual commit SHA and parent-array length, exact
merge-resolution SHAs and a tagged direct/indirect acceptance list. It does
not pass a Boolean saying the commit is authorized. This selector does not
establish that a merge resolution is valid: the existing later
`mergeResolutionMatches` checks and source admission still do that. It does
not infer that a GitHub commit association is acceptance evidence.

## Complete per-record ownership transition

`readWorkUnitHistory` in `value-work-unit-consumption.ts` calls
`planOwnershipTransition` after each row's original byte, sequence, JSON and
record-schema checks. Five runtime functions are verified: the two exported
kernels and three membership helpers used by them.

The ownership kernel receives the actual new project and digest, predecessor
records, retirement flags, new source and claim keys with their current
owners, and the current claim-owner entries. A predecessor includes its
actual project and complete source-key list, or an explicit missing-record
case. No provider or authority result is represented by an assumed Boolean.

The complete refusal order is proved with if-and-only-if postconditions:

1. Refuse a missing, already-retired, wrong-project or source-incomplete
   predecessor.
2. Otherwise refuse a source whose current owner is omitted from predecessors.
3. Otherwise refuse a claim whose current owner is omitted from predecessors.
4. Otherwise return the complete operation plan.

Every refused plan has empty operation arrays. Every ready plan returns:

- All predecessor retirement indices, in predecessor order.
- Every claim currently owned by a predecessor, grouped in predecessor order
  and then existing claim-map order.
- Every new source key, in its existing order, assigned to the new digest.
- Every new claim key, in its existing order, assigned to the new digest.

Thus an omitted old claim is released, an explicitly retained claim receives
the new owner, and an unrelated claim is untouched. It is not enough merely
to check that each new claim is unique. The complete removal list is part of
the contract. The native adapter applies exactly those returned retire,
remove and set operations before adding the row to the existing history.

The retiring state uses an append-only dense record index and Boolean flag
array. `recordIndices` receives a digest only after its row has passed all
checks; the same index is appended as not retired. The kernel returns the
indices to retire, and proves they are in range. This is concrete state, not
an authorization flag. It avoids copying or scanning the whole set of old
retired digests for each new row. A missing predecessor has index -1 and the
explicit missing-record tag. The kernel's precondition requires a stored
predecessor's index to address the supplied retirement array; the native map
and append operation provide it.

## Boundaries and preserved order

The source key remains exactly `JSON.stringify([repositoryNodeId,
pullRequestNodeId])`. SHA, claim and source comparisons use exact existing
strings. There is no new normalization, sort, truncation or identifier rule.
Current source and claim owners still come from the original native Maps;
map iteration, lookup, digest-to-record/index association and operation
application remain explicit adapter boundaries. Both original native Sets
that form predecessors and source membership still provide their original
insertion order and duplicate collapse.

The relevant input domain is typed plain records that have passed the
existing per-row validation. Previous records were checked before they
entered the map. The input arrays are real finite JavaScript arrays; their
indices and lengths are safe integers. Persisted digests are nonempty
validated strings, so the existing truthy-owner test and its tagged
projection agree. The proof does not cover arbitrary getters, proxies or
malformed direct-call evidence objects. In particular, the native projections
read the already-validated predecessor and owner fields eagerly.

Page loading, pagination checks, hash acquisition and verification, JSON
parsing, record schema validation, current-target selection, final ancestry
traversal and full-history coverage remain in their original locations and
order. A bad row still stops before another page is requested. The kernel
never calls GitHub, decides who accepted a commit, publishes an assessment,
or writes the journal. This is a proved per-record transition and a native
map-application adapter, not a proof of the whole `readWorkUnitHistory`
workflow or its SQL/concurrency behavior.

The production change retains the original source and record objects in
returned history. Retiring flags and the extra index map are local to a read;
no schema, stored bytes or public response field changes.

## Evidence and cost

Pinned tools are Bun 1.3.14, Node 24.15.0, LemmaScript 0.6.6 and Dafny 4.11.0.
The strict command is:

```sh
lsc check --backend=dafny --time-limit=30 --extra-flags=--isolate-assertions \
  workers/slopbot/verified-source-ownership.ts
```

The five functions pass **364 isolated obligations with zero errors**, or
**19 default-grouped verifier results**. The
proof adds only checked mathematical definitions and assertion blocks to the
unchanged generated executable bodies and headers. Integrity and complete
source-obligation checks pass. There are no axioms, assumptions, extern
functions or skipped obligations.

The final runtime passes **44 existing tests and 248 assertions** across
`value-shared-commit-group`, `value-group-collection`, `history-registry` and
`accepted-promotion`. These include real migrated SQLite/HTTP journal reads,
registry renames and states, shared-commit discovery and full retained-copy
preparation. Type checking passes. The touched source has the existing
unchanged `changedPaths!` lint warning in `value-work-unit.ts`; no new lint
warning was added.

A deterministic before/after comparison records **35,803 matching checks**:
29,656 selection and original-object checks, 5,457 ownership-plan and map
application checks, and 690 complete history-read comparisons. The last set
covers page sizes 1, 2 and 100, roots and combined successors, retired-parent
forks, missing predecessors, omitted sources, repeated claims, intentionally
omitted old claims, missing targets and malformed JSON. It compares complete
returns, error text and page-call order. The input operations include all
four decision branches. These generated cases supplement the real workflows;
they do not claim live-provider evidence.

The adapter adds per-record projections and returned operation arrays. It
snapshots current claim entries once when predecessors exist, then returns
only the changed keys. The old removal loop already enumerated those entries.
It does not construct replacement ownership maps or copy the full
retired-record array on every row. The transient allocation
is linear in the current predecessors, new members/claims and removable
claim inventory. The predecessor-by-claim scan retains the old worst-case
order of work. Native map effects and allocation/resource limits are not
part of the mathematical theorem.

A seven-sample alternating local benchmark measured complete validated
one-claim revision-chain reads, including native JSON and SHA-256 and a
controlled page provider:

| Records | Before median (ms) | After median (ms) |
| --- | ---: | ---: |
| 10 | 3.73 | 5.40 |
| 100 | 107.24 | 144.46 |
| 1,000 | 880.24 | 965.33 |

These measurements show local cost, not a speedup or a live-service latency
bound. Concurrent verification and runtime scheduling affect small samples.
The benefit is a complete checked decision and operation contract.

Ignored `evidence/source-ownership/` retains exact baseline source, drivers,
results, proof logs, checks, benchmark, tool versions and a commit receipt.
Captured evidence is not committed. Root-owned inventories, Quint mappings,
merge and push are handled separately.

## Remaining accepted-source work

This cohort does not close retained-copy edit/hunk matching, merge-resolution
identity, complete SHA/parent association parsing, or the final ancestry
traversal. `value-retained-copy.ts` still has useful pure candidates in
`retainedEditIdentity`, `changedHunks`, `preexistingHunks`, same-author reopen
history comparison and exact retained-copy binding selection. Their
complete patch/rename/binary/manifest domains need separate contracts.
Cryptographic hashes, canonical Git reconstruction, live GitHub acceptance,
source acquisition and publication ownership remain external evidence or
state/concurrency boundaries. No blanket completion claim is made for that
family.

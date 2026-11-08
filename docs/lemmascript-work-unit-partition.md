# Complete work-unit claim partition

This isolated cohort starts from
`c3f4da61c66f74469b6f9d980b0151adb008674c`. It addresses the active accepted-work
integrity candidate from the backend report and PRD sections 5 and 7. One
accepted source claim must not earn implementation credit in two proposed
work units, disappear from a complete assessment, or be invented by a model.
No scoring policy, claim identity, actor selection or publication behavior is
changed. This is a formal assurance improvement, not a claimed production
defect correction.

## Production path and exact contract

`validateWorkUnitAssessment` validates the structured model response and
builds copied string arrays for each unit. It validates the existing review
and assessment rules, then calls `validateWorkUnitPartition` on claim-bearing
units. Review-only units are filtered there as before. The resulting assessment
continues through the existing retained-inference and publication paths.

`validateWorkUnitPartition` keeps the early refusal for source limitations.
It maps each distinct source claim ID to a dense integer and preserves the
current duplicate-source-ID behavior: duplicate IDs in the supplied evidence
collapse to one available claim. Exact JavaScript Map string identity is
used; there is no lowercasing, normalization, sorting or delimiter encoding.
Unknown references become `-1`, including an unknown empty string.

The production-used `completeClaimPartition` kernel in
`workers/slopbot/verified-work-unit.ts` has one exact postcondition. It returns
true if and only if:

- Every supplied unit contains at least one claim.
- Every referenced claim is in the available range.
- No two references anywhere in the units name the same claim.
- Every available claim occurs in the units.

Thus empty source evidence with no units returns true, while an empty unit,
unknown reference, duplicate reference or missing source claim returns false.
The theorem uses complete membership, pairwise distinctness and coverage
predicates, rather than an assumed authorization or a precomputed validity
flag.

The kernel's only precondition is a nonnegative integer claim count. The
adapter supplies the exact Map size, and every generated index is an exact
integer below that size. The unknown sentinel is deliberately outside the
range and is checked before indexing. Native array lengths bound the index
arithmetic. The theorem allows any finite nested integer arrays, including
negative and excessive references.

## Allocation and proof representation

The runtime initializes one visited bitmap, scans the original nested unit
arrays and checks the bitmap for completeness. It does not materialize a
second flattened claim list. `FlattenClaims` and `ClaimsPrefix` exist only in
the proof. Checked lemmas connect those mathematical prefixes to the complete
sequence so early unknown and duplicate refusals establish the same exact
postcondition as success.

The adapter still allocates the indexed unit arrays needed to cross from
string identity to the integer kernel. Its time and space are linear in the
source claim count and number of references. The kernel adds a bitmap whose
length is the distinct source claim count. The source schema does not impose
a maximum claim-array length. The model request's `max_tokens: 16000` is a
provider setting, not a proven application array bound, and retained results
are revalidated. This change adds no speculative size restriction.

## Caller and proof limits

The theorem begins with indexed claims. The Map adapter's obligation is to
preserve the one-to-one relationship between each distinct source ID and its
index. The adapter is small and is exercised against the original complete
function. The proof does not assume a native Map implementation or sorting
axiom.

The sole production caller validates and copies every `claimIds` string array
before invoking this function. Eager index conversion therefore does not move
malformed-response failures in that workflow. Arbitrary getters, proxies or
incorrectly cast direct-call objects are outside this refinement claim.

The complete source records, actor IDs, paths, commits, carrier PRs and claim
digests remain unchanged. The theorem does not establish that GitHub accepted
those commits, that the source census is complete, that the model's quality
judgment is correct, or that storage/publication is atomic. Those are the
existing collection, schema, authority, provider and Quint boundaries.
`acceptedWorkUnitCommits` and source-evidence construction are unchanged.

## Verification and reproduction

Tools are pinned Bun 1.3.14, Node 24.15.0, LemmaScript 0.6.6 and Dafny 4.11.0.
The runtime dependency link is read-only. No dependency install, shared
inventory edit or shared checkout mutation was performed.

```sh
lsc check --backend=dafny --time-limit=30 --extra-flags=--isolate-assertions \
  workers/slopbot/verified-work-unit.ts
bun test --timeout 30000 ./workers/slopbot/value-pipeline.test.ts \
  ./workers/slopbot/value-publication-fence.test.ts \
  ./workers/slopbot/value-shared-commit-group.test.ts \
  ./scripts/joint-value-scoring.test.ts ./scripts/value-self-review.test.ts
bun run typecheck
```

The kernel passes **281 strict obligations**, or **11 results** in default
grouping, with zero errors. The integrity receipt, source hashes, timing
samples and commit are saved under ignored
`evidence/work-unit-partition/receipt.json`. All generated executable bodies
and function headers remain unchanged in the checked proof. Additions are
terminating mathematical definitions, checked lemmas and assertion proofs;
there are no axioms, externs or assumed boundaries.

The real workflow tests passed **30 tests and 210 assertions**, with no
failures. They use the actual consumer, SQLite migrations, retained inference,
source grouping, publication fences and leaderboard projection. Provider and
Git fixtures remain controlled and are not live GitHub or model-quality
acceptance.

The saved comparison runs the original and changed public functions over
**6,020 cases**, with **2,290 accepted and 3,730 refused**. It covers duplicate
source IDs, repeated and unknown references, omissions, empty units, empty
evidence, source limitations, Unicode/NUL IDs, reference order and input
immutability. Benchmarks use the same complete wrappers, not an isolated
bitmap loop. They are local cost samples, not a claimed application speedup.

Seven-sample median milliseconds per complete public-function call were:

| Distinct claims | Before | After |
| --- | ---: | ---: |
| 100 | 0.008 | 0.004 |
| 1,000 | 0.058 | 0.033 |
| 10,000 | 0.759 | 0.899 |

These samples include mapping and the full partition check. They establish
neither a maximum supported assessment size nor a live service latency bound.

Full type checking passes. The touched legacy module still has its unchanged
Biome non-null-assertion warning at the existing `changedPaths!` expression;
the new kernel has no such warning. No unrelated lint change is included.
There is no UI, live model request, signing, deployment, merge or push here.

# Project-skill publication safety VIEW V1

This is a manually reviewed strong safety projection of the unchanged bounded
`project_skill_publication` model. It supports PRD section 4's generated skill
publication and refusal behavior. The complete concrete model, all request and
project IDs, methods, routes, boolean choices, actions, dispatcher, scenarios,
invariant, mapped runtime, adapter and checker allowances remain unchanged.
The VIEW changes TLC fingerprints; TLC still executes a complete representative
state. It does not establish application refinement, liveness, HTTP-host body
behavior, exact erased diagnostics, linearizable registry reads, or immediate
revocation of an in-progress response.

## Exact observations

All globals remain complete: present, active, published, retired, restrictions,
revisions, evidence, template, assets and livePin. In particular, livePin remains
exact even though normal clearance ignores pin freshness: `changeLivePin` reads
it for enabledness. Map domains and every retained value remain exact.

Every request's `delivered` output is erased. `deliver` writes it from its
parameter; no executable action, guard or invariant reads it. Scenario
assertions still inspect the original concrete output.

For the known postlookup phases template, clearance, discovered, files, render
and select, erase only projectRead, restrictionsRead and the five captured sets
present, active, published, retired and restrictions. The action read matrix is:

| Phase/action | Reads of erased captures | Retained outputs/continuations |
| --- | --- | --- |
| lookup/readProjects | projectRead; copies globals into four sets and revisions | Complete lookup row remains exact, including revisions |
| lookup/readRestrictions | restrictionsRead; copies global restrictions | Complete lookup row remains exact |
| lookup/joined | Both flags and all five sets | Computes actual listed/refusal result or candidates before projection |
| postlookup operations | No read of those seven fields | Every other live field remains exact |
| response/deliver | Only phase; writes delivered | Exact phase and raw invariant vector |
| unused/begin | Only old phase; full idle-based reset | Original inputs, branch and reset before projection |

No postlookup action returns to lookup. `dependencyFailure` preserves the phase
restriction from the original source and computes `respond` using exact method
and caught/status parameters. Captured revisions stay exact in **every** live
row: render reads them, and a dirty artifact-200 prefix's invariant also reads
them outside the render phase. Lookup and unknown phases are otherwise entirely
raw. There are no ownership/refusal shortcuts or assumed healthy live states.

For unused, fallthrough, response and done retain exact phase and these eight
separate **RAW** original local clauses, without assuming any is true:

1. Positive status implies noStore.
2. HEAD with positive status outside catch implies no body.
3. Artifact-200 implies both roles, fileCount 4, project in cleared and equality
   of renderedRevision with the captured revision at that project.
4. Discovery-200 implies cleared is a subset of candidates.
5. Terms-200 implies template 0 and fileCount 0.
6. Unconditional cleared is a subset of candidates.
7. The original conjunction fileCount >= 0 and fileCount <= 4.
8. Fallthrough implies status 0 and noStore false.

The subset is request.cleared versus request.candidates, not the constant project
ID set. The original two file-count bounds remain one conjunction because no
terminal continuation consumes either count. These clauses need not vary
independently in every combination; for example discovery's conditional subset
and the unconditional subset share operands. Every feasible false observation
is retained without an all-true refusal or terminal shortcut.

## Congruence without an invariant assumption

Relate well-typed states when all globals agree, request phases agree, complete
lookup/unknown rows agree except delivered, postlookup rows agree after exactly
the seven-field mask plus delivered, and terminal rows have equal eight-bit
vectors. The relation applies to hypothetical false-invariant prefixes as well
as reachable states.

Every same-parameter global action has identical enabledness and writes exact
retained globals. Its only cross-request dependency is omit's all-unused phase
guard, which remains exact. No global action reads any terminal payload or
postlookup erased capture. Global writes cannot change any terminal clause:
all eight use captured request fields and constants, not current global data.

Lookup enabledness and successors agree because the entire row needed by its
read guards and joined calculation is raw. A successful joined calculation
consumes the old exact flags and sets, then forms its actual response/candidates
before the new phase is masked. Both successors therefore project identically.
No partly read lookup row is prematurely erased. All later request operations
read only retained fields and exact globals. Copies of the seven dead captures
stay in the same erased cone. They cannot affect guard choices, future retained
writes or the invariant. Unknown phases receive no extra liveness assumption.

Unused requests can only begin. Begin checks the retained phase and replaces the
entire request with idle plus original arguments; no old payload survives. All
eight resulting clauses are true for either lookup or fallthrough, while lookup
retains all fresh fields. Fallthrough and done absorb. Response can only deliver:
status, method, body, caught, revision map and every other clause operand carry;
phase response to done leaves clause 8 true. Consequently both enabledness and
same-parameter projected successors agree, including arbitrary false vectors.
Slot reuse is not introduced. No cross-slot payload reader exists.

The invariant is reconstructed as the conjunction of the eight terminal bits
and the unchanged original clauses over every full/masked live row. None of the
seven postlookup erased captures or delivered occurs in those clauses. This
preserves truth and false classes in both directions; it is not a temporal or
exact-response-byte claim.

## Binding and control source

The hardcoded descriptor and manifest pin the complete original QNT, complete
production TLA, exact literal, final viewed TLA and official adapter. Production
capture stops before exploration. Applying the descriptor to that complete TLA
must preserve its original module body and full 80-equals terminator. Future
reads, partial-reset/reuse, changed phase gates, cross-slot readers, a new method
domain, or any other QNT byte change refuse pending another manual review.

`project-skill-publication-safety-view.test.ts` contains named-property native
negative controls (property is the named witness alone, never the original
invariant as an unrelated conjunct), initial-state rejection checks and required
State 2 or State 3 boundaries. They cover feasible false/healing clauses in
unused/absorbing/response rows, raw globals, lookup partial reads, unknown rows,
all other live operands, captured revisions at render and a dirty live
artifact-200 clause, real joined candidates/refusal, dirty begin reset, omit's
phase gate and actual delivery carrying a false artifact clause.

RAW2/VIEW1 pairs target only approved masks, including a retained false count
class. Actual-action pairs include RAW4/VIEW2 joined/output, read, template,
render and delivery boundaries. The distinct lookup snapshots consumed by
joined deliberately expect RAW4/VIEW3: lookup remains raw until the last read.
An actual dirty unused full reset expects RAW3/VIEW2. Positive pairs use TRUE
alone and require exhausted queues; negatives require the named witness at a
noninitial state. These are bounded regression controls, not a mechanized proof
of the manual congruence argument.

## Qualification status

This packet is static preparation only. Source-bound literal review, strict
format/type checks, actual complete translation/application and index checks are
recorded separately in ignored evidence. All native controls, original scenarios,
sampled traces and full finite graph remain **unexecuted for this packet** until
the release coordinator explicitly schedules them. Existing raw deadline reports
are incomplete checks, not evidence of a counterexample or a completed graph.

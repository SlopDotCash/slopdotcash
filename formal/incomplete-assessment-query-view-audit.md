# Incomplete-assessment query VIEW audit: static prototype

Status: **static prototype, not native or full-graph qualified**. The owner
reviewed the complete original model and source proposal before authorizing
this implementation. The manual argument below covers the current invariant
and strong same-parameter labeled successors over defined source expressions,
including false/healing prefixes. It is not a mechanically checked refinement
proof, performance result or application-acceptance claim.

Checker base is exactly `88b393dcc0a550653cb70601ffc6e427557343a9`, not a
private timeout child. The QNT, all actions/domains/invariants and all 23
scenarios are unchanged. Only the hardcoded helper/manifest, source controls,
this audit, native workflow registration and derived catalogs change. No
runtime/resource allowance, model or scenario change is included. One bounded
full production translation capture was separately authorized and intercepted
before official TLC. No SANY, native control, ordinary model or graph ran for
this prototype; the native SOURCE definitions below are not results.

## Exact input and retained incomplete evidence

- Owning checkout: `/Users/shawwalters/.codex/worktrees/slop-ci-release-20261111`.
- Exact committed source: `88b393dcc0a550653cb70601ffc6e427557343a9`.
- Model: `formal/models/api/incomplete_assessment_queries.qnt`, 242 lines,
  original 23 concrete scenarios.
- Model SHA-256:
  `2cd566d8f8830d594550ff9991486042a4bd79895aaa5396550bac8db25b5ca7`.
- Original domains remain deliveries={1,2,3,4}, PRs={1,2,3}; all actor,
  expected actor, cursor, Boolean and six permission labels remain unchanged.
- The retained hosted raw600 receipt matches that hash, requests no VIEW and
  uses the original concrete `step`. It ended incomplete after the unchanged
  600,000 ms allowance (600,303 ms recorded): 215,905,537 generated,
  10,572,715 distinct, 7,660,785 queued, depth 10. Inputs were unchanged; no
  counterexample was reported before the deadline. This is not a safety pass.
- The old receipt's producer runner differs from the current 88b runner;
  its 600-second allowance is a property of that retained producer. Current
  `check-formal.mjs` delegates to `formal-report.mjs`. This proposal changes
  neither runner nor allowance and inherits no current-run qualification.

## Exact prototype binding and narrow capture

- ID: `incomplete-assessment-query-observation-safety-v1`.
- Operator: `SlopIncompleteAssessmentQueryViewV1`.
- Source SHA-256:
  `2cd566d8f8830d594550ff9991486042a4bd79895aaa5396550bac8db25b5ca7`.
- Fresh full production TLA SHA-256:
  `38a24e884aa6b2ff90dcd18c381d945419c729f6ed1f30dbd436e1b616ca48c1`.
- Appended VIEW TLA SHA-256:
  `e26d2fe13e61f88478a1c48828bc8324d03c5cb43ab4aab59134d32bd2c577c9`.

The sole narrow capture exited 0 in 24.851 seconds using pinned Node 24.15.0,
Quint 0.33.1, Java 21 and Apalache 0.62.4. The local bridge verified the
approved JAR digest; the official adapter binding is unchanged. All 2,169
tracked files and 542 tool/binary files were stable during capture. Captured
Node/Java PID identities were absent after exit, the private temporary root
was removed, and an independent post-terminal check found all observed paths
absent. The full TLA was intercepted before official TLC; this is translation
provenance, not native semantic parsing or graph qualification.

The hardcoded definition uses unique SlopIAQ-prefixed LET names and bound
variables. There is no manifest-selected expression engine. All twelve prior
VIEW entries remain unchanged; static tests pin their explicit original IDs
and digest while permitting separately reviewed appended entries. Source,
translation and appended VIEW drift fail closed. Native tests freshly capture
and bind the original full translation only when their explicit flag is set.

## Literal projection, with original model unchanged

Keep phase, requestCount, now, manifest, binding and the complete row map
exact, except for the closed retry cone described below. Keep every row's
exists, gap, phase, resolving and updated fields **exact in every phase**.
No timestamp ordering, resolver state or row lifecycle is approximated.

1. Erase global `ordinaryRead` to false. Its sole action writes true; no step
   guard, invariant or other stored output reads it. OrdinaryNotice is a
   different field and is not treated as write-only.
2. Normalize permission to three classes: literal allowed; error class
   {unavailable,missing,replaced}, represented by unavailable; all other
   values, represented by denied. Keep all six original action parameter
   labels, rather than replacing their domain with three choices.
3. Normalize every row.retry to -1, but separately retain **two raw indexed
   maps** for each original delivery: retry>=-1 and retry<=4. Compute them
   before normalization, in every phase, without trusting the invariant.
4. Normalize global s.retry values to -1 over its **actual map domain**. This
   response-output map has no transition or invariant consumer. Only concrete
   scenario output assertions inspect its exact values.
5. For nonterminal query phases, normalize each s.since value over its actual
   map domain by sign: 0 if raw>=0, otherwise -1. All old since reads use
   only >=0 in the item invariant; query transitions either copy the map or
   completely replace it. Do not erase its negative class.
6. For raw phase exactly idle or done, mask query-local payload listed below,
   but keep the raw query invariant vector in the next section. Keep the
   actual since/retry map domains, using -1 for their terminal values. Every
   other live or unknown phase retains its query payload exactly, except
   the since sign and retry output abstractions above.

Terminal query-local payload is actor, bundled, cursor, capturedManifest,
capturedBinding, contexts, allowed, queue, status, ordinaryNotice, items,
eligibleSnapshot, since values, retry values, running, nextCursor and
publishedManifest. Canonical values can be the original init values; this is
a VIEW observation, not replacement of a concrete source state. Exact raw
phase remains part of the carrier: idle/done are not merged with live phases.

Preserve state/row/map record domains. Global cache-like domain restrictions
must not be invented from the initially declared keys. For the current finite
model, since/retry are initialized and overwritten on the three PR keys;
actual-domain preservation also avoids silently changing malformed prefixes.

## Raw invariant observations

The row retry lower/upper truths are indexed independently by delivery ID.
Other row clauses remain directly observable from exact row fields: gap>=-1,
gap<=3, and resolving => (phase=completed and gap=-1).

Retain these eleven **separate raw query observations in every phase**, before
any terminal masking. The original item forall is conservatively split into
its two conjuncts; no original clause is weakened.

1. items.size<=2.
2. items is a subset of eligibleSnapshot.
3. Every item PR is strictly greater than cursor.
4. Every item's raw since value is >=0.
5. running is a subset of items.
6. nextCursor!=0 => items contains nextCursor.
7. queue=ready and items nonempty => allowed and capturedBinding.
8. queue=ready and allowed => publishedManifest=capturedManifest.
9. queue=unavailable => bundled and status=200 and ordinaryNotice and items
   empty.
10. phase=done and status=200 => queue is ready or unavailable.
11. status=401 or status=403 => not ordinaryNotice.

The remaining global requestCount<=2 clause uses the exact counter. Do not
replace query observations with true constants in terminal or failed states,
and do not reconstruct snapshots from current rows.

## Complete field-consumer audit

| Field | Source readers | Treatment |
| --- | --- | --- |
| rows.exists | Worker guards, unresolved rows and completed resolver search, running snapshot | Exact |
| rows.gap | recordGap's retain/reset branch; unresolved membership and resolver timestamp comparison; since minimum; two bounds and resolving invariant | Exact |
| rows.retry | Two raw bounds; observeRows retry minimum, which feeds only s.retry | Erase value; keep both indexed raw bound truths |
| rows.phase | All worker phase guards; completed resolver search; running snapshot; resolving invariant | Exact |
| rows.resolving | Resolver search and resolving invariant | Exact |
| rows.updated | Completed resolver >= gap comparison | Exact, including malformed resolving rows and currently non-dominating timestamps |
| now | Tick guard; all three worker writes | Exact; do not assume valid time bounds for false prefixes |
| manifest/binding | changeManifest guard/writes; context capture; live publish fence | Exact |
| permission | observeAccess allowed equality and three-member error set; otherwise copied | Three classes, original parameter labels unchanged |
| requestCount | begin guard/increment and invariant | Exact, never saturated/capped |
| phase | All query stage guards, begin guard, done/status invariant | Exact; no live phase folding |
| ordinaryRead | Only copied or markOrdinaryRead=true; concrete scenario assertion | Erased, action still enabled as projected self-loop |
| actor | Live observeAccess role tests | Exact live, terminal resettable |
| bundled | failed status/queue choice and unavailable invariant | Exact live, terminal raw vector |
| cursor | Live rows eligibility and item invariant | Exact live, terminal raw vector |
| capturedManifest/binding, contexts, allowed | Live access/rows/publish and query invariants | Exact live, terminal raw vector |
| queue/status/ordinaryNotice | Query invariants; overwritten/copied by query actions | Exact live, terminal raw vector |
| items/eligibleSnapshot/running/nextCursor | Query invariants; copied or wholly reset/replaced | Exact live, terminal raw vector |
| since | Only sign test in item invariant; copied or wholly replaced | Domain-preserving sign live, raw vector plus terminal value erasure |
| retry | No transition/invariant read of old values | Domain-preserving value erasure |
| publishedManifest | Only equality with capturedManifest in query invariant | Exact live, terminal raw vector |

## Every primitive action: same-parameter audit

| Original action / source lines | Guard and read dependencies | Projected successor and false/healing behavior |
| --- | --- | --- |
| init 28–34 | Original constants | Same initialized observation from any input; raw retry bounds and query clauses true |
| tick 35 | Exact now<3 | Same now+1; all row/query flags carry |
| recordGap(id) 38–44 | Original ID, exact row phase and old gap sign/value, exact now | Same exists/gap/phase/resolving/updated. New retry=now+1: recompute its two truths from exact now, not a trusted healthy constant. Other delivery truths and query snapshots carry |
| recordRunning(id) 45–50 | Exact exists/waiting phase, exact now | Same phase/updated; retry=-1 heals both retry bounds. Gap and resolving clauses carry, including malformed resolving=true waiting/running rows |
| recordCompletion(id,resolves) 51–57 | Exact exists/running phase, Boolean label and now | Same completed phase/gap/resolving/updated; retry=-1 heals bounds. resolves=true heals gap bounds and resolving implication; resolves=false preserves any bad gap while making resolving implication vacuous |
| changeManifest(mapped) 59–60 | Exact manifest=1, original Boolean label | Same manifest/binding update. Query captures and all their raw flags carry; no continuous freshness is inferred |
| permission(value) 61–63 | Original six-label domain, no old permission guard | Same class for the same label. Query flags carry; no labels are removed |
| begin(actor,expected,bundled,cursor) 86–100 | Exact idle/done phase and requestCount; original parameter domains; admitted uses parameters only | Complete query-local reset independent of masked old payload. Both related states get the same exact request/counter/capture values, all eleven query flags become true, and old row false flags carry |
| validateCursor(valid) 101–102 | Exact cursor phase and Boolean label | True changes only phase; false executes the original failed helper, with the caveat below |
| observeContexts 103–105 | Exact contexts phase; grouped computed from exact row lifecycle/timestamps | Same contexts and captured manifest/binding. Dirty ready/capture implications may heal or break, so recompute raw flags |
| observeAccess 106–113 | Exact access phase/contexts/capturedBinding/actor, preserved permission class | Same needsRemote/error/allowed branch for every role. Error uses failed; success writes identical allowed/phase and may change ready-access/manifest implications in dirty prefixes |
| observeRows 114–127 | Exact rows phase/allowed/cursor, exact grouped/row gap/phase/updated | Same eligibleSnapshot/items/running/next and same since signs. Only retry response may differ, and that whole cone is erased. Fresh page size/subset/cursor/since/running/next clauses are healthy; ready/capturedBinding and stale queue/status clauses need not be |
| publish 130–133 | Exact manifest phase, allowed, manifest/capturedManifest | Same stale-failure branch, or same ready/status/published-manifest result before terminal masking. Size/subset/range/running/next flags carry; ready/status implications must be recomputed, not assumed true |
| readFailure 134 | Exact contexts/rows/manifest phase | Same failed helper and raw flags before terminal masking |
| markOrdinaryRead 136 | Always enabled | Writes only erased field; remains an enabled labeled projected self-loop |
| stutter 156 | Always | Same observation |

The query macro (176) is the unchanged sequential composition of its five
primitive await completions. Its same-parameter relation follows from them.
All original 23 scenarios remain concrete and unchanged.

## Why the combined abstraction is closed

### Retry output cone

No transition guard or non-retry output consumes old row.retry. observeRows
reads it only to write global s.retry, whose old values have no step/invariant
consumer. Erasing the global output therefore closes that dependency cone.
All other functions, especially unresolvedRows/grouped/since/running, ignore
row.retry. Row updates either copy retry or overwrite it completely. Their
raw lower/upper truths are consequently enough for invariant truth and the
same targeted successor; computed writes use exact now or literal -1.

Keep the bounds indexed by ID. A single aggregate bounds bit is unsound:
states with a bad retry in different delivery rows can have the same aggregate
false truth, but recordRunning(1) may heal one and leave the other false.

### Since and permission

The since sign abstraction preserves every `since.get(pr)>=0` exactly. No
source action uses old numeric since values in a guard or new non-since
value. Copies retain signs; begin/failed/observeRows replace the entire map.

The permission abstraction preserves exactly `permission=allowed` and
membership in {unavailable,missing,replaced}. Those are its only consumers.
It preserves all combinations of contexts, binding, actor and bundled mode,
including the admin outage bypass and error outcomes for other actors.

### Terminal query captures

In idle/done, all query-stage actions and readFailure are disabled by the
retained phase. Worker/environment actions and markOrdinaryRead never read
the query-local captures. The only way back into the query pipeline is begin,
which completely resets every masked field from exact globals/constants and
the same original parameters. If requestCount blocks begin, no other action
can reduce it or reactivate that request. Thus masked terminal payload is
never consumed before reset.

Worker/environment actions do not mutate query snapshots or any operand of
the eleven raw query flags. Their effects on current rows/manifest/permission
must not be used to recompute a historical item or captured-authority flag.
The exact raw phase distinguishes a terminal canonical payload from an equal
looking live payload; no separate terminal marker is needed while phase stays
exact.

Any live-to-terminal action begins from live fields that are exact except
the closed retry/since/permission abstractions. Those abstractions preserve
every action predicate and all query-clause inputs. Its same-parameter raw
successor therefore has the same eleven flags before masking. This includes
false flags, not only reachable healthy requests.

## Critical arbitrary false/healing prefixes

- **failed is not uniformly healthy.** The helper preserves ordinaryNotice.
  A dirty live prefix with bundled=true and ordinaryNotice=false becomes
  queue=unavailable/status=200/items empty, violating its notice implication.
  Other snapshot clauses heal, but this clause may become false. Retain it.
- **publish can introduce ready-access failure.** A dirty manifest phase with
  allowed=false and nonempty items publishes ready without clearing items.
  Similarly allowed=true/capturedBinding=false can fail the ready implication
  when the manifest fence passes. The ready flag must be raw, not trusted.
- observeContexts can change capturedBinding/capturedManifest while dirty
  queue=ready, healing or breaking capture implications. observeAccess can
  similarly change allowed and implication antecedents.
- observeRows overwrites the six page-construction clauses, but it does not
  infer capturedBinding from allowed, clear a dirty queue/status, or repair
  captured/published-manifest equality. Preserve these remaining raw truths.
- recordGap writes retry=now+1 even in an arbitrary out-of-range clock prefix.
  Bounds may stay false or change; no invariant premise permits replacing
  them with true. Running/completion reset -1 and genuinely heal the bounds.
- Completion with resolves=false preserves a bad gap; resolves=true replaces
  it with -1. Existing row gap, lifecycle, resolver flag and updated timestamp
  remain exact, so sibling resolution and equal/newer timestamp cases stay
  distinguishable. No row timestamp erasure is included in this proposal.
- begin heals all query clauses by its complete reset, including a malformed
  terminal payload. It does not repair bad row bounds, and row worker actions
  do not repair frozen query output. Keep these two invariant families apart.

## Native SOURCE controls, not executed

The native SOURCE definitions bind the actual full unchanged translation and use
native TLA fixture aliases/real original actions, not a JavaScript behavior
controller. Every named negative requires a noninitial named witness,
not pass by an initially false production invariant. Owner literal review
and separate execution authorization are still required.

Completion checks require the successful complete marker, then parse the last
anchored terminal summary for exact distinct-state and zero-queue counts.
Startup/progress lines cannot satisfy those assertions. A static parser guard
rejects expected one when progress reports one but the terminal summary has
two, and rejects a nonzero final queue even after an earlier zero queue.

1. **Retry classes/indexing:** four fixed delivery rows, each taking retry
   -2 (lower false), -1 (both true), or 5 (upper false), with all other retained
   fields fixed. Require completed RAW 81 / VIEW 81 graphs and empty queues.
   Two bounds cannot both be false for an integer; do not invent a 2^8 cube.
2. For every ID, real recordRunning/recordCompletion must heal its retry
   classes; another row's false class must survive. recordGap with a dirty
   exact clock must compute, retain or introduce the appropriate false bound.
3. The RAW 4 / VIEW 2 closed-copy graph includes real observeRows on both
   raw retry alternatives, plus fixture mutations of both the pre-copy and
   post-copy representations. This exposes both outputs even when one viewed
   predecessor coalesces. JS does not reimplement observeRows. Equal
   gap/phase/resolver/updated inputs and bound truths are retained.
4. RAW 2 / VIEW 1 output-cone coalescence with equal retry flags, different
   ordinaryRead, positive since magnitudes, retry-map values and same-class
   permission labels. Require complete empty queues; also test positive versus
   negative since classes remain distinguishable when an item observes them.
5. Domain-only RAW 2 / VIEW 2 graphs extend since and retry with an extra
   negative entry in both rows and done phases, checking actual-domain
   preservation without changing clause truths. Keep six original permission
   action labels and cover allowed/error/other
   classes for maintainer, unrelated actor and admin, direct/bundled modes,
   including the admin remote-outage bypass.
6. Terminal snapshots: eleven isolated raw query-clause pairs use done phase
   with otherwise equal retained terminal carrier. Idle has dirty-reset and
   exhaustion coverage, not eleven isolated false pairs: the done/status
   clause cannot be false while phase is idle. False snapshot persistence is
   checked after workers. Clause dependencies mean no unrestricted independent
   Boolean cube is assumed.
7. Actual begin from dirty terminal snapshots must reset the query flags and
   preserve bad row flags; requestCount>=2 must remain blocked. Keep idle and
   done phases distinct from live phases. A paired RAW 2 / VIEW 2 graph changes
   only the captured request actor in an unknown phase, preserving flags and
   other captures while checking the conservative exact-field branch.
8. Actual validateCursor(false), readFailure, access failure and stale publish
   from bundled=true/ordinaryNotice=false must find the noninitial unavailable
   notice failure rather than trust failed's result.
9. Actual publish must find noninitial ready-access failure from dirty
   allowed/items/capturedBinding prefixes; retain other false snapshot flags.
   Four real-action controls explicitly check implication healing and breaking:
   observeContexts captures binding=true/manifest=1 to heal dirty ready access
   and manifest equality, or binding=false/manifest=2 to break them;
   observeAccess with denied permission changes allowed true to false and
   exposes ready-access failure, while allowed permission changes it back and
   heals that implication. Each sole named witness includes the changed phase,
   so it is false initially even when the initial invariant is already false.
10. Keep all 23 original concrete scenarios, especially exact earliest since,
    retry scheduling, timestamp sibling resolution, frozen snapshot completion,
    ordinary mark-read, authorization outages and numeric continuation. They
    run concretely; exact since/retry/terminal response output is not a
    quotient-output guarantee.
11. Add source drift refusal for any new retry/since/ordinaryRead consumer,
    terminal capture read, changed failed reset, changed permission predicate,
    row timestamp/lifecycle consumer, domain/action/invariant/scenario change.

## Scope and delivery boundary

This is a hardcoded source-bound static VIEW prototype only. It does not authorize
model edits, domain/resource/sample reductions, an arbitrary expression
engine or a broad retry. Future literal helper/manifest/control review must
pin the complete model, fresh actual translation, appended VIEW and official
adapter, and separately qualify the candidate before any complete-graph
claim. All current graph evidence remains raw and incomplete.

The relation is invariant truth plus strong same-parameter labeled-step
congruence over defined original expressions. Preserve actual map domains and
include malformed map/index controls; no theorem about undefined missing-key
evaluations is claimed. Exact since/retry values, ordinary-read output,
permission spellings within a class and terminal response bytes are excluded
from the observation claim, while their original concrete scenarios remain.
Temporal/fairness, unbounded domains, implementation refinement and actual
UI/backend availability are outside this source-only proposal.

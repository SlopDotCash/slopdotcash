# Trace-run creation phase/terminal VIEW V1

This private PRD section 12 static candidate starts from
`dabd9d893d2b323746128496d65c49daee308aab`. It changes only TLC observations,
source-bound guards, native controller SOURCE, its native inventory entry,
documentation and generated inventories. The original QNT, every domain,
action/argument, concrete step, invariant, 29 direct named scenarios, runtime,
checker, adapter, config and lock remain unchanged. The parent checker has its
original default 180-second allowance for this model. The separate raw14
600-second resource probe is historical context; this packet changes neither.

## Exact observation

ID `trace-run-phase-terminal-safety-v1`, operator
`SlopTraceRunPhaseTerminalViewV1`, keeps the entire global State except requests.
All rows stay COMPLETE, including login, creation time and run state. Every
row index, ID, actor/key, payload, existence, ban, clock and insertion counter
stays exact. No currently failed admission, ownership or lookup is assumed
permanently dead; ban and reinstate retain their complete original transitions.

For the nine known live phases (initial-ban, body, prepare, lookup, insert,
insert-result, race-read, by-id-read and conflict-ban), keep all fields exact
except these reviewed classes and carriers:

| Field | Observation | Every executable/property consumer |
| --- | --- | --- |
| snapshotLogin/snapshotCreated/snapshotState | zero/zero/none | snapshot copies row metadata into them; no step or invariant consumes these local fields. The global source fields remain exact. |
| response/priorResponse | none/none | respond writes response; begin only copies response to priorResponse. No guard, retained-field writer or invariant reads this closed output cone. |
| desired | 200 / 201 / other | The invariant distinguishes 200 and 201; respond only copies desired into erased response. No other old-status branch exists. |
| disposition | created / existing / other | Only the two corresponding invariant implications test these values. snapshot/conflict overwrite their original diagnostics. |
| insertOutcome | inserted / constraint / other | insertResult tests constraint; the last local invariant tests inserted. None and no-op share the by-ID branch, with every live ID/row preserved. |
| created | exact in lookup/insert; zero in other known live phases | prepare overwrites it on success before lookup. Insert is its only later reader and copies it into the exact global row. After insert no live action reuses that capture. |
| login | exact through insert; zero in insert-result/race-read/by-id-read/conflict-ban | Insert copies it into the exact global row. Later snapshot copies row.login into the erased local output, and no other consumer reads request.login. |

All live snapshotId/Actor/Payload, generatedId, actor, key, payload and attempt
remain exact. These reconstruct every local invariant, including false prefixes.
In particular a dirty prepare may change generatedId and heal or break a 201
implication; no live local clause is presumed already true. Unknown phases keep
the COMPLETE original request, including otherwise output-only fields.

For idle/reply/done, use a tuple with exact phase, attempt, actor and key;
FOUR separate RAW original local implications; the raw inserted predicate;
and exact generatedId iff inserted. Compute all clauses before masking:

1. snapshotId>0 implies snapshotActor==actor and snapshotPayload==payload.
2. desired201 implies disposition-created and snapshotId==generatedId.
3. desired200 implies disposition-existing and snapshotId>0.
4. inserted implies rows[index(actor,key)].id==generatedId.

Every separate true AND false class remains visible. Actor/key are retained
uniformly, including exhausted requests. Do not merge idle/reply/done: begin
requires idle/done, while respond requires reply. Attempt is exact, preserving
both bounds and the retry guard. The old actor/key retry equality remains
exact; payload and login may differ on the original retry and are reset from
its original parameters. No domain or legal choice is removed or renamed.

## Whole-action and successor audit

begin reads exact old phase/attempt/actor/key and original parameter domains.
It fully replaces the request with idle plus the new original arguments.
The only old-output copy, response into priorResponse, remains inside the
closed erased cone. All four new local implications are true after reset;
the new insertion outcome is none. There is no partial or terminal-slot reuse.

initialBanRead retains exact ban membership, request actor, phase and original
ok argument. A ban that exists now can be removed before that read. readBody
keeps the complete original result domain and produces the same desired class.
Neither action reads an old created capture, and every path to insert still
passes prepare, which overwrites created with exact now. Prepare retains exact
slot/attempt and generatedId for its invariant effects. Its successful lookup
successor retains the newly written exact creation time; failure enters the
terminal tuple with observations computed on the actual resulting request.

readExisting keeps exact actor/key, payload and global row. Its existence,
sameCreate and original I/O branches are unchanged. A lookup reaching insert
still has exact login/time. insert retains exact bans, row existence and every
row-constructor input. Its original uniqueness/no-op/inserted choice and atomic
row/counter/request update are unchanged. Every false global metadata clause
therefore remains observable after an insertion from a dirty live prefix.
insertFailure writes only the original failure response transition.

insertResult retains both branches through the three outcome classes. raceRead
still compares exact current row payload to exact request payload. createdRead
still compares exact current row ID to exact generatedId. Their snapshot writes
preserve all invariant-relevant identity/payload fields; only unused local
login/time/state outputs disappear. conflictBanRead retains exact actor/bans
and its original ok argument; a reinstatement can change its classification.
No live record is masked because its present ban or ID match fails.

respond requires exact reply phase, moves to done and writes the erased response
using the original delivery parameter. All four local observations and exact
dynamic-binding carriers carry. tick/ban/reinstate read and write exact globals.
advanceRun retains row existence and the full exact run-state transition;
its local snapshotState consumer is output-only. Other-slot operations see exact
rows and requests whenever a real consumer exists. Explicit stutter remains.

Consequently related states have identical enabledness and matching projected
successors for every SAME original action/parameter tuple. The observations
reconstruct every original invariant clause without assuming it true. Global
clauses are raw; local attempt bounds are exact; the four terminal implications
are separate raw truths and all live operands remain exact. This is a manual
strong finite safety-congruence argument, not machine-checked application/SQL
refinement, UUID entropy or byte-validator correctness, exact HTTP/output
semantics, liveness, continuous authorization or an unbounded-system theorem.

## Dynamic binding: false and true can both change

The terminal inserted-row clause is NOT treated as forward-closed. A terminal
inserted request may point at an absent row with a mismatching ID. Another slot
can insert the expected ID and heal the clause. Conversely an absent row may
already have the same ID in its otherwise ignored dirty metadata, making the
clause true even though exists=false. Another slot's insert can replace that
absent metadata with a different ID and break the clause. The invariant does
not require row.exists for this local comparison.

Keep exact actor/key/generatedId whenever inserted and recompute the raw clause
against the exact current global rows at EVERY projection. Do not freeze a
truth bit and discard its carrier. advanceRun only changes state, while every
other actual row writer remains exact. All these arguments include false
prefixes, absent metadata, late bans/reinstatements and concurrent callbacks.
They do not infer permanent failure from a current comparison.

## Source gates, exact pins and controls

* QNT: `de3cd439eff487813f76d3d56eabde649bb0917b6037fa9d0fd756c61bd20cfa`
* Complete production TLA: `5915afe0c3be4814b131645a4d168a273a22db03ffae47064390d009cff69f55`
* Complete final VIEW TLA: `4c701b04d117d8597d8b9c7c76ab7cb6f0605ccfe124a9f4478fcf94cbb8a992`

A fresh translation-only capture stopped at the real TLC entry before graph
exploration. Actual bind/apply validates the complete production TLA and full
module terminator. The committed native harness derives this input afresh only
under its explicit native flag; ignored evidence is not a test dependency.
Unknown definitions, adapter changes, translation/view drift, changed properties
and temporal requests continue to fail closed.

Whole-source gates cover each new output/copy-cone reader, status/disposition/
outcome distinction, early/post-consume metadata read, partial reset, terminal
reuse, phase regression, cross-slot output use, new invariant and changed domain.
The complete source pin also protects every other action, branch and scenario.
The native filename is added to formal.yml without removing any existing path.

Native SOURCE defines independent false/healing observations for original
clock/count/cap, row index/ID/payload/login/time/uniqueness, attempt bounds and
each local implication. Actual actions test dirty live prepare healing, exact
lookup/insert metadata, false and true absent-row binding changes by another
slot, exact terminal pointers, late ban/reinstatement and a retry with new
payload/login, reply carry and full begin resets. No target is initially true.
A named witness ALONE is negated into q_inv; State2 and later real continuation
depths are required. Unrelated production-invariant failures cannot make those
fixtures pass. Independent 201 and 200 reset cases respect their disjoint guards.

Paired controls use q_inv TRUE alone and require RAW/VIEW counts with queue zero.
They preserve separate FALSE local classes, known-phase consumed carriers and
closed output cones. Actual insertResult and respond pairs retain two raw input
and output representatives (RAW4/VIEW2); actual prepare overwrites the old time,
so two raw inputs converge into one raw output (RAW3/VIEW2). No count is inferred
from a sampled run. Unviewed future consumers demonstrate why new reads require
new review. Original 29 direct scenarios keep every output assertion unchanged.

## Prior raw receipt and current status

Raw14 run 43122136526's retained terminal receipt reports 600643ms against 600000ms,
142403643 generated /28134708 distinct /11667362 queued /depth16 at its last
progress sample. Inputs unchanged, uncanceled, concrete step, no VIEW and no
reported counterexample. Progress was sampled about 51s before receipt generation;
it is not a final frontier count or completed proof. Receipt SHA-256:
`0ccf073f6de8dbfa1277bd5d0c29476214cc70de03d240f6806cc6f98d28092c`.
Its checker/host differ from this dabd parent; only model/mapped-source identity
is established. Do not label that resource probe a fresh V1 result.

This packet is STATIC ONLY until independently reviewed and scheduled. No V1
native, original ordinary scenarios/sampler or complete finite graph is run by
preparing it. No push or dispatch is performed. Hosted composition must refresh
source bindings/tools and complete all required qualifications. Skipped tests,
partial frontiers, deadlines and translation-only checks never qualify as a
successful safety exploration.

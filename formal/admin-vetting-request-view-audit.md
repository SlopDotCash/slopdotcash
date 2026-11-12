# Admin vetting request observation safety VIEW V1

PRD section 12 requires state-correctness evidence without weakening invariants
or hiding failure paths. This isolated prototype starts at
`dabd9d893d2b323746128496d65c49daee308aab`. It changes only the reviewed VIEW
registration, its audit, focused control definitions, workflow test selection,
and generated source catalogs. No runtime, original QNT, dispatcher, parameter
domain, invariant, scenario, checker, timeout or verification allowance changes.

## Exact bindings and status

- Original 338-line model SHA-256:
  `681a1d0913f4ab5e4ab6d80c8879d96b47def92cfd8785d08e561f64e3fd7778`.
- ID: `ui-admin-vetting-request-observation-safety-v1`.
- Operator: `SlopAdminVettingRequestViewV1`.
- Full production TLA: `738a0a9ca2103821211352471afbb0834a397bea76217037d47cdb28aec4039a`.
- Appended VIEW TLA: `adc5b7b4e95bdcba18eaf83f0286d68dc8f2cbe7b301031d849320b400e55d9e`.

One explicitly coordinated translation-only capture used the current pinned
local translator, Node 24.15.0 and Apalache 0.62.4. It intercepted the official
verify call BEFORE TLC and produced the complete 20,451-byte production module.
No SANY/native/graph ran. The native-flagged test helper will freshly derive the
complete production translation again, verify BOTH pins, and append the VIEW
without replacing production action definitions. Its fixture controls replace
only q_init/q_inv/q_step aliases; every real action body remains complete.
All VIEW-local LET names begin SlopAdmin to avoid production name collisions.

Static source implementation is not native or full qualification. Native
controls, original scenarios, sampling and the complete graph remain pending
at this checkpoint. No speedup or completion claim is made.

## Retained raw-600 failure

The actual retained exhaustive-finite-tlc receipt was read from the raw14-0e
shard for run 43122136526. It binds the exact original QNT hash above,
inputsUnchanged=true, requestedSafetyView=null and concrete step. Its result is
FAILED/incomplete: exit1, 600000ms allowance, 600406ms duration, deadline then
SIGKILL. Last progress: depth33, 445,667,038 generated, 47,932,708 distinct,
8,324,224 queued. This is not a counterexample and not a safety pass.

That historical execution used an older runner/tool set; its check-formal
SHA-256 was `28b8a5fce561fe1df7db1e2208dec14a94247529757f2d76a46d19cedb2833fb` and safety-view
helper SHA-256 was `6ca95578bde65fa83375b73756009cacd37411c54b0fa57c75fd15610dc49b52`.
Its TLC reported Version 2026.11.12.000402 with 4 workers/8192MB heap. Preserve
that failed receipt separately: this prototype does not relabel it as a viewed
or newly qualified run, and does not change its original allowance.

## Guarantee and structural domain

This V1 prototype adds a TLC fingerprint VIEW only. Keep original init, invariant, every
action, branch-local parameter domain, dispatcher and all 32 scenarios byte
identical. Preserve each invariant clause and the enabledness/projected
successor of EACH original action with the SAME parameter, rather than only
the union of possible successors. Preserve the read map domain `{1,2}` and
all reference IDs; `privateRead` and `activeRead` are 0 or a map ID. This is the
structural domain needed for defined indexed invariant evaluation, not an
assumption that the safety invariant is true. Do not impose extra phase,
counter, identity or freshness validity assumptions on false/healing controls.

Exact payload, error-display, and raw erased snapshot-output predicates are
outside the VIEW guarantee. Their existing concrete scenarios stay unchanged.
This is a manual safety-congruence proposal, not a theorem, liveness result,
rendering equivalence, source refinement, performance claim or release pass.

## Proposed observation

Keep every global exactly EXCEPT `error`, `formPayload`, and `refreshes`.
Retain the separate RAW observation `refreshes == callbacks` in every phase,
including false classes; keep callbacks exact. Keep exact map domain and,
for each raw slot `id -> r`, compute observations from RAW fields:

| Read observation | Proposed value |
| --- | --- |
| `phase` | Exact raw string; do not merge phases. |
| `life`, `actor` | Exact when phase is nonterminal OR `privateRead == id`; otherwise erased. |
| `generation` | Exact when nonterminal; erased in `unused`/`done`. |
| `cookieMatchesActor` | Raw `r.cookie == r.actor` while `phase == http`; otherwise erased. |
| `accessFailure` | Raw `r.failure == access` in preflight/postflight/failure/identity-observed/identity-returned; otherwise erased. |
| `observed` | Exact raw actor snapshot when identity-observed/identity-returned OR `privateRead == id`; otherwise erased. |
| `observedAdmin` | Exact raw boolean in identity-observed/identity-returned; otherwise erased. |
| `gate` | preflight/postflight/other classification in identity-observed/identity-returned; otherwise erased. |

Here terminal means ONLY `unused` or `done`. Unknown nonterminal phase strings
retain ownership fields because `dropRead` still tests ownership. Raw selected
read actor/life/observed are retained even when the slot is unused/done or the
view is currently invisible; do not trust a terminal record to be valid.

For the raw mutation `m`, retain:

| Mutation observation | Proposed value |
| --- | --- |
| `phase` | Exact raw string. |
| `life`, `ownerRead`, `actor` | Exact unless phase is unused/done. |
| `cookieMatchesActor` | Raw `m.cookie == m.actor` in ALL phases. |
| `observedMatchesActor` | Raw `m.observed == m.actor` in ALL phases. |
| `observedAdmin` | Exact raw boolean in ALL phases. |
| `accessFailure` | Raw access-failure predicate in preflight/postflight/failure/identity-observed/identity-returned; otherwise erased. |
| `gate` | preflight/postflight/other classification in identity-observed/identity-returned; otherwise erased. |
| `payload` | Erased in ALL phases. |

Compute equality predicates before masking a terminal actor. In particular,
NEVER compute these from a rewritten canonical record or replace them with
trusted true constants. Keep all three mutation truth observations even if
`accepted == false` or `callbacks == 0`; they can be dormant invariant facts.

The optional read observed-equality reduction is deferred. V1 retains RAW selected/identity-phase read.observed and preserves each selected atomic equality as well as the whole invariant.

## Complete consumer and copy audit

- `error` is written/reset/copied and observed only by concrete scenarios.
  `formPayload` is edited, then copied once into `mutation.payload`; that
  captured payload is never consumed by a step guard or invariant. Erase both
  carriers together. `editPayload(id)` stays enabled for each original ID and
  projects to a labeled self-loop. Do not delete it.
- `refreshes` is read only by its equality to callbacks in the invariant and
  by excluded concrete output scenarios. invokeMutationCallback increments
  BOTH integers by one, preserving raw equality even when it is false. Every
  other step copies both. No step resets one independently, tests refreshes,
  or consumes its raw value. Therefore the all-phase raw equality flag is a
  closed cone, with no false-class healing assumed. Init sets it true.
- `present`, mounted/life/actor, cookie/admin/identity availability, generation,
  active/private read IDs, note/invalidated/accepted and callbacks remain exact.
  Do not clip counts or replace invariant-false classes with valid ones.
- Read actor/life/generation feed `ownsRead` for dispatch, identity use and
  dropping. Terminal phase guards prevent all those consumers, and beginRead
  replaces an unused record completely. A done slot can never be republished
  by another slot's parameterized use. Its actor/life/observed still matter if
  it is the selected private read, hence that exception is mandatory.
- Read cookie is consumed ONLY by readResponse's equality to its captured
  actor. Dispatch overwrites it with the current cookie; later cookie changes
  never rewrite that snapshot. Read response overwrites failure, temporary
  failure sets local, and neither reads the former failure/gate/observations.
- Identity observation overwrites observed/observedAdmin/gate, preserving
  failure. Return only changes phase. Identity use reads ownership, the access
  predicate, captured observed/admin, and preflight/postflight/other gate.
  Failure empty/local and all non-preflight/postflight gate strings are
  indistinguishable for that action. The final default error write is erased.
- A read observation can affect the visible invariant without affecting its
  current action phase. Thus selected read observed/actor/life cannot be
  discarded solely because a request is done, checked, HTTP, or not owned.
- Mutation life/actor/ownerRead feed `ownsMutation`. Keep them through HTTP
  too: admit/temporaryFailure can expose a later phase whose ownership guard
  consumes those copied fields. Terminal phases block all such consumers;
  beginMutation replaces an unused record completely.
- Mutation cookie is used by admit and the accepted-write invariant ONLY as
  equality to mutation.actor. Mutation observed is used by identity use and
  the callback invariant ONLY as equality to mutation.actor. No action edits
  that actor alone: beginMutation replaces the entire record. Fresh dispatch
  and fresh identity observation recompute equality from exact global inputs
  and exact nonterminal mutation.actor. Later environment changes do not
  rewrite captured booleans. observedAdmin remains a captured boolean.
- Callback-ready observed facts are not dead: invokeCallback increments the
  exact counters and thereby activates the callback invariant. Cookie and
  observed equalities/admin also remain relevant in terminal false classes
  whenever accepted/callback antecedents are already true.
- Note, privacy selection, acceptance, visibility, actor/cookie distinction,
  lifetime/generation distinctions, and every synchronous reset remain exact.

## Every labeled transition, with identical parameters

| Action group | Enabledness and projected successor argument |
| --- | --- |
| cookieChanges(actor), identityAvailability(flag), adminRole(flag) | Original domains and global writes exact. Captured snapshots do not change. No equality is recomputed from current cookie/admin by the VIEW. |
| editPayload(id) | Exact visible guard and original ID domain; changes only the jointly erased payload carriers. Labeled self-loop retained. |
| depart | Exact mounted guard. Clears private selection, note and active read and sets present/mounted false. Former selected terminal facts may become erased together; no other retained value is changed differently. |
| remount | Exact mounted/life/availability/cookie guards and same life=2/actor=cookie/reset writes. Clears private selection before previously selected dormant facts become irrelevant. Nonterminal ownership facts stay exact across actor/life change. |
| beginRead(id) | Exact mounted/invalidated/unused guards; resets entire slot and changes exact globals. Newly needed observations are computed from identical fresh values, even if the old unused slot had false facts. |
| observeReadIdentity(id) | Exact phase guard; same raw observed/admin/gate writes from exact environment, retained access-failure predicate carries. Selected invariant facts are recomputed from the real fresh snapshot. |
| returnReadIdentity(id) | Exact phase; retains the already captured identity/admin/effective gate/access facts. |
| useReadIdentity(id) | Exact phase and ownership, identity snapshot and classified failure/gate select same branch. A successful postflight publishes its own ID; that slot's actor/life/observed were already retained. A stale/default/failure result cannot expose masked facts. |
| dispatchRead(id) | Exact checked/ownership guards; HTTP equality recomputed from exact current cookie and retained read actor. Other newly relevant fields carry identically. |
| readResponse(id,allow) | Exact HTTP phase and retained captured-cookie equality choose same postflight/failure and access predicate. Old nonconsumed data cannot affect result. |
| readTemporaryFailure(id) | Exact HTTP guard; sets failure/local and failure phase, yielding the same non-access fact and future gate behavior. |
| dropRead(id) | Exact nonterminal ownership and phase tests. Done selected actor/life/observed remain exact; nonselected dormant details are safely erased. |
| beginMutation | Exact visible/unused guards. Entire mutation replaced from exact life/privateRead/actor and known zero snapshots; erased formPayload affects only erased payload. |
| observeMutationIdentity | Exact phase guard; effective gate and observed-equality/admin are freshly computed from exact environment and exact nonterminal mutation.actor. Access predicate carries. |
| returnMutationIdentity | Exact phase, all captured predicates carry. |
| useMutationIdentity | Exact phase/ownership, access and captured identity/admin/gate select the same terminal, invalidation, checked, or callback-ready branch. |
| dispatchMutation | Exact checked/ownership guards; replaces captured cookie equality from exact cookie and mutation.actor. |
| admitMutation(allow) | Exact HTTP phase and captured-cookie equality select identical accepted/phase/failure writes. HTTP ownership is not added as a guard. |
| mutationTemporaryFailure | Exact HTTP phase; non-access failure and next phase agree; copied ownership facts remain available. |
| invokeMutationCallback(id) | Exact ownership/callback-ready/accepted/unused-slot guards. Exact callbacks increments, raw refresh/callback equality carries because both source integers increment, note/private/active/generation change identically, and full fresh read slot matches. Mutation terminal predicates retain captured cookie/observed/admin facts. |
| dropMutation | Exact ownership/phase guards, including the HTTP exclusion. Terminal predicates preserve all accepted/callback invariant facts. |
| Stutter | Every observation, including false and dormant predicates, carries unchanged. |

There are 23 named dispatcher actions plus stutter and 41 labeled parameter
instances under the original finite input sets. Scenario convenience actions
inherit the argument compositionally but remain outside step. Historical
oldPassiveDepart also stays outside step; its present/mounted violation is
still observable because both globals are retained.

## Each invariant clause and healing

All these facts must have equal truth for related states, separately:

1. not-present implies not-mounted: both exact; depart/remount and excluded
   historical passive departure preserve their real effects.
2. callbacks <= 1, refreshes == callbacks, callbacks-positive implies accepted:
   exact callbacks/accepted and all-phase raw equality flag; do not saturate
   callbacks or merge 0 and 1. Equal false flags do not silently become true
   after a paired increment.
3. accepted implies captured mutation-cookie equality: preserve that raw
   equality in ALL phases, including unused/done. Admit, dispatch and begin
   can replace the fact; every copy or phase-only action carries it.
4. invalidated implies privateRead=0 and no note: exact globals. Existing
   clearing/reset actions can heal; callback/private-selection writes can
   expose violations in structurally valid false-class fixtures.
5. Visible selected read actor/life/observed match current actor/life: preserve
   all THREE raw selected fields in every phase. Selection clearing can heal;
   identity observation can heal or break the observed clause; publication of
   a newly selected returned slot uses its already retained snapshot.
6. callbacks-positive implies captured observed matches mutation actor AND
   captured observedAdmin: keep BOTH independent observations in ALL phases.
   Callback invocation can activate previously dormant false facts, and fresh
   observation/begin can change them; no antecedent-validity assumption.
7. generation <= 2 and life <= 2: retain exact raw integers and increments.

## Native control definitions and pending qualification

The new focused test file defines these controls. They have NOT been executed at this static-only checkpoint:

- Pin exact QNT hash, original translated TLA, appended VIEW and reviewed
  hardcoded definition/manifest. Reject model/definition/hash drift and
  temporal use. Preserve original model and all 32 concrete scenarios, including
  exact captured payload, form payload, error flags, and historical controls.
- For related state pairs, exercise every one of the 41 same-label/parameter
  instances: compare enabledness first, and projected successors when enabled.
  Include nonterminal stale/owned states, both IDs, independent current cookie,
  admin and identity availability, and observed-versus-returned gaps.
- Positive coalescence: differences only in jointly erased payloads/error,
  raw refresh counts with the SAME raw refresh/callback equality,
  read non-access failure strings, ignored gates, non-HTTP read cookies,
  nonselected terminal read baggage, and terminal mutation life/owner/actor
  with unchanged raw equality/admin observations must merge. A two-raw/one-VIEW
  finite fixture must actually complete with empty queues.
- Non-coalescence controls: different active/private indices; nonterminal
  life/generation/actor; HTTP cookie-match truth; returned snapshot identity or
  admin; preflight/postflight/other gate; access failure; ALL selected read
  actor/life/observed facts. Verify both slot positions independently.
- Construct all eight mutation cookie-match/observed-match/admin combinations
  from real raw records. Exercise HTTP admission, callback-ready invocation,
  and unused/done with accepted and callback antecedents independently active.
  In particular a valid-current-invariant callback-ready state with callbacks=0
  and a bad dormant observed/admin snapshot must expose the later violation.
- Isolate each original invariant subclause with structurally valid false
  states; retain matching carry and actual reset/healing transitions. Selected
  unused/done records with bad actor/life/observed are essential. Include
  visible/invisible and invalidated/note combinations, 0/1/2 and out-of-bound
  counter/generation/life cases, and unused mutation records not assumed empty.
- Environment changes after observing/dispatching must not rewrite captured
  admin/identity/cookie facts. Preserve accepted old-lifetime writes while
  refusing callbacks, parent-refresh retirement before child use, denied
  server admission, local failure, and both historical passive cleanup bugs.
- Named negative witnesses must be reached AFTER a safe initial state; reject
  initial-state violations, native errors, missing witnesses, and a control
  that simply checks invariant/VIEW equality without executing the relevant
  labeled action. Deliberately broken projections must fail the controls.
- Only after independent source review and controls: unchanged ordinary graph
  qualification under the existing allowance, with all source/tool bindings,
  final distinct/queue/depth, complete status and EMPTY queue retained. No
  domain/step/property/sample/budget weakening or performance prediction.


## Static-only checkpoint

Pinned Bun 1.3.14 native-OFF source/binding tests: 10 pass, 164 native
controls deliberately skipped, 0 fail, 33 assertions. The focused TypeScript
check, Biome check and JavaScript syntax check pass. Three source catalogs
were regenerated after formatting. These are not native/model passes. No
checker command-builder file or stale --step literal is asserted; source
guards bind the actual QNT, VIEW, complete production TLA and property.

The helper, manifest, test and audit are frozen for independent review before
commit. No second capture, SANY, native control, ordinary model scenario,
sampling or full graph was run. Required post-review catalog checks and all
model qualification remain pending.

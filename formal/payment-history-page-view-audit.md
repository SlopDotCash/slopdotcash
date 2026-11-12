# Payment-history terminal-page safety VIEW: V2 audit and private diagnostic

The independently reviewed V2 source is frozen at
`97076b79a8f55bb9ecfb6aaf2de00597797ed5f8`, derived from
`cbf4fd2a12e2a51014a7a99fa102cc63b456832a` on
`codex/payment-history-terminal-view`. This private diagnostic child starts
from that frozen source on `codex/payment-history-v2-diagnostic-600`. It serves
PRD section 12's bounded state-correctness work. It changes only this model's
full-verification time allowance, this audit and derived catalogs. The complete
Quint model, action/domain choices, invariant, 25 concrete scenarios, VIEW
helper/manifest and source-control tests remain byte-identical to the frozen
source. No application behavior changes.

**V2 full-graph verification remains incomplete.** Fresh component checks
passed on the frozen source, as recorded below. One original 180-second
full-graph attempt remained incomplete. This child prepares an authorized
600-second allowance only for a later combined hosted diagnostic; it has not
executed or qualified that longer attempt. All positive and incomplete V1
results remain below as V1-only history. The source argument remains manual,
not a mechanically checked refinement proof.

## V2 exact bindings and projection

- ID: `payment-history-terminal-page-safety-v2`.
- Operator: `SlopPaymentHistoryTerminalPageViewV2`.
- Unchanged complete model SHA-256:
  `ca6e47f6ff38fb8129738d1cadd071607d9bf742d69a21d5bbedc1c5c9a262d1`.
- Unchanged actual full translated TLA SHA-256:
  `fabbf107b0ae16501d1d1042c09e057b0ac6a7c6bc928f948be395a709f70622`.
- V2 appended VIEW TLA SHA-256:
  `728a86901f8ddb47d20406619c9bae6544d58418cb18801517a0ac1bcffb0270`.

The appended hash was first computed by pure string assembly over the
retained actual `guard-lift/payment_history-production.tla`, after verifying
its exact unchanged digest. Fresh production capture on the frozen V2 source
subsequently confirmed both TLA hashes, as did the original 180-second attempt.
This private child preserves all eleven VIEW bindings exactly. The same strict
hardcoded helper remains in use: no arbitrary manifest expression engine or
new evaluation path is introduced.

Define a **pure predicate**, exactly matching the original `accept(id)`
enabledness guard:

```text
sourceAcceptEnabled(id) =
  page.phase = response and page.after = s.cursor and
  ((s.through = -1 and page.requested = -1) or
    page.requested = s.through) and not s.ready and not s.failed
frozenFrontier =
  (every id in the original translated ids has phase response or done) and
  (no id in the original translated ids satisfies sourceAcceptEnabled)
retired(id) = s.configured and
  (page.phase = done or
    (page.phase = response and (s.ready or s.failed or frozenFrontier)))
```

`ids` is the original model operator, not a second domain. The guard is not an
action, `ENABLED`, a validity check, or the `bad` calculation. In particular,
`none`, `400`, `503` and invalid `200` responses can enable actual acceptance;
they must not be filtered out when deciding whether the frontier is frozen.

V2 keeps V1's unconditional erasure of global `monthly` and each page's
`fetched` and `months`. Additionally, only a retired page's `after`,
`requested`, `through`, `total`, `selected`, `next` and `result` normalize to
`0`, `-1`, `-1`, `-1`, `{}`, `0` and `none`. Exact phase, record shape, map
domain and every other global field remain unchanged. A nonretired page keeps
all V1-retained fields exact. No additional retirement occurs while
`configured` is false.

The raw indexed `retired` map is a separate VIEW component. Six additional
indexed maps retain these original clause truths for each raw page:

1. `selected.size <= 2`.
2. `selected` is a subset of `fetched`.
3. `fetched.size <= 3`.
4. `months` is a subset of `selected`.
5. Each selected row is strictly after `after` and at most `through`.
6. `result = 200 and rail = vault` implies no selected invalid row.

The marker and all six maps are computed from the raw source state before
normalization. A marker computed on canonical payload would turn a frozen
response into an apparently active one. A clause computed on canonical empty
sets would erase malformed false classes. Neither is permitted.

## V2 whole-model enabledness and absorbing-payload argument

The relation is equality of the complete V2 tuple, over well-typed source
states, including malformed states that violate the invariant. It does not
assume reachability or prior invariant validity.

Once configured, `configure` is disabled, fixing `rail` and `invalid`.
A done page has no server transition and never restarts. A response with
`ready` or `failed` cannot be accepted, and neither client flag can clear in
that state. For a frozen frontier, every source page is response/done, so
`begin`, `boundary`, `count`, `readPage`, `validate`, `queryFailure` and `scope`
are disabled. No accept guard is enabled. The remaining actions cannot change
page phases/parameters, client cursor/through, or ready/failed. Thus no later
action can unfreeze the frontier. Append/visibility/month/private operations
can still occur, but do not make a frozen page live. Retired payload is
therefore never read by a subsequently enabled action.

The raw marker prevents an active page's already-canonical payload from
colliding with a retired page. Equal views preserve page phases and all
client globals. A retired page's accept guard is false; a nonretired page's
raw guard inputs are exact. Therefore every source accept-guard truth, and
hence frozen-frontier truth, agrees in related states. Previously retired
pages stay retired. Newly retired pages had exact prior V1 payload and the
same action/parameters, so their post-action raw markers and all six clauses
agree before masking.

| Action | Same-parameter enabledness and projected successor |
| --- | --- |
| `configure` | Before configuration there is no new retirement: all selected/result/range inputs remain exact. The same parameters write rail/invalid and other exact globals. The first five clause truths carry; the sixth may change with rail/invalid and is recomputed from the same exact selected/result inputs. A copied done page may retire only afterward. |
| `scope` | Exact configuration, global through and every source phase determine its guard. It cannot run in a retired frontier. Scope/testnet updates are exact. |
| `appendRecord`, `appendPrivate`, `visibility`, `attachMonth` | All guards use retained globals/parameters; updates are exact except V1-erased attribution. They do not consume retired payload or change retirement dependencies. All six existing page truths carry. |
| `begin` | Only unused pages can run and are nonretired. Both syntax outcomes replace the whole page from the original `unused` constant, so all six truths become true even from six malformed clauses. Other page markers may become retired, but those pages previously had exact live payload or were already absorbing. |
| `boundary` | Boundary pages are nonretired, so requested/after and exact highest select the same branch. A successful through update can heal OR falsify the range clause; it is not assumed to carry. Failure retains through but writes 400, healing only the result implication. Other truths carry. |
| `count` | A count page is nonretired. Exact eligible rows/through produce the same total and phase. All six truths carry. |
| `readPage` | A page-phase page is nonretired. Exact filters/after/through produce identical fresh fetched, selected and next. Fresh construction makes the first five clauses true. The old result is copied: an inherited 200 with a selected invalid row can leave the sixth FALSE. That truth agrees because rail, invalid, old result and fresh selected agree. Monthly attribution remains only V1-erased output. |
| `validate` | A validate page is nonretired; exact phase/rail/selected/invalid yield the same result. It heals the sixth implication only. The first five truths, including false ones, carry. A response may newly retire only with the same post-action raw flags. |
| `queryFailure` | Exact live phase determines enabledness. Writing 503 heals only the sixth implication; the first five truths carry, including false classes. |
| `accept` | No retired page can enable it. On a nonretired page, every original guard and `bad` input remains exact. Both successful and bad acceptance perform identical exact client updates. Payload is copied and all six truths carry even after the page becomes done. Other page retirement transitions have exact prior live payload. |
| Stutter | Every component and raw observation stays equal. |

The unchanged `queried`, `firstPage` and `nextPage` action compositions inherit
the same labeled-step argument. All original global invariant clauses use
retained globals; all six page clause truths are indexed raw observations.
Equal V2 views therefore preserve each invariant clause and the original
parameterized labeled successor relation. This is a manual argument, not a
machine-checked refinement theorem.

## V2 source controls

All native tests remain gated by `SLOP_QUINT_TRANSLATOR_TEST=1`. They executed
only after independent literal review of the frozen V2 expressions and
controls. Fixtures modify the actual full translated model's `q_init`,
`q_step` and named-witness `q_inv` aliases. They call original actions where
action behavior matters. There is no JavaScript behavior controller. The
results below belong to the frozen source; this private diagnostic child
performs static checks only.

- Retain all V1 controls: old three-flag independent false/reset/healing/carry
  cases, complete 64 indexed combinations, RAW 2 / VIEW 1 coalescence and
  concrete month output without a VIEW. Old eight exact-field test bases now
  use nonretired `page` phase: done fields legitimately retire in V2.
- The new paired graph has seven representatives per done page: healthy, then
  each of the six isolated false clauses. All changes are normalization-erased
  payload; phases/globals/raw retirement markers are constant. Require both
  RAW 49 / VIEW 49 complete graphs with empty queues. Dropping any clause or
  index must lose distinctions.
- The canonical marker control begins with the other page done and a frozen
  response with after/requested 6, all other payload canonical. Unlock only
  after/requested to 0/-1, then call actual `accept(1)`. The required named
  failed-State-3 witness is lost if the raw retirement marker is dropped. A
  separate 400-response control rejects a result-200-only accept predicate.
- The unconfigured control poisons a done page's result from none to 200,
  then calls actual `configure("vault",2,FALSE,1,0)`. Require a named State 3
  invalid-result-clause failure. Premature retirement before configuration
  would merge the poison and lose that witness.
- A blocked response with another page still unused retains each live numeric,
  selected and result distinction: this is not a frozen frontier. The changed
  payload keeps all six clause truths constant.
- Actual action controls check all-six reset by begin; first-five healing with
  a still-false inherited result after readPage; validate/queryFailure healing
  only the sixth; and boundary range healing, range falsification and result
  healing without range healing. Every named negative requires a noninitial
  State 2 or State 3 witness, never an initial invariant violation.

The guarantee excludes exact monthly/fetched or retired payload output,
temporal/fairness properties, unbounded domains and implementation refinement.
All concrete scenarios remain unchanged. Their concrete output checks do not
claim that the excluded output properties are preserved by the quotient.

## V2 fresh component evidence on the frozen source

All results in this section ran at
`97076b79a8f55bb9ecfb6aaf2de00597797ed5f8`, with Bun 1.3.14, Node 24.15.0,
Java 21.0.10, Quint 0.33.1 and the pinned Apalache 0.62.4 JAR. The approved JAR
and official Quint adapter digests remained unchanged. All 2,163 tracked files
and 542 recorded tool/binary files were byte-stable across the owned runs.

- A fresh actual production translation matched `fabbf107...f70622`, and the
  appended V2 VIEW matched `728a8690...fb0270` (complete hashes above). SANY
  semantic processing of that exact appended module passed in 3.4 seconds.
- The fresh focused suite passed all **75 tests**, including all **64 native
  controls**, with **396 assertions**, no skips and no failures. It took
  616.196 seconds. The paired graphs completed RAW 49 / VIEW 49 with empty
  queues; the retained 64 indexed combinations and RAW 2 / VIEW 1 coalescence
  completed. All three named noninitial State 3 controls passed.
- The original canonical ordinary command passed type checking, all 25
  concrete scenarios, and the unchanged seed-20261107 simulation with 500
  samples and 60 steps. Their stage times were 27.527, 24.649 and 74.032
  seconds, respectively, within the unchanged 90-second limit per stage.
- The three post-commit no-write inventory checks passed. Final independent
  audit found all 146 observed owned PID/start identities absent, no scoped
  Node/Java/Bun command and all 214 observed owned temporary paths absent.
  The SANY-created empty standard-module cache directory was separately
  audited and removed. Prior failure evidence remains retained, including the
  initial static helper attempt refused for PATH Node 24.5.0; the rerun with
  pinned Node 24.15.0 passed. An inefficient read-only audit probe was stopped
  and replaced by a bounded batch; it did not rerun a qualification stage.

These are component results, not full-graph completion or a mechanically
checked quotient theorem. No source/control adaptation occurred during the
runs, and no samples, domains, properties or resource limits were reduced.

## V2 original 180-second attempt: incomplete

After independent component and cleanup review, the owner authorized exactly
one original canonical `--verify --model=payment_history` attempt at the same
frozen source. It used the complete original concrete `step`, the exact V2
VIEW and original 180,000-millisecond phase allowance. Fresh actual translation
and appended VIEW hashes matched the bindings above; the four workers,
`-Xmx8G` heap and `-Xss16m` stack configuration stayed unchanged.

The attempt ended **incomplete**, with checker exit 1. Last progress at depth
five recorded **2,968,294 generated states, 1,111,232 distinct viewed states
and 1,080,338 queued states**. The original deadline terminated the stage;
its measured 185.937 seconds includes termination/cleanup. No empty queue,
complete-graph safety pass or performance improvement is claimed.

The retained checker output reports SIGKILL, `kill EPERM` and
`process cleanup did not finish`. Independent post-terminal ownership/start
identity and scoped-command audit found all five captured owned identities
absent, no scoped Node/Java/Bun command and all nine observed owned temporary
paths absent. The private temporary root was removed. Both the warning and
the independent cleanup evidence remain retained. All 2,163 tracked files
and 542 tool/binary files were stable before and after. No retry, allowance
increase or model/projection edit occurred during that attempt.

## Private 600-second diagnostic child

The owner subsequently authorized this isolated child from the frozen source
for the CI owner's next combined hosted diagnostic. Its only executable change
is an explicit payment-history verification allowance of 600,000 milliseconds
in `scripts/check-formal.mjs`, instead of the original 180,000-millisecond
default. Every other model allowance, ordinary 90-second stage limit, sample
count, seed, domain, action, invariant, scenario and VIEW binding is unchanged.
The original 180-second incomplete attempt above remains part of the evidence.

This child has **not run or qualified a 600-second attempt**. Only pure static,
syntax, type and no-write inventory checks are permitted during its local
preparation. No local translation, JVM, SANY, native, ordinary-model or
full-graph execution, separate push or dispatch is authorized for this child.
Any combined hosted execution remains the CI owner's separate operation.

# Retained V1 source argument and qualification history (V1 only)

Everything below describes `payment-history-page-observation-safety-v1` and
its old appended VIEW hash, not V2. Its positive results and incomplete
attempts are preserved unchanged; none qualifies V2.

## V1 original page-observation safety VIEW

This isolated prototype starts at `4066e7b41a1054a808ccf7c140cdb48aa826988d`.
It serves PRD section 12's bounded state-correctness checks without changing
application behavior or weakening the model's invariant.

`payment-history-page-observation-safety-v1` applies only to the complete
`formal/models/payments/payment_history.qnt`, SHA-256
`ca6e47f6ff38fb8129738d1cadd071607d9bf742d69a21d5bbedc1c5c9a262d1`.
All domains, nondeterministic choices, action bodies, invariant and 25 concrete
named scenarios remain unchanged. The dispatcher duplicates existing guards
before enumerating already-disabled choices, as detailed below. The VIEW affects
TLC fingerprints; it never rewrites a concrete state or a source action.

## Exact dispatcher guard lift

The predecessor source hash is
`1f39992de916c278e325dd03c31d71475a04e805229356730e591381142813ab`.
Only two dispatcher branches changed; all bytes before `action step` and after
the invariant boundary compare equal to that predecessor. No underlying action body,
constant domain, other dispatcher branch, invariant or scenario changed.

For each of the 432 configure tuples, `configure` already requires
`not(s.configured)`. Duplicating that guard before the independent tuple
enumeration therefore preserves each enabled tuple and successor: `G /\\ A`
equals `A` because `A` implies `G`.

For each of the 224 begin tuples, `begin` already requires `s.configured` and
the chosen page's `unused` phase. Configuration is checked before choosing the
ID; the ID remains bound before its dependent phase guard, and all 112
after/through/syntax choices per ID remain present. The same implication
argument preserves enabledness and successors for each tuple. Sampling
evaluation work and random-choice sequencing may differ; this nonprobabilistic
successor argument makes no claim of identical seeded traces. Two independent
source reviews cleared the literal diff. Existing time limits remain unchanged.

## Exact projection and scope

The state component retains every global and page field except global
`monthly` and each page's `months` and `fetched`, which normalize to empty
sets. Exact page-map domain, phases, selected rows, next/after/requested/through
cursors, totals, responses, collected rows, visibility, invalid/unmatched rows,
configuration, rail, scope and testnet selection are retained.

Three additional observations are retained separately for **each raw page**:

1. `page.months` is a subset of `page.selected`.
2. `page.selected` is a subset of `page.fetched`.
3. The size of `page.fetched` is at most three.

These indexed booleans are computed from the original state before any
normalization. Computing them from empty canonical sets would hide false
classes. A single aggregate validity bit would lose the separate observations.
No `response`/`done` phases are merged.

The guarantee is preservation of the current invariant and parameterized,
labeled successor relation. It deliberately does **not** preserve arbitrary
monthly/fetched output predicates or exact attribution values under the VIEW.
The three monthly-output scenario observations still execute against the
unchanged full concrete model; they are not quotient-output guarantees.
The VIEW authorizes no temporal property, fairness claim, unbounded proof,
implementation refinement or rendering-equivalence claim.

## Whole-model dependency audit

| Value | Reads and updates | Reason for projection |
| --- | --- | --- |
| Global `monthly` | `attachMonth` unions a present row; `readPage` intersects it with newly selected rows on the vault rail, or emits empty months for direct. No guard or invariant reads global `monthly`. | The only effect outside its own erased carrier is a set guaranteed to satisfy the retained month-subset observation. |
| Page `months` | Read only by its subset invariant and concrete output scenarios; replaced by `begin` and `readPage`, otherwise copied. | Preserve its raw indexed subset truth, including false classes. |
| Page `fetched` | Read only by selected-subset and size invariant clauses. `readPage` computes a new local `fetched`, `selected` and `next` from exact present/filter/after/through inputs; it does not consume the prior stored fetched value. | Preserve both raw indexed truths. Exact selected/next outputs remain unchanged. |
| Page `selected` | Used by validation, client acceptance, ranges, invalid-row checks and all three observations. | Retain exactly. |
| All other data | Includes cross-page client state, all server filters and every action guard. | Retain exactly. |

The private-table flag is retained: although it does not change ordinary
history, `appendPrivate` tests it for enabledness. No hidden/global visibility
or invalid-row state is erased. This prototype uses no reachability assumption
that the invariant already holds.

## Same-parameter successor and enabledness argument

For two well-typed source states with equal projected observations:

| Original action | Guard and projected successor |
| --- | --- |
| `configure` | Guard/parameter domains are exact. Writes the same exact rail/configuration/present/hidden/invalid/unmatched data. It copies all page fields, hence all three raw observations; differing global monthly remains erased. |
| `scope` | Exact configured/through/page phases determine enabledness. Scope/testnet writes are exact; raw page observations carry unchanged. |
| `appendRecord` | Exact present/highest determines enabledness and the same row union. Observations carry unchanged. |
| `appendPrivate` | Exact flag determines enabledness; same flag update, observations unchanged. |
| `visibility` | Exact actor parameter/domain and hidden set yield the same retained update; page snapshots and observations are unchanged. |
| `attachMonth` | Exact present set determines enabledness. It updates only erased global attribution; existing page snapshots and all raw observations carry unchanged. |
| `begin` | Exact configuration, ID, phase and parameter domains determine enabledness. Both syntax branches replace the complete page from `unused`: selected/fetched/months are empty, so all three observations become true, even from a malformed unused record. Other outputs are exact. |
| `boundary` | Exact phase/requested/highest/after inputs select the same success/refusal branch. It changes neither selected nor fetched nor months, so all three observations carry unchanged. |
| `count` | Eligibility depends only on retained present/rail/scope/hidden/unmatched/testnet fields, never monthly. The same total/phase is written; raw page observations carry unchanged. |
| `readPage` | Exact retained filters, after and through produce the same fresh local fetched/selected/next values. `first(rows,3)` has size at most three; `first(fetched,2)` is its subset. Intersection with monthly (or empty direct months) is a subset of selected regardless of prior attribution. Thus all three raw observations become true. Other retained outputs match. |
| `validate` | Exact phase/rail/selected/invalid inputs give the same response. Selected/fetched/months are copied, so every indexed observation carries unchanged. |
| `queryFailure` | Exact phase determines enabledness. Changes phase/result only; all observations carry unchanged. |
| `accept` | Exact phase, after, requested, client state, response, selected, total, through and next determine enabledness and bad/success results. Raw monthly/fetched/month values do not participate. The same exact client updates occur, and snapshots/observations carry unchanged. |
| Stutter | Projection is unchanged. |

Every original parameterized action is equally enabled for related states,
and its projected successors agree. Erased attribution updates may project to
self-loops, but their labeled actions remain enabled; no action is deleted.
`queried`, `firstPage` and `nextPage` inherit this argument from their unchanged
constituent actions. This is a manual source argument, not a mechanically
checked refinement theorem.

## Invariant truth and false/healing classes

All original clauses remain exact or have their individual indexed truth
retained. Present membership, private row exclusion, selected size/range,
invalid selected evidence and ready/failed/count/boundary facts use retained
fields. Month-subset, selected-subset-fetched and fetched-count truths are the
three raw indexed observations. Thus each original clause, not merely the
whole conjunction, has equal truth for equal views.

This includes deliberately malformed, well-typed states: a false page flag is
not changed to a trusted constant. `begin` and `readPage` heal the same three
observations through their actual reset/construction; every other action
preserves them. Result-dependent invariant failures may separately heal through
`validate` or `queryFailure`, and their result/rail/selected/invalid inputs remain
exact. Cross-page indices and all client totals/cursors remain exact.

## Bindings and qualification status

The manifest and hardcoded helper permit only this exact ID/module/operator,
state expression, three indexed clause expressions and modes. No arbitrary
manifest-selected expression engine is added. Source, full translated TLA,
appended VIEW TLA and official Quint adapter remain pinned. Changed source,
translation, projection or temporal properties fail closed.

- Complete guarded source: `ca6e47f6ff38fb8129738d1cadd071607d9bf742d69a21d5bbedc1c5c9a262d1`.
- Full translated TLA: `fabbf107b0ae16501d1d1042c09e057b0ac6a7c6bc928f948be395a709f70622`.
- Appended VIEW TLA: `05d9e973f25dc10a4f136140f972db055e8ed36cec6f4034cea7bab4c228e0bd`.

Translation was captured by intercepting the actual pinned runner before TLC
could start. Static semantic parsing succeeded. Two independent source reviews
found no missing consumer or congruence defect; this remains a manual argument.
The existing hosted native-control step includes the new test file under its
explicit native-test flag.

The predecessor's focused native suite passed all 50 tests and 253 assertions on stable input
bytes using Bun 1.3.14, Node 24.15.0, Quint 0.33.1 and Java 21 with the pinned
Apalache 0.62.4 distribution. Controls cover each page-indexed false class,
actual reset/healing/carry actions, all 64 combinations of the six indexed
observations, and exact retained fields. Named negative controls require a
noninitial State 2 witness and reject initial-state violations. The identical
coalescence fixture completes with two raw states and one viewed state, both
with empty queues. Exact month output is checked separately without the VIEW.

That predecessor's model type check and all 25 concrete scenarios passed. The
unchanged seed-20261107, 500-sample, 60-step simulation exceeded its ordinary
90-second local deadline; that stage is incomplete. No sample count, model
domain, action or invariant was reduced. Those results are retained at local
prototype commit `0e8282808`; they are not fresh qualification of the guarded
source.

Fresh qualification of the guarded source passed the original canonical
ordinary command in 28.61 seconds: type check, all 25 scenarios and the same
500-sample, 60-step seed-20261107 simulation. The simulation took 16.418 seconds
under the unchanged 90-second phase deadline. Fresh native qualification also
passed all 50 tests and 253 assertions in 126.24 seconds, on stable new source,
translation and VIEW bindings. Static drift tests, formatting and regenerated
catalog checks passed. These results supersede the predecessor's incomplete
simulation for the guarded source only.

One canonical full-graph attempt ran at `77635f8b0` with the original 180-second
phase allowance. It is incomplete: the last progress at depth six recorded
22,840,216 generated states, 8,788,808 distinct viewed states and 8,239,321 queued
states. No complete-graph safety pass is claimed. The original incomplete
simulation remains predecessor-specific; the guarded source's ordinary
simulation passed separately as recorded above.

All 2,163 tracked files and the Node, Java, pinned JAR and Quint adapter bytes
were stable. The checker reported a cleanup warning after termination; an
independent post-terminal audit found every recorded checker/compiler/TLC PID
absent and no scoped Node/Java command or working directory remaining. The
warning and the independent audit are both retained. No rerun or resource,
domain, property or projection change was made during that attempt.

The retained earlier 180-second full-graph attempt is incomplete: its last
progress had 12,676,811 distinct states and 11,881,463 queued at depth six. It
reported no counterexample before termination, which is not a safety pass.
Malformed requests can reach done in three step transitions; a normal counted,
read and validated page needs seven. Terminal-only erasure cannot be assumed to
resolve the early cross-product. This projection also removes the independent
attribution history before terminal phases. Its actual speedup and complete
state count are unmeasured until a frozen complete run finishes with an empty
queue. No domain, sample, property or time allowance was reduced to obtain it.

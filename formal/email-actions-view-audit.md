# Email-action phase and closed-carrier VIEW

This private PRD section 12 experiment starts from clean
`dabd9d893d2b323746128496d65c49daee308aab`. It changes TLC fingerprints only.
The complete QNT, initializer, actions, parameter domains, invariant, scenarios,
mapped runtime and existing 600-second full-verifier allowance stay unchanged.
No application, storage, email or account operation is performed by this work.

The prior raw hosted search remained incomplete after 600 seconds. Its last
progress report recorded 231,135,140 generated states, 38,345,939 distinct
states and 7,351,140 queued at depth 21, about 51 seconds before the wrapper
reported its deadline. Those are last-reported metrics, not ending counts or
a safety pass. The original log reference remains separate from this new
VIEW's eventual qualification. No fresh native or full run is claimed here.

## Exact binding

`email-actions-phase-carrier-safety-v1` / `SlopEmailActionsViewV1` binds:

- Complete QNT: `25c1c3d0f59066177b8aac797912fea84be0663efb5d29eab297ed9206b7ec48`.
- Complete production TLA: `f10bd5a30e893616127d1fa014a13cb713e1742b4977489e716d3cf0fdc2a798`.
- Actual complete TLA after adding only the VIEW operator at the full module
  terminator: `9b6fb54a10997de6fb9f9449e5a6731a90c5fe9190d87d0ad5f8a5ace739bf98`.

The hardcoded loader binds the definition, model, translation, final VIEW,
property mode and official adapter. Temporal requests or changed source bytes
require review. The complete translated module is captured before TLC search;
actual bindSafetyView/applySafetyView and a non-exploring SANY semantic parse
validate the final production operator. These checks are not a finite graph.

## OPEN observation

The explicit OPEN marker cannot collide with the CLOSED marker below. All
global fields remain exact except:

| Field | Observation and future-read argument |
| --- | --- |
| scrubbed | Erased; no helper, action or invariant reads it. |
| error | Exact none versus non-none class; retry and invariant read only that distinction. |
| errorGeneration | Erased only when error is none. Every writer producing a non-none error writes its generation at the same time. Preserve it whenever error is non-none, including when present/link currently make its invariant implication vacuous. Restore can later expose it without clearing error. |
| stored/storedActor | Four independent raw lower/upper-bound truths. Their values feed no guard, other field or invariant except these bounds; self-carries preserve the truths and each overwrite computes them from retained captures/arguments. |

Keep done, link, doneLink and effects exact. A false done-effect membership
can heal when a late accepted server effect adds the exact referenced link.
A frozen whole receipt Boolean would lose that distinction. Keep generation,
captures, loaded, activeCheck, session, busy, actionActor and all other global
guards exact. The shared busy release is not generation scoped.

| Check phase | Retained data |
| --- | --- |
| unused | Exact phase. startCheck completely resets the record before any use. The forall admission guard short-circuits unused generation. |
| waiting | Exact generation/link/bound; observed/available are overwritten by observeCheck before consumption. |
| observed | Complete original record, even when ownership currently fails. |
| done | Exact phase and generation. The cross-check forall in startCheck still reads every done generation. No slot returns to unused. |
| unknown | Complete original record. |

For the single request, always retain exact phase/attempt and independently
observe the original verify-cookie equality implication and verify-positive-
actor implication. Both are computed from the ORIGINAL request before any
masking, including when they are false.

| Request phase | Retained data |
| --- | --- |
| idle/done/finally | Exact phase/attempt plus the two raw authentication observations. Submit fully resets idle/done; finally remains distinct because releaseBusy still runs unconditionally. |
| catch | Exact phase/attempt/generation and cause's none/non-none class, plus raw authentication observations. |
| preflight, preflight-observed, http, http-reply, body, postflight, postflight-observed | Conservative complete live record, except cause is dead, observed/available are retained only in the two observed phases, and cookie is retained only in http. |
| unknown | Complete original record, plus raw authentication observations. |

Accepted/kind/actor remain exact before usePreflight replaces cookie. In a
hypothetical prefix with accepted already true, that overwrite can break or
heal authentication. The successor's two raw implications derive from those
retained fields and the exact current session; their old values are not
assumed true. HTTP keeps its captured cookie because serverEffect consumes
it even after departure. After HTTP there is no further cookie writer until
submit's complete reset, and no cookie consumer except the raw implications.
Actor/kind/accepted remain conservatively exact in the remaining live phases.

## CLOSED observation

The CLOSED predicate is exactly:

```text
loaded and generation >= 4 and request.attempt >= 2
and request.phase in {idle, done}
and checks[1].phase == done and checks[2].phase == done
```

CLOSED retains its explicit class marker, exact present, exact terminal
request phase and these 15 separate ORIGINAL raw observations:

1. Generation lower bound.
2. Generation upper bound.
3. Capture upper bound.
4. Attempt upper bound.
5. Stored lower bound.
6. Stored upper bound.
7. Stored-actor lower bound.
8. Stored-actor upper bound.
9. Effects subset.
10. Done-and-live-link implies doneLink equals link.
11. Done-and-live-link implies effects contains doneLink.
12. Present-and-live-link-and-error implies errorGeneration equals generation.
13. Done request implies not busy.
14. Accepted verify implies cookie equals actor.
15. Accepted verify implies actor is positive.

No raw truth is computed from the canonical OPEN record, replaced by true, or
collapsed into one overall invariant bit. The lower generation bound cannot
be false inside CLOSED because its predicate requires generation >= 4;
controls for that bound deliberately cross the class boundary instead.

CLOSED is forward closed without assuming any invariant. Loaded disables
restore. The generation cap disables capture, sessionEvent, discard and
depart. The request attempt cap disables submit, terminal phase disables all
request continuations, and both done checks disable start/observe/useCheck.
The remaining branches are sessionChanges, retainFromOtherView and stutter.
Session changes are projected stutters. Exact present preserves retention's
guard. Retention writes stored=2/storedActor=0, making exactly their four bound
observations true and carrying every other raw observation unchanged.

Do not broaden this predicate to not-present, failed-owns, or just exhausted
attempts. Pending HTTP still changes effects; finally still releases busy;
future generation can recover ownership of a captured false-prefix request
or check. No such live ownership erasure is used.

## Every transition and class entry

| Original branch | Congruent enabledness and successor |
| --- | --- |
| capture/restore | Exact open guards/arguments determine link, kind, bound, counters and storage-bound writes. New errors are not inferred; non-none errorGeneration remains exact through restore even when its old implication was vacuous. |
| start/observe/useCheck | Exact cross-check phases/generations and observed captures preserve admission, actor publication and storage writes. Waiting observations are overwritten; unused resets fully. |
| sessionChanges/sessionEvent | Exact open session and generation preserve observations/dispatch. CLOSED session changes are stutters. |
| submit | Exact guards/counter determine admission; complete reset sets accepted=false, so both new authentication implications are true. No old terminal payload is consumed. |
| observe/usePreflight | Observed snapshots are exact when consumed. Cookie overwrite uses exact session and retained accepted/kind/actor; otherwise authentication observations carry. |
| serverEffect/response/body | Captured HTTP authorization/link and response acceptance stay exact. Late effects remain enabled without ownership. Body owns/kind checks and raw receipt references remain. |
| observe/usePostflight | Observation producer overwrites both inputs; consumer has exact snapshot, actor and generation. Success/error storage bounds and raw receipt effects reconstruct. |
| handleCaught/releaseBusy | Error none-class publication uses exact generation; finally always releases the shared busy flag. |
| discard/depart/retainFromOtherView | Exact open guards and storage-bound writes remain; CLOSED retains present and the four storage bounds described above. |
| stutter | Observation unchanged. |

Entry to CLOSED can occur through restore, capture, sessionEvent, discard,
depart, the last useCheck or releaseBusy. Its predicate depends only on exact
open fields. Each resulting invariant observation reconstructs from retained
raw fields/bits or the transition's known overwrites. Controls include all
seven entries, with existing false authentication, newly false storage bounds
and a previously vacuous error-generation implication becoming false.

Equal observations preserve every original invariant truth, action enabledness
for the same original parameters and projected successors. This is a manually
reviewed strong finite safety-congruence argument, not a machine-checked source
refinement proof, exact UI/storage/error bytes, HTTP/provider qualification,
temporal progress or unbounded-system claim. Original scenarios/samples retain
complete concrete values and run without this fingerprint projection.

## Qualification contract

The focused native file is registered in formal.yml and binds the WHOLE QNT.
Future diagnostic consumers, overwritten-input reuse, altered retry/restore/
generation gates or retention effects require renewed review. Actual complete
production TLA is derived under the native flag; no ignored artifact is a
committed-test dependency. Test aliases follow their production dependencies.
Each negative q_inv is only the named witness complement; require State 2 and
reject initial failures. Positive pairs use q_inv TRUE alone and require
RAW2/VIEW1 with empty queues, including retained false observations. A no-VIEW
future stored-value consumer documents why new reads invalidate the binding.

The native definitions cover false/healing raw observations, live session and
HTTP captures, cross-check generation, false-prefix generation recovery,
preflight auth overwrite, late effect healing, unscoped busy release, resets,
all class entries, conservative unknown phases and CLOSED retention. Static,
type/style, translation and inventory checks remain separate from native and
full-graph qualification. Both native controls and the existing-budget full
graph remain held for independent actual-diff review and root scheduling.

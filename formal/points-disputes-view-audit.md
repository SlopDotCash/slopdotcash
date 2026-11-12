# Points-disputes phase observation VIEW, V1

This candidate changes only finite-model observation and its qualification
controls. It does not change the application, QNT model, `step`, action labels,
parameter domains, invariant, or the 29 concrete named scenarios. It is a manual
finite-safety congruence argument, not implementation refinement or liveness.
Exact error strings and notification counts remain observable in the unchanged
concrete scenarios, which run outside VIEW.

The complete QNT pin is
`315fb521122256a03108c3d87da4382f613080a78fadba32c1626bbaffd96a93`.
The complete translated TLA pin is
`da042eccd27443f294fc20e0b3a510ae5ad51f61bebabffeca02e6f60784454f`.
The TLA with the appended literal VIEW is
`e3eff4b515654f65ce3673e281a672dcbb18ff3e09cc08e0284fc9f9785a6096`.
The pinned official translator, TLC adapter and one-line VIEW config overlay
remain unchanged. A bounded translation-only capture intercepted the official
runner before TLC; that capture is not a graph or native qualification.

## Whole-source consumer audit

All globals remain exact except `parentNotifications`, a closed counter read only to increment itself, with no
guard, invariant or retained-field consumer, and `error`, whose only
executable read is `retryRead`'s `error != "none"`. Preserve none/non-none.
`Request.kind` is captured by the producers but has no consumer anywhere in the
step/invariant cone. It is erased uniformly, including unknown phases.

For read and mutation requests, only `unused` and `done` are represented by exact
phase alone. `startRead` and `beginMutation` completely replace unused records;
the unused payload is not a guard. Done records never reopen. No invariant reads
request payload. All other phases retain epoch, actor and target exactly. No
request is collapsed merely because `owns` or active-read ownership is currently
false. A mutation's ownership can heal on the bounded remount; a remount clears
activeRead, so that example must use mutation rather than assume read ownership.
Unknown phases keep their remaining full record.

Observe actions fully overwrite their observation record. Before observation,
only request phase controls progress; header/body refusals read ownership, not
observation payload. `returnRead`/`returnMutation` only change phase. Therefore
observation payload is erased in unused/pending/refused-body/refused-session/done.
Unknown phases keep their complete observation, with every map domain preserved.

In session-observed/session-returned, both observation kinds retain:

- Outcome 0, outcome 3, or other. Every original observe parameter and guard stays
  unchanged, including pending/refused outcome restrictions and accepted-set
  requirements. Later consumers distinguish only 0 and 3, never 1 from 2.
- Raw `refused` and the raw equality of observation actor and request actor.
  These operands are frozen until use finishes. This reconstructs invalid and
  changedIdentity, including unavailable actor mismatch keeping the old URL.

Mutation observations have no other consumer. For read observations, a payload
tail exists only when invalid is false and outcome is nonzero. Invalid/transport
branches never inspect payload/draft/decider and then finish. Otherwise, target 0
uses only payload==1 for page/nextPage; target nonzero retains exact payload,
including out-of-range false prefixes, exact draft, and payload==2 AND decider.
No other action can modify these frozen operands while their callback is live.

`parentLoads`, parentSameActor/unavailable, remount, depart, cookieChanges,
retryRead, olderRecords, chooseAward, editReason, editDecision and back retain
all of their guard and update inputs exactly. Refused read/mutation headers and
bodies keep phase and captured ownership; observe retains its complete labeled
parameter space; acceptMutation retains exact accepted set and pending phase.
Use callbacks reconstruct every branch described above and emit exact retained
global successors. Terminal payload observations then disappear together.

Thus equal observations agree on every original invariant conjunct (all source
operands remain raw), have the same enabled transitions for each original
label/parameter tuple, and produce equal successor observations. Output-only
increments/categories and erased unused/stale values cannot heal a hidden guard.
False global invariants are never summarized away. Live authority/target values,
unknown phases, and nonzero-target payload bounds remain exact.

## Required qualification

The native source includes named negative witnesses for raw invariant failures,
live actor/epoch/target, outcome/refusal distinctions, detail payload/draft/decider,
unknown phases, and none/non-none error. Actual complete production actions check
invalid detail bounds, unavailable/changed actors, refusal, list/detail results,
stale and superseded callbacks, mutation ownership healing, dirty-unused reset,
transport retry and exact navigation. Multistep witnesses require State 3; the
named witness is the only invariant in each fixture, never ORed with production
invariant. No witness may be true initially.

Twelve synthetic RAW2/VIEW1 pairs check each erased/class carrier. Seven pairs
start from two equivalent raw representatives and cross an unchanged production
callback/reset; both full graphs must complete RAW4/VIEW2 with empty queues.
A no-VIEW future-kind-consumer control proves a new consumer would be observable.
Complete-source gates refuse any newly introduced reader, partial reset or phase
reuse before these pins could be reused. Native tests obtain the complete real
production translation and verify both TLA hashes, then replace only fixture
init/step/invariant aliases. No ignored local evidence file is a native input.

Raw hosted run 43122136526 at 0e218700 reached its 600-second limit: 27,986,322
distinct states, 15,247,806 queued, depth 12. It is incomplete, not a pass. Its
older runner differs from the present parent 88b393dcc, while the QNT and mapped
application sources are unchanged. Do not claim whole-run source equivalence.

Current packet qualification is STATIC ONLY. Native controls, original type/run
scenarios and 500x60 sampler, and a complete bounded full VIEW graph must pass
at the composed hosted source before release integration. No timeout allowance
is changed in this source packet. Timeout, cancellation, partial frontier and
skipped native cases never qualify as successful exploration.

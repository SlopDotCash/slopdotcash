# Wallet registration phase safety VIEW

This PRD section 12 / STATE-05 source-only experiment starts at
`dabd9d893d2b323746128496d65c49daee308aab`. Concrete QNT, initializer, helpers,
actions, step, domains, invariant, scenarios, runtime and verifier allowances
remain byte-identical. The VIEW changes TLC fingerprints, never registration,
authorization, history, HTTP handling or payment behavior.

The retained raw attempt (run 43122136526, raw14-0e) ended incomplete at the
600,000 ms deadline: last progress was 81,667,394 generated states, 21,595,813
distinct, 11,222,004 queued and depth 12. The receipt records exit 1, unchanged
inputs, uncanceled state and no reported counterexample. QNT and three mapped
runtime hashes match this packet. That equivalence covers those sources only;
raw runner/tool/receipt equivalence is not claimed. This packet's actual tools
are pinned separately. No raw graph is rerun and no completion is inferred.

## Exact globals and dynamic registry binding

All globals stay exact: configured, current time, historical-use flag, complete
heads map and every field of every row. Login and timestamp participate in
sameDigest; row ID and predecessor metadata also feed integrity or later
lookups. Even fields that a current successful response does not inspect cannot
be normalized in rows. A future helper's sameDigest or dirty candidate overwrite
can depend on them. Map domains and all six retained row slots are unchanged.

Success remains a dynamic condition, evaluated against exact globals:

- Desired is 200.
- The exact returned-key row exists and has registry source.
- Its address, actor and chain match the captured request.

The request keeps desiredIs200 plus exact returned/address whenever desired is
200. Actor and chain remain exact in every phase. This applies to dirty live
requests too: prepare, helper, helper-reply or winner can carry an old desired
200 and its old returned key until an ending actually replaces both. No phase
assumption may erase that key.

The success condition is never replaced by its current truth. Configure can
replace row 2, historical append can replace row 1, and a dirty helper can
replace a referenced candidate row. They can heal or break an old success while
another row-integrity clause remains false. Exact rows and the exact request
binding reconstruct those changes without assuming fresh IDs or invariant truth.
Other global invariant clauses stay functions of the complete raw rows/heads.

## Uniform closed value and output classes

Request response normalizes to none; its only writer is respond, with no guard
or invariant consumer. winnerObserved normalizes to zero; winnerResult writes
it but nothing consumes it. Direct scenarios still inspect full raw values.
No exact-output claim is made.

Desired keeps 200 versus other. Its only readers are successIsRegistry and the
copy into erased response. helperKind keeps conflict versus other: helperReply
only distinguishes conflict, and existing/created/none otherwise use the same
branch. All original helper outcomes and input domains remain available.

Returned may be zeroed only when desired is not 200 in known phases. It has no
executable consumer, and every original desired write also sets returned in
ending; begin resets both. Intermediate live transitions carry the old desired
and returned together. Thus no discarded non200 returned value can become an
observed successful key before an original paired overwrite.

helperReturned is exact only in helper-reply with a raw nonconflict helperKind.
That branch copies it into returned with desired 200, including hypothetical
none/unknown nonconflict kinds. Conflict ignores it and enters winner; winner
reads the current head instead. Every other path overwrites it before a later
helper-reply or resets the entire request. It is not read by any invariant.

## Phase observation and retry

Unused, response and done become:

1. Exact phase.
2. Exact attempt.
3. Exact actor.
4. Exact chain.
5. Raw desiredIs200.
6. Exact address/returned pair if desiredIs200; otherwise a fixed zero pair.

Begin accepts only unused/done, requires attempt < 2, and for positive attempts
requires the same actor/chain. Those exact inputs preserve both enabled and
refused retries, including false attempt-bound prefixes. It replaces the entire
record from idle with new parameters/time and incremented attempt. Old success
obligations are removed by a known complete reset; retained rows remain exact.
Response has only respond, which changes phase and copies desired into erased
response. Done can retry; it is not assumed absorbing.

Known live phases tip/prepare/helper/helper-reply/winner remain full records
except the closed classes above and these final-use cuts:

| Capture | Exact phases | Source reason |
| --- | --- | --- |
| Login and stamp | Tip, prepare, helper | Read tip may proceed without replacing them; helper uses both in candidateClaim/sameDigest and copies them into full rows. They have no later request consumer. |
| Candidate | Helper | Prepare overwrites it before helper; tip either ends or reaches prepare. |
| Predecessor | Prepare, helper | Read tip overwrites it before prepare; helper consumes it for digest, CAS and row creation. |
| Helper returned | Nonconflict helper-reply | It is consumed only by that response branch. |
| Returned | Any known phase with desired 200 | Dynamic success can be true or false regardless of phase. |

All live actor, chain, address and attempt stay exact. Unknown phases retain the
full raw record except the four uniform response/winnerObserved/desired/
helperKind classes. In particular unknown returned/helperReturned and all other
captures stay raw. No unknown or currently unsuccessful request is phase-folded.

## Every action and same-parameter successor

| Action | Preserved behavior |
| --- | --- |
| Configure, tick, historical append | All global guards, inputs, physical rows and head updates remain exact. Old response bindings are reevaluated against changed rows rather than frozen. |
| Begin | Exact phase/attempt/actor/chain preserve retry guards and parameter domains. Full replacement determines every new live capture independently of erased old payload. |
| Read tip | Exact actor/chain/address choose the same head and registry/address no-op. Login/time are retained on the non-noop continuation; predecessor is overwritten before prepare. All endings write desired/returned together. |
| Prepare | Exact attempt determines the same candidate formula before helper. Its predecessor/login/time remain exact; an old desired 200 and returned key stay visible. |
| Helper | Complete live candidate inputs and complete global rows/heads preserve digest priority, existing-before-CAS behavior, conflict and every physical row write. The new helperReturned is exact when its reply consumes it. |
| Helper failure | Ends with error/zero; no old row write is undone. |
| Helper reply | Received and conflict class preserve the branch. A nonconflict reply retains its exact helperReturned; conflict carries old desired/returned unchanged into winner. |
| Winner read | Exact actor/chain/address and raw heads/rows preserve registry-required selection, even for historical same-address rows. ending replaces both desired and returned. winnerObserved is an output only. |
| Respond | Changes exact phase response to done; output is erased, desired/binding remain observable for future global changes and retry. |
| Explicit stutter | Leaves the observation unchanged. |

Related raw states therefore have the same enabled original action/parameter
tuples and projected successors. The complete success invariant is reconstructible
in every phase, including false/healing classes; row/head invariants remain raw;
attempt bounds use exact retained attempts. Every last-use cut either has no
later consumer or is overwritten before one becomes enabled. There are no
arbitrary next-phase jumps, and unknown records use the conservative fallback.

This is a manual finite safety argument, not a machine-checked congruence or
runtime refinement theorem. It claims no continuously fresh authority, exact
output, immutable-success assumption, liveness, unbounded behavior, signer or
payment effect. The legacy historical-winner negative action remains outside
step; all direct scenarios and finite domains/properties remain unchanged.

## Exact source binding and control source

The hardcoded helper and matching manifest bind complete QNT, complete production
TLA, actual loader-produced final VIEW and the official adapter. Actual
bindSafetyView/applySafetyView preserve the entire concrete body and whole
80-character terminator. Unknown definitions, source/TLA/expression/adapter drift
and temporal properties fail closed. Full-file guards cover all helpers, phases,
writers, retry constraints, digest metadata, paired ending writes and scenarios.

QNT SHA-256:
`d5023fc793181ed1a348c7d636806f89f5870971e790c25c188bd6648c3fec01`.
Actual complete production TLA SHA-256:
`dfabd27058f4dc2a5a1c1069f1d21e232635a7b421df4e7ed08000dc736d1505`.
Actual final VIEW SHA-256:
`c2b48a9fb0583707823302849645913011f117bd3f9c8849a8faec6c0a1690a5`.
These are source/translation bindings, not passing native or graph receipts.

Under the native flag, controls freshly capture this full pinned production
module and validate actual loader application. They retain every production
definition and reversibly replace only test init/step/invariant aliases, with
helper predicates before first use. Request domains remain the original slots,
not the larger row-ID domain. Boundary tests call actual original actions.

The source defines 50 observation cases, seven raw-two/view-one pairs, nine
production boundary witnesses, five dynamic binding witnesses, one excluded
legacy-rule counterexample and sixteen queue-zero guard cases. Each negative
property or reachability witness stands alone and requires noninitial State 2;
unrelated false original invariants cannot satisfy it. Positive guards require
successful completion, exact state counts and queue zero. Pairs use q_inv TRUE
and include false success with identical retained binding fields.

Dynamic cases exercise configure and dirty helper overwrite healing/breaking
success while a different physical row has an invalid ID. That extra bad row
has a deliberately different digest, so it cannot accidentally absorb the helper
write as a sameDigest replay. Historical overwrite separately breaks an existing
binding. Other cases retain dirty live desired200 keys, nonconflict none-kind
helper returns, exact digest metadata, retry limits/identity, historical-winner
refusal and lost-response bindings. The former legacy rule remains visibly bad
through the same VIEW; it is never adopted into the real step.

All three inventories are regenerated and checked again after the source commit.
Integration must regenerate combined inventories and re-pin its actual runner/
report tooling. Ignored evidence separates exact packet hashes and binding from
the old incomplete raw receipt. All native, ordinary and full graph qualification
and push remain held for actual review and coordinated hosted execution.

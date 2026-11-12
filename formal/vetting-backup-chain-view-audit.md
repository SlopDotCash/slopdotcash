# Vetting backup-chain capped-carrier VIEW V2

This private PRD section 12 experiment starts from clean
`4066e7b41a1054a808ccf7c140cdb48aa826988d`. The hosted original search hit its
180-second limit with last logged progress 92,702,035 generated, 10,083,905
distinct and 3,110,710 queued at depth 35. That growing frontier is incomplete,
not a safety pass or evidence that another small allowance will finish.

The complete `models/vetting/vetting_backup_chain.qnt` remains byte-identical,
SHA-256 `61ecf280693c06a4d3d717fcf5786fc9ba39172e543f62a60fd4559a475482ef`.
Every original action, parameter domain, bound, invariant, dispatcher and named
scenario is retained. No runtime or financial policy changes. The separate
hosted allowance exception and unchanged ordinary limits are recorded below.
`vetting-backup-chain-capped-carrier-safety-v2` changes TLC fingerprints only and authorizes no storage operation or deletion.

## Exact projection

V2 starts from frozen V1 `c4530f531ae0cdfbaaa182b43e7656a438c71b90`.
Its first four normalizations are unchanged; only the two independently
capped carriers are added. All other state stays exact:

| Field | Normalization | Complete read audit |
| --- | --- | --- |
| outcome | none | No step/helper/invariant reads it. readStart, ack and retry assign diagnostics only. |
| restoreOutcome | none | No step/helper/invariant reads it. Restore actions assign caller diagnostics only. |
| completionObserved | Exact at stage phase-update; false otherwise | The only consumer is finishBackup, guarded by phase-update. readReceipt computes a new value from exact completePresent/completeReceipt while entering that stage. |
| selected | Zero at restoreStage none/done; exact otherwise | readRestoreSource, putRestore and readRestore consume it only in their live stages. beginRestore fully replaces it with the original object parameter before entering chain. |
| seen | Empty iff replays >= 2; exact below 2 | replay is the only consumer and also requires replays < 2. deliver only unions a page into this carrier. |
| pending | Empty iff deliveries >= 6; exact below 6 | deliver is the only consumer and also requires deliveries < 6. All other uses only preserve, union or exclude pages in this carrier. |

The projection of init is unchanged. Original outcomes and selected values
remain available to the unchanged concrete named scenarios and sampled step;
this VIEW does not establish their exact delivery/diagnostic bytes.

## Future reads and same-parameter successors

The argument does not assume any original invariant. Related states have the
same main phase/stage, restore stage, exact counters, every live queue
carrier and every storage/receipt/evidence field. Every guard is therefore identical, including
all 13 original invariant observations when they are false.

For the completion observation, the only action entering phase-update is
readReceipt. It overwrites the old observation with exact completePresent and
completeReceipt before any finishBackup can consume it. At phase-update the
capture stays exact, including a false observation and the case where current
completion is later lost. Losing a reply, retrying, delivering or resuming
cannot reuse an erased old capture: before another phase-update they pass the
same fresh producer. Delivery/resume resets, inactive copies and all later
storage changes preserve the projected relation.

For the selected object, none/done can leave through beginRestore only. Its
guard uses exact restoreAttempts/stage and the original bounded object
parameter; the next selected value is assigned before any source/destination
read. There is no background pending-restore transition after done in this
model. Unknown PUT response effects have already been recorded by putRestore;
loseRestoreReply preserves those exact global destinations. A later attempt
selects its new parameter. Selection remains exact throughout chain,
source-read, put and readback, conservatively retaining it even at chain where
it is consumed later. Backup and external corruption actions never read it.

| Action family | Congruent enabledness and projected update |
| --- | --- |
| Main backup pipeline | All live guards, object/job IDs, start/page/copy/receipt data and current evidence stay exact. Caller outcome writes are erased. |
| readReceipt/finishBackup | Fresh producer overwrites before entry; active capture is exact until consumed. Current evidence and its loss remain distinct. |
| resume/deliver/ack/retry/replay | Live carrier, job, counters and phase behavior remain. Each capped carrier has no enabled consumer and only receives carrier-local writes. Diagnostic outcome and inactive observation copies have no future consumer. |
| Restore pipeline | Live selected value and all current source/destination bytes stay exact. Terminal selection is replaced before reuse. Outcomes have no consumer. |
| Corruption/loss/conflicting destination | Every guard and non-diagnostic mutation stays exact. No erased field influences those calls. |
| Stutter | The projection is unchanged. |

The original invariant reads none of the six projected fields. Its pages,
history, copied bytes, exact/present sets, completion witness/receipt,
restoration sets, delivery/replay/acknowledgment bounds and cycle/day clause
remain literal observations of exact raw fields. A false clause may be healed
or broken by later original operations; no clause is frozen to true. Related
states thus enable the same original calls with the same parameters and have
the same projected successors. This is a manually reviewed strong finite
safety-congruence argument, not a machine-checked implementation refinement,
cryptographic/storage-provider proof, liveness or unbounded-system theorem.

## Binding and controls

The new operator is one explicitly hardcoded allowlisted definition. Exact
full QNT, complete original production TLA, final VIEW TLA and official
adapter bytes are pinned. The actual bindSafetyView/applySafetyView functions
must accept the complete production translation, including its full module
terminator. Existing model definitions and runner/config behavior stay intact.
Whole-file source guards bind helpers, all actions/domains/properties and
scenarios and reject new outcome readers, stale capture reuse, terminal
selection reads or a changed object domain.

The native definitions isolate each original invariant clause and its healing
counterexample. Additional controls cover the live completion guard, every
live restore pointer phase and fresh producer/capture boundaries. Each negative
q_inv is its named observation alone; tests require a State 2 violation and
refuse initial-state violations or unrelated success. A separate positive
paired raw-two/view-one diagnostic changes only the four erased observations
while an acknowledgment invariant is already false; q_inv is TRUE alone.
This checks intended coalescing, not original safety. Static/type checks and
translation binding are separate from native/full qualification. The V2
operator pins the unchanged complete production translation, SHA-256
`c6c7d4a872bc1cd2d99e37f432501b1db7de850ccd2f984dbdccf322d6ec051d`,
and the new complete VIEW translation separately. A translation-only capture
must stop before TLC and the actual production apply/bind test must pass;
small synthetic fixture pins are not a substitute.

## Closed-carrier successor audit

The two masks are independent and do not require a true invariant or a
reachable prefix. `replays` only increments in replay under `< 2`;
`deliveries` only increments in deliver under `< 6`. No step action resets or
decrements either counter, including start, resume, retry or a new restore
attempt. Thus each `>=` predicate is closed even in a hypothetical false
prefix with an already-exceeded cap. Init is not an executable continuation.

Below a cap its carrier stays exact, so that consumer's guard and all its
writes agree for the same original page argument. The last enabled replay
consumes exact seen before changing replays from 1 to 2. Its pending union is
still exact when deliveries < 6; otherwise pending was already dead. The last
enabled deliver consumes exact pending before changing deliveries from 5 to 6.
Its job, stage, delivery counter and completion reset stay exact. Its seen
union stays exact if replays < 2 and is otherwise dead.

After replays >= 2, replay is disabled for every page, irrespective of seen;
deliver may still add to seen but no future guard or retained write reads it.
After deliveries >= 6, deliver is disabled for every page, irrespective of
pending. readStart, sendNext, sendCleanup, retry and replay only copy or union
pending without using its contents to choose a retained write or branch.
Those calls retain their original exact stage, job, parameter and evidence
guards and their original retained updates. If deliveries is capped but
replays is not, seen stays exact: a replay can still occur and its counter
increment remains visible, although its pending union is dead. Conversely,
with replays capped but deliveries live, pending stays exact so a delivery
can still occur. No carrier mask changes when the other cap is crossed.

Therefore related states have identical enabled calls for the same original
parameters and matching projected successors across and after each boundary.
All 13 original invariant clauses, including false delivery/replay bounds,
false acknowledgment bounds, and later healing of storage/evidence clauses,
are still evaluated on exact raw operands. The masks assume none of them.
This is a manually reviewed strong finite safety congruence, not an exact
queue-delivery/diagnostic trace, liveness, provider or application-refinement
proof.

## V1 evidence and V2 qualification status

The V1 parent and its failure packets are preserved separately. V1's focused
native qualification passed 37 tests / 235 assertions, including its original
34 named negative controls and paired raw-two/view-one diagnostic. Its
ordinary type/scenario/500-by-60 sampling receipt passed on the same complete
QNT. These are inherited source-equivalent results, not fresh V2 results.
The V1 local 180-second graph was incomplete (last logged 1,668,669 distinct,
15,762,493 generated, 532,338 queued, depth 32); the hosted 600-second graph
also remained incomplete (root-reported rounded 29.72 million classes,
6.25 million queued, depth 42). Neither is a safety pass. Their resource
changes and metadata were not imported into the original-180-second V2
parent; this separate hosted child is documented below.

All original 34 negative definitions and the original paired diagnostic are
retained unchanged. V2 adds below-cap and opposite-cap live-carrier negatives,
exact counter observations, the actual last-replay/last-delivery continuations
in both orders, and raw-two/view-one pairs at exact and exceeded caps. Every
new pair retains an already-false acknowledgment clause, and exceeded-cap
pairs retain their false raw counter clauses. Each negative's q_inv is only
its named observation; it requires State 2 and refuses an initial violation.
The paired tests use TRUE alone and establish coalescing only. Whole-source
gates additionally reject new carrier consumers, removed cap guards, counter
resets and carrier-dependent invariant/restore consumers.

At the original static freeze, V2 native controls and a complete frozen finite
graph were held for root's actual-diff review and capacity authorization. The
subsequent local results and this separate hosted diagnostic are recorded
below; static/type/index checks and translation binding alone do not complete
qualification.

## Hosted 600-second diagnostic child

This child starts from frozen V2
`69b02f98a6035385f0c38b6b9c601a5144953d50`. The complete QNT, VIEW expression,
helper/manifest, native controls, runtime, domains, dispatcher, properties and
scenarios remain byte-identical. The checker changes only the backup
full-graph allowance from its default 180 seconds to an explicit 600 seconds.
Every ordinary stage retains 90 seconds. The workflow adds exactly the manual
models/shards inputs reviewed in `e8977c1add61ea87ec04c3f5f607e3c7cebeceba`;
the default all-model/six-shard inventory and every native CI control remain.

The parent's fresh focused native run passed 60 tests / 408 assertions,
including 48 named counterexamples, seven paired diagnostics and the complete
production bind. Wrapper duration was 436,393 ms. Every tracked/tool hash
remained stable. Its fresh original type check passed in 27,921 ms and all
21 original scenarios passed in 23,088 ms. The original 500 × 60 sampler
FAILED the unchanged 90,000 ms stage deadline (90,113 ms measured, SIGKILL).
It produced no counterexample; that does not make the failed check a pass.
The ordinary wrapper took 151,123 ms. All inputs stayed unchanged and its
recorded owned-process survivor list was empty. These exact local receipts
and the earlier V1 incomplete packets are retained separately.

Consequently the conditional local broad-graph prerequisite was not met and
no V2 local full graph was started or retried. This child is a hosted resource
diagnostic, not a local ordinary-pass repair or completed safety result.
Linux qualification must freshly pass the original type/21-scenario/500 × 60
lane under the same 90-second ordinary-stage limits, the native inventory
controls, and the complete finite graph with stable exact source/tool pins.
No child native/full run, push or dispatch is performed during preparation.
The sole integrator owns publishing and interpreting hosted diagnostics.

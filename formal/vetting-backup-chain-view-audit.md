# Vetting backup-chain observation VIEW

This private PRD section 12 experiment starts from clean
`4066e7b41a1054a808ccf7c140cdb48aa826988d`. The hosted original search hit its
180-second limit with last logged progress 92,702,035 generated, 10,083,905
distinct and 3,110,710 queued at depth 35. That growing frontier is incomplete,
not a safety pass or evidence that another small allowance will finish.

The complete `models/vetting/vetting_backup_chain.qnt` remains byte-identical,
SHA-256 `61ecf280693c06a4d3d717fcf5786fc9ba39172e543f62a60fd4559a475482ef`.
Every original action, parameter domain, bound, invariant, dispatcher and named
scenario is retained. No runtime, financial policy or verification allowance
changes. `vetting-backup-chain-observation-safety-v1` changes TLC fingerprints
only and authorizes no storage operation or deletion.

## Exact projection

All state stays exact except these four fields:

| Field | Normalization | Complete read audit |
| --- | --- | --- |
| outcome | none | No step/helper/invariant reads it. readStart, ack and retry assign diagnostics only. |
| restoreOutcome | none | No step/helper/invariant reads it. Restore actions assign caller diagnostics only. |
| completionObserved | Exact at stage phase-update; false otherwise | The only consumer is finishBackup, guarded by phase-update. readReceipt computes a new value from exact completePresent/completeReceipt while entering that stage. |
| selected | Zero at restoreStage none/done; exact otherwise | readRestoreSource, putRestore and readRestore consume it only in their live stages. beginRestore fully replaces it with the original object parameter before entering chain. |

The projection of init is unchanged. Original outcomes and selected values
remain available to the unchanged concrete named scenarios and sampled step;
this VIEW does not establish their exact delivery/diagnostic bytes.

## Future reads and same-parameter successors

The argument does not assume any original invariant. Related states have the
same main phase/stage, restore stage, counters, queue membership and every
storage/receipt/evidence field. Every guard is therefore identical, including
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
| resume/deliver/ack/retry/replay | Full queue, job, counters and phase behavior remain. Diagnostic outcome and inactive observation copies have no future consumer. |
| Restore pipeline | Live selected value and all current source/destination bytes stay exact. Terminal selection is replaced before reuse. Outcomes have no consumer. |
| Corruption/loss/conflicting destination | Every guard and non-diagnostic mutation stays exact. No erased field influences those calls. |
| Stutter | The projection is unchanged. |

The original invariant reads none of the four projected fields. Its pages,
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
translation binding are separate from native/full qualification.

At frozen `c4530f531ae0cdfbaaa182b43e7656a438c71b90`, focused native controls
passed 37 tests with 235 assertions and the unchanged ordinary 21 scenarios plus 500×60
seeded traces passed. The canonical 180-second full graph remained incomplete:
1,668,669 distinct states, 15,762,493 generated, 532,338 queued at depth 32. No full
safety pass is claimed. Its cleanup EPERM status is retained; a later independent
process check found known Java PID 30043 absent and no model/worktree/tempdir
matching Node/Java process. No kill was performed.

This private child changes only the time allowance to 600 seconds and adds the
same reviewed manual model/shard selector interface used by the release
investigation. All concrete QNT, VIEW, native-control and adapter bytes remain
unchanged. The hosted 600-second experiment is PENDING: it is not release
qualification until actual stable-source receipts report completion with zero
queued states. Keep the earlier failed receipt; do not relabel it as passed.

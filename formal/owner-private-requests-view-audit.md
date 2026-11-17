# Owner private-request safety VIEW

This private PRD section 12 experiment starts from clean
`4066e7b41a1054a808ccf7c140cdb48aa826988d`. Its frozen parent
`39f03addce0efb7571da97c04617612908d6b3a4` changes TLC fingerprints only.
The complete model, parameter domains, actions, invariant, scenarios and mapped
runtime sources remain unchanged. This private child grants that same graph
600 seconds for a hosted diagnostic and adds the reviewed manual model/shard
selectors. The earlier hosted original search exhausted 180 seconds. Its last
report had 15,353,813 distinct states and 5,670,478 queued at depth 22, with a
growing frontier.
That incomplete historical reference is not a safety pass.

## Exact observation

`owner-private-terminal-safety-v1` binds complete model SHA-256
`10f3857b1869eede164399bb95e8690243f18b83552fca833717ef8c37a85b6c`.
Complete production TLA is
`e790dc551ab11b1ce58682cfeef78750eec2bd8d33ab80dbdb147a7a1bcc5b4c`.
Inserting only `SlopOwnerPrivateRequestsViewV1` before the full terminator gives
`eeae6caf9dce45b40cebaada085dc4143cf5db382151af27b6fb5f5114e72b55`.

Every global stays exact except error, which no helper, action guard or
invariant reads. Carrying or assigning that output affects no other projected
field. Every live request stays exact, including actor, cookie, admission,
lifetime, kind, outcome, setup and session captures, even when owns currently
fails. This V1 uses no stale-pointer or failed-owns criterion for live erasure.

Only unused and done request records become tuples of exact phase and three
independent raw truths: actor >= 0, actor <= 2, and admitted implies cookie ==
actor. Each truth comes from the original request before masking. None is
assumed true, merged with another clause or reconstructed from a canonical
actor/cookie. Indices and map domains stay exact. The terminal phases remain
distinct because begin accepts unused only. Unknown/live phases stay complete.

## Complete future-read and successor audit

| Action/helper | Dependency and projected successor |
| --- | --- |
| owns | Exact mounted, active and global lifetime plus request lifetime. It affects transitions only inside phase-guarded live actions; no terminal payload is consumed through it. |
| clearPrivate | Reads no discarded field; writes exact data, draft, knownActor, canSetup and stale globals. |
| fundsMode/sessionChanges | Guards and non-error writes use exact globals and original actor parameters. |
| begin | Requires unused, mounted, original ID/kind domains and awards/data mutation gate. It reads no old payload and fully replaces all ten request fields from arguments and exact knownActor/lifetime before entering preflight. |
| observePreflight/returnPreflight/usePreflight | Only their live phases enable them. Observed identity, availability, kind, actor, lifetime and global identity remain exact, including detached and superseded requests. Done observations are computed from the actual resulting request. |
| dispatch/admit | Live phase, ownership, cookie capture, expected actor and admission computation remain exact. Later session changes cannot rewrite captures. |
| response | Only http or temporary failure at admission enables it. Exact kind/admitted and original outcome/setup parameters preserve accepted membership and refusal clearing, even without ownership. |
| observeRecheck/returnRecheck/useRecheck | Every live captured input and global stays exact. Data/draft/stale/setup and accepted effects match before entering done. |
| depart/remount | Exact presence, mount, lifetime and private globals preserve cleanup/replacement. Neither consumes or changes terminal payload. |
| stutter | Observation unchanged. |

The named preflight/recheck sequence helpers only compose the audited actions;
they add no step branch or hidden read. Every step action appears above. No
action reads a different request's payload.

Done absorbs: no original action acts on it, and begin never reuses it. Global
changes cannot unmask done payload. Unused can leave only through begin, whose
complete replacement precedes any captured-field consumer. Dirty unused false
lower/upper/admission classes therefore remain false until that reset. Its
new bounds derive from exact knownActor for mutations or zero for reads. A
hypothetical knownActor above two can create a new false upper bound; it is
not silently repaired. Admission resets false, so its new implication is true.
Every subsequent live field remains exact.

All five global invariant clauses retain their raw operands: presence/mount,
data/knownActor, stale/mode/data/canSetup, mount/data and accepted/IDs. Every
live request observation is raw because its record stays complete; terminal
tuples retain all three separate raw observations, including false classes
and distinct healing. No invariant truth or accepted-to-request relationship
is assumed. Equal projections imply equal original invariant truth, the same
enabled calls for every original parameter and equal projected successors.
This is a manual strong finite safety-congruence argument, not a machine-checked
refinement proof, runtime/HTTP-byte equivalence, financial/provider qualification,
temporal progress or unbounded-system theorem.

## Guards and qualification

`scripts/owner-private-requests-safety-view.test.ts` pins the complete QNT and
whole schema/helper/action/step/invariant prefix. New error consumers, unused
payload reads, terminal reuse/late effects, cross-slot reads and invariant
changes require review. The hardcoded allowlist also binds complete source,
production TLA, final VIEW TLA and adapter bytes; temporal requests and changed
operators are refused.

Native definitions derive complete production TLA under the pinned flag,
validate actual applySafetyView on its full terminator, and reuse its actual
begin/dispatch/admit/response/session-use actions. No committed test depends
on ignored evidence. Negative q_inv is the named witness complement alone;
tests require State 2 and reject initial failures. Cases cover every global
false/healing class, independent terminal lower/upper/admission false/healing,
live capture consumers, dirty-unused full reset and new false state from exact
global identity. Paired raw-two/VIEW-one positive controls cover only the
write-only error and terminal payload, including already-false raw classes.
Done-no-reuse and a no-VIEW future error-consumer witness exercise the reset
and future-read boundaries. The focused file is registered in formal.yml.

Static/translation binding, native controls and the full finite graph are
separate qualifications. Their exact frozen lineage follows; no domain,
property or bound is reduced.

## Frozen qualification and private hosted follow-up

At clean `39f03addce0efb7571da97c04617612908d6b3a4`, the focused native file
passed 50 tests and 271 assertions, including all 40 native controls and five
paired raw-two/VIEW-one diagnostics. The unchanged ordinary typecheck, 24 named
scenarios and 500×60 seeded traces passed with the original 90-second stage
limits. These are the parent's actual receipts, not fresh qualification on
this child's changed checker. No failed result is relabeled as passed.

The one canonical 180-second V1 full graph was INCOMPLETE. Its last progress
report recorded 7,840,481 generated states, 1,669,261 distinct states,
638,390 queued and depth 18. The report preceded the deadline by about
18 seconds; these are last-reported metrics, not final ending counts. Its
receipt reports passed=false, inputsUnchanged=true and canceled=false. The
reviewed VIEW was applied and all source/tool plus six binary hashes stayed
stable. No full safety pass or empty queue is claimed.

The wrapper recorded SIGKILL, cleanup kill EPERM and cleanup-did-not-finish
warnings, which remain in the failed receipt. A separate post-exit audit found
all three captured PIDs (86264, 94955 and 31122) absent, no exact owned process
group or module-path match, no scoped Node/Java process, and both owned stage
and TLC temporary directories removed. No manual signal was sent. Verified
cleanup is separate from graph completion and cannot turn a timeout into a
safety pass. Startup took about 35 seconds inside the unchanged allowance;
known small concurrent build/browser load and a low-CPU resource snapshot are
retained as timing context, without a causal attribution or an adjusted cap.

This private child changes only the model-specific full-verifier allowance
from 180 to 600 seconds; ordinary stages retain 90 seconds. QNT, helper, VIEW
manifest, native-control, translator, adapter, configuration and lockfile bytes
stay exact. The manual models/shards dispatch block is copied exactly from
reviewed `e8977c1add61ea87ec04c3f5f607e3c7cebeceba`. All three inventories are
regenerated against this child. The hosted 600-second probe is PENDING until
its own stable-source receipt reports completed finite exploration with zero
queued states. It adds no temporal, output-byte or implementation-refinement
claim. No local native/full run, dispatch or publication is performed by this
preparation; the sole CI owner handles publication and diagnostics.

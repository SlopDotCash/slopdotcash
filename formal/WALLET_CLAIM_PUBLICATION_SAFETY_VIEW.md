# Wallet claim publication continuation safety VIEW

PRD section 12, STATE-04/05. This private static candidate preserves the full
source model, its actions, invariant, named scenarios, failure paths and finite
domains. It retains two actors, all four chains, two concurrent slots with one
retry each, six history rows, eight lineages and the original clock ranks.
There is no new input delay, ID symmetry, terminal stutter or resource allowance.
This is a manual finite safety congruence argument, not machine-checked source
refinement, a liveness proof or payment authority.

## Observation relation

All globals remain exact except the write-only `observedCurrent` output and
the `created` fields in the indexed history map. Every history key and every
other history field remains exact. All request phases remain exact.

The request's `tip`, `disposition` and `response` fields have no executable
future reader or invariant consumer. Its outcome retains exactly equality to
`committed`: both batchResult and the invariant use that equality, and every
other outcome name has the same continuation given the other retained fields.
Its desired status retains exactly equality to `201`; respond only copies the
full status into the erased response, while the invariant reads only `201`.
Raw scenarios continue to check their original exact outputs without this VIEW.

Every request retains exact attempt, mode, actor, chain and returned row ID.
These preserve the retry restrictions, attempt bounds and dynamic returned-row
existence/actor/chain checks. A terminal request also retains its claim ID
whenever its outcome is committed or its desired status is 201. These exact
keys preserve obligations when another request or configure later changes the
history or audits. Current truth bits alone cannot replace those keys.

## Creation copy cone

Request `claim.created` and all history `created` fields are a closed copy-only
cone. Body/capture assign or copy them, and batch may copy the request value
into its indexed row. No guard, invariant, digest comparison, predecessor check,
head lookup or other field reads that value. Normalize the entire cone to zero
together, so every copy commutes with normalization. History is an indexed map;
this normalization cannot merge distinct members of a set or hide duplicate-key
rows. All global history IDs, existence, provenance and digest fields stay exact.

Request `claim.exists` also has no reader: batch explicitly writes exists=true
when it publishes. Global history existence always remains exact.

## Before capture

In authority/body/tip/capture, a contributor's observed time and material are
dead because capture overwrites them with the exact global clock and constant
material=1 before their first digest read. Operator values stay exact: body
checks its observed time, and capture preserves its observation/material.
Unknown mode values also remain conservative; only exact contributor mode gets
this normalization.

A claim ID before capture is dead only if desired is not 201 and outcome is
not committed. Otherwise the original invariant can already observe the ID
in a false prefix, so it stays exact. No pre-capture action can newly mark the
outcome committed or desired 201. Capture overwrites the ID from the exact slot
and attempt before any batch can activate those conditions.

Live contributor source remains exact. Begin forces registry for a normal
contributor request, but that reachable-state fact is not an invariant premise.
A defined false-prefix historical source could reach digest/batch because
capture does not overwrite source. Source, address, login and predecessor stay
exact throughout every active digest, CAS and recovery continuation.

## Terminal continuation

Unused/reply/done requests keep phase, attempt, mode, actor, chain, returned ID,
the two retained status classes and the conditional exact claim ID above.
Other claim payload is dead. Reply only writes output and changes phase; begin
accepts only unused/done, checks the exact retry identity, then fully replaces
the claim and result payload. Other slots cannot read this request directly.
Their history/audit changes still affect its retained lookup keys.

Use identical original actions and parameters from related states. Every guard
reads retained fields, and every erased live payload is overwritten before its
first consumer. The creation copy cone stays closed through configure/body/
capture/batch. All original invariant observations are reconstructed from exact
global rows, heads, audit/notice sets and the retained per-request keys/classes.
This includes already-false observations and later healing; no invariant is
assumed. Explicit stutter preserves the relation.

## Qualification

The previous raw hosted 600-second graph remained incomplete at 30,528,959
distinct states and 30,518,886 queued, depth 5. Its failure is retained.

One bounded translation-only capture derived the actual unchanged source TLA
using the pinned translator and JAR, then intercepted TLC before exploration.
It exited successfully in 34.594 seconds with source/tool hashes unchanged,
no surviving owned process group and no retained translator temporary directory.
This is translation evidence only.

Actual literal/controller peer review, fresh native controls, original scenarios
and sampling, and a complete bounded graph are pending. No V1 native or graph
qualification is claimed. Wallet publication or possession never authorizes a
payment.

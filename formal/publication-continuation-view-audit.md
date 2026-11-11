# Publication continuation safety VIEW

This experiment starts from `53c1727cebe45a2790f97d1fa5e99e29a20b03e2`.
`ui-project-publication-continuation-safety-v1` applies only to the unchanged
`models/ui/ui_project_publication_lifetime.qnt`, SHA-256
`68360360fec1f0abd036e8b78046603c14f557831fa6da7bf3ec19774d196e03`.
The concrete state, domains, actions, dispatcher, invariant, named scenarios
and ordinary sampled execution remain unchanged. The VIEW changes only TLC
fingerprints and does not modify product code.

## Projection and dependency audit

Let P normalize global `serverDraft` to zero, `storageError` to false and
`error` to `none`. No action or invariant reads these fields. `failed` branches
on its supplied kind, not on the prior global error. `serverResult` writes
serverDraft but its admission decision reads the retained request expected
revision, admitted flag and global server revision. `persist` writes its
diagnostic error but never uses the old diagnostic to decide an update.

P also normalizes the three referrer carriers: global `referrer`,
`storedReferrer` and every request's `referrer` become false. Their dependency
cone is closed:

| Action | Referrer dependency |
| --- | --- |
| `persist` | Copies referrer to storedReferrer; both are erased. |
| `begin` | Copies referrer to the new request; both are erased. |
| `remount` | Copies storedReferrer to referrer; both are erased. |
| `consumeSuccess`, create mode | sameDraft compares the request/global referrers, but its result affects only the new referrer. View, publication, ownership and all other fields have the same update either way. |
| `consumeSuccess`, revision mode | sameDraft uses the retained draft epoch instead of referrer. It retains the exact draft-clear/rebase decision. |
| Other actions and invariant | Do not read these carriers. |

The only reachable modes are create and revision, independently of the
invariant: init supplies revision and createMode supplies create. Mode remains
exact. No economic or attribution policy is inferred from this model-specific
dependency argument. Concrete scenarios still inspect the original referrer
values and their payload behavior.

P normalizes request `outcome` to `none`. This field is only assigned. The
response action tests its outcome parameter; it never reads r.outcome. Phase,
HTTP acceptance and all outcome parameters remain exact, so success,
temporary and access still enable the original distinct transitions.

For a request with phase unused or done, P records
`<<phase, accepted, (admitted => cookie = actor)>>`. Every other live request
field remains exact except the two erased referrer/outcome fields above. In
particular, the VIEW does not abstract live actor, cookie, lifetime, draft,
draftEpoch, expected revision, acceptance, resultRevision or observedActor.

Done slots are absorbing: every request-local transition excludes done and
begin requires unused. An unused request is read by begin only for its phase,
then completely replaced from current globals. createMode checks only request
phases. The global publication invariant can select another request's
accepted field dynamically, so accepted is retained exactly for both unused
and done slots. Other requests and global actions read no other inactive-slot
payload. Captured cookie/actor values are independent of subsequent global
cookie/actor changes, so their admission truth remains unchanged when copied.

## Invariant preservation, including false classes

For two source-reachable states with equal P, every original invariant clause
has equal truth:

| Original observation | Retained information |
| --- | --- |
| Global accepted IDs are a subset of ids | The exact global accepted set. |
| Global server revision is between zero and three | The exact revision. |
| Departed DOM implies unmounted | Exact present and mounted flags. |
| Publication is zero or its selected request is accepted | Exact publication index and every request's exact accepted flag, including unused/done flags. |
| Each admitted request has matching captured cookie/actor | Exact live admission fields or the exact inactive-slot implication truth. |

This does not assume the invariant is true. A false selected-publication
observation and a false admission observation remain distinguishable from
their true classes. A false admission bit is not replaced with a trusted
constant. The publication index is not erased or converted to a frozen bit.

## Same-parameter successor congruence

Related states enable the same original action calls and have equal projected
successors for the same parameters:

| Action group | Reason |
| --- | --- |
| `createMode` | Exact active/accepted globals and every request phase determine its guard. Its mode/source/base changes are retained exactly. |
| `begin` | Guard uses exact mount, active, view, draft, mode, draftBase/base and slot phase. It replaces the slot completely. New admitted=false makes its admission implication true, irrespective of prior inactive payload. Captured referrer is erased. |
| `cookieChanges`, `edit` | All guards and changed live fields remain exact. |
| `persist` | The retained draft/base writes are equal; the referrer and diagnostic writes stay inside the erased cone. Failed persistence projects to a self-loop from either representative; the original explicit self-loop remains. |
| Observation/return/preflight consumption | All ownership and snapshot reads are exact. Failure writes only the same retained ownership/view/phase plus erased error/outcome values. A move to done retains exactly acceptance and admission truth. |
| `dispatch`, `admit` | Live ownership, actor and cookie are exact. Dispatch captures the same global cookie. Admission computes the same admitted flag. |
| `serverResult` | Expected/server revision, validity parameter and admitted flag are exact. Acceptance, resultRevision, global accepted set and serverRevision update identically. Only the serverDraft output is erased. |
| `response` | HTTP phase, acceptance, outcome parameter and ownership are exact. Success/access guards remain unchanged. A response that finishes a slot records its unchanged acceptance and admission truth. |
| Success observation/return/consumption | Ownership, observed actor, mode, live draft/epoch and resultRevision are exact. Revision rebase/clear decisions match; create mode differs only inside the erased referrer cone. Publication chooses the same ID. |
| Failure observation/return/consumption | Ownership and observed actor reads are exact. The same retained view/active/phase follows; only the diagnostic string is erased. |
| `depart`, `remount` | All guards and mount, lifetime, identity, draft, source/base, view and publication changes are exact. The referrer copy stays inside its erased cone. Inactive-slot admission truths and acceptance are carried unchanged. |
| Stutter | P is unchanged. |

Convenience preflight/successCheck/failureCheck sequences inherit congruence
from their unchanged constituent stages. Historical oldPassiveDepart remains
excluded from step and its concrete negative scenario is unchanged. No terminal
phase or source transition is removed. Starting from the unchanged init, the
source-level argument makes the quotient graph the projection of the full
finite graph, preserving all original invariant counterexamples.

This is a manual argument, not a mechanically proved refinement theorem.
The VIEW does not establish exact diagnostics, erased output/referrer values,
rendered UI equivalence, implementation refinement, unbounded safety or
temporal progress. Source scenarios continue to see the complete state.

## Binding, controls and completion evidence

The existing helper adds one separately hardcoded ID/operator/expression/mode;
there is no arbitrary manifest-selected expression engine. The manifest pins
the concrete source, complete translated TLA, final VIEW TLA and official
Quint adapter. Temporal properties and changed bindings fail closed. The
original TLA body and official runner remain intact.

`publication-continuation-quotient.test.ts` binds the entire concrete file,
including helpers, domains, dispatcher, invariant and original scenarios.
Future diagnostic/referrer/outcome reads, aliases, cross-slot dependencies,
new invariant observations or slot reuse require renewed review. Generic
safety-view tests cover source/TLA/VIEW/adapter drift and preserve the complete
TLA body.

Native controls use the actual pinned TLC runner and exact VIEW on synthetic
two-state probes. They isolate every original false invariant observation,
including dynamically selected unused/done acceptance and false admission
classes, and distinguish representative live fields. Each control property
is its named observation alone; an unrelated invariant failure cannot satisfy
a reachability claim. These controls test fingerprint distinguishability,
not the manual successor theorem or application behavior.

Run the unchanged model's types, scenarios and seeded traces, then native
controls with pinned Node 24.15.0, Bun 1.3.14 and Java 21:

```sh
node scripts/check-formal.mjs --model=ui_project_publication_lifetime
SLOP_QUINT_TRANSLATOR_TEST=1 bun test scripts/publication-continuation-quotient.test.ts
bun test scripts/quint-safety-view.test.ts
```

The full finite graph is scheduled separately with the existing 1,800-second
allowance and `node scripts/check-formal.mjs --verify --model=ui_project_publication_lifetime`.
Until a frozen run completes with unchanged model/source/tools and zero queued
states, graph completion remains unverified. Retain this experiment's exact
commit, bindings, control output and complete graph receipt separately from
the earlier timeout. A timeout, cancellation or changed input is incomplete.

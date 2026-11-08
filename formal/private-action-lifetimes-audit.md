# Ordering private case action responses

This source-only pass starts at `6f5aee920874`. No tests, browser, typechecker,
formatter, simulation or prover were run. The defect below is established by
the source path; the correction and seven authored scenarios are unverified.
No held branch, generated registry, proof inventory or global status changed.

## Reachable response ordering

`useSecurityData` now fences a pending GET when an action replaces its value.
That does not order two different action results. `ActionForm` retains its
`onDone` closure while awaiting the POST, and that closure still calls
`CaseDetail.replace` after the form's revision-keyed instance is removed.

A case with a retained refresh error has an enabled Retry read alongside its
action forms. This gives a concrete path:

1. The detail displays revision 1. A retry GET and action A are in flight.
2. A commits revision 2; its response is delayed. The GET returns revision 2.
   Rendering that response remounts the forms with revision-2 inputs.
3. A valid next action B commits revision 3 and its response replaces the view.
4. A's delayed response still calls `onDone`. The former unconditional
   replacement installed revision 2 over revision 3.

The server's expected-revision comparison does not prevent this sequence:
each mutation used the revision current at its own commit. The defect is the
ordering of accepted client responses, not unauthorized server mutation.

## Correction

The hook retains the latest accepted value in a ref when a valid GET or
replacement is accepted, before its state update is rendered. It accepts an
optional replacement predicate. `CaseDetail` supplies a predicate that refuses
a lower case revision. Other hook consumers omit it and retain their prior
behavior.

The predicate runs against the accepted value synchronously. Comparing only
the last rendered state would miss two responses arriving before React paints.
The ref is not mutated inside a React state updater. A refused older response
returns before changing the read generation, so it cannot cancel a newer GET.
An accepted response retains the existing generation fence.

Equal revisions remain accepted. Chain observations and related projections
can change without a case revision, so the case revision alone cannot order
them. An old equal-revision projection can still replace a newer one; this is
an explicit limit, not a claim that every displayed field is monotonic.

The case key still creates a new detail instance for another selected case;
the enclosing private provider still handles actor changes and performs its
before/after identity checks. This change does not grant authority from a
revision number, alter API requests, cancel a server mutation, or replace the
fresh authorization checks before payment actions. Per-action completion
notes remain observations of those actions, not versioned authority.

## Model and adjacent review

`ui_private_case_revisions` bounds one case/actor, revisions 1–3, two action
requests, three reads, and two independent projection values. It distinguishes
accepted state from painted state, expected-revision mutation acceptance,
queued action responses and read generations. Named scenarios cover delayed
older action refusal, refusal before paint, keeping a newer GET active, old
GET success/error after an accepted action, stale mutation refusal, departure,
and the equal-revision projection limit. The existing parent-payment model
now explicitly treats its replacement action as an already accepted value.

The source pass also reviewed the new Inbox action ref, its explicit identity
reload, the private provider's current-session checks, and selected-case keys.
No additional source-confirmed change was made in those paths. Full browser
scheduling, provider responses, current-role decisions and implementation
refinement remain outside this unexecuted model pass.

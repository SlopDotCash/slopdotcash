# Ordering private case action responses

This source-only pass starts at `6f5aee920874`. No tests, browser, typechecker,
formatter, simulation or prover were run. The defects below are established by
the source paths; the corrections and twelve authored scenarios are unverified.
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

The first revision of this correction accepted equal case revisions. The
follow-up below replaces that policy with a fresh read, because a case
revision does not order all of its related projections.

The case key still creates a new detail instance for another selected case;
the enclosing private provider still handles actor changes and performs its
before/after identity checks. This change does not grant authority from a
revision number, alter API requests, cancel a server mutation, or replace the
fresh authorization checks before payment actions. Per-action completion
notes remain observations of those actions, not versioned authority.

## Model and adjacent review

`ui_private_case_revisions` bounds one case/actor, revisions 1–3, two action
requests, three reads, and two wallet projection values. It distinguishes
accepted state from painted state, expected-revision mutation acceptance,
queued action responses and read generations. Named scenarios cover delayed
older action refusal, refusal before paint, keeping a newer GET active, old
GET success/error after an accepted action, stale mutation refusal, departure,
same-revision wallet changes, joining an active read, retry after read failure,
explicit reload and cleanup. The existing parent-payment model
now explicitly treats its replacement action as an already accepted value.

The source pass also reviewed the new Inbox action ref, its explicit identity
reload, the private provider's current-session checks, and selected-case keys.
No additional source-confirmed change was made in those paths. Full browser
scheduling, provider responses, current-role decisions and implementation
refinement remain outside this unexecuted model pass.

## Equal-revision wallet and payment projections

`registerPaymentWallet` appends a successor claim through `insertWalletClaim`;
neither operation changes `security_cases.revision`.
`backend/security/direct-payments.ts` computes `CURRENT_RECIPIENT` from the
effective claim and authorization. `directView` uses that result for
`walletReviewRequired`, the held notice and the remaining owner request.
`caseView` then selects `nextStep` and the visible payment controls from those
fields.

This makes the following equal-revision sequence real: a prepare-payment or
other case-action response is captured while the old recipient is current;
the reporter registers a new wallet; a fresh case GET shows the held/recovery
view at the same case revision; the older action response then arrives. The
first revision guard allowed it to restore the obsolete send controls. The
send preflight still refused the obsolete request, so this was incorrect
presentation rather than a demonstrated signing-authority bypass.

Private vault payment projections have a separate source too. The security
payment worker uses `securityPaymentDatabase` to update the private obligation,
queue and attempt tables. `settlementView` reads those tables for held,
uncertain and paid status without changing the case revision. Paid ledger
evidence is distinct from a current wallet/queue/role projection. Direct-payment
receipt insertion, by contrast, is guarded by the case-action event in its
atomic action batch. None of these facts makes the whole case response an
immutable, monotonically ordered snapshot.

The current replacement rule is therefore: reject lower case revisions,
accept higher revisions, and retain the accepted projection while refreshing
an equal revision. A ref tracks only the latest active GET. An equal callback
joins that request instead of invalidating it; if none is current, it uses the
existing loader. Matching success/error, an accepted replacement and effect
cleanup clear the active-read ref. Old callbacks cannot clear a newer read.
Ordinary explicit Reload/Retry still starts a new generation. Non-case hook
consumers retain their existing behavior, and no ref is mutated inside a React
state updater.

The wallet model's first projection means the original recipient is current;
the second means a successor claim makes it held. A delayed equal action can
no longer restore the first projection in the model. The model also checks
that a current read is not restarted and that failure/cleanup release the
coalescing state. Its three-read cutoff excludes transitions requiring a
fourth read; it is not a claim about unbounded retries.

Fresh reads are still point-in-time observations. This change does not add
server timestamps, establish a globally atomic case/ledger snapshot, merge
fields using presumed monotonicity, or guarantee that an external wallet or
role cannot change after a read. Higher-revision response handling and current
action preflights keep their existing contracts. The new source and model
remain untested under the instruction to skip checks.

A source-review follow-up added a lifecycle guard to the loader and replacement
entry point. A departed equal-revision callback now returns without starting a
private GET. Effect setup marks the hook active before loading; cleanup marks
it inactive and keeps the generation/active-read invalidation. StrictMode's
second setup therefore starts its own read, while a first-setup reply remains
obsolete. Explicit Retry remains available while the hook is active. A named
departed-equal-response scenario records that no additional read starts; it
has not been executed.

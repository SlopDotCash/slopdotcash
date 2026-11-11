# Solana binding API safety VIEW

This isolated PRD section 12, STATE-05 experiment starts at
`212e225444073b60e023d97bc5d7ca272cd31517`. The repaired scenario initializer
qualifiers let `solana_binding_api` translate; the original finite graph then
exceeded 180 seconds with 3,683,833 distinct states and 2,039,426 queued. That
incomplete result is not a passing safety check.

`solana-binding-api-observation-safety-v1` changes TLC fingerprints only. The
concrete model, actions, domains, dispatcher, invariants, named scenarios and
runtime sources remain byte-identical. It adds no constraint, narrowed input,
retry, payment transition, signer power or activation. Its completed count, if
obtained, is a quotient count rather than the number of full model records.

## Dependency projection

Every global field remains exact except ledger row status. `selectable` tests
only whether a row differs from `unavailable`. Prepared, unknown and submitted
therefore normalize to prepared. Configure still accepts every original row
parameter and maps its write to the same availability class. CloseAttempt has
the same guard and writes unavailable. No other action or invariant reads an
exact row status. Scope, ordinary-query precedence, service profiles,
configuration, deployment availability, ownership, clock, current claim, audit
membership, audit timestamps and remote-effect membership remain exact.

Request `response` and `emptyId` are write-only and normalize to none/false.
No action or invariant reads them. A request's `desired` value is read only by
comparisons with `200` in the original invariant and by respond copying it to
the erased response output. It therefore keeps exactly the success/non-success
class. Ending and responseJson write that class deterministically. Distinct
error responses, receipt delivery and empty string ID output are not claims of
this VIEW; the unchanged named scenarios still inspect their complete values.

All other live request fields remain exact. This includes mode, captured audit
time, admission, scope, captured claim and attempt, owner/audited flags,
deployment context and context claim, dispatch snapshots, request-transaction
selection and reply flags. Context selection and service invocation remain
separate, and replacement of the global claim does not rewrite a selected
request. No cryptography, chain finality or implementation refinement is proved.

For unused, response and done phases, the VIEW instead records phase, **exact
`dispatched`**, and the separately computed truth of each original clause:

1. Request audited flag equals that ID's global audit membership.
2. An audited request has owner authority and its exact captured timestamp
   equals that ID's global committed audit timestamp.
3. Private scope implies owner authority and an audited request.
4. Dispatch implies admission, valid scope, matching scope/claim/attempt
   snapshots and the original mode-to-request-transaction relation.
5. A recorded remote effect implies dispatch.
6. Context implies prepare mode and the matching captured context claim.
7. A transaction reply implies prepare mode and desired success.
8. A context reply implies context and desired success.
9. Desired success implies dispatch.

The clauses are recomputed from raw concrete state before projection, including
exact global audits, auditStamps and effects. They remain separate Boolean
observations even when false. No implication is replaced by a trusted constant,
and no invariant truth is assumed. The four global domain/subset clauses stay
exact because now, claim, audits and effects stay exact.

## Same-parameter successor argument

For related states, each original action call has the same enabledness and
projected successor:

| Action group | Preserved dependency and successor |
| --- | --- |
| Configure, clock advance, claim replacement | All guards and inputs remain exact. The only collapsed write is the already equivalent ledger availability. These actions never modify captured request operands. |
| CloseAttempt | Reads availability only and writes the same unavailable class. |
| Begin | Requires the exact unused phase and configuration. It replaces the entire request with idle plus original mode, origin phase and exact current clock. Fresh local clause 1 is `not audit-membership`; clause 5 is `not effect-membership`; the other seven clauses become true. Both memberships remain exact even for dirty/false unused states. |
| Origin, session, expected actor, body, service gates and queries | Every live branch dependency remains exact. Error labels differ only inside the erased non-success/output class. A move to response computes all nine original truth values. |
| Owner query, commitAudit, auditReply and private query | Live owner/audit/captured-time fields and global audit structures are exact. Commit writes only its own ID's membership/timestamp, so another request's terminal audit observations do not change. |
| Context gate/reply, selected service and dispatch | Mode, service/deployment predicates and captured scope/claim/attempt/context remain exact. Dispatch preserves the original transaction predicate and snapshots. |
| FetchReply and responseJson | All live predicates remain exact; accepted response classes set the same success observation and original reply flags. Rejected classes set non-success. EmptyId is write-only. |
| Respond | Only response phase is enabled. It changes that phase to done and copies desired into erased response; all nine observations and dispatched remain unchanged. |
| ServiceEffect | May remain enabled in unused/response/done. Exact dispatched and exact effect membership preserve its guard. An enabled addition makes clause 5 true while carrying the other eight observations. If clause 5 is false, membership is already true and dispatched false; this action is disabled and the false bit remains false. |
| Explicit stutter | The observation is unchanged. |

Every request-local action other than respond and serviceEffect excludes
response/done. There is no done-slot reuse. An unused slot can only begin,
fully replacing its payload, or receive a hypothetical dispatched remote effect
under the retained guard. Same-ID audit/timestamp writes require audit-write
and cannot occur in these terminal phases. Other IDs update only their own
membership or timestamp. Thus future global changes cannot consume an erased
terminal payload or heal a false audit/snapshot/context/reply clause silently.
An unused begin intentionally recomputes its new observations from exact global
sets rather than carrying stale terminal bits.

This is a manual quotient argument, not a mechanically checked successor
congruence theorem. Combined with the unchanged init, it supports finite model
safety exploration while preserving the original invariant counterexamples.
It proves no temporal progress, exact output values, SQL/cryptographic
conformance, unbounded safety or application refinement.

## Binding and evidence

The hardcoded helper/manifest entry pins the complete original model, concrete
translated TLA, actual loader-produced final VIEW TLA and official adapter.
Temporal properties, unknown definitions and changed source/TLA/expression
fail closed. The captured complete production TLA is passed through actual
bindSafetyView/applySafetyView before freezing, with its full 80-character
module terminator intact. The original translated body and official runner
are unchanged.

`solana-binding-api-quotient.test.ts` binds the complete concrete model,
including helpers, domains, dispatcher, invariant and named scenarios. New
exact ledger or output reads, terminal/reuse dependencies, cross-slot readers,
serviceEffect payload guards and new invariant observations require review.
Native tiny TLA fixtures run the exact reviewed VIEW through the pinned TLC
runner. Each has one named property alone, requires a noninitial two-state
counterexample, and rejects an initial-state failure. Controls cover the four
global clauses, all nine local clauses and their false/healing classes,
terminal effect enabledness, dirty unused resets, and live audit/selection/
context/dispatch fields. They test observation distinguishability and adapter
behavior, not the manual successor theorem or application behavior.

Run the unchanged concrete checks and focused controls with Node 24.15.0,
Bun 1.3.14 and Java 21:

```sh
node scripts/check-formal.mjs --model=solana_binding_api
SLOP_QUINT_TRANSLATOR_TEST=1 bun test scripts/solana-binding-api-quotient.test.ts
bun test scripts/quint-safety-view.test.ts
```

The original 180-second quotient attempt also remained incomplete. The
explicit model-only verifier allowance is now 600 seconds; the model, VIEW,
scenario set and 90-second ordinary sampling limit are unchanged. Completion requires unchanged model, mapped sources and tools plus
an empty queue. Keep timeout, canceled, source-drift and pre-graph failures as
incomplete receipts. No sampling result or native fixture substitutes for a
completed frozen graph; the larger allowance alone is not a passing result.

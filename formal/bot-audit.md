# Slopbot source and publication state review

Scope is the current `origin/development` worktree. PRD sections 5 and 7 govern
these flows. The models below complement the existing review lease, source
lease, value-request, budget, moderation and appeal models. An `@source` link
means a reviewed state abstraction; it does not prove implementation refinement
for every statement in that file.

| Model | Reviewed entry points and transitions | Finite boundary |
| --- | --- | --- |
| `bot_value_journal` | `prepareValueRecord`, `appendValueRecord`, same-assessment replay, root/successor SQL guards and no-replace trigger | One source, three revisions/keys; digest equality is abstract |
| `bot_joint_journal` | `prepareWorkUnitRecord`, `appendWorkUnitRecord`, current group lookup, atomic derived indexes and predecessor conservation | Two sources, three revisions; one owner per source and whole-group replacement |
| `bot_value_freshness` | `consumeValueRequest`, `verifyCurrentValueSource`, both publishers, merge-recipe reuse and live registry gates | Three source generations; head and discussion changes differ; GitHub observation is not a lock |
| `bot_value_history` | `readValueDecisionFromHistory`, `readWorkUnitHistory`, `consumeWorkUnitHistory` | Three pages; pinned through-sequence/total, exact-byte and lineage validity abstracted |
| `bot_evidence_integrity` | `collectValueEvidence`, context collection, file/tree readers, binary and full-file comparison recovery | Three items/two blob reads; hash validity and complete tree are explicit predicates |
| `bot_work_partition` | `prepareWorkUnitEvidence`, `validateWorkUnitAssessment`, `validateValueAssessment` | Two claims and two required reviews; exact partition and no self-review credit |
| `bot_retained_acceptance` | Indirect branch observations, retained-copy/reference collection, branch policy, no-change promotion original-source check | Two imported commits; hint, ancestry, byte retention and original ownership are separate |
| `bot_patch_replay` | Added/removed patch recovery, accepted-range and shifted squash replay, exact manifest comparison | Two integer line tokens; complete unambiguous original-parent replay, not a parser proof |
| `bot_installation_lifecycle` | Installation webhook handling and `completeInstallationDelivery` atomic batch | Three timestamps/four deliveries; stale events lose, removal wins ties, permissions upsert preserves suspension |
| `bot_webhook_delivery` | Signed body decoding, durable webhook receipt, `recordValueRequest`, reopen-source retention, enqueue/checkpoint | One delivery/two queue sends; lost response may redeliver, value request identity cannot change |
| `bot_producer_provenance` | Structured route, `assessValue`, producer identity, prompt evidence projection and exact model identity | Two provider attempts; admission before fallback; subscription declaration cannot create API receipt |
| `bot_historical_import` | Private `publishSubscription` RPC, `importSubscriptionAssessment`, fixed/configured cutoff and optional merge reconstruction | One import; every source must be historical; deployed producer and source binding required |
| `bot_accepted_census` | `collectAcceptedCommitCensus`, recursive search partition and `collectValueGroup` discovery | Three immutable source IDs; unique/disjoint partitions conserve count, moving count stays incomplete |
| `bot_value_dispute_binding` | Current single/joint dispute selection, retained dispute read, actor identity checks | Three retained revisions; later correction never retargets an opened dispute |
| `bot_review_admission` | `route`, config/closure contracts | Eligibility boolean classes; a reopened, draft, closed or bot item cannot enter review; security scope cannot close |
| `bot_notice_delivery` | Failure/spend notice claim, `deliverNotice`, receipt append | Three scaled milestones; one send per claim, accepted versus ambiguous retained |
| `bot_budget_resume` | `recordBudgetBlock`, active block, `resumeBudgetBlocks` | Two claims/two sends; due time, live claim, active installation; queue precedes checkpoint |
| `bot_repository_access` | Live installation lookup, permission read, internal access/read routing and GitHub client | Immutable repository and actor match; missing/suspended/unavailable do not grant authority |
| `bot_quality_receipt` | `verifyQualityReceipt`, `loadQualityEvidence` | Two ticks; signature, source/policy, isolation, predicate, expiry and independently qualified profile |

`api_reporting_readiness` also maps the scheduled/private reporting refresher.
`api_points_disputes` maps Points triage/escalation orchestration. Their existing
finite abstractions remain limited: they do not prove every lease interleaving
or all structured model outputs. `bot-stateless.json` contains only the entry
module that re-exports these implementations. Worker deployment configuration
is not stateless and remains an operational review boundary.

## Demonstrated correction

`collectValueContext` previously copied GitHub's claimed blob SHA next to the
received text without hashing the bytes. A same-length changed body could be
accepted with the original SHA, and repeating the response let the real
`verifyCurrentValueSource` accept it as unchanged. The new
`value-context-integrity.test.ts` reproduces this through a local HTTP Git
fixture. Before the correction, the expected publication rejection resolved
successfully. The collector now uses the existing `valueFileReader`, which
checks the Git blob hash, size, per-file limit and shared byte budget. This
removes duplicate decoding/limit code and keeps valid context behavior.

This test contains synthetic Git evidence only. It does not contain a model
verdict, make a provider call, qualify model quality, or claim live-GitHub
availability. The valid and corrupted publication cases both pass after the
change. Four existing source/group/census/live-registry suites also pass:
37 tests, 191 assertions in the combined targeted run.

## Limits that remain material

- Digest, signature, Git ancestry, repository/actor identity, exact schemas,
  path parsers, line tokens and timestamps are finite equivalence classes.
  Real byte algorithms remain covered by source tests, not by these models.
- Single and joint journals have database constraints and triggers. The model
  preserves their observed first-writer and immutable predecessor semantics;
  it is not an automated SQL-to-Quint translation.
- Publication checks external GitHub state at specific observations. The model
  explicitly permits that state to change after the final observation. It does
  not promise a transaction across GitHub, the registry and D1. Installation
  liveness and the captured registry revision, manifest digest, restriction
  generation and source repository mappings are checked in the journal
  insertion SQL. External GitHub source checks remain separate observations.
- The history reader checks exact bytes and complete predecessor pages. A
  finite page model does not prove performance or success for arbitrary
  history size. Server/consumer batch and discovery limits can yield a
  recoverable incomplete state; they never prove absence or assign zero.
- `bot_retained_acceptance` covers authority gates shared by several distinct
  proofs. It does not treat a closure comment as acceptance or a verified tree
  as semantic value. The real copy algorithm retains original actors and
  verifies ordered edits, ancestry, and exact accepted text where required.
- Queue delivery is at least once. A successful send with a lost response may
  duplicate dispatch. Downstream immutable requests and current review/source
  leases remain essential. An ambiguous notification stays claimed and needs
  operator reconciliation; this review does not invent an automatic resend.
- Actual model quality, private merge-verifier deployment, service-binding
  isolation and production closure qualification are separate runtime and
  operational evidence. No provider, account, signing, deployment or
  production activation was performed for this state review.

## Additional API and historical-state checks

`api_request_composition` covers request-local actor/configuration isolation,
including the admin-only historical import wrapper. A malformed
`PAYMENT_RPC_URLS` value previously threw before the Pages dispatcher could
reach account reads or signout. The resolver now parses that configuration
only when a payment operation asks for it. The real `onRequest` plus migrated
SQLite regression shows account read and signout succeed and unavailable
funding still fails closed (3 tests, 8 assertions). The local Solana loopback
restriction remains at the payment configuration boundary.

`api_advisory_census` models complete private GitHub report enumeration versus
unavailable reads. `api_public_summary` models distinct-item read projection
and unavailable storage; no failed read becomes an empty success.
`api_incomplete_assessments` models the durable source gap through running,
waiting and attempt exhaustion, with completion removing that PR's old gap.
Current recipient authority and identity must still be checked for each read.

`bot_provider_cost_history` separates historical unknown provider cost, retained
estimates and billing versions. Migrations 0039, 0041, 0043 and 0047 retain old
rows and add null request/cost identity or call-v1/default billing fields; they
never infer actual billing evidence. `bot_inference_retention` maps migrations
0054/0104: a valid inference is retained only after usage recording and can
then be reused without another provider call. Reservation/admission and
at-most-three paid attempt rules remain complementary in the budget/request
models. Migrations 0097/0098 widen historical outcomes and add queue lookup
indexes; 0064/0091 retain penalty reversals, appeals and publication claims.
0040 adds quality-shadow records without penalty authority. 0085 queues only
new failed provider calls. 0079 widens notices without replaying old mail.

`formal/tests/bot-migrations.test.ts` preserves populated provider rows across
those additive cost upgrades, verifies immutable fields/REPLACE refusal, and
proves no historical failure-notice backlog is created. It also exercises
0115's selective source-gap backfill and the real claim/complete operations.
Together with the earlier API migration tests (now including the 0079 notice
rebuild), this targeted run passes 8 tests and 96 assertions.


## Publication transaction interleaving review

`bot_publication_transaction` adds the previously unmodeled gap between the
last authority read and the journal INSERT. Both single-source and joint
publishers could append a new assessment after a project pause or quarantine
committed during that gap. Their SQL checked only installation liveness.
The real publishers and migrated SQLite reproduced all four pause/quarantine
cases before the correction: each unexpectedly succeeded. The new shared
`value-publication-fence.ts` captures the registry revision, exact manifest
digest and restriction generation before the source checks, then tests those
values and every required repository mapping inside the INSERT. A concurrent
registry change now prevents the write. Immutable existing records remain
readable as replays; a pause does not erase history.

`workers/slopbot/value-publication-fence.test.ts` covers both publishers with
normal controls, a new paused revision, an append-only quarantine decision and
removal of their source mapping immediately before insertion. All eight cases
pass. The full Slopbot suite also passed: 336 tests, 1,908 assertions.
Its inputs are valid unresolved declarations; it makes no provider call,
model-quality claim, signing or payment. Together with the existing history
and live-registry tests, 31 tests and 277 assertions passed. The finite model
uses two competing publishers, two required mappings, two revisions and one
restriction generation change. Five named scenarios and 1,000 40-step sampled
traces passed. It abstracts the exact digest/identity checks, not GitHub's
future state or all SQL-to-model refinement.

## Remaining composition obligations

File mapping does not close these remaining proof obligations:

- `bot_value_pipeline` and its generated real-consumer traces now compose
  the two-PR shared-claim retry, retention and publication graph below.
  Arbitrary source-group size, changed-source generations, indirect-copy
  recipes and every provider/budget failure permutation remain bounded
  by separate models and tests, rather than one universal refinement.
- Webhook ordering, installation suspension, source edits and external GitHub
  visibility changes are finite scheduler abstractions. No atomic transaction
  spans GitHub, queue delivery, R2 and D1.
- Corrective journal chains and paginated historical import have bounded
  examples; arbitrary chain length, multi-project aliases and all partition
  overlaps are not exhaustively proved.
- Ambiguous external comment/label/email outcomes need operator or downstream
  reconciliation. The models do not turn a lost acknowledgment into proof
  that the external effect did not occur.


## Composed value pipeline and stale-consumer correction

`bot_value_pipeline` composes complete two-PR collection, deduplicated shared
claim partition, all-or-none source ownership, processing lease expiry, paid
inference usage, immutable retained-result selection, reuse, publication and
request settlement. This exposed a separate defect after the registry fence:
`consumeValueRequest` checked its processing/source ownership before calling
the publisher, but publication then awaited fresh GitHub/source reads. An
expired worker still inserted a journal record; only its later processing
completion failed. The reproduction used the actual consumer, complete local
Git evidence for both PRs, the actual work-unit validator, a local HTTP
Anthropic transport, and migrated SQLite. Before the correction the expired
consumer left one journal record where zero were expected.

API publishers now require their trusted processing claim. The final INSERT
checks both the live claim token and every source lease in the same SQL
statement as the registry/installation fence. Lease expiry uses SQLite's UTC
clock at statement execution, not a timestamp captured when JavaScript binds
the statement. A separate delayed-statement regression proves a lease can be
valid at bind time and refuse after it expires while queued. Subscription imports retain
their explicitly validated independent publication path. The inference
receipt is not discarded when a lease expires: the next owner reuses it, then
publishes and settles its request. No source text, prompt or raw provider
response is added to durable storage by this correction.

`workers/slopbot/value-pipeline.test.ts` generates seeded Quint traces
and drives them through the real consumer and SQLite boundaries:

- Expiry after inference retention and immediately before journal insertion.
- Expiry while the provider response returns, before usage/retention commit.
- An overlapping sibling consumer while the first provider call is in flight.
- A prepared and bound publication delayed until after real SQLite-clock expiry.

Each reaches one inference attempt, reservation and cost row, one shared
claim, one joint journal record covering both PRs, and two completed request
rows. The sibling performs no additional inference. The first three cases passed 61 assertions; the fourth adds an independent
bind/execute clock boundary. The broader Slopbot suite passed 338 tests and 1,945
assertions before the third overlap scenario was added; the later focused
run includes all three scenarios. Six named model scenarios and 1,000 sampled
50-step traces passed; combined TLC validation is run by the root task.

The model bounds one immutable source key, two PR carriers, one shared claim,
two request owners, two generations of the first owner and three successful
primary provider attempts. It preserves the first retained result identity.
It does not establish model quality, live-provider billing, unlimited group
size, absence of GitHub changes after observation, or a transaction across
remote services. The injected provider verdict is an explicit unresolved
transport fixture, not evidence of an actual assessment.

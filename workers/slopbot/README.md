# Slopbot worker

Hosted Slopbot GitHub App service under `protocol/slopbot-v2.md` (approved
9 October 2026; PRD BOT-08 to BOT-13). It is not deployed yet, and closing is
disabled by `SLOPBOT_CLOSURE_ENABLED = "false"`.

## Flow

1. `POST /github/webhook` verifies `X-Hub-Signature-256`, records the delivery
   ID once, updates installation state, and enqueues identifiers only.
2. Intake and the queue consumer check the live D1 project registry.
   `registry.ts` uses the existing project repository index, validates the
   current manifest and immutable repository ID, and checks current enforcement
   records. It derives capabilities with the shared evaluator in
   `src/lib/project-capabilities.mjs`. An active, listed, unrestricted project
   gets the full contributor review. A registered project that is paused,
   flagged, quarantined or banned gets a security-only review: only a
   `scam` finding is labeled and commented, nothing is closed, and no value
   assessment runs (PRD section 5, owner decision D12). A retired project gets
   no review. Unregistered repositories and replaced
   repository IDs skip; database errors retry. Registry checks repeat for the
   same scope before inference and GitHub writes. The queue consumer
   then gets an installation token and re-reads the
   repository, the item, `.github/slopbot.json`, and `AGENTS.md`,
   `CONTRIBUTING.md` and `README.md` from the default branch at its current
   SHA.
3. `routing.ts` applies the published precedence: installation, private
   repository, type switch, open/draft, bot author, human reopen, exemption,
   audience, author cap, budget. Advisory review stays broad; closure needs the
   separate eligibility check below.
4. Deterministic pre-filters (empty, same-author duplicate) run without a model.
5. `models.ts` runs triage: Surplus `claude-opus-5.5`, then Surplus
   `gpt-6.1-sol` as fallback (owner decision, 9 October 2026). Every call is written to
   `slopbot_costs` with its internal provider cost and a zero billed amount.
6. A close needs all of the following:
   - closure eligibility (`closure-eligibility.ts`, owner decision D6): a pull
     request whose author is not a maintainer, is a slop.cash member matched by
     immutable GitHub ID, and has a `trace_runs` row created by their own
     authenticated Slop session for this project and repository, with a
     `pull_request_opened` event that names this exact pull request node ID.
     A URL alone, a copied marker or a receipt does not match. Advisory review
     stays available for everyone else. Issues are never closed.
     The check runs at routing and again, from fresh state, immediately before
     the close;
   - the category set to `close`, and a category that the penalty table does
     not make label-only (`out_of_scope` never closes);
   - verified evidence;
   - for guidance categories, a rule quoted verbatim from the named file;
   - confidence ≥ 0.9;
   - closure enabled globally and by the repository;
   - the shadow period over;
   - no circuit breaker and no daily cap hit;
   - a confirming second verdict (Surplus, falling back to GPT-6.1 Sol);
   - an unchanged item just before acting.

   Otherwise the bot only comments and labels.
7. An uncertain finding goes to the maintainer first (PRD section 5). A
   finding is uncertain when its confidence is below 0.9, its cited rules or
   evidence fail the verbatim check, or the second review does not confirm.
   The bot comments, adds no label, and records a hold in
   `slopbot_maintainer_holds` (`maintainer-holds.ts`). The 5-minute schedule
   queues each hold after 7 days. If no maintainer commented, reviewed,
   labeled, assigned or changed the item in that time, the bot adds the
   `slopbot:uncertain` label only (owner decision D8); the verdict stays in the
   review comment. An uncertain finding never closes an item. A closed,
   merged or changed item, or a paused, flagged or quarantined project, ends
   the hold without a label. On such a restricted project Slopbot comments and
   adds the scam label only (owner decision D12), so an uncertain finding
   there stays a comment and records no hold. Unknown maintainer status
   retries the hold.
8. A confirmed close of a closure-eligible author records one debit from the
   published penalty table (`penalties.ts`, owner decision D7) in
   `slopbot_penalties`. The row is written once per pull request and reverses
   once, on an upheld appeal or a maintainer reopen. A `scam` close also adds
   the `slopbot: moderator` label for a moderator review of the account.
   Maintainers and authors without the closure evidence are never penalized.
   The read-only `GET /v1/penalties?project=ID&after=NODE_ID` returns the
   project's unreversed debits (item node ID, author ID, category, table
   version, thirds, period) in pages of 100; no review key, verdict or source
   text. `scripts/generate-leaderboard.ts` reads it for each project with a
   closed, unmerged pull request in its census and binds each debit to that
   pull request: GitHub supplies the author and the closure month. The
   published score subtracts the debit once from that author's score for the
   same project and UTC month, never below zero (`src/lib/score-penalties.ts`).
   A reversed debit is absent from the feed, so the next snapshot restores the
   score. Closed reward cycles bind their own snapshot bytes, so a debit never
   changes an approved, scheduled or paid award. A feed outage keeps the last
   published snapshot, as for the value feed.
9. `/slopbot appeal` from the author, or any reopen, blocks re-closing that
   revision. An author's appeal opens Slopbot triage (`appeals.ts`, owner
   decision D8): an independent higher-effort review of the same revision,
   with the appeal text as untrusted data, drafts `uphold` or `deny` with a
   confidence. The draft is posted on the item. The appellant or a maintainer
   answers with `/slopbot accept` or `/slopbot reject`. An accepted `uphold`
   reopens an item that Slopbot closed, removes the finding label and
   reverses the penalty. The appeal escalates to a moderator, with the
   `slopbot: moderator` label, when the draft is rejected, the finding is
   `scam`, the debit at stake is 24 thirds or more, the draft confidence is
   below 0.9, or the appeal is unresolved 7 days after it opened. A moderator
   in `PROJECT_MODERATOR_GITHUB_IDS` decides an escalated appeal with
   `/slopbot uphold` or `/slopbot deny`, never their own. Unset, no moderator
   decision is possible. A maintainer reopen always wins.

## Repository policy file

`.github/slopbot.json` on the default branch:

```json
{
  "version": 1,
  "audience": "protection",
  "issues": true,
  "pullRequests": true,
  "closure": false,
  "categories": { "out_of_scope": "label", "spam": "close" }
}
```

A missing or invalid file means label-only review.

## Budget-block recovery

A structured provider budget rejection writes an immutable block in
`slopbot_budget_blocks`. The same database operation ends the claimed attempt
with the explicit reason `blocked: provider budget exhausted`. The queue
acknowledges that durable state, so a monthly reset does not exhaust its short
failure-retry allowance. Early redeliveries do not call a model.

The five-minute scheduled handler sends due jobs for active installations,
then records each dispatch. A failed or uncertain queue send leaves recoverable
work. Duplicate sends remain subject to the existing revision check and review
lease. Recovery re-reads GitHub and policy before it can infer or act; it is
unbilled under the service-retry rule. The public summary reports
`itemsBlocked` separately from completed reviews.

Apply migration `0048_slopbot_budget_blocks.sql` before the worker and summary
API. This recovery mechanism does not set provider limits, reserve prepaid
credit, or make an estimated token price a hard spending cap.

## Free reviews and provider cost records

The canonical PRD section 5 makes Slopbot free on registered repositories.
Review eligibility does not depend on project credits or a vault balance.
New triage, confirmation, and value-assessment calls record provider usage and
cost but zero billed amount and zero billable cost, including successful calls
and retries of older reviews. Existing `call-v1` and `review-v2` charges remain
unchanged. The existing `review-v2` row format permits these zero-charge rows;
no historical invoice or migration is rewritten.

Provider spending-limit rejections still stop the model route without a Sol
fallback. The queue retains its retry time. Internal budgets, queue limits,
and the $500 operational alerts remain separate from customer billing.
No project vault service charge is required or authorized for free Slopbot.

Slopbot has no customer statement, invoice, credit balance, fee offset or
markup. The former installation invoice route and the public summary's billed
total are removed. The `slopbot_credits` table and historical `billed_micro_usdc`
values stay in D1, unchanged, as historical records only. When provider
budget runs out, an item waits in the queue and resumes; nothing asks a
project to fund Slopbot.

## Setup checklist (owner)

Do these in order. Each step names who does it and how to verify it.

1. **Use the registered App** (an org owner of SlopDotCash):
   [slopdotcash](https://github.com/apps/slopdotcash), App ID `5257625`.
   Do not create a second App or use the unrelated `slopcash` App.
   - Homepage: `https://slop.cash`.
   - Webhook: active. URL: `https://<worker host>/github/webhook`. Set this
     after step 6; until then, leave the webhook inactive.
   - Webhook secret: generate with `openssl rand -hex 32` and keep it for
     step 4.
   - Permissions: Contents read, Metadata read, Organization members read,
     Issues write, Pull requests write. No others.
   - Events: Installation, Issues, Issue comment, Pull request, Pull request
     review, Pull request review comment. The two review events queue a fresh
     value assessment when a review changes. Without them, the Worker does not
     receive those changes.
   - "Where can this App be installed": Any account.
   - Verify: the App page shows exactly these permissions.
2. **Get the App identity:**
   - Record the App ID shown on the App page.
   - Get the bot user ID from `https://api.github.com/users/slopdotcash%5Bbot%5D`
     (the `id` field).
3. **Create the key:** on the App page, click "Generate a private key". Then
   convert it:
   `openssl pkcs8 -topk8 -nocrypt -in slopbot.private-key.pem -out slopbot.pkcs8.pem`.
   Delete both files after step 4.
4. **Add the Cloudflare secrets** (account owner), using
   `bunx wrangler secret put <NAME> --config workers/slopbot/wrangler.toml`
   for each of:
   - `SLOPBOT_WEBHOOK_SECRET`
   - `SLOPBOT_APP_ID`
   - `SLOPBOT_APP_USER_ID`
   - `SLOPBOT_APP_PRIVATE_KEY` (the PKCS#8 PEM)
   - `SURPLUS_API_KEY`

   Both models use the same Surplus key. The default Anthropic-compatible
   base URL is `https://api.surplusintelligence.ai/anthropic`. Optionally set
   `SURPLUS_BASE_URL` for another verified Surplus Anthropic endpoint.
5. **Create the queues in the production Cloudflare account** (the account
   in the `CLOUDFLARE_ACCOUNT_ID` environment secret, which also holds
   `slop-private` and the `eliza-computer` Pages project):
   `bunx wrangler queues create slopbot-jobs` and
   `bunx wrangler queues create slopbot-jobs-dlq`. A personal Cloudflare
   login is a different account; check with `bunx wrangler whoami` and
   `bunx wrangler d1 list` (it must list `slop-private`) first.
6. **One-time bootstrap (owner, after claiming the deploy lever):**
   1. In Cloudflare → Workers, create a Worker named `slop-slopbot` from the
      "Hello World" template. Do not deploy from a local tree.
   2. Add the custom domain `slopbot.slop.cash` to that Worker.
   3. Add the step 4 secrets.
   4. Attach the queue consumer:
      `bunx wrangler queues consumer add slopbot-jobs slop-slopbot --batch-size 5 --message-retries 5 --dead-letter-queue slopbot-jobs-dlq`.
   5. In GitHub → repository Settings → Variables, set `SLOPBOT_RELEASE` to
      `enabled`.
   6. `wrangler.toml` sets `PROJECT_MODERATOR_GITHUB_IDS` to the approved
      moderators' immutable GitHub IDs: lalalune (18633264) and drew-dot-com
      (202660855), PRD section 11. A change to this list needs an owner
      decision and a reviewed pull request.

   The next protected release runs these steps:
   - checks the secret inventory;
   - uploads and promotes the version bound to the release SHA;
   - applies the checked-in five-minute schedule and queue triggers;
   - probes `https://slopbot.slop.cash/health`.

   Then set the App webhook URL to `https://slopbot.slop.cash/github/webhook`
   and activate it.
7. **Verify live:**
   - `GET /health` returns `{"service":"slopbot","ok":true}`.
   - The App's "Advanced" tab shows `202` for the ping delivery.
8. **Verify free review:** use a registered repository with no project credits.
   Confirm that an eligible review runs, records provider costs, and adds zero
   customer charges. Verify that unregistered repositories remain blocked.
9. **Observe the shadow period:** review the labels and comments for at least
   14 days and 50 items, with `SLOPBOT_CLOSURE_ENABLED` still `"false"`.
   Enabling closure later is a separate reviewed PR that sets the variable
   and records the agreement data.

## App permissions and events

- **Read:** Contents, Metadata, Organization members.
- **Write:** Issues, Pull requests.
- **Events:** `installation`, `issues`, `issue_comment`, `pull_request`,
  `pull_request_review`, `pull_request_review_comment`.

After the protected release, verify delivery of a submitted review and a new
inline review comment on a registered repository. Each delivery must create a
pending record in `slopbot_value_requests`. Redelivery must not create another
record. A pending record proves intake only; verify the resulting assessment
and publication separately. An unregistered repository must create no record.

Escalated appeals also create a moderator Inbox notice. Repeated events use
one notice key. The action and email dispatcher recheck moderator access and
appeal status; a resolved appeal no longer asks for a decision. Verify actual
provider delivery separately from local queue acceptance.

## Not yet implemented

- Maintainer dashboard and Automation row (LDR-04).

## Value assessment work in progress

The owner approved automatic **provisional** value scores under PRD SCR-06.
Payout approval stays human. See
[`slop-value-scoring-plan.md`](../../docs/slop-value-scoring-plan.md) for the
separate delivery checklist. This does not activate the closure switch.

`value-evidence.ts` collects paginated submitted changes, reported merge changes,
commit identities and discussion evidence. It reports missing patches, source
drift, API file limits and merge ancestry that needs joint review. A matching
squash diff can establish the accepted range; the final commit of a rebase or a
branch-sync diff cannot establish that range on its own. A read-only local
collection uses:

```bash
bun scripts/collect-value-evidence.ts OWNER/REPOSITORY PR_NUMBER /private/output
```

For merge-resolution scope, add `--local-git /absolute/repository`. The checkout
must contain the collected merge commits and both parents. Collection reads
objects without checking out or running repository code. It reconstructs each
two-parent merge in an isolated bare repository with no global configuration,
hooks or configured merge drivers. Only the difference between that automatic
tree and the recorded tree becomes resolution scope. A clean branch sync adds
no claims. The record binds the Git version, parents, trees and patch digest.
If Git automatically moves a file added on the other parent, collection also
records its original path and ancestor commits. The blob and file mode must
match in the source parent, automatic tree, resolved tree and accepted head.
The claim binder retains the original commit/path identity and covers the new
path without creating a second claim for the move. Changed content cannot use
this byte-identical relocation evidence.
Missing objects or a failed reconstruction stop collection. Octopus merges are
not reconstructed. Reconstruction depends on the Git merge algorithm: review
the resulting diff before valuation; it does not itself prove useful work.

The hosted collector does not run Git. For a source with no two-parent merges,
publication can reproduce the local collector's empty resolution array so that
an unchanged source keeps its original digest. Nonempty resolution evidence is
never copied from the submitted assessment into the fresh source.

Historical resolution evidence must
remain source-bound and pass the joint record's freshness and publication gates.
Do not strip limitations or substitute a full first-parent merge diff to make
an assessment pass.

Raw evidence stays outside the repository. `value-review.ts` shares the strict
value rubric with the hosted model route. It does not publish scores or approve
awards. Source-bound publication, ingestion and complete historical calibration
must pass before this route can be activated. The September/October review uses
the owner's existing ChatGPT subscription; it does not authorize paid API calls.
A hosted service still requires its own supported runtime credentials.

Local evidence checks used real GitHub sources: Eliza #34772 has matching full
submitted and squash diffs; Delta Star #218 correctly requires ancestry review;
Delta Star #215 reports an omitted original-file patch instead of claiming full
coverage. These checks do not prove model execution or score publication.

Installation was verified on 10 October 2026: the owner installed the registered
App on elizaOS (installation `169856061`) with all repositories selected. This
proves App access, not worker deployment, model connectivity or score delivery.

## Runtime verification (10 October 2026)

The owner-supplied Surplus key passed live structured calls for
`claude-opus-5.5` and `gpt-6.1-sol` through the Anthropic endpoint above.
An unavailable primary model also exercised the live Sol fallback. These
checks used the same `runStructuredRoute` function as the worker. The endpoint
reports the served model; that report is not independent model attestation.

The marketplace response did not follow the requested schema when it was
provided only in `output_config`. The route now includes the exact schema in
the trusted prompt and still rejects every response that fails local validation.
Provider error bodies are not persisted. A model identity mismatch also fails.

A fresh read of Eliza #34772 resolved co-authors through GitHub's pinned commit
mapping, collected complete diff and discussion evidence, and produced a valid
Opus value assessment covering all three formal reviews. Email addresses used
to join co-author identities are omitted from the evidence export. This was a
local, read-only runtime test. A first schema-valid result double-credited the
same review finding. The rubric now requires explicit `duplicateOf` references
to earlier review identities; a duplicate cannot receive positive credit. A
subsequent live result identified the repeated finding correctly. Validation of
superseded heads still needs evidence of distinct retained value. Schema validity
alone is not semantic calibration. The test did not publish a score, run the hosted queue,
activate billing, or approve a payout. Hosted delivery and historical calibration
remain on the value-scoring acceptance checklist.


## Provisional assessment journal

`value-journal.ts` prepares source-bound records for the append-only D1 table
in migration `0014`. It revalidates the assessment against its exact evidence,
policy digest and configured served-model identity. The record contains the
safe rationale and source links, not patches, raw responses or prompts.

An exact source/rubric/producer retry returns the first canonical record.
A successor must name its predecessor and explain the change. The database
rejects competing successors, predecessors from another PR, edits and deletes.
The exact stored JSON bytes define the record digest. Consumers must retain
those bytes when they verify a record.

A local integration check applied the checked-in migration to real SQLite and
used the two real Eliza runtime assessments. It verified replay, digest/key
integrity, successor readback, retained history, and rejection of cross-PR
predecessors and competing successors. This is storage evidence only. No
production migration was applied. `value-publication.ts` checks the active
installation, its token-scoped repository membership, the exact repository IDs,
and freshly collected complete source and pinned policy. The insert also checks
installation state to reject a suspension/removal that arrives during the read.
The live source recheck matched Eliza #34772. Hosted App authentication remains
untested while credentials are pending.

The read-only `GET /v1/value-assessments?repository=OWNER/REPO&pull=NUMBER`
route returns ordered record strings and their digests. It accepts an `after`
sequence cursor, returns up to 100 records, and supplies `nextAfter` when another
page exists. Invalid queries return 400. A storage failure returns 503, never a
successful empty history. This route shows recorded history; it does not assert
that a record still matches GitHub or overrides a human decision.

A local Cloudflare Worker with local D1 passed HTTP readback using the checked-in
migrations and seeded real Eliza assessments. All returned record digests matched
the exact bytes; cursor reads, valid empty history and invalid-query responses
also passed. This does not prove hosted authentication, queue delivery or a
production write.

Queue scheduling, inference budget accounting, score/Points ingestion and human
precedence remain required before activation. No hosted queue has published a
record. Only the internal publisher may establish authority for a write; the
public reader cannot submit or alter assessments.


## Current value decisions

`readValueDecision` reads the complete journal for one registered source. It
checks exact byte digests, sequence order, immutable repository and pull-request
identity, and the predecessor chain before selecting the latest record. It
compares that record with the supplied complete source and pinned policy, then
validates the assessment and model identity. Its states are `missing`,
`incomplete`, `stale`, `unresolved`, and `assessed`. The first four do not supply
a numeric score. A caller must apply valid human ratifications before using a
provisional assessment. The database connection is the authority boundary;
matching a digest from an arbitrary host does not establish authority.

Publication uses this reader and requires a new result to name the current
predecessor. An exact assessment-key replay retains the original record. SQLite
still rejects concurrent forks after the read. Local integration checked real
Eliza evidence, 104 paginated revisions, changed source, incomplete evidence,
missing records, unresolved value and corrupted bytes. The leaderboard and
Points ingestion still require hosted activation; these checks do not change public
scores or prove a hosted publication.

## Provider request receipts

The Anthropic SDK response headers carry Surplus transport evidence. The route
retains `x-si-buyer-cost-micro` as a nullable integer in a separate immutable
`provider_cost_micro_usd` column (migration `0015`). Missing, fractional or
unsafe values remain unknown. This is a provider report, not a finalized invoice;
it does not replace the versioned price, change billing, or mark reconciliation
complete. Migration `0019` also retains the transport `x-request-id` in the
private immutable `provider_request_id` column. The model response body's ID
is a different identity. Only bounded ASCII identifiers are accepted; missing
or invalid IDs stay null, including all earlier rows. Neither header is exposed
by the public assessment reader.

`x-si-truncated: 1` rejects the response even if its JSON and stop reason appear
complete. SDK retries are disabled so each explicit route attempt has one cost
record. Failure responses retain a valid cost header without recording provider
error bodies. See the official [Surplus routing controls](https://www.surplusintelligence.ai/docs/marketplace/routing-controls).

Live Opus and Sol receipt checks passed on 10 October 2026. Controlled local HTTP
checks covered deadline truncation, fractional costs, error receipts and retry
count; the real SQLite migrations preserved the receipt and rejected its update.
Those local checks did not charge a contributor or reconcile a production invoice.

A live Sol call on 10 October 2026 confirmed that the transport ID retrieves
the exact Surplus request receipt. The model and cost matched; settlement was
still accrued. Local HTTP and SQLite checks retained IDs on success, truncation
and HTTP errors, ignored invalid IDs, and rejected changes to persisted IDs.
This provides a link for later reconciliation, not finalized invoice evidence.


## Webhook redelivery after queue failure

Receipt storage and successful dispatch are separate. Migration `0016` adds a
completion timestamp. A queue or receipt-write failure returns 503 and leaves
the delivery retryable. A later redelivery of the same signed event can enqueue
it; only a completed receipt returns the duplicate acknowledgement. Concurrent
or ambiguous sends can still deliver a job more than once, so consumer
idempotency remains required.

This does not make GitHub redeliver failed events automatically. Use GitHub's
redelivery control for a failed delivery. Existing receipts have no reliable
queue-acceptance evidence, so they remain retryable after migration.

A local fault-injection check used the actual worker fetch handler, HMAC-signed
requests and the real SQLite migrations. An injected first-send failure returned
503; redelivery accepted one job; the completed duplicate made no extra send.
Invalid JSON returned 400, and an invalid signature returned 401, without
creating receipts. This check did not exercise the hosted Cloudflare queue or
GitHub App credentials.

## Supporting code for value assessments

Historical joint-record preparation can receive the independently fetched D1
project registry used to collect its sources. The registry is validated again,
and only active project repositories can supply those records. Captured source
policy cannot override it. This does not authorize publication by an external caller. Producer provenance
and installation authority are checked separately.
Source revalidation and joint-history readers accept that same verified
repository set; callers must keep it consistent across the operation.

When GitHub omits an added text-file patch, the collector can recover it from
the full file at the immutable submitted or accepted commit. It verifies the
Git blob SHA-1, UTF-8 bytes, byte length and exact added-line count before
constructing the empty-file diff. Recovery is limited to 16 reads, 512 KiB per
file and 2 MiB total across both ranges. Binary, modified, oversized or invalid
files keep their missing-diff limitation. Publication uses the same collector
and rechecks the recovered source. The recovered bodies stay in private source
evidence; journal records contain their source digest, not the patch bodies.

For a rename with no patch and zero added or deleted lines, the collector
checks the old path at the submitted merge base and the new path at the head.
For the accepted range, it checks the first parent and merge commit instead.
Only identical verified Git blob bytes permit an empty patch. Both paths and
the proof refs remain in private evidence and its source digest. The shared
blob reader permits at most 48 reads, 512 KiB per file and 2 MiB per recovery
range. Missing, changed or invalid bytes retain the limitation; zero line
counts alone are insufficient. A rename proves no new content or extra award.

When a modified or renamed text file has no complete patch, the collector can retain a
`fullComparison` with the complete old and new text, verified Git blob hashes,
and immutable refs. The old version comes from the submitted merge base or
accepted first parent. It does not manufacture a patch. Invalid UTF-8, binary,
missing and oversized files remain unresolved. The bounded shared reader limits
this recovery to 48 reads, 512 KiB per file and 2 MiB per range. Squash matching
also compares the recovered blob pairs. Both texts remain private and are
included in the source digest that publication revalidates.

For a changed rename, read the old path at the base and the new path at the
head. GitHub can report zero changed lines while those blobs differ. Preserve
the reported counts and missing patch; the complete texts provide the evidence.
An identical rename still uses the unchanged-rename proof above. A missing old
path or unverified file leaves the evidence gap open.

An unchanged file can prove or disprove a review claim. Pass its repository path
after the output directory in `scripts/collect-value-evidence.ts`. The collector
reads the full UTF-8 file at the PR head and binds its bytes, path and immutable
revision to the assessment source digest. Use `--context-at SHA path` to compare
a file at the captured base or a formal review's recorded commit. Arbitrary
revisions are refused. This lets an assessment distinguish a review of an early
revision from validation of later changes. Publication reads those files again.
Journal records retain the selected paths and non-head revisions so ingestion can re-fetch the same
context. They never include the file bodies. Older records without context
selection keep their original digest contract.
Missing, oversized or invalid files stop collection; partial context is not
assessment evidence. The limits are 16 files, 512 KiB per file and 2 MiB total.
Keep these raw captures in the private output directory outside the repository.

For Eliza #34761, the exact-head application entry point and number parser
resolved claims about code outside the three-file PR diff. Live GitHub reads
matched the local immutable Git blobs. This check supplies assessment evidence;
it does not publish a score or establish that the application tests passed.

## Immutable billing evidence

Migration `0017` rejects changes to every cost field, credit deletion and SQLite
replacement of an existing cost or credit. This preserves installation and
model attribution as well as amounts. A credit reference cannot be reused to
replace a deposit. Corrections and invoice reconciliation require appended
evidence; this migration does not implement invoice reconciliation.

A local check exercised the model transport and `recordCalls` against the real
SQLite migrations. All 20 cost columns rejected updates; cost and credit
deletion and replacement failed; new cost and credit rows still appended, and
the derived credit balance retained both entries. No production funds changed.

Migration `0018` also prevents SQLite replacement through any of the value
journal's unique keys: sequence, digest, assessment key, PR root, or predecessor.
A local upgrade check applied it to an existing journal containing a real Eliza
assessment. Replays retained the original row, successors appended, and all five
replacement paths failed without changing historical bytes. The actual worker
reader returned the original JSON bytes. This is local storage evidence, not
production score publication.

Closed, unmerged assessments retain the GitHub closure date as `occurredAt`;
merged outcomes retain their merge date. Publication refuses an open outcome
or a missing occurrence date. The source digest includes the closure date, and
collection checks state and closure date again before returning evidence.
An existing assessment must be recollected and reassessed if this changes its
source digest; do not rewrite earlier assessment bytes.

The live collector retained the 15 September closure date for Eliza PR #31343
with no source limitations. Existing real merged-assessment journal checks also
passed. This check made no model call or public assessment and does not establish
the value of that closed PR's reviews.

## Recovery after an eligibility skip

A skip occurs before inference. A later event for the same revision rechecks
eligibility, including budget, draft state and author limits. If eligible, an
atomic claim permits the first actual review; completed and running reviews
remain deduplicated. Failed attempts remain unbilled Slop-caused retries.
The daily author cap counts completion time over the preceding 24 UTC hours,
including reviews that were first skipped on an earlier day.

A local routing/persistence check using the real SQLite schema covered an empty
balance followed by a deposit, competing claims, failed-attempt retry, completed
deduplication and the rolling completion-time cap. It made no provider call or
production write. Hosted queue recovery and atomic inference-budget reservation
still require separate qualification.

When every triage model route fails, the consumer persists a failed review and
throws to the queue handler. The handler requests a retry after 60 seconds;
the configured queue allows five retries before its dead-letter queue. A normal
return would incorrectly acknowledge the failed job. A successful retry remains
unbilled and completed revisions remain deduplicated.

A local end-to-end check used the actual queue handler, review service, SDK HTTP
transport and SQLite, with local GitHub and provider fixtures. Two failed routes
caused a retry; the next attempt completed; a duplicate made no further provider
request. All three call rows were retained with zero billed amount. This does
not prove hosted dead-letter delivery or production GitHub access.

Before posting any review action, the worker rereads repository visibility,
item state and content, revision, current policy/configuration and installation
state. A changed source, disabled configuration, missing/removed/suspended
installation, or closed/draft item discards the pending action. The failed
record preserves the reason and permits a later unbilled retry. This guard
applies to comments and labels as well as closure; it is not a transaction with
GitHub, so a change after the final read can still race an API write.

The local queue/service/SDK/SQLite workflow check changed state during the model
response. Unchanged advisory review made its two expected writes. Installation
removal, suspension, missing installation, private visibility, disabled review
configuration and edited source each made zero writes. GitHub and provider
responses were local fixtures; hosted permission and webhook checks remain open.

Comment creation requires GitHub's 201 response and a valid comment ID. Updates
require a 200 response for the stored ID; only a 404 permits creating a
replacement comment. Label writes require a 200 response containing the requested
label. An unconfirmed write fails the run and requests a queue retry instead of
recording successful action evidence.

The local queue workflow covered comment 404, invalid creation ID, redirected
update, label 404 and a response missing the requested label. Each failed and
retried; no unconfirmed action entered the ledger. Confirmed comments remained
recorded when the subsequent label failed. Normal comment/label success passed.

The initial review comment never announces a close. Only after GitHub confirms
the closed state does the worker record the close and update that comment with
the result. If the comment update fails, the confirmed close stays in the action
ledger and the run fails visibly. A rejected or failed close creates no close
record and no closure claim.

The isolated queue workflow exercised confirmed closure, an unchanged open
response, a close-request failure and a post-close comment-update failure. The
event sequence contained no closure claim before confirmation. Closure was
enabled only in that local fixture; production closure remains disabled.

After inference, closure eligibility is checked again against current author
permissions, recorded human-reopen signals and closure limits. Assignment,
exempt or unknown membership, and a human reopen at the reviewed revision prevent
closure. Local queue workflow checks changed each condition during inference:
all four made zero close requests, while the unchanged eligible case closed only
after confirmation. These checks do not enable production closure or establish
hosted membership permissions.


## Value score projection

The leaderboard generator accepts verified `valueDecisions` and GitHub-resolved
`valueActors` for outcomes accepted under the `slop-value-v1` policy. Valid
human ratifications take precedence for the implementation score. Missing,
incomplete, stale and unresolved decisions receive no review award; their
accepted merge keeps only the repository's one-third minimum until assessed.
An accepted merge assessed at zero keeps the same one-third minimum. The
snapshot retains a coverage row for every accepted source, and integer-third
shares preserve the scored total.

Positive assessments require exact-head source agreement, hydrated human and
review decisions, complete implementation identities, and no overlapping
accepted commits that need joint assessment. Distinct positive review outcomes
share one per-pull-request review pool among the first five distinct reviewers.
The pool is their summed bands, capped at the pull request's assessed size,
minimum one third. Duplicate and zero-valued reviews do not multiply credit.
Existing reviewed evaluator awards keep their precedence.

A local integration passed collected Eliza #34772 through the journal reader
and real snapshot generator and validator: nine implementation thirds, one
review award, no missing-value fallback, retained zero, wrong-head rejection,
and precedence for a controlled valid human-ratification fixture. The generator
entry point accepts these inputs. Hosted-feed operation, Points revision
ingestion, and public activation remain unverified. Legacy
inputs and frozen cycle files retain their existing behavior.


## Ingest published assessments

`bun run leaderboard:generate` reads the fixed
`https://slopbot.slop.cash/v1/value-assessments` feed for every outcome accepted
under the `slop-value-v1` scoring policy; there is no opt-in flag. Policy
selection, the recorded owner decision, feed-outage handling and the
review-credit allocation are in
[`protocol/scoring-v2.md`](../../protocol/scoring-v2.md#current-producer-slop-value-v1).
Release workflows run the same command. Hosted publisher operation and its
production records remain unverified.

The generator rejects redirects, unavailable or invalid pages and changed
source. An unlinked commit author remains null in the source and adds no credit
recipient under SCR-04. The PR author qualifies through their verified PR
identity; the collector does not assign an unknown commit identity to them. An
empty successful history is explicitly missing, never a fabricated assessment. It checks current repository visibility
and identity, complete GitHub evidence, pinned policy and all journal revisions.
Each non-merge commit also retains its verified primary-author ID, complete
changed paths (including rename sources), and attribution limitations. Commit-file
pagination, repeated paths, the API cap, and addition/deletion totals are checked.
Incomplete path evidence is null and blocks assessment; it is never an empty
change set. The final PR stability read follows these commit and identity reads.
The whole-PR contributor set follows SCR-04: the non-bot PR author plus
GitHub-linked primary commit authors when the PR targets the integration branch.
Historical PRs can target a former integration branch. When a merged PR has
other eligible primary authors and its base differs from today's registry,
the collector reads `CONTRIBUTING.md` at the immutable PR base SHA. It recognizes
the explicit sentence `Pull requests target \`branch\`.` outside fenced examples
and comments. Missing, conflicting, or unreadable declarations leave a source
limitation; a declaration of another branch keeps author-only credit. A matching
declaration retains commit-author credit without changing the current registry.
The captured document and base SHA enter the source digest and are re-read for
publication. Existing assessments require a verified successor, not an in-place
recipient change. This historical evidence never activates a project or payment.
Vendor agent accounts and co-author trailers do not add score recipients or
turn trailer authors into self-reviewers. The original commit messages remain
in the evidence; the collector does not resolve trailers into credit authority.
This preserves the evidence needed to distinguish shared work
from unrelated changes; it does not yet authorize scoped joint publication.
The additional evidence participates in the source digest, so old assessments
need a verified successor before they can match the expanded source record.
Incoming GitHub PR cross-references are paginated and retained by immutable ID,
public repository, number and URL. Private references are withheld and leave a
source limitation. These references are discovery metadata, not a joint source
assessment, and their absence does not prove that no other related work exists.
The evaluator can name a discovered PR in an unresolved result; a related URL
without collected reference evidence or a positive joint score is rejected.
GraphQL cross-reference reads use the existing generation budget. REST reads
contribute to the request count, and all merged outcomes receive human-decision
hydration.
Value collection also retains closed, unmerged PRs in the full scoring window.
Their complete reviews and current assessment history can award review value,
but never implementation value. Missing or unresolved decisions do not fall
back to retained legacy review awards. Reviews must precede closure and exclude
the implementation authors. Published counts and assessment coverage retain
these sources separately from merged PRs. Value hydration collects every review
state, including `COMMENTED`, on every page. Eligibility and assessed value
determine credit; collection does not discard a finding because the reviewer
did not select approve or request changes. Review awards use their submission
time within the scoring window. A later merge or closure does not move an old
review into the current month, and that old review does not take a reviewer
slot or a share from a review inside the window. Assessment history still
retains that review.

The source collector does not call a model. A failed feed prevents snapshot
publication; legacy scoring is not a failure fallback.

Local integration used the actual Worker HTTP reader, SQLite, fresh Eliza source
and a controlled assessment fixture, then passed the loaded decisions through
the real score projection and snapshot validator. It also exercised unavailable,
redirected, wrong-identity and oversized responses, explicit empty history, and
private or unknown repository visibility. This is local ingestion evidence, not
proof of the production hostname, a new model valuation or a hosted publication.

### Recovering a confirmed review comment

A failed local comment-ID checkpoint does not authorize another GitHub comment.
When the cached ID is absent or GitHub reports it deleted, the Worker reads the
complete bounded issue-comment history before creating a replacement. It adopts
only a comment authored by the configured App bot ID with the Slopbot review
marker. A copied marker from a contributor or another bot is not authority.
Unavailable, incomplete, or ambiguous history causes a queue retry without a new
comment. Local queue/SDK/SQLite checks cover checkpoint failure after creation,
second-page recovery, foreign markers, unavailable history, and multiple matches.
These controlled checks do not prove live GitHub delivery or production activation.

### Recovering interrupted review attempts

Migration `0045_slopbot_review_leases.sql` gives each running attempt a private
claim token and a 20-minute expiry. This exceeds the documented
[15-minute queue consumer wall limit](https://developers.cloudflare.com/queues/platform/limits/).
A competing delivery retries when the lease expires; it is not acknowledged as
completed and does not spend another model call. An expired running attempt can
be claimed atomically as an unbilled retry. Completed reviews remain deduplicated.

The current claim is checked before model work and GitHub mutations. Completion
and failure updates require the same unexpired token, so an older attempt cannot
overwrite a successor. Provider receipts are still recorded if ownership is lost,
with zero customer billing for those calls. GitHub mutations and D1 checkpoints
remain separate operations; confirmed comments use the recovery path above.

Local queue/SDK/SQLite checks cover contention without inference, expired recovery,
a replaced token during inference, stale completion rejection, concurrent claims,
skip-to-funded recovery, and migration of existing running rows. Production
interruption recovery and dead-letter operations still require hosted verification.


### Subscription assessment provenance

The historical review may use the owner's existing ChatGPT subscription. A
trusted internal publisher can supply `SubscriptionResult` with a separate
`provenance` declaration: channel `chatgpt-subscription`, provider `openai`,
declared model and client, `identityEvidence: self-reported`, and null
`exactVariant` and `apiReceipt`. This records the declared session identity;
it does not claim that a provider response verified the model or billing.
Subscription results must omit `calls`, `servedBy`, and `budgetResetAt`.
They cannot create API usage receipts or service charges. API results retain
the existing route and served-model checks.

Both forms use the same source, rubric, occurrence, predecessor and journal
checks. Readers preserve the distinct provenance. Single-source preparation,
like joint preparation, can use an independently verified active D1 registry.
Publication still requires the installation's repository authority and a fresh
source read. The authenticated admin intake below adds no new operator
credentials, human ratification or payout authority. Production intake activation
and ongoing automatic dispatch remain separate delivery gates.

Single-source publication rechecks installation repository selection after the
source read, as grouped publication does. Removing one repository does not
suspend the whole installation. A local check used the real publisher, captured
public GitHub evidence and the migrated SQLite journal: before the fix, removal
during the source read still appended a row; after the fix, it appends no row.
An unchanged selection still appends one row. This is controlled local evidence,
not proof of a live App permission change.

### Authenticated historical intake

`POST /api/v1/slopbot/value-import` uses the existing site session and
`ADMIN_GITHUB_IDS`. It accepts only same-origin JSON from a signed-in admin.
The optional `SLOPBOT_VALUE_IMPORT` service binding must target the
`HistoricalValuePublisher` named entrypoint of `slop-slopbot`. No public Worker
fetch route exposes that entrypoint. Without the binding, intake returns 503.
Configure the binding only as part of the protected release; this source change
does not configure or activate a production binding.

The envelope has `mode` (`single` or `work-unit`), `installationId`, `result`,
`sources`, `supersedes`, and `revisionReason`. Grouped imports also require
`legacyPredecessors`. Each source contains `repository`, `pullRequestNumber`, and
`contextPaths`. A source may also set `emptyMergeResolutions: true` to match
a local collector result with no two-parent merges. The Worker verifies that
condition from fresh GitHub commits before adding the empty array. False values,
nonempty resolution records and unknown source fields are refused.
The Worker collects the evidence from GitHub; callers do not
upload diff bodies. Results use the existing subscription result format.
Single predecessors are a
digest or null; grouped predecessors are digest arrays. A successor requires a
reason. Unknown envelope fields, API receipt claims and caller-supplied producer
revisions are refused. Requests are bounded to 25 MiB. Large PR diffs do not count toward the
request size because they are read inside the Worker. Source bodies are
processed transiently and are not returned or logged by this path.

The protected workflow supplies `SLOPBOT_PRODUCER_REVISION` from its checked-out
main SHA. The importer requires that value, reuses installation selection,
fresh source and predecessor checks, and returns only a record digest and
sequence. It invokes no model and creates no API costs. Publication remains
provisional; the existing human decision and payout boundaries remain in force.
A failed publication returns a generic error without source or upstream detail.

A local HTTP replay used the actual Pages route, database-backed sessions, all
D1 migrations and the production importer/publisher with captured public GitHub
source reads. It checked admin authorization, same-origin enforcement, absent
binding, invalid provenance, exact source, replay and repository deselection.
The local replay replaces the Cloudflare RPC transport with direct dispatch;
it is not production binding or live installation acceptance.


## Monthly API cost emails

The owner requested email at each $500 milestone on 21 October 2026.
`dispatchSpendAlert` uses the immutable model-call ledger across installations,
including failed calls. Provider-reported micro-USD takes precedence; other
calls use their recorded estimate. The email states how many calls use an
estimate. This is an operational alert, not a provider invoice, spending cap,
contributor charge or payout approval. Subscription backfill has no API calls.

Apply migration `0049_slopbot_spend_alerts.sql`. The protected workflow releases
the private notify route before Slopbot. An enabled Slopbot release requires
`SLOP_NOTIFY_RELEASE=enabled`; its `SLOP_NOTIFY` binding targets `slop-notify`.
No production settings are activated by this source change. Existing
`ADMIN_EMAILS` recipients receive the notices; no address is taken from GitHub.
The existing five-minute cron processes one pending milestone per invocation.
A jump across several milestones catches up without losing past UTC months.
Overlapping schedules claim each month/milestone once. Missing receipts and
`ambiguous` receipts require operator reconciliation; do not delete claims or
blindly resend. `accepted` means the email service accepted all recipients,
not inbox delivery. Production activation and inbox receipt remain unverified.

## Installation scope

Use **Only select repositories** in each GitHub App installation. Read the
current inventory from `GET /api/v1/projects`; select active, non-retired,
unrestricted public repositories belonging to the installation account. Do not
copy this inventory into source code or a second configuration list.

On an approved registry change, reconcile the App selection. Adding App access
alone cannot activate reviews. The Worker checks current D1 state, so pausing or
restricting a project stops later work even if selection cleanup is delayed.
If the App was installed while its webhook was inactive, recover its installation
delivery after protected deployment; a missing installation row must not be
invented as proof of a qualified shadow period.

### Repository access for project setup

Self-service project setup (`backend/projects/README.md`) needs Slopbot
installed on the repository before a project is ready, and reads the owner's
current permission through the App. The site calls
`GET https://slopbot.internal/v1/repository-access?repository=OWNER/REPO&repositoryId=ID&login=LOGIN`
over its `SLOPBOT` service binding only; a public host never matches that
origin. The Worker asks GitHub for the repository's installation with the App
JWT, rejects a repository whose id changed, and returns
`{ installation: "missing" }`, `{ installation: "suspended", installationId }`
or `{ installation: "installed", installationId, permission, roleName }`
with GitHub's base permission (maintain reads as write). It returns no token.
Any GitHub failure is HTTP 503; setup shows it as a retry. Installation
records in D1 alone never answer this check.

## Objective quality verification

The [trusted evidence contract](QUALITY.md) implements the approved objective
criteria and shadow admission. Production closure remains disabled.

### Live registry at value publication

Single and grouped provisional publishers check the live D1 registry before
source validation and again before append. Every grouped source must remain
active and unrestricted. Historical intake checks the same registry before
collecting source evidence. App selection and a bundled registry alone do not
authorize publication. Database failures stop publication.

A local replay of the actual publisher with captured public GitHub evidence
and all SQLite migrations reproduced an append with an empty live registry
before this fix. Afterward, absent and paused projects append zero records,
including a pause recorded during source reads. The active-project control
appends one record; installation deselection still appends none. These checks
make no model calls and do not publish production scores.

### Authority before each valuation request

Single and grouped API assessments require a caller-supplied guard before every
provider attempt, including fallback. The dispatcher must use that guard to
check its lease, live project authority and reserved inference budget. A refused
or unavailable guard returns `blocked: true` and retains earlier call receipts.
It does not publish an assessment or erase incurred usage. This callback is not
itself a budget reservation; automatic dispatch remains incomplete.

A local HTTP replay used both actual assessment entry points and the provider
SDK with captured source evidence. Before the repair, neither entry point could
receive the guard and each made two requests despite denial. After the repair,
initial denial made no request; revocation or a guard error before fallback made
one request and retained its usage and provider cost. The allowed control made
both requests. Responses were local schema-invalid fixtures, not real inference
or provider acceptance. No paid model request or score publication occurred.

### Pending closed-outcome requests

Migration `0050_slopbot_value_requests.sql` retains identifier-only requests for
signed `pull_request.closed` deliveries from active registered repositories.
Both merged and unmerged closures can carry useful review outcomes. Intake does
not decide value from the webhook. It returns `valuation pending` only after
the immutable request is stored. Delivery retries cannot change its identities.
The assessment consumer remains incomplete; a receipt does not prove a model
call, a score or a completed rollout. Source collection, installation authority,
budget reservation, leases, current-source publication and retry disposition
must run before these requests can be completed.

The actual HTTP webhook and SQLite migrations pass a local replay for signature
rejection, accepted closure, duplicate delivery, wrong repository identity and
changed retry identity. The request survives an unavailable queue without using
it. The replay writes one request and zero costs or score records. No live
webhook or provider acceptance is claimed.

Review submissions, edits and dismissals, inline comment changes, PR discussion
changes, and PR reopen/edit/synchronize events also retain a valuation request.
The processor must re-read GitHub before deciding whether a closed accepted
outcome exists; an open PR event is not permission to award implementation
credit. Ordinary issue comments do not enter this intake. Appeals, human reopen
signals and ordinary review jobs keep their existing queue behavior. A failed
queue send leaves the delivery retryable while the valuation receipt remains
idempotent.

An extended signed HTTP/SQLite replay retained 14 expected source-change
requests, compared with one before this repair. It preserved five queue sends
including an appeal retry after a failed send, with zero score or cost rows.

### Valuation budget admission

Migration `0051_slopbot_value_budget.sql` stores immutable attempt reservations
and reconciliations. Migration `0077_slopbot_alerts_only.sql` preserves those
records and permits a null monthly allowance for explicit alerts-only approval.
`reserveValueBudget` requires an approved spending mode and a conservative maximum
attempt cost. In capped mode, it atomically counts the
current month's recorded provider costs (or estimates) across installations and
all unreconciled reservations. Prior-month reservations remain held because an
unresolved provider request can be charged later. A repeated attempt ID does
not authorize another call. The scheduled consumer uses these primitives. They do not configure a
production allowance or impose a provider-side spending cap.

The consumer must use its unique `value:<UUID>` attempt ID as the cost ledger's
review key, record every attempted route including failures, and pass the full
expected call count to reconciliation. Capacity is released only when every
expected receipt has a provider-reported amount within the reserved maximum.
Missing, estimated or over-reservation costs require reconciliation; there is
no timeout-based release. A denied pre-call guard does not by itself prove that
an interrupted attempt never sent a request. Existing review calls outside this
admission mechanism are not capped by it; their recorded costs are included
when admitting valuation work. The $500 email rule remains separate.

The real SQLite replay covers overlapping admission, retry refusal, exact
remaining allowance, missing and partial receipts, provider reconciliation,
uncertain estimates, month rollover, absent approval and immutable history.
No production allowance, provider request, contributor debit or payout changes.

The single and grouped assessment entry points now require a trusted
`ValueInferenceBudget` and use the same reserved inference route. They check
authority before reservation and again before each provider attempt. They
persist all returned call receipts to the existing cost ledger under the
unique attempt ID before returning a verdict, with contributor billing disabled.
Receipt persistence failure prevents a result from reaching publication.
Reservation retries return blocked and make no new provider request. The
caller still must establish a conservative maximum covering its complete route;
this is not a provider-side dollar cap or permission to invent an allowance.

A real local HTTP/SDK and SQLite replay exercised both entry points with valid
schema responses, invalid responses, fallback revocation, authority failures,
insufficient budget and reservation replay. Valid single and joint results
return after one stored receipt; invalid output uses the allowed fallback and
stores both receipts. Every case records zero contributor charges. Responses
are controlled local fixtures, not live model acceptance. Grouped request consumption, approved production configuration and live
publication remain unfinished.

### Durable request claims

Migration `0052_slopbot_value_processing.sql` separates operational claims from
immutable request history. A ten-minute lease has a unique token. Only the
current unexpired owner may finish a request. A disappeared worker can be
reclaimed after expiry; its old token cannot report success. An explicit retry
time retains budget, authority and evidence blocks. Published/current outcomes
and open-context dispositions complete that delivery only; a later source event
has its own request. The consumer must check ownership before external calls
and publication. The scheduler processes one due request per invocation. Single-source and
joint consumption use the same durable request lifecycle.

A file-backed SQLite replay verifies one concurrent winner, process restart,
expiry/reclaim, rejection of a stale completion, scheduled budget retry and a
terminal open-context disposition. The immutable request remains present. This
is durable-state evidence, not a model, queue or publication acceptance result.

### Scheduled value consumption

The scheduler selects one due request and claims it before source reads. It
checks live registry and installation authority, then reads the complete closed
PR evidence and pinned policy. Collection, history validation and publication
use the validated current D1 manifest, so new registrations do not wait for a
Worker rebuild. Publication reads the manifest again and preserves the final
restriction and installation checks. A matching current journal avoids another model
call. New results pass the reserved inference route, a final ownership check
and the existing fresh-source publisher before the request is completed.
Open work completes as context, not an implementation award. Missing evidence keeps the request pending. Related PRs are collected with
their pinned policies and prior joint membership. All members must belong to
the same registered project, be closed, be within the API start boundary, and
have complete evidence. Collection stops at 32 sources and leaves a larger
group pending; it does not assign zero or split that group. Failures retain a
retry state without provider exception bodies. Validated results are retained before publication, so a restart can reuse them
without another model call.

Required operator settings have no defaults:
`SLOPBOT_VALUE_MONTHLY_BUDGET_MICRO_USD`,
`SLOPBOT_VALUE_ATTEMPT_RESERVE_MICRO_USD`, `SLOPBOT_VALUE_START_AT`, the existing
model credential, and the deployed `SLOPBOT_PRODUCER_REVISION`. The start date
separates ongoing API assessment from the subscription-only historical backfill;
set it after the historical cutoff. No production settings are enabled here.
Set `SLOPBOT_VALUE_MONTHLY_BUDGET_MICRO_USD=alerts-only` for the owner-approved
24 October 2026 policy: email every crossed $500 milestone without a monthly hard
cap. A positive integer instead selects a capped allowance. Missing or malformed
configuration still stops inference. Both modes retain every attempt and cost;
alerts-only records a null monthly limit rather than an invented finite cap.
The attempt reservation must cover the entire permitted model route.

The consumer replay uses actual SQLite migrations, collector, policy loader,
model SDK over local HTTP, usage ledger, journal reader and publisher. Captured
GitHub responses and installation selection are controlled. First delivery
publishes one local record; another delivery returns current without inference.
Missing configuration, historical cutoff and open-source paths make no model
call. Totals: one model-response fixture, one cost receipt, one journal row and
zero contributor charges. This is not live provider or production acceptance.

Claims also exclude another live delivery for the same immutable repository ID
and PR number. The scheduler skips those busy sources so a repeated webhook
does not block other available work. A completed request does not suppress a
later event: its consumer re-reads the current source and journal.

A concurrent two-delivery replay reproduced two provider requests and two cost
receipts for one journal row before this repair. Afterward it makes one request,
stores one receipt and one journal row, and the other delivery returns current
when retried. The file-backed claim replay also confirms that a different PR
can acquire a lease while the first remains active.

### Work accepted through another integration

A closed PR can contain work accepted through an integration branch without a
GitHub merge event on that PR. The collector uses commit references in integration
comments only as discovery hints. It verifies a two-parent integration commit,
the historical head in the PR's commit inventory, ancestry on the registered
integration branch, and a GitHub push-triggered workflow observation before
closure. A workflow's result is not test acceptance; even a cancelled run can
prove the branch and SHA that triggered it.

The source keeps its original head, closure and null merge fields. The joint
record adds a separate indirect-acceptance binding and uses its branch-observation
time as the recorded acceptance observation. Complete hash-verified trees and
texts preserve renamed, changed and removed content between the historical head
and observed branch tip. Only original non-merge commits newly integrated in that
range can supply claims. The assessor must compare retained content and separate
maintainer repairs; source hunks removed during integration do not become awards.

This path requires joint work-unit assessment. The legacy single-PR route rejects
it. Discovery, pagination, tree, text and ancestry bounds produce an unresolved
gap rather than inferred absence or zero value. Hints without a verified integration
do not grant credit. Publication re-collects source evidence and consumers compare
the exact bindings. GitHub merge counts and source state remain unchanged.
Ledger awards carry `acceptanceKind: "indirect-integration"` and count against
the closed-unmerged census. Distinct joint units use distinct Points keys even
when they share a PR and recipient. Existing keys remain valid; a new projection
appends corrections instead of changing earlier revisions.

### Source-set ownership

Migration `0053_slopbot_value_source_leases.sql` adds all-or-none ownership of
repository-ID/PR-number source sets. The consumer uses it
before inference and checks it before each call and publication. Joint
consumption acquires its full source set with this same mechanism before
spending; different initiating PRs do not make overlapping work independent.
An active competing group prevents the entire acquisition. Completed or expired
request ownership stops authorizing external work, and disjoint sets can run.

The real SQLite replay proves that groups [1,2] and [2,3] have one winner, the
loser acquires no part of its set, and disjoint work proceeds. Completion and
expiry revoke ownership. The actual single-source HTTP/SQLite consumer and
concurrent-delivery replays still publish once with one receipt. The joint consumer validates predecessor history and legacy digests before
inference, then uses the existing fresh-source joint publisher. Previous group
members remain in scope when a PR removes a reference.

A local joint workflow uses captured GitHub evidence with a controlled outgoing
reference, installation selection and unresolved model response. Initial delivery
creates one joint record; repeat delivery reuses it. Removing the reference
causes reassessment of both retained members, with two total joint records, two
cost receipts and no single-source rows. The unmodified linked group rooted at
proximityprize #195 stays pending because #206 has an unavailable or private
reference. These are orchestration checks, not live-provider valuation evidence.

### Retained inference before publication

Migration `0054_slopbot_value_inference_results.sql` retains only validated
proposals and safe call metadata after usage receipts are recorded. It does not
store prompts, source bodies or raw provider responses. Immutable keys bind the
installation, source digest, system and project policy, output schema and model
route. Both single-source and joint assessment use this boundary.

A retry checks current authority, verifies retained bytes, runs the current
source validator, and reuses the original inference time. It makes no new
reservation or provider call. Existing exact-cost receipts can reconcile a
reservation interrupted before reconciliation; unknown cost remains held.
Publication still requires the ordinary current source, project, installation,
lease and journal predecessor checks. A changed source or policy gets a new key.

File-backed SQLite workflows interrupt single and joint publication after
inference, close and reopen the database, then resume the request. Each publishes
with one total model-response fixture, one cost receipt and the original
assessment time. Mutation and invalid-verdict reuse are rejected; a changed
source is reassessed. These checks use local HTTP model fixtures and captured
GitHub evidence, not live model acceptance. A crash before result retention is
still an ambiguous provider outcome: a stored reservation cannot reconstruct
an unrecorded response, and its unknown cost must not be released on a timer.

### Stacked squash evidence

When a squash omits changes already present in its parent, the collector can
retain a source-bound `acceptedRange` proof. Every newly merged patch must match
its submitted patch exactly. Git blob bytes must verify at both the submitted
head and accepted commit for every submitted file; omitted paths must also
match the merge parent. The proof labels those paths `alreadyPresent` and keeps
both original diffs. It establishes acceptance, not an additional award for a
dependency. Joint attribution and duplicate-work checks still apply.

The bounded recovery handles at most 16 added or modified text-diff paths and
2 MiB of verified file reads, with 512 KiB per file. Unsupported changes, missing
bytes, altered patches, or larger sources retain the original limitation and
need dedicated Git evidence. No original capture is rewritten.

### Omitted deleted-file evidence

GitHub can omit a deleted-file patch and report zero file deletions while its
commit total includes those lines. The collector records `removedComparison`
with the original text, blob hash, base commit, and accepted commit. It requires
complete hash-verified trees, a regular parent file, verified blob bytes, and
absence at the accepted commit. Missing or truncated trees, changed hashes,
binary content, and files still present cannot establish a deletion.

GitHub's reported `patch` and `deletions` remain unchanged. Matching and commit
reconciliation use the separately verified text to derive deletion lines and
a deletion-only comparison. Commit totals must still reconcile. Existing blob
and tree limits apply; exceeding them leaves an explicit evidence gap. This
proof supplies review material, not a value tier or payment approval.

### Escalated appeal notices

Escalation writes one moderator Inbox notice in the same D1 transaction as
its source decision. Repeated webhooks and scheduler runs keep the same event
key. The appellant never receives a moderator notice for their own appeal.
Inbox reads and the same-site GitHub redirect recheck the configured moderator
identity. A resolved appeal remains in history with no decision requested.
Optional activity email uses the existing consent-bound queue; dispatch
suppresses a resolved appeal or a recipient who is no longer a moderator.
Private security appeals keep their separate notice and acknowledgment path.

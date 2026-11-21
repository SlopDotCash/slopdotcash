# Slopbot worker

Hosted GitHub App worker under [`protocol/slopbot-v2.md`](../../protocol/slopbot-v2.md)
(PRD section 5, Slopbot). Protected releases deploy it. Automatic closing stays
off unless `SLOPBOT_CLOSURE_ENABLED` is `"true"` after an explicit production
qualification and activation review (`wrangler.toml` ships it as `"false"`).

This README is the operator contract for the tip code under `workers/slopbot/`.
Deep value, quality and recovery detail lives in the modules named below and in
[`QUALITY.md`](QUALITY.md). Do not treat older narrative in git history as
current behavior.

The production config declares `limits.cpu_ms = 300000`, a CPU ceiling per
invocation on Workers Paid with Standard usage. Cloudflare enforces it on its
network. It applies to HTTP and queue work, including historical validation;
the cron that runs every five minutes retains its platform 30-second CPU cap.
Network waits and wall-time caps are separate. After a protected release,
verify the 100% active version, `cpu_ms = 300000`, Standard usage and a supported
plan before retrying an import. This budget does not guarantee completion.

The protected main `fee-worker-bindings.yml` workflow accepts an optional exact
`slopbot_source` SHA for a separate read-only metadata job. Its
selection skips the fee job and its publication concurrency group. Combining
it with any fee probe, rotation or prior-proof input is refused in a
credential-free step before the metadata read. With `slopbot_source` empty,
the existing fee workflow keeps its original input behavior. The
`slopbot-runtime.json` artifact retains only the matching source, active version,
CPU limit, usage model and deployment stability. Missing, denied, malformed or
changing metadata stays unavailable. The receipt does not verify Paid plan
entitlement, execution success or the cause of an earlier import failure.

Optional publication-local text sharing retains at most the existing 32 MiB
cache budget, measured conservatively as two bytes per UTF-16 code unit.
Overflow is returned intact without retaining it in that pool. This does not
limit evidence size or admission. Recovered added-file patches enter sharing
only after their line counts match the accepted file metadata.

## Flow

1. **Webhook.** `POST /github/webhook` verifies `X-Hub-Signature-256`, records
   the delivery ID once, updates installation state, and enqueues identifiers
   only (`index.ts`).
2. **Registry.** Intake and the queue consumer check the live D1 project
   registry (`registry.ts`) through the shared evaluator in
   `src/lib/project-capabilities.mjs`. An active listed unrestricted project
   gets full contributor review. A paused, flagged, quarantined or banned
   project gets security-only review: only a `scam` finding is labeled and
   commented, nothing closes, and no value assessment runs. A retired project
   gets no new review; appeal, maintainer-reopen and moderator events may only
   reverse an existing debit or decide a retained value dispute without a new
   review or GitHub write. Unregistered repositories and replaced repository
   IDs skip; database errors retry. Registry checks repeat before inference and
   GitHub writes.
3. **Context.** The consumer takes an installation token and re-reads the
   repository, the item, optional `.github/slopbot.json`, and `AGENTS.md`,
   `CONTRIBUTING.md` and `README.md` from the default branch tip. PR content
   comes from an immutable comparison of the current GitHub-selected target
   branch and PR head, with the target repository ID verified. Missing
   comparisons and invalid target identities retry. Missing binary or large
   patches, the text budget, and the 300-file comparison limit produce a
   limited advisory review (comment only; no label, hold, close or penalty).
4. **Routing.** `routing.ts` applies published precedence: installation,
   private repository, type switch, open/draft, bot author, human reopen,
   exemption, audience, author cap (`AUTHOR_DAILY_CAP = 3`), budget. Advisory
   review stays broad; closure needs the separate eligibility check below.
5. **Pre-filters.** Deterministic empty and same-author duplicate hints can
   yield free advisory results when closure is unavailable. A potentially
   closable result still goes through model triage and independent confirmation;
   model verdicts replace the hint.
6. **Models.** `models.ts` starts with Surplus `claude-sonnet-5.5`, then
   Surplus `gpt-6.1-terra`, then Orbio `anthropic/claude-sonnet-5.5` as the
   backstop (operator decision, 16 November 2026). A Surplus spending denial
   skips the remaining Surplus model and goes directly to Orbio. Missing
   provider keys skip that provider without recording a paid attempt. Every call is written to `slopbot_costs` with its
   internal provider cost and a zero billed amount.
7. **Close gates.** A close needs all of the following (`review.ts`,
   `closure-eligibility.ts`, `penalties.ts`, `contracts.ts`):
   - closure eligibility: a pull request whose author is not a maintainer, is a
     slop.cash member matched by immutable GitHub ID, and has a `trace_runs` row
     from their own authenticated Slop session for this project and repository
     with a `pull_request_opened` event naming this exact pull request node ID;
   - category set to close, and `penaltyFor(category).action === "close"` (the
     published table keeps `out_of_scope` label-only; `missing_evidence` can
     close only for a deterministic missing-field finding on a Slop submission
     under a published Evidence policy);
   - verified evidence; for guidance categories, a rule quoted verbatim from
     the named file;
   - confidence ≥ `CLOSE_CONFIDENCE` (0.9);
   - closure enabled globally and by the repository;
   - reviewed real cases and counterexamples for production activation; for
     objective `low_quality` closure, the separate verifier-profile
     qualification in `QUALITY.md` (no verifier host exists today, so that path
     stays unavailable);
   - no reopen-rate breaker (`REOPEN_BREAKER_RATIO = 0.1` over 7 days of
     maintainer reopen or upheld appeal reversals) and no repository
     `dailyCloseCap` hit;
   - a confirming second model verdict, or a repeated deterministic evidence
     finding from the unchanged GitHub body and published guide for
     `missing_evidence`; no unresolved limitations; unchanged item just before
     acting. Missing-evidence closure uses
     `SLOPBOT_EVIDENCE_CLOSURE_ENABLED` independently of the general switch.

   The daily close slot is reserved in D1 before the GitHub request. Confirmed
   closes in the rolling day and every unresolved close attempt consume
   capacity. Confirmation records the action and settles its reservation in
   one transaction, so they count once. The new-author review cap similarly
   counts live review leases and unresolved closes, not only finished reviews.
   A verified prior merge preserves the existing new-author cap exemption.

   A timeout or lost response does not release a close slot. Replay the
   original review job to reconcile GitHub's immutable actor, revision and
   close-time evidence; replay does not send another close. If that evidence
   remains unavailable, retain the pending attempt for operator investigation.
   Do not delete it or expire it merely because the review lease ended.
   A definitive GitHub 401, 403, 404, 410, 422 or 429 refusal records a rejected
   attempt and releases its slot. A later retry creates a new attempt; it does
   not rewrite that history. Expired ordinary reviews without a pending close
   also release their author slot.

   Otherwise the bot only comments and labels. Eligible full reviews with no
   finding still update the bot's single review comment. An uncertain finding
   (confidence below 0.9, failed verbatim check, or unconfirmed second review)
   goes to a maintainer hold (`maintainer-holds.ts`, `MAINTAINER_HOLD_DAYS = 7`);
   after seven days without maintainer action the bot may add
   `slopbot:uncertain` only. Uncertain findings never close.
8. **Penalties.** A confirmed close of a closure-eligible author records one
   debit from `PENALTY_TABLE` in `slopbot_penalties`, in the UTC month of
   GitHub's `closed_at` from the confirmed close response. One debit per pull
   request; one reversal on upheld appeal or maintainer reopen. `scam` also
   adds `slopbot: moderator`. Read-only
   `GET /v1/penalties?project=ID&after=NODE_ID` pages unreversed debits (100 per
   page). `scripts/generate-leaderboard.ts` binds them into the score census.
9. **Appeals.** `/slopbot appeal` from the author, or any reopen, blocks
   re-closing that revision (`appeals.ts`). Escalation to a moderator (label
   `slopbot: moderator`) uses `PROJECT_MODERATOR_GITHUB_IDS`. A repeat
   appeal of a finding on an item whose earlier appeal was denied, awaits a
   moderator, or has an unanswered deny draft is always escalated, at triage
   and again before the appellant accepts an uphold draft (value disputes
   excepted). A maintainer reopen always wins. See `appeals.ts` and `reopen-source.ts` for revision
   binding and late-close races.

For an ordinary PR value assessment, an affected author, implementation actor,
reviewer or maintainer may comment `/slopbot dispute` with their reason. Slopbot
binds the original single or joint journal digest and drafts a decision. An
author's `/slopbot appeal` also uses this path when no finding exists. Use the
exact accept/reject or moderator command in its reply to select that dispute.
An upheld value dispute does not change Points, awards, penalties or PR state;
an authorized correction must append through the existing assessment journal.
Incomplete source, partial joint context and restricted projects go to a
moderator. A member can also select a record from their Points history and
request review in Inbox, including non-PR and manual awards. This private
intake pins the exact Points revision and retains the member's statement in
`points_disputes`; it uses the same draft and escalation rules. The periodic
Slopbot job recovers an interrupted intake. This path does not independently
retrieve original work, so a moderator must inspect it before deciding.
An upheld dispute records that decision; it never edits Points or funded
awards. Corrections still use the existing append-only journal.

## Project consent

Consent is the project's automatic-closure setting, which starts unchecked;
installing the App or registering the project does not grant it
([PRD section 5](../../docs/slop-product-requirements.md)). A repository
`.github/slopbot.json` is optional. If it is absent, the project setting
decides. If it is present and valid, its `closure` flag and per-category
`off` / `label` / `close` restrictions still apply (`contracts.ts`). If it is
present but invalid, review falls back to label-only with no closure.

## Ready label

Operator decision, 16 November 2026 (PRD section 5). When a project owner
turns on `slopbot.readyLabel` in project settings (absent means off),
`ready-label.ts` adds the `slopbot:ready` label and one line to the review
comment while all of these hold at the pull request's exact head commit:

1. GitHub's `mergeable_state` is `clean` (or `has_hooks`): mergeable with every
   check passing. Slopbot has no Checks permission, so it reads this from the
   pull request itself.
2. Slopbot's latest review of that head (`slopbot_reviews.revision`) completed
   with category `none`, no coverage limitation and the comment action. A pull
   request Slopbot did not review (an exempt maintainer, a draft, the monthly
   cap) never gets the label.
3. The required approvals (default 1) on that head commit come from distinct
   `User` accounts other than the author whose repository permission is
   `write` or `admin`, and no such account's latest review requests changes.
4. Changed lines and files are within the owner's caps (defaults 400 and 20).
5. No changed path (or previous path of a rename) is protected. The built-in
   set in `ready-label.ts` covers `.github/` and CI configuration, dependency
   manifests and lockfiles, contracts and payment code, skill, agent and
   policy files, the Slop project manifest, `SECURITY.md`, binary files and
   files without a text diff, deleted files, and more than 300 deleted lines.
   Owner patterns add to it and never remove from it.

The label comes off on a new push or when a condition stops holding. Pull
request pushes, draft changes and review decisions queue a `ready_label` job,
and so does every finished pull request review. Check results have no webhook
here, so a pending result is checked again every 10 minutes for up to 14 days
per head commit, and a labelled pull request every hour
(`slopbot_ready_labels`, `dispatchReadyChecks`). A closed or merged pull request
keeps its last label. Every write re-reads the head commit first. Slopbot never
merges: a human does. Labels and comments are already within Issues and Pull
requests write, and Points and scoring are unchanged.

## Free reviews, budget blocks, spend

Free advisory reviews are capped at 2,000 pull requests or issues per
repository per UTC month; value assessment is not capped (operator decision,
16 November 2026). `review-cap.ts` admits a review before any model call and
records one row per item in `slopbot_review_month_starts`. Any later review of
an item already admitted this month (new pushes, a moved base, retries) runs
and adds nothing. A new item over the cap makes no model call, writes nothing
to GitHub and is recorded as skipped with the reason `monthly-review-cap`.

A project owner may set an intake cap (operator decision, 17 November 2026;
PRD section 5, `src/lib/intake-cap.mjs`): pause new contributors when this
many outside pull requests are open. While the stored open count of one of the
project's repositories (`repository_merge_activity.open_outside`, read by the
scheduled merge activity job) is at or above the number, `intake-cap.ts`
refuses the review of a pull request from an outside contributor that Slopbot
has not completed a review of before. It makes no model call, writes nothing
to GitHub, uses no monthly review and is recorded as skipped with the reason
`intake-cap`. A pull request reviewed once keeps its reviews, a maintainer's
own pull request is not refused, and a count that was never read or is older
than three days refuses nothing. Value assessment and scoring are unchanged.

A project owner may turn on wanted issues (operator decision, 21 November
2026; PRD section 5, `src/lib/wanted-label.mjs`). Every project uses the one
label `slop-wanted`. The scheduled merge activity job
(`refreshRegisteredMergeActivity` in `reporting-readiness.ts`) stores the open
issues that carry it and, once per repository, creates the label if it is
missing with a token narrowed to `issues: write` (`ensureWantedLabel`). That
is its only GitHub write: it never edits, renames or applies a label. A failed
creation keeps the list and is tried again at the next read. Reviews, value
assessment and scoring never read the label.

Surplus budget blocks are durable in `budget-blocks.ts` and resume when its
provider window opens. A Surplus spending denial skips the other Surplus model
and asks Orbio in the same attempt. If Orbio serves a valid result, it is used
normally. If Orbio has no key or does not serve, the request waits as `budget`
until the Surplus reset. An attempt whose only call was the Surplus denial is
not a paid value attempt and does not use one of the three attempts per
inference key (`value-inference.ts`). An attempt that also called Orbio is a
paid attempt, even when it then waits as `budget`. Free reviews still record provider cost
rows with zero customer charge. Whole-micro Orbio `usage.cost` receipts are
retained as actual cost; fractional-micro or missing receipts keep actual cost
unknown. Release qualification uses a rounded-up fractional receipt only as a
spending bound, never as a reconciled ledger charge. Spend alerts live in `spend-alerts.ts`; failure
alerts in `failure-alerts.ts`.

Every reservation occupies that three-attempt limit until recorded calls prove
the whole attempt was a free denial, or an immutable completion and a zero-call,
zero-cost reconciliation prove that no provider request started. A missing
response or unfinished result stays reserved. An immutable attempt-completion
record is written only after
call records and any valid retained result are stored; it does not assert that
provider cost amounts are known or reconciled. A full limit with unfinished
attempts returns `attempts-pending` and keeps the request on its existing
retry schedule. Only three completed non-free attempts permit terminal
`attempts-exhausted`, and a retained result is read again before that decision
is returned. Completion, cost reconciliation and journal publication are
separate facts; no reservation is refunded or expired by a timer.

## Submission fee

A project owner may turn on the refundable submission fee (operator decision,
18 November 2026; PRD section 5, `src/lib/submission-fee-setting.mjs`).
`submission-fee.ts` holds Slopbot's part; it moves no money and reads no chain.

`SUBMISSION_FEE_MODE` in `wrangler.toml` is `off`, `dry_run` or `live`; it is
`live` since 21 November 2026 (operator decision; record-only from
19 November). Any other value is `off`. While no deposit contract address is
published in `src/lib/submission-fee.mjs`, the fee does nothing in any mode.

- **Who is asked.** A pull request of a project open to contributor work,
  whose setting is on, from an author the existing `authorExemption` rule
  calls an outside contributor, opened after the setting was last turned on
  (`feeSettingSince` reads the immutable project revisions). Bots, drafts,
  closed pull requests and exempt authors never reach the gate. Nobody is
  asked for a review the intake cap or the monthly cap would refuse.
- **First sight (`live`).** One row in `submission_fee_items` with the
  project's fee at that moment, one comment (marker `<!-- slopbot:fee -->`,
  found by the App's own account, never by text), the label
  `slopbot:fee-needed`, and the review is recorded as skipped with the reason
  `fee-needed`. No model call. Slopbot's own state is in `slopbot_fee_gates`
  (`recorded`, `asking`, `asked`, `paid`, `released`); the first ask holds a
  ten-minute lease so two jobs never post two comments. A job whose comment
  or label write fails gives the lease back, so the queue's retry a minute
  later asks again instead of recording `fee-needed` with nothing posted.
- **Paid.** The submission-fee Worker sets `paid_at`. The five-minute schedule
  (`dispatchFeeChecks`), or the review job that notices it first, queues a
  `submission_fee` job. `refreshSubmissionFee` swaps the label for
  `slopbot:fee-paid`, updates the comment and queues the review it held back.
- **Outcome.** The same job sets `outcome` on a paid, undecided row only:
  `refund_due` when the pull request is merged or still open 14 days after
  `paid_at`; `kept_due` when it has been closed without a merge for 7 days,
  counted from the later of the close and `paid_at`. A `closed` or `reopened`
  event queues the check at once; otherwise a paid pull request is read again
  within a day. The Worker sends what is due and writes `refunded` or `kept`.
- **Taken back.** When the owner turns the setting off, or the author gains
  write access, an unpaid ask is released: the label comes off, the comment
  says so and the review runs. The unpaid row in `submission_fee_items` is
  removed, so a deposit sent afterwards pays for nothing and is refunded.
- **`dry_run`.** Inserts a `recorded` gate row with the reason it would have
  skipped, writes nothing to GitHub and runs the review as today. It inserts
  no row in `submission_fee_items`: nobody was asked, so a deposit naming that
  pull request pays for nothing and is refunded, and the pay page shows no
  fee. The first real ask writes the item row.

- **Payment withdrawn.** The Worker may clear `paid_at` again while no outcome
  is set, when the deposit's block is reorganised away before it is final.
  The next check puts `slopbot:fee-needed` and the asking comment back, and
  later commits wait for the fee again.

Slopbot never closes a pull request for an unpaid fee, an unpaid pull request
never gets `slopbot:ready`, and a maintainer can review and merge without it.
Value assessment and scoring never read the fee.

The ways to pay in the comment come from `submissionFeeOptions` in
`src/lib/submission-fee.mjs`, the same rule the Worker judges a deposit by:
the stablecoin of each network with a published contract at the amount fixed
for the pull request, and SLOP only while a rate from `submission_fee_rates`
is in force. The SLOP amount in the comment is the one at the time of writing;
the comment says it changes with the rate and points to the amount due now at
`/api/v1/submission-fee/items/<repositoryId>/<pullNumber>`.

## Value assessment

Value scoring is a separate pipeline from advisory/close review. Entry points:

| Concern | Module |
| --- | --- |
| Webhook enqueue and schedule drain | `index.ts`, `value-consumer.ts` |
| Request claims and budget admission | `value-requests.ts`, `value-budget.ts` |
| Evidence, patches, trees, binaries | `value-evidence.ts`, `value-patch.ts`, `value-tree.ts`, `value-binary.ts` |
| Inference and model source | `value-inference.ts`, `value-model-source.ts` |
| Journal and publication | `value-journal.ts`, `value-publication.ts` |
| Work units / joint groups | `value-work-unit*.ts`, `value-group-collection.ts` |
| Live registry / authority checks | `value-consumer.ts`, `registry.ts` |
| Historical / import intake | `value-import.ts`, `value-import-service.ts` |

The authenticated Pages assessment import accepts `Accept: application/x-ndjson` for long-running publication. It sends pending heartbeat frames, then one `{status, body}` terminal frame containing the ordinary HTTP result. A pending frame or interrupted stream does not prove publication. Reconcile the exact record through public assessment history before retrying. Requests without this Accept type keep the ordinary JSON response.

The private publisher records a failed import's fixed stage, zero-based source
index/count, allowlisted error name/HTTP status and bounded message SHA-256.
It retains no message, body, stack, path or source identity and rethrows the
original failure. The protected intake diagnostic reprojects only that exact
structured shape; an observation is not a publication receipt.

To inspect one authorized upload, generate a fresh lowercase 64-hex nonce
locally and put it in the request's `X-Slop-Intake-Correlation` header. Start
the protected diagnostic workflow with the same `correlation` before the
upload. This selects only the live production Pages tail. Pages records
authorized admission, bounded upload EOF, successful parse, the first
queued heartbeat for NDJSON, RPC dispatch, and application status. Each event
contains only its nonce, fixed phase, elapsed milliseconds, and the applicable
body byte count or terminal status. The tail filters the nonce before its
retained event cap and again when projecting the fixed event shape. A queued
heartbeat or terminal status does not establish delivery to the client.

For an earlier failure, the trusted-main `value-intake-diagnostic.yml` workflow
accepts paired `history_from` and `history_to` UTC bounds. They must cover at
most 15 minutes within the last 24 hours. The existing short live-tail path is
available when both are absent. Use the live correlation mode separately.
Retained inspection uses one dry Cloudflare
query for this Worker, at most 200 events and 1 MiB, with no automatic retry or
pagination. It checks the current deployment before and after reading. Only
the existing seven-field failures and their event times are retained; raw
messages, bodies, stacks, request IDs and query-run IDs are discarded. Missing,
unprojectable, truncated or unavailable evidence does not establish a cause or
prove that an import succeeded. Deployment stability now does not establish
the version that produced an earlier observation.
The provider's `$workers.truncated` flag and both reported ABR levels are also
checked: a truncated/invalid event or sampled/invalid query cannot report a
complete read. Absent ABR metadata follows the provider's documented default
of 1. A bounded read still does not establish unsampled source coverage or the
absence of failures.

The Cloudflare query API requires the `Workers Observability Write` permission
even for its dry read. Use only the existing protected credential. A refusal
is reported with fixed stage and scalar status/code; this workflow does not
grant permissions or create credentials. Keep observations and any subsequent
publication attempt separate, and reconcile public history before a retry.

Trusted objective-quality evidence (dormant until a verifier host and
qualification exist) is documented in [`QUALITY.md`](QUALITY.md) and
implemented in `quality.ts`. Keep
`SLOPBOT_QUALITY_QUALIFIED_PROFILE_SHA256` unset until that review passes.

## HTTP surface

| Method | Path | Role |
| --- | --- | --- |
| `GET` | `/health` | `{"service":"slopbot","ok":true}` |
| `POST` | `/github/webhook` | Signed GitHub deliveries |
| `GET` | `/v1/penalties` | Unreversed project debits for scoring |

## App permissions and events

Registered App: [slopdotcash](https://github.com/apps/slopdotcash), App ID
`5257625`. Do not create a second App or use the unrelated `slopcash` App.

Permissions: Contents read, Metadata read, Organization members read, Issues
write, Pull requests write. No others.

Events: Installation, Issues, Issue comment, Pull request, Pull request review,
Pull request review comment. The review events queue a fresh value assessment
when a review changes.

## Local test GitHub App

Do **not** put production App credentials in a local tree. For `wrangler dev`
and model-route checks, create your own throwaway GitHub App and put its
secrets in `workers/slopbot/.dev.vars` (gitignored). Use the same names as
production (`SLOPBOT_WEBHOOK_SECRET`, `SLOPBOT_APP_ID`, `SLOPBOT_APP_USER_ID`,
`SLOPBOT_APP_PRIVATE_KEY`, plus the model keys from
[`CONTRIBUTING.md`](../../CONTRIBUTING.md)). Point that App's webhook at your
local tunnel only. The owner setup checklist below is for the registered
production App (`slopdotcash`, App ID `5257625`) and Cloudflare deploy; it is
not a contributor local-dev path.

## Setup checklist (owner)

Do these in order. Each step names who does it and how to verify it.

1. **Use the registered App** (an org owner of SlopDotCash):
   [slopdotcash](https://github.com/apps/slopdotcash), App ID `5257625`.
   - Homepage: `https://slop.cash`.
   - Webhook: active. URL: `https://<worker host>/github/webhook`. Set this
     after step 6; until then, leave the webhook inactive.
   - Webhook secret: generate with `openssl rand -hex 32` and keep it for
     step 4.
   - Permissions and events: exactly as in the section above.
   - "Where can this App be installed": Any account.
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

   Surplus is primary; Orbio is the backstop. Each provider uses its own
   key. The default Anthropic-compatible bases are
   `https://api.orbio.so/api` and
   `https://api.surplusintelligence.ai/anthropic`. Optional `ORBIO_BASE_URL`
   and `SURPLUS_BASE_URL` overrides must name verified endpoints for that
   provider. See the [Orbio authentication guide](https://www.orbio.so/developers/authentication)
   and [live model catalogue](https://api.orbio.so/api/v1/models).
   The protected `slop-production` GitHub environment requires both provider
   keys. Its release uploads `ORBIO_API_KEY` together with the tested Worker
   source in one version, retaining the existing App and Surplus secrets. It
   verifies that version's ID, release tag, and all six secret bindings before
   promotion. Do not set the Orbio key separately on the old live version.
5. **Create the queues** in the production Cloudflare account (the account in
   `CLOUDFLARE_ACCOUNT_ID`, which also holds `slop-private`):
   `bunx wrangler queues create slopbot-jobs` and
   `bunx wrangler queues create slopbot-jobs-dlq`. Confirm account with
   `bunx wrangler whoami` and `bunx wrangler d1 list` first.
6. **One-time bootstrap** (owner, after claiming the deploy lever):
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
      (202660855). Changing this list needs an owner decision and a reviewed PR.

   The next protected release checks the secret inventory, uploads and promotes
   the version bound to the release SHA, applies the checked-in five-minute
   schedule and queue triggers, and probes `https://slopbot.slop.cash/health`.
   Then set the App webhook URL to `https://slopbot.slop.cash/github/webhook`
   and activate it.
7. **Verify live:**
   - `GET /health` returns `{"service":"slopbot","ok":true}`.
   - The App's "Advanced" tab shows `202` for the ping delivery.
8. **Verify free review:** use a registered repository with no project credits.
   Confirm that an eligible review runs, records provider costs, and adds zero
   customer charges. Unregistered repositories stay blocked.
9. **Qualify closure:** review real cases and counterexamples with
   `SLOPBOT_CLOSURE_ENABLED` still `"false"`. Enabling production closure later
   is a separate reviewed release that records the evidence and sets the
   existing switch. Project consent, caps, appeals and reopen protection remain
   required. Fixtures alone do not qualify model behavior.

## Supporting code map

| Area | Files |
| --- | --- |
| Contracts, caps, verdict schema | `contracts.ts` |
| Routing and audience | `routing.ts` |
| Close/label/hold publish path | `review.ts` |
| Closure eligibility (D6) | `closure-eligibility.ts` |
| Penalty table and feed | `penalties.ts` |
| Appeals, value disputes and reopen binding | `appeals.ts`, `value-disputes.ts`, `appeal-publication.ts`, `reopen-source.ts` |
| Maintainer holds | `maintainer-holds.ts` |
| Model route | `models.ts` |
| Registry / capabilities | `registry.ts` |
| Persistence helpers | `persistence.ts` |
| Repository access helper Worker | `repository-access.ts`, `repository-access-entrypoint.ts` |
| Reporting readiness | `reporting-readiness.ts` |

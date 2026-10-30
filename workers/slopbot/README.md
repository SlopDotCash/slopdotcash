# Slopbot worker

Hosted GitHub App worker under [`protocol/slopbot-v2.md`](../../protocol/slopbot-v2.md)
(PRD section 5, Slopbot). Protected releases deploy it. Automatic closing stays
off unless `SLOPBOT_CLOSURE_ENABLED` is `"true"` after an explicit production
qualification and activation review (`wrangler.toml` ships it as `"false"`).

This README is the operator contract for the tip code under `workers/slopbot/`.
Deep value, quality and recovery detail lives in the modules named below and in
[`QUALITY.md`](QUALITY.md). Do not treat older narrative in git history as
current behavior.

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
6. **Models.** `models.ts` triages with Surplus `claude-opus-5.5`, then Surplus
   `gpt-6.1-sol` as fallback. Every call is written to `slopbot_costs` with its
   internal provider cost and a zero billed amount.
7. **Close gates.** A close needs all of the following (`review.ts`,
   `closure-eligibility.ts`, `penalties.ts`, `contracts.ts`):
   - closure eligibility: a pull request whose author is not a maintainer, is a
     slop.cash member matched by immutable GitHub ID, and has a `trace_runs` row
     from their own authenticated Slop session for this project and repository
     with a `pull_request_opened` event naming this exact pull request node ID;
   - category set to close, and `penaltyFor(category).action === "close"` (the
     published table keeps `out_of_scope` label-only; `missing_evidence` and
     `none` cannot close);
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
   - a confirming second Surplus verdict; no unresolved limitations; unchanged
     item just before acting.

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
   `slopbot: moderator`) uses `PROJECT_MODERATOR_GITHUB_IDS`. A maintainer
   reopen always wins. See `appeals.ts` and `reopen-source.ts` for revision
   binding and late-close races.

For an ordinary PR value assessment, an affected author, implementation actor,
reviewer or maintainer may comment `/slopbot dispute` with their reason. Slopbot
binds the original single or joint journal digest and drafts a decision. An
author's `/slopbot appeal` also uses this path when no finding exists. Use the
exact accept/reject or moderator command in its reply to select that dispute.
An upheld value dispute does not change Points, awards, penalties or PR state;
an authorized correction must append through the existing assessment journal.
Incomplete source, partial joint context and restricted projects go to a
moderator. Historical non-PR/manual records still need their separate intake.

## Project consent

Consent is the project's automatic-closure setting, which starts unchecked;
installing the App or registering the project does not grant it
([PRD section 5](../../docs/slop-product-requirements.md)). A repository
`.github/slopbot.json` is optional. If it is absent, the project setting
decides. If it is present and valid, its `closure` flag and per-category
`off` / `label` / `close` restrictions still apply (`contracts.ts`). If it is
present but invalid, review falls back to label-only with no closure.

## Free reviews, budget blocks, spend

Provider budget blocks are durable in `budget-blocks.ts` and resume when the
provider window opens. A provider spending denial is not a paid value attempt:
the request waits as `budget` and does not use one of the three attempts per
inference key (`value-inference.ts`). Free reviews still record provider cost
rows with zero customer charge. Spend alerts live in `spend-alerts.ts`; failure
alerts in `failure-alerts.ts`.

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

   Both models use the same Surplus key. The default Anthropic-compatible base
   URL is `https://api.surplusintelligence.ai/anthropic`. Optionally set
   `SURPLUS_BASE_URL` for another verified Surplus Anthropic endpoint.
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

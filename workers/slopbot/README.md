# Slopbot worker

Hosted Slopbot GitHub App service under `protocol/slopbot-v2.md` (approved
9 October 2026; PRD BOT-08 to BOT-13). It is not deployed yet, and closing is
disabled by `SLOPBOT_CLOSURE_ENABLED = "false"`.

## Flow

1. `POST /github/webhook` verifies `X-Hub-Signature-256`, records the delivery
   ID once, updates installation state, and enqueues identifiers only.
2. The queue consumer gets an installation token and re-reads the
   repository, the item, `.github/slopbot.json`, and `AGENTS.md`,
   `CONTRIBUTING.md` and `README.md` from the default branch at its current
   SHA.
3. `routing.ts` applies the published precedence: installation, private
   repository, type switch, open/draft, bot author, human reopen, exemption,
   audience, author cap, budget.
4. Deterministic pre-filters (empty, same-author duplicate) run without a model.
5. `models.ts` runs triage: Surplus `claude-opus-5.5`, then OpenAI
   `gpt-6.1-sol` as fallback (owner decision, 9 October 2026). Every call is written to
   `slopbot_costs` with cost and billed amount (cost + 10%).
6. A close needs all of the following:
   - the category set to `close`;
   - verified evidence;
   - for guidance categories, a rule quoted verbatim from the named file;
   - confidence ≥ 0.9;
   - closure enabled globally and by the repository;
   - the shadow period over;
   - no circuit breaker and no daily cap hit;
   - a confirming second verdict (Surplus, falling back to GPT-6.1 Sol);
   - an unchanged item just before acting.

   Otherwise the bot only comments and labels.
7. `/slopbot appeal` from the author, or any reopen, blocks re-closing that
   revision.

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

## Cost statements and vault billing

`GET /api/v1/payments/slopbot/installations/<id>/invoices/<YYYY-MM>` returns
one installation's billed model calls for the UTC month. Values use integer
micro-USDC. This is a cost statement, not a request for payment or proof of
settlement. The fee offset is zero until a reviewed project binding exists.

Billing must use the existing project vaults under PAY-10. The owner authorizes
`chargeService` on Base or `charge_service` on Solana. The operation must use
only free sponsor funds, preserve reserved awards and donor funds, and prevent
a second charge for the same invoice digest. Neither contract has that
operation yet; finalized invoice reconciliation is also required before launch.
Issue #616 tracks these dependencies.

Do not send service deposits to payout-fee wallets. There is no public prepaid
deposit-credit endpoint. A past fee transfer must never become new service
credit. This change neither enables billing nor moves funds.

## Setup checklist (owner)

Do these in order. Each step names who does it and how to verify it.

1. **Register the App** (an org owner of SlopDotCash): go to GitHub →
   SlopDotCash → Settings → Developer settings → GitHub Apps → New GitHub App.
   - Name: `slopbot`. Homepage: `https://slop.cash`.
   - Webhook: active. URL: `https://<worker host>/github/webhook`. Set this
     after step 6; until then, leave the webhook inactive.
   - Webhook secret: generate with `openssl rand -hex 32` and keep it for
     step 4.
   - Permissions: Contents read, Metadata read, Organization members read,
     Issues write, Pull requests write. No others.
   - Events: Installation, Issues, Issue comment, Pull request.
   - "Where can this App be installed": Any account.
   - Verify: the App page shows exactly these permissions.
2. **Get the App identity:**
   - Record the App ID shown on the App page.
   - Get the bot user ID from `https://api.github.com/users/slopbot%5Bbot%5D`
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
   - `OPENAI_API_KEY`

   Optionally add `SURPLUS_BASE_URL` if Surplus's Anthropic endpoint differs
   from the default.
5. **Queues:** `slopbot-jobs` and `slopbot-jobs-dlq` were created on
   9 October 2026 with `wrangler queues create`.
6. **One-time bootstrap (owner, after claiming the deploy lever):**
   1. In Cloudflare → Workers, create a Worker named `slop-slopbot` from the
      "Hello World" template. Do not deploy from a local tree.
   2. Add the custom domain `slopbot.slop.cash` to that Worker.
   3. Add the step 4 secrets.
   4. Attach the queue consumer:
      `bunx wrangler queues consumer add slopbot-jobs slop-slopbot --batch-size 5 --message-retries 5 --dead-letter-queue slopbot-jobs-dlq`.
   5. In GitHub → repository Settings → Variables, set `SLOPBOT_RELEASE` to
      `enabled`.

   The next protected release runs these steps:
   - checks the secret inventory;
   - uploads and promotes the version bound to the release SHA;
   - probes `https://slopbot.slop.cash/health`.

   Then set the App webhook URL to `https://slopbot.slop.cash/github/webhook`
   and activate it.
7. **Verify live:**
   - `GET /health` returns `{"service":"slopbot","ok":true}`.
   - The App's "Advanced" tab shows `202` for the ping delivery.
8. **Qualify billing for the dogfood installation:** install the App on
   `SlopDotCash/slopdotcash` only. There is no free allowance. Keep billable
   review disabled until the vault service-charge path and invoice
   reconciliation are qualified.
9. **Observe the shadow period:** review the labels and comments for at least
   14 days and 50 items, with `SLOPBOT_CLOSURE_ENABLED` still `"false"`.
   Enabling closure later is a separate reviewed PR that sets the variable
   and records the agreement data.

## App permissions and events

- **Read:** Contents, Metadata, Organization members.
- **Write:** Issues, Pull requests.
- **Events:** `installation`, `issues`, `issue_comment`, `pull_request`.

## Not yet implemented

- There is no free allowance. Review stays blocked until billing is qualified.
- Vault service charging and finalized invoice reconciliation (PAY-10/BOT-11).
- Reviewed installation-to-project binding and payout-fee offsets.
- SCR-01 penalty journal events. Closures record `penaltyEligible` for them.
- Maintainer dashboard and Automation row (LDR-04).

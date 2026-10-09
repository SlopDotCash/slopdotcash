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
5. **Create the queues:**
   - `bunx wrangler queues create slopbot-jobs`
   - `bunx wrangler queues create slopbot-jobs-dlq`
6. **Deploy only through the protected workflow:** a reviewed PR adds the
   `slop-slopbot` deploy and the D1 migration step to
   `.github/workflows/deploy.yml`, then merges to `develop`. Claim the
   deploy lever on the issue first (AGENTS.md "Deployment"). Add the worker
   route (for example `slopbot.slop.cash`) in the same PR, then set the App
   webhook URL from step 1 and activate it.
7. **Verify live:**
   - `GET /health` returns `{"service":"slopbot","ok":true}`.
   - The App's "Advanced" tab shows `202` for the ping delivery.
8. **Fund the dogfood installation:** install the App on
   `SlopDotCash/slopdotcash` only. There is no free allowance, and automatic
   deposit crediting (BOT-11 Step A) is not built yet. Until it is, an
   operator records a verified deposit as one `slopbot_credits` row of kind
   `deposit`, with the transaction signature as its `reference`.
9. **Observe the shadow period:** review the labels and comments for at least
   14 days and 50 items, with `SLOPBOT_CLOSURE_ENABLED` still `"false"`.
   Enabling closure later is a separate reviewed PR that sets the variable
   and records the agreement data.

## App permissions and events

- **Read:** Contents, Metadata, Organization members.
- **Write:** Issues, Pull requests.
- **Events:** `installation`, `issues`, `issue_comment`, `pull_request`.

## Not yet implemented

- There is no free allowance: an installation reviews nothing until it has a
  prepaid balance (owner decision, 9 October 2026).

- Prepaid deposit crediting (BOT-11 Step A).
- The vault `charge_service` instruction (PAY-10).
- SCR-01 penalty journal events. Closures record `penaltyEligible` for them.
- Maintainer dashboard and Automation row (LDR-04).

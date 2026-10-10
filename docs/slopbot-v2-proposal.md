# Slopbot v2 proposal: hosted protection bot, cost-recovery billing

Date: 9 October 2026. Status: **approved by the repository owner on 9 October 2026.** Owner decisions: Q5 Surplus for everything; Q6 GPT-6.1 Sol fallback; Q8/Q9 both; Q14 no free allowance; all other proposed answers accepted. Requirements are merged into the PRD, MVP plan and `protocol/slopbot-v2.md`. Nothing here is
approved scope. After approval, the agreed items are merged into
`docs/slop-product-requirements.md` (PRD), `docs/slop-mvp-plan.md` (MVP plan),
a new `protocol/slopbot-v2.md`, and `AGENTS.md`/`CLAUDE.md`.

Research basis: PRD sections 9, 10, 11, 12, 14, 17, 18, 20 and 22;
`protocol/slopbot-v1.md`; `contracts/solana/programs/slop-escrow/src/lib.rs`;
`contracts/evm/src/ProjectEscrow.sol`; `src/lib/project-schema.mjs`;
`src/lib/leaderboard.ts`; `src/lib/run-receipts.ts`; `workers/*`;
`.github/workflows/*`; public provider, GitHub and incident sources listed in
section 12. All repository facts are from `origin/develop` at `8c621b5`.

---

## 1 What the owner asked for (requirement extraction)

Each line is one requirement from the request, with an ID used in the rest of
this document.

| ID | Requirement as stated |
| --- | --- |
| R1 | An installable Slop GitHub App ("Slopbot") that protects a repository from being overwhelmed by issues and pull requests. |
| R2 | It runs on Slop's servers (hosted), not in the project's CI. |
| R3 | Primary model: Claude Opus 5.5 bought through Surplus Intelligence. |
| R4 | Fallback model when Opus 5.5 fails: "GPT Astra 6.1". |
| R5 | It reviews every PR and every issue. |
| R6 | The review checks mission fit, the contributor and maintainer goals published on slop.cash, the repository's `CONTRIBUTING.md`, `README.md` and `AGENTS.md`. |
| R7 | The review detects slop, scams, spam, unwanted work, unnecessary busywork, and obvious gaming of the system. |
| R8 | It automatically closes bad or worthless items. |
| R9 | It never closes items from maintainers or organization members. |
| R10 | Goal: lower the volume of unwanted items that reach maintainers. |
| R11 | Anyone can register a project on slop.cash. |
| R12 | A project without a bounty can still register and use the bot. |
| R13 | Projects pay for the bot. |
| R14 | Payment uses a balance loaded into the same contracts/program Slop already has, but that balance goes to Slop purely as fees, not to contributors. |
| R15 | Some percentage of the money a project puts in at launch goes to the bot. |
| R16 | The bot appears on the leaderboard, credited as the initial reviewer and closer, for PRs and issues. |
| R17 | The bot receives only very small amounts: what it costs to run. |
| R18 | Cost tracking for every run. |
| R19 | Price = actual cost + 10%. |
| R20 | Ideally built in the SlopDotCash organization and this repository. |
| R21 | Before building: full requirements, clarifying questions with proposed answers, and a risk / opportunity / strength / weakness analysis. |
| R22 | After owner approval: add the result to the PRD and MVP plan, then build. |

## 2 What already exists, and where the request conflicts with it

Slopbot is already an MVP item (PRD section 10, BOT-01 to BOT-07; MVP-05).
This proposal **extends** that text. It does not start a second design.

| Area | Current approved or draft text | Conflict with the request | Proposed resolution |
| --- | --- | --- | --- |
| Who is reviewed | BOT-02: by default, only items with the `Made via @slopdotcash` marker or from registered Slop participants. External items are untouched unless the maintainer opts in. | R5 says every PR and issue. | Add a **Protection** audience mode that covers all external items. The maintainer selects it. Keep "Participants only" as the other mode. (Q4) |
| Closing outsiders | BOT-06: no punishment of a non-consenting external author. | R8 closes outsiders' items. | Separate **closing** from **penalty**. Slopbot can close an external item under published rules. A Slop Score / points penalty applies only to Slop participants who consented (BOT-06 unchanged). |
| Maintainers | BOT-03: ignore list, empty by default. | R9 exempts maintainers and members. | Default exemption for owners, org members and collaborators with write or higher permission, checked through the API. A maintainer can opt them in to *advisory* review only. They are never closed. |
| Closing at all | `protocol/slopbot-v1.md` lists autonomous closing as a non-goal and allows only `COMMENTED` reviews. | R8. | Replace it with `protocol/slopbot-v2.md`. The PRD (BOT-06) already plans this transition. |
| Who pays | slopbot-v1 "Operator and cost": the operator bears inference cost; it is never taken from a pool or a fee. PRD 18 already proposes "metered review plans with hard spending controls". | R13, R14, R19. | Metered cost-plus-10% billing becomes the v2 rule. The money never comes from contributor principal, reserved awards or donor-class funds. |
| Contracts | The escrow program has no service charge. A fee-only charge through `commit` would book 98% as contributor principal, add a 2% fee on top, and need a Slop-signed wallet binding (contracts research). | R14. | Add one owner-authorized `charge_service` instruction before the contracts get their security review. They are immutable and test-only today, so this is the cheapest time to add it. (Q8) |
| Leaderboard | Bots never score (`leaderboard.ts:518`, scoring-v2). | R16. | Show Slopbot in a separate **Automation** row/panel with its activity, accuracy and cost recovery. It never ranks by Slop Score, never takes a pool share, never dilutes contributors. (Q11) |
| Projects without funding | The PRD allows unfunded listings, but `project.json` always requires a `reward` block. | R12. | Add a **protection-only installation** that needs no manifest, no `reward` block and no security vetting, because Slopbot does not run their code and no paid work is advertised. (Q3) |
| Models | VET-05 already names "Astra-class and Opus-class" models for security scans. | R4 names "GPT Astra 6.1", which does not exist. | Use **GPT-6 Astra (`gpt-6-astra`)**, released 3 September 2026, as the fallback. (Q6) |

## 3 Clarifying questions with proposed answers

These are the questions I need answered. Each has my recommended answer. If you
accept an answer as written, reply "accept Qn". Change only the ones you
disagree with.

**Q1. Name and repository.** Is the product "Slopbot" (the PRD term), and is it
built in `SlopDotCash/slopdotcash`?
*Proposed:* Yes. Name the GitHub App `slopbot` (it posts as `slopbot[bot]`).
Register it under the SlopDotCash organization. Put the service in
`workers/slopbot/` in this repository, next to `workers/identity`. A separate
repository adds no value: the bot needs the same D1 database, identity worker,
chain verifier and policy files.

**Q2. Hosting.** Which runtime?
*Proposed:* Use Cloudflare, the same stack as today. A Worker receives the
GitHub webhook, verifies the signature and puts a minimal job on a Cloudflare
Queue. A consumer Worker fetches bounded context with a short-lived
installation token, calls the model, validates the output and performs the
allowed action. State goes in D1 (`slop-private`, new tables). v2 does
**static review only**: it does not run contributor code, so it needs no VM.
Running tests stays behind the VET/BOT-05 secure-VM work.

**Q3. Bot-only projects (R12).** How does a project without a bounty use
Slopbot?
*Proposed:* Add a new **protection-only installation**. The maintainer signs in
on slop.cash, installs the App on selected repositories, proves admin
authority, adds a prepaid balance, and commits a `.github/slopbot.json` policy
file to their own default branch. Nothing is added to `projects/` and the
project is not listed as paid work. It can show a "Protected by Slopbot" badge.
Later the same repository can become a full project and keep its history.
This respects "GitHub is the policy authority": the closure rules are public
and versioned in the project's own repository.

**Q4. Review every PR and issue (R5)?**
*Proposed:* There are two audience modes, chosen per repository:
- **Protection:** review every item from authors who are not exempt.
- **Participants only:** the existing BOT-02 behavior.

Separate switches control issues and PRs. Maintainers, members and
collaborators with write access or higher are always exempt from closing.
Bots (dependabot, renovate, the project's own Apps) are skipped by default.
Protection mode is the default for protection-only installations, and
Participants only stays the default for funded Slop projects (BOT-02).

**Q5. Model route and Surplus Intelligence (R3).** Surplus is a peer-to-peer
resale marketplace. It lists Opus 5.5 as `claude-opus-5.5` at about $0.60 input
and $3 output per million tokens, which is 85% below Anthropic's $4/$20. It has
no SLA, no proof of which model actually served a request, a settlement
contract an admin can change with no timelock, and sellers whose right to
resell Anthropic capacity is doubtful under Anthropic's Commercial Terms.
*Proposed route:*
1. **Triage:** Opus 5.5 through Surplus. It is cheap, and the content is
   already public.
2. **If Surplus fails** (error, timeout, schema-invalid output, or no offer):
   Opus 5.5 directly from Anthropic (`claude-opus-5-5`).
3. **If Anthropic fails:** GPT-6 Astra directly from OpenAI.
4. **Closure confirmation:** before any close, the "close" verdict must be
   confirmed by a **directly contracted** provider (Anthropic Opus 5.5, or
   GPT-6 Astra if Anthropic is down). This guards against a seller quietly
   substituting a cheaper model, and it gives a second opinion on the one
   action that harms people.
5. **Never Surplus:** private repositories. v2 supports public repositories
   only.

Every review discloses the provider, requested model and route step. Surplus
results say "served model unverified". Use an API key, not x402, so Slop holds
no hot wallet.

**Decision (9 October 2026): Surplus for everything, including closure confirmation.** The route is Surplus Opus 5.5, then GPT-6.1 Sol. Risks 5 and 6 are accepted by the owner.

**Q6. Fallback model (R4).** "GPT Astra 6.1" does not exist. Which model did you
mean?
*Proposed:* **GPT-6 Astra (`gpt-6-astra`)**, OpenAI's flagship ($10 input / $50
output per million tokens). The other near match is GPT-6.1 Sol, which is a
mid tier and too weak for closure confirmation.

**Decision (9 October 2026): GPT-6.1 Sol (`gpt-6.1-sol`, $2 / $10 per million tokens, cached input $0.10, per secondary sources).**

**Q7. What can be closed (R7, R8)?**
*Proposed:* Each category is set separately to off, label, or close. Closing
requires a cited rule, a cited piece of evidence, the confirmation in Q5, and
an unchanged revision.

| Category | Default in Protection mode | Needs repository guidance to close? |
| --- | --- | --- |
| Spam / advertising / unrelated content | close | No (universal) |
| Scam, phishing, malware, credential bait, malicious code | close and flag to maintainer | No (universal) |
| Empty or no-op change, generated filler, duplicate of an open item by same author | close | No (universal) |
| Out of scope / unapproved feature (per CONTRIBUTING/AGENTS/PRD) | label | Yes |
| Busywork: preference-only change, unneeded tests, unasked truncation/validation | label | Yes |
| Missing required evidence or template | label and comment, never close | Yes |
| Gaming: split-PR farming, self-dealing, mass near-identical PRs, forged attribution | label and flag (close only after maintainer enables) | Yes |
| Low-quality but plausible good-faith work | comment only, never close | n/a |

The bot never closes a merged PR, an item with an assignee or a maintainer
claim, an item a maintainer reopened, or an item while membership is
unknown. It also never closes on PRD/scope grounds when the repository
publishes no guidance (BOT-04 rule).

**Q8. How projects pay (R13, R14, R15).**
*Proposed, in two steps:*
- **Step A, launch:** **prepaid credits.** The maintainer sends USDC on Base or
  Solana to Slop's published service address with a payment reference.
  The existing finalized-transfer verifier credits the balance in D1. Each
  review debits the balance at cost + 10%. Unused credit is refundable on
  request. This needs no contract change and no Slop signing key, and it
  can ship first.
- **Step B, vault:** **the same escrow program.** Before the contracts get
  their security review and mainnet deployment, add `charge_service(amount,
  invoice_digest)` (Solana) and `chargeService` (EVM):
  - Only the **owner** can authorize it.
  - It moves money only from **free sponsor-class funds** to the existing
    `fee_recipient`.
  - It adds a `service_fees` counter to the conservation equation.
  - An invoice-digest PDA or mapping makes each charge happen exactly once.
  - It can never touch reserved principal, reserved fees or donor-class
    funds.

  The monthly invoice is a public, deterministic file. The owner signs one
  charge per month. If they do not pay, the bot moves to Suspended at the
  budget limit. Slop holds no key that can pull money.

*R15, "a percentage at launch":* at deposit time the owner can choose a service
allocation percentage (suggested 2%, owner-editable). That share of each
sponsor deposit is earmarked as the Slopbot budget. The earmark is a budget
cap, not a transfer: money moves only by the monthly charge, and any unused
earmark stays refundable sponsor money. Donor-class money is never used for
the bot. (See Q9: you may have meant something different by "fees".)

**Q9. Does "some percentage of the fees" mean the project's deposit or Slop's
own 2% payout fee?**
*Proposed:* Treat the two separately:
- **Deposit share:** as in Q8. The owner opts in; it is a budget, not a
  transfer.
- **Slop's own fee:** for funded projects, Slop's 2% payout fee from the same
  project **first offsets that month's Slopbot bill**, and only the excess is
  charged. Funded projects then pay little or nothing extra, which supports
  "very small amounts", and unfunded projects pay cost + 10%. This is a
  pricing choice. It never changes contributor amounts.

**Decision (9 October 2026): both.**

**Q10. What counts as "cost" in cost + 10% (R17 to R19)?**
*Proposed:*
- **Billable cost per run:** the actual model charges for that run (input,
  cache and output tokens multiplied by the provider's price for that route,
  in integer micro-USD) plus any confirmation call. Infrastructure (Workers,
  Queues, D1) is not itemized; the 10% covers it.
- **Calculation:** price = ceil(cost × 1.10) in micro-USDC, recorded per run.
- **Not billed:** runs that deterministic pre-filters drop before any model
  call, retries caused by Slop, and failed provider calls.
- **Reconciliation:** monthly, against provider invoices (Anthropic and OpenAI
  usage, the Surplus dashboard and its USDC spend). Publish any difference;
  never adjust it silently.
- **Price table:** a reviewed file. Changes take effect only at a future
  month boundary.
- **Charging rule:** charge per review, never per closure, so Slop earns
  nothing extra by closing.

**Q11. Leaderboard (R16).**
*Proposed:*
- **Placement:** an **Automation** section on the leaderboard and on each
  project page with one Slopbot row.
- **Metrics:** items reviewed, items closed, closures reopened or overturned,
  agreement with maintainers (slopbot-v1 agreement record), and cost recovered
  in USDC, labeled "cost recovery, not earnings".
- **Exclusions:** it never appears in the Slop Score, Points or Money received
  ranks, and never takes a monthly-pool share.
- **Attribution:** "initial reviewer / closer" is shown on each item's
  record.

**Q12. Penalties (SCR-01).**
*Proposed:* Keep the PRD default (−10 points, −1 Slop Score). It applies only to
consenting Slop participants, once per item, with reversal on reopen or appeal.
External authors receive no Slop record beyond the public outcome counts.

**Q13. Appeals.**
*Proposed:* Every close comment explains the rule, the evidence and how to
appeal. To appeal, the author comments `/slopbot appeal`, which adds a label
and a maintainer queue item. A maintainer reopen always wins. The bot never
re-closes the same revision after a human reopen. A new PR head or issue edit
starts a new review. Repeated reopen wars escalate to the maintainer; the bot
never bans anyone.

**Q14. Free allowance?**
*Proposed:* Yes, a small one: the first **$5 of billable cost** per new
installation, paid by Slop as acquisition, then prepaid only. With the cost
estimate in section 6, that covers about 100 or more reviews and the full
shadow period.

**Decision (9 October 2026): no free allowance.** An installation needs a prepaid balance before any review.

**Q15. Rollout safety.**
*Proposed:*
- **Shadow mode:** every new installation starts in shadow mode for 14 days
  or 50 items, whichever is later. In shadow mode the bot labels and comments
  but never closes.
- **Enabling closure:** the dashboard shows what the bot *would* have closed
  and the maintainer's decisions on those items. Closure is enabled only when
  the maintainer turns it on.
- **Circuit breaker:** a per-repository daily closure cap (default 25). If
  more than 10% of the bot's closures in 7 days are reopened, it switches to
  label-only automatically.

**Q16. GitHub Marketplace?**
*Proposed:* Not for v2. Paid Marketplace listing needs a verified publisher and
about 100 installs, and its card billing does not fit USDC credits. Publish the
App as a public App installed from slop.cash. Revisit when the bot has more
than 100 installations.

## 4 Proposed requirements (to merge into PRD section 10 and related sections)

Existing BOT-01 to BOT-07 stay. The changes are:

- **BOT-02 (amend):** add the Protection audience mode, default member
  exemption, bot skips, and separate issue/PR switches (Q4).
- **BOT-06 (amend):** separate closing from penalty; allow closing of external
  items under published universal or repository-cited rules; require a
  direct-provider confirmation; Q7 table; never-close list.
- **BOT-07 (amend):** metered cost + 10%, budgets, Suspended at exhaustion,
  free allowance, and public monthly invoices (Q10, Q14).
- **BOT-08 (new), protection-only installations:** Q3. No manifest, no reward
  block, no VET gate while the bot is static-only. Config lives in
  `.github/slopbot.json` on the default branch, with schema validation; an
  invalid file fails closed to label-only.
- **BOT-09 (new), model route and disclosure:** Q5 route, model allowlist,
  schema-validated structured output, no tools, private repositories
  excluded, per-step disclosure, served-model-unverified label.
- **BOT-10 (new), cost ledger:** one immutable cost row per model call:
  provider, model, route step, token counts, price-table version, cost
  micro-USD, billed micro-USDC, run and item IDs, and reconciliation status.
- **BOT-11 (new), billing:** Q8 Step A prepaid credits through verified
  transfers; refund path; Step B `charge_service` in both programs; the Q9
  offset of Slop's own fee.
- **BOT-12 (new), safety rollout:** Q15 shadow mode, caps, circuit breaker,
  appeals (Q13).
- **BOT-13 (new), cost-DoS protection:** run deterministic pre-filters before
  any model call (empty diff, exact duplicate, known spam fingerprints, burst
  from one author); cap reviews per author per day for accounts with no
  history in the repository (default 3); point maintainers to GitHub's own
  pull-request limits (June and August 2026 features).
- **LDR-04 (new):** the Automation row (Q11).
- **FND-06 (new):** service allocation earmark (Q8 R15). Never from donor
  class.
- **PAY-10 (new):** `charge_service` contract requirement, `service_fees`
  conservation, invoice exactly-once.
- **Section 18 (amend):** Slopbot cost-recovery pricing replaces "subscriptions
  or metered plans".
- **Section 22 (add decisions):** Surplus use, fallback model, closure
  categories, billing steps, free allowance.
- **MVP plan:** amend MVP-05; add **MVP-05a** (protection-only installation,
  route, ledger, prepaid credits), **MVP-05b** (vault `charge_service`, merged
  into MVP-06 contract work), and **MVP-09a** (Automation row).

## 5 Proposed architecture

```text
GitHub ──webhook──▶ workers/slopbot (ingress)
                     verify HMAC, dedupe delivery ID, enqueue {installation, repo, item, event}
                          │
                          ▼
                   Cloudflare Queue ──▶ workers/slopbot (consumer)
                     1 load config (.github/slopbot.json @ default branch SHA) + health
                     2 routing: security/suspension → enabled → type scope → exemptions
                       (members API, collaborator permission) → audience mode → budget
                     3 deterministic pre-filters (free)
                     4 context pack: policy files @ base SHA (digests), item revision, bounded diff
                     5 model route (Q5) → strict JSON verdict {category, rule_ref,
                       evidence_refs, confidence, summary} – no tools, no secrets
                     6 cost row (BOT-10), balance debit
                     7 if close candidate: confirmation call (direct provider)
                     8 action service: recheck state, revision, membership, budget,
                       caps → one comment (edited in place) → label → close
                     9 outcome / penalty events (SCR-01) for consenting participants only
D1: installations, repo_configs, review_runs, cost_ledger, credit_ledger,
    actions, appeals, health
slop.cash: install flow, maintainer dashboard (health, shadow results, spend,
           invoices, appeals), Automation leaderboard row
```

GitHub App permissions:
- **Write:** Issues (comment, label, close), Pull requests (close).
- **Read:** Contents (policy files, diff), Metadata, Organization members
  (exemptions).
- **Events:** `pull_request`, `issues`, `issue_comment`, `installation`,
  `installation_repositories`.
- **Excluded:** checks, statuses, merge and admin.

## 6 Cost estimate (illustrative, not a promise)

Assumption for one item: about 30k tokens of policy context (cacheable), about
10k tokens of item content, and about 1.5k output tokens.

| Route | Approximate cost per item |
| --- | --- |
| Opus 5.5 via Surplus ($0.60 / $3) | about $0.03 (no prompt-cache data from Surplus) |
| Opus 5.5 direct, with cache hits | about $0.08 |
| GPT-6 Astra direct ($10 / $50) | about $0.48 |
| Close confirmation (direct Opus) | +$0.08, only on close candidates |

At 1,000 items a month with 20% close candidates, that is about $46 of cost, or
about $51 billed. A 50-item shadow period costs about $2. Real figures come from
the cost ledger in the first 30 days; this table is only for sizing.

## 7 Strengths

- The existing PRD already has the hard policy work: routing, ignore lists,
  exact-revision binding, penalties, reversal and appeals. v2 mostly
  connects it.
- Charging per review, cost + 10%, and charging nothing extra for closing
  removes any incentive for Slop to close good work.
- GitHub-native: the policy lives in the project's own repository and every
  action is a normal, reversible GitHub event.
- Existing assets to reuse: the chain verifier, the micro-USD receipt schema,
  the reviewer skills as prompt basis, and the D1/Worker stack.
- Static-only v2 avoids the hardest security dependency (VM execution).

## 8 Weaknesses

- No GitHub App, webhook, queue or installation-token code exists yet. This is
  new infrastructure.
- The escrow contracts are not on mainnet, so Step B billing depends on the
  contract security review.
- "Busywork" and "mission fit" are subjective. The bot can only enforce what
  the repository has written down.
- Surplus is a young market with thin supply and no verification.
- Static review cannot prove a change works. It can only flag clear
  problems.

## 9 Opportunities

- **Funnel:** protection-only installations are the cheapest way to bring
  maintainers to Slop. Some later fund bounties.
- **Timing:** GitHub's 2026 pull-request limits show the AI-PR flood is a
  recognized problem. Slopbot is the content-aware layer above GitHub's
  blunt per-user caps.
- **Data:** agreement data (bot versus maintainer per model) is a public
  quality signal and a sales asset.
- **Dogfooding:** run it first on `SlopDotCash/slopdotcash`, which states
  exactly these rules in `CONTRIBUTING.md`/`AGENTS.md`.
- **Pricing:** cost + 10% with a public invoice is an honest price that is
  easy to explain.

## 10 Risks, failure modes and answers

| # | Risk | What could go wrong | Answer |
| --- | --- | --- | --- |
| 1 | False closure of good work | A first-time contributor's legitimate fix is closed, and the project and Slop look hostile. | Shadow mode first; close only universal or cited categories; direct-provider confirmation; never close on unknown membership or missing guidance; daily cap; reopen-rate circuit breaker; one-step appeal; maintainer reopen always wins. |
| 2 | Prompt injection | Issue text tells the model to close a rival's PR, leak data or approve itself (Clinejection, February 2026). | The model has no tools, no secrets and no network. Output is a strict enum schema. Code performs the actions after independent state checks. A verdict can affect only the item it reviewed. Content is passed as delimited data, never as instructions. Adversarial fixtures go in the acceptance tests. |
| 3 | Maintainer misclassified | Private org membership shows as `CONTRIBUTOR`/`NONE` in `author_association`. | Never trust `author_association`. Check the org members API (Members: read) and collaborator permission. A lookup failure means unknown, so the bot does not close. |
| 4 | Cost denial of service | An attacker floods a repository with PRs to drain its balance. | Free pre-filters; per-author daily caps for authors with no history; Slop-caused retries not billed; hard budget with Suspended state (blocked, never "clean"); GitHub PR limits recommended. |
| 5 | Surplus problems | Outage, model substitution, admin fee change, seller terms violations, end of supply. | The route falls back automatically; closures always need direct-provider confirmation; served model labeled unverified; API-key billing (no Slop wallet); one config switch removes Surplus. Owner accepts the terms risk explicitly (Q5). |
| 6 | Provider terms | Anthropic's Commercial Terms restrict resale. Buying resold access may be challenged, and supply can vanish. | Same as 5. Keep the direct Anthropic account funded as the reliable path. Legal reads Surplus terms before launch (their `/terms` page returned 404 during research). |
| 7 | Legal: fees and prepaid balances | Holding customer prepayments, refunds, sales tax, sanctions screening. | PRD section 17 already requires counsel review for fee collection in payment flows. Step A is ordinary prepaid service credit; counsel confirms before launch. No Slop key moves project funds in either step. |
| 8 | Contract change risk | `charge_service` drains reserved money through a bug. | It is restricted to free sponsor-class funds, owner-signed, exactly-once by invoice digest, included in the conservation invariant, and covered by the existing security review before mainnet. |
| 9 | GitHub rate limits | Mass closing hits the secondary content-creation limit (about 80 per minute, 500 per hour). | Queue with backoff and retry-after; one comment per item, edited in place; installation-level concurrency limit. |
| 10 | Review loops | Bot comments trigger webhooks, edits create re-reviews, and duplicate deliveries cause double actions. | Ignore own events; dedupe by delivery ID and by (item, revision, policy digest); one canonical result per revision. |
| 11 | Policy weakening by PR | A PR edits CONTRIBUTING.md to allow itself. | Always review against the base-branch policy at its SHA (BOT-04). |
| 12 | Leaderboard optics | "Slop pays itself on its own leaderboard." | Separate Automation section; "cost recovery" label; public invoices and cost ledger; never ranked with people. |
| 13 | Gaming the bot | Spammers learn phrasing that passes. | It is a filter, not a guarantee: the human merge gate stays. Update fingerprints. Track misses that maintainers close later. |
| 14 | Private data | Private repository content sent to resellers. | v2 supports public repositories only. Private support later needs direct providers with zero data retention. |
| 15 | Unpaid bills or empty balance | Protection stops silently. | Low-balance alerts at 25% and 10%; Suspended state is visible on the dashboard and in a one-time repository notice; nothing is closed without budget. |
| 16 | Over-reach into scoring | The bot's verdict changes contributor pay. | The verdict never scores, excludes or pays. Only the published penalty for consenting participants applies (SCR-01), with reversal. |
| 17 | Uninstall or repository transfer | Queued jobs act after removal. | Recheck installation and config just before every action (BOT-01). |

## 11 Build plan after approval

1. **Docs (one PR):** amend the PRD (section 4 of this proposal), the MVP
   plan, `protocol/slopbot-v2.md` (supersedes v1 at an effective month),
   `AGENTS.md`/`CLAUDE.md` (byte-identical) and `CONTRIBUTING.md` (bot
   behavior and appeals).
2. **Service core:** `workers/slopbot` ingress and consumer, D1 migration,
   App JWT and installation tokens, config loader, routing, pre-filters,
   model route with cost ledger, comment and label actions, shadow mode.
   Dogfood on `SlopDotCash/slopdotcash`.
3. **Closure:** confirmation call, action service, caps, circuit breaker,
   appeals, and SCR-01 events for participants.
4. **Billing A:** prepaid credit through the verified transfer, balance
   checks, invoices, free allowance, refunds.
5. **UI:** install flow, maintainer dashboard, Automation row. This needs
   video evidence per CONTRIBUTING.
6. **Billing B:** `charge_service` in both contracts, folded into the MVP-06
   contract review.

Owner-side setup that I cannot do:
- register the GitHub App and give me its ID and private key through
  Cloudflare secrets;
- create the Surplus, Anthropic and OpenAI API keys;
- publish the service receiving addresses;
- get counsel sign-off.

## 12 Sources

- Surplus Intelligence: https://www.surplusintelligence.ai/, https://www.surplusintelligence.ai/markets, https://alearesearch.substack.com/p/surplus-intelligence-an-order-book
- Anthropic pricing: https://platform.claude.com/docs/en/about-claude/pricing; terms: https://www.anthropic.com/legal/commercial-terms
- GPT-6 Astra: https://openai.com/index/gpt-6-astra/, https://developers.openai.com/api/docs/models
- GitHub rate limits: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- GitHub PR access and limits: https://github.blog/changelog/2026-02-13-new-repository-settings-for-configuring-pull-request-access/, https://github.blog/changelog/2026-06-17-limit-open-pull-requests-for-users-without-write-access/, https://github.blog/changelog/2026-08-06-set-pull-request-limits-at-the-organization-level/
- Marketplace requirements: https://docs.github.com/en/apps/github-marketplace/creating-apps-for-github-marketplace/requirements-for-listing-an-app
- Prompt-injection incidents: https://simonwillison.net/2026/Mar/6/clinejection/, https://blog.trailofbits.com/2025/08/06/prompt-injection-engineering-for-attackers-exploiting-github-copilot/

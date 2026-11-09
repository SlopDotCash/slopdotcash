# Slop product requirements

**Make money shipping and securing open source.**

Slop connects accepted open-source work and private security reports to review and rewards. Public work stays on GitHub. Private reports enter through Slop. Slop records Points, decisions, and payment evidence.

This document defines product behavior, user flows, acceptance criteria, and release conditions. The repository copy governs; Google Docs mirrors it after repository review. A requirement does not establish implementation or production readiness.

## 1. Product and scope

### Problem and intended outcome

Contributors need useful work, clear acceptance rules, and a reliable reward record. Maintainers need accepted results without paying for activity or reviewing invented work. Researchers need confidential intake and a traceable human decision. Administrators need bounded authority and evidence for exceptions.

Slop must connect these needs without replacing GitHub authority or confusing a projected reward with a payment.

### Scope

The minimum viable product (MVP) includes:

- GitHub accounts, payout wallets, preferences, and private Inbox notices.
- Self-service project registration, immutable terms, and generated contribution skills.
- Public work discovery, Slopbot review, Points, rankings, and appeals.
- Project security admission, contributor flags, and human moderation.
- Private reports, discretionary bounties, remediation, and controlled disclosure.
- Monthly vault allocations, supported private-award payments, and finalized payment records.
- Conversion of received fees within the approved fee wallets.
- The separate contributor token allocation described in section 6.

Support Base, Ethereum, Robinhood Chain, and Solana. Each project selects one network and asset. Section 6 defines supported assets and payment restrictions.

### Boundaries

Score accepted outcomes, not commits, comments, token use, or test counts. Any provider, model, or agent client may participate with exact attribution. Manual work is also permitted.

Only project owners and maintainers open issues. Contributors use approved requirements and existing issues. An issue alone does not approve scope. The target repository's contribution rules still apply.

Slop must not infer copyright ownership, legal capacity, assignment, wallet control, or payment authority from GitHub identity. Slop does not guarantee awards or vault funds.

Referrals remain disabled and outside launch scope. Do not start a later phase until maintainers record MVP completion and approve that phase. New product requirements need human approval before implementation.

### Success measures

Use existing work, case, allocation, and payment records to assess these outcomes. Keep private-case measures within authorized views.

| Outcome | Measure |
| --- | --- |
| Useful public work | Accepted work units and useful reviews, with complete source coverage and no duplicate credit. |
| Useful security work | Qualifying reports, human decisions, verified fixes, and unresolved cases. |
| Reliable rewards | Eligible allocations, finalized payments, unpaid obligations, and reconciliation errors. |
| Timely service | Time from acceptance or report receipt to decision and eligible payment; failed or overdue notices. |

Numeric growth, availability, latency, and response-time targets are not approved in this specification. Do not invent them or present them as launch commitments.

## 2. Authority and records

### Sources of truth

| Record | Authority |
| --- | --- |
| Repository identity, permissions, work, and merge acceptance | GitHub, using permanent repository and actor IDs. |
| Project inventory and published terms | D1 `projects`, `project_revisions`, and `project_applications`; each change appends an immutable revision. |
| Sessions, preferences, wallet records, and private decisions | Authenticated account and case services. |
| Points and corrections | Append-only journal with source identity, occurrence time, and recording time. |
| Monthly proposals and final allocations | Private D1 allocation records. |
| Deposits, reservations, and completed payments | Exact finalized chain evidence, reconciled with the applicable obligation. |

Generated snapshots and pages derive from these records. They are not separate inventories. Never edit generated registry or public build outputs by hand. Retain history when a project pauses or retires; never delete registry rows.

A score, model result, device signature, or database entry cannot replace another required proof. GitHub stewardship does not establish legal ownership or financial authority.

### Roles

| Role | Permitted decisions and actions |
| --- | --- |
| Contributor | Select permitted work, submit a PR, review work, manage their wallet, and appeal a decision. |
| Researcher | Submit a private report, provide evidence, authorize optional forwarding, and consent to a payout destination. |
| Project owner or maintainer | Prove current GitHub authority, publish terms, accept work, review authorized cases, and decide awards. |
| Financial approver | Authorize permitted funding and payments with the required wallet and project authority. A case role alone grants no signing power. |
| Administrator | Manage listing tiers, authorized restrictions, and recorded policy exceptions. Administration alone grants no general private-report access. |
| Moderator | Decide escalated disputes, appeals, and confirmed-malicious bans. Preserve funded obligations and appeal access. |
| Security operator | Inspect scanner evidence only through the approved audited access process. |
| Slopbot | Review, score, apply eligible penalties, perform qualified closure, and triage disputes under published rules. |

Recheck current authority for sensitive reads and actions. Refuse unauthorized self-approval, cross-project access, and access after role revocation.

### Terms

A **pull request (PR)** proposes a repository change. **D1** is Slop's database service; **R2** is its private object storage service. **UTC** is the time standard for periods and deadlines.

An **asset base unit** is the smallest transferable unit. **Gross** is the amount before fees; **net** is the recipient amount. **Principal** excludes network fees. **Finality** is the required chain confirmation, not submission or inclusion alone.

A **reserve** holds funds for an obligation. A **pledge** states an intention without proving funds. **Clearance** permits project admission under the security policy. A **work unit** groups related accepted contributions for one scoring decision.

**EVM** means Ethereum Virtual Machine. **ERC-20**, **SPL**, and **Token-2022** identify supported token standards or programs. **RPC** is the interface used to query or submit chain data. **USDC** and **USDG** are asset names, not interchangeable dollar balances.

### State meanings

These are separate dimensions. Do not collapse them into one success status.

| Dimension | Distinct states or facts |
| --- | --- |
| Project | Setup readiness, admission clearance, funding readiness, listing tier, pause, quarantine, and retirement. |
| Award | Projected, under review, approved, or excluded. Approval alone does not prove funds or payment. |
| Payment | Underfunded, awaiting wallet, ready, scheduled, held, submitted, or paid. A submitted transaction is not paid. |
| Private case | Receipt, screening, human review, award, funding, payment, remediation, and disclosure. |
| Notice | Saved, read, acknowledged, provider-accepted, delivered, failed, or uncertain. |
| Data | Loading, empty, stale, invalid, denied, unavailable, failed, or current. Missing data is not zero. |

A funded award never expires because of time or a missing wallet. The separate contributor token allocation uses its own deadline and Unclaimed state.

## 3. Accounts and wallets

### Identity and account pages

GitHub is the only login method. Use permanent actor IDs through account renames. Preserve the return destination and permitted drafts through sign-in.

Settings, Payouts, and Inbox are separate pages reached from the account menu. Do not add shared account navigation tabs. Settings contains wallet management and email preferences, both always expanded. Payouts links to wallet management when needed. Preserve existing wallet deep links.

Keep current-session sign-out and backend session validation, expiry, revocation, account closure, and appeal records. Do not restore the session list, Connections card, or Security card. Keep recovery, closure, and account-appeal controls out of Settings. Do not add a payout-wallet shortcut to contributor profiles. The Activity email switch has no outer button border.

Account closure ends all sessions and makes the account private. Explicit reopening is permitted. Preserve wallet records, identity reservations, obligations, settlement history, and private cases.

### Public membership and optional X connection

Active memberships and connected X profile links are public. Disclose this before sign-in or connection. Existing private membership and connected X links become public at the next authenticated sign-in. Explicit reopening and new X connections are public. Public reads must not perform this transition.

Keep closed accounts private and removed links disconnected. Do not change private cases, traces, wallets, email consent, or historical Points during the transition.

An X connection requires OAuth authorization and is optional. Store only its ID, optional username, verification time, and visibility. Reserve the ID to the first verified GitHub identity, including after disconnect. It grants no Points, posting permission, messaging permission, or other authority.

Telegram remains retired. Preserve historical records, but provide no bot, connection, profile link, or support route.

### Wallet registration and recovery

A user may add EVM and Solana payout wallets. Record walletless awards against the account. Require a verified wallet only for payment.

Bind a wallet with both authenticated account evidence and the destination wallet's signature. Neither proof establishes the other identity. Changed or recovered wallets activate immediately after these proofs. There is no waiting period.

Keep the current verified wallet active until the replacement wallet signs its authorization. Preserve the first-registration proof, pending attempts, uncertain attempts, and replay protection.

Redirected recovery uses one operator: contact the operator by email, then complete the contributor-signed self-service flow. The operator gains no signing or payment authority. Retain historical recovery records; retire the unused admin wallet-proposal endpoint.

For an unpaid private award, use explicit review and a successor payment request after a wallet change. Obtain renewed reporter consent. Retire or prove expiry of every prior signable request before presenting the replacement. Preserve paid legs. Deleting a database row never cancels an external transaction or permits a second payment.

### Email enrollment

Users enroll and verify their own notification address. Verification is account-bound, expiring, single-use, and stored only as a token digest. Use a provider configuration that can deliver to verified user-selected destinations.

Security and activity email consent remain separate, explicit, and revocable. In-app notices work independently. Unsubscribe stops future delivery without granting account or case access. Section 9 defines delivery and retry behavior.

## 4. Projects and contribution skills

### Contributor journey

1. Open a project and read its scope, reward terms, restrictions, and freshness.
2. Inspect live GitHub for permitted, bounded work and overlapping submissions.
3. If using a skill, install its verified project version.
4. Follow repository rules and test the useful result.
5. Open a PR with the requirement, result, evidence, and exact attribution.
6. Follow review, acceptance, Points, and any appeal.
7. If an eligible funded award exists, view it in Payouts and register a wallet if needed.
8. Follow that payment until finalized evidence proves completion.

Stale discovery requires a live check. Assignments, maintainer claims, drafts, active review requests, approvals, and changes requested exclude work selection. Security labels, human-gated work, epics, and project restrictions also exclude selection. Do not claim platform authority over an issue or create placeholder work.

Work may earn acceptance and Points without a funded award. A pause stops contributor work. A failed payment preserves the award and reserve. Ordinary submission remains possible without payout registration, a measured run, a device key, a signed receipt, or a private trace.

### Maintainer journey

1. Sign in and start or resume Add project.
2. Select a public repository and prove current GitHub authority.
3. Complete Project, Rewards, and Review.
4. Preview the public page and generated skills.
5. Install Slopbot and complete admission clearance.
6. Publish the project when all setup requirements pass.
7. Review work and authorized private cases; manage unresolved assessments in Inbox.
8. Adjust monthly allocations or decide individual bounty awards under the published terms.
9. Publish later changes as immutable revisions.

No routine administrator approval is required. A stored applicant may publish through the same current authority checks. Funding readiness remains separate from registration and admission.

### Setup requirements

Project contains the repository, integration branch, and contribution rules. Provide one picker for the user's public repositories and URL entry for other public repositories. Load repository facts after selection.

Verify permanent repository and actor IDs, current write or maintain authority, license facts, integration branch, and reward terms. Record the license URL, commit, and digest. Read Slopbot installation status before creation.

Collect scope, contribution guidance, supported tasks, required tests, review expectations, security contact, closure policy, and maintainer notes. Preview both generated skills. Missing required skill fields prevent skill publication.

Rewards offers a monthly pool or Private bounty. New monthly projects use one contribution pool, not a second review budget. Preserve historical review-budget commitments. Bounty-only projects have no monthly pool.

Monthly rewards and bounties use the same network and asset choices. A new bounty records the selected branch's immutable revision, owner-defined scope, acceptance criteria, and safe-test rules. Its creator is the initial contact and sponsor. Show gross award, researcher share, Slop share, and private-report terms before creation.

New bounties use a 75/25 split and an after-approval pledge. Owners cannot grant split exceptions. Creation neither proves funds nor requires a bounty vault. Section 8 defines award and payment rules.

An optional custom project image falls back to the GitHub owner avatar. Do not use social-preview images. Save changes as presentation revisions.

Show one setup summary with separate authority, Slopbot, security, and funding results, plus the next action. Activate after complete setup, current authority, installation, and valid admission clearance. Economic policy changes apply from the next UTC calendar month; preserve frozen terms and funded obligations.

### Skill source and installation

Generate each skill from one canonical generic template and the approved D1 project revision. The same inputs must produce the same bytes. Maintainer notes cannot weaken template rules. Do not store per-project skill copies.

The trust root is the canonical immutable template commit and approved D1 revision digest. The checksum detects corruption only. Resolve the full 40-character commit through the fixed canonical GitHub API. Verify the complete tree against immutable GitHub bytes and verify the rendered output against the approved digest.

Any resolved canonical commit may supply the template, including unreleased, divergent, older, or previously revoked commits. Do not add freshness, ancestry, release-label, or revocation gates. These checks prove source identity, not maintainer approval.

Ordinary updates must not decrease the D1 revision. Explicit rollback rechecks retained bytes, the digest, and current installation clearance. Installation, update, and rollback require current project status and clearance.

Reject missing or extra files, mutable redirects, working-tree provenance, and byte mismatches. Preserve immutable sibling versions, the process-bound kernel lock, atomic relative-symlink activation, and prior verified versions. Tests may inject deterministic `file://` authorities only through the generator's test option.

Installed `authorize` and `start` validate local provenance, complete hashes, and receipt schema without live authorization calls. A local checkout is not an installation. Existing installs need one verified update to gain this behavior; never rewrite historical templates.

Repository access, live work selection, submission checks, and consent rules still apply. Inspect malicious code and prompt-injection risks before installation or execution. Report a risk and stop the local workflow.

### Submission and optional evidence

A PR states the problem, approved requirement, useful result, implementation choice, and real evidence. Include `Made via @slopdotcash` once and the exact provider, model, and client. Agents star and fork only when they can use browser or computer control. Stars and forks earn nothing.

After opening the PR, the skill records `pull_request_opened` with the exact PR node ID through the author's authenticated Slop session. This evidence supports automation eligibility; it is not a prerequisite for ordinary GitHub submission.

Signed receipts and minimized private traces are optional. The contributor inspects and redacts a selected trace before upload. The uploader stores those exact bytes. Usage totals are diagnostic and never change Points, rank, share, or payment. A device signature proves byte continuity, not provider billing.

The separate reviewer skill is advisory. It checks correctness, tests, security, scope, duplication, abuse, evidence, and usefulness. Place its recommendation before the exact provider, model, and client footer.

## 5. Slopbot

### Review and scoring

Slopbot is required, always free, and limited to registered repositories. Never charge a project vault for bot review.

Apply effective repository security, scope, ignore, and rejection rules before review. Review exact source against approved base-branch rules. Run untrusted code only in approved isolation without secrets or posting credentials.

Use Surplus Opus 5.5, then GPT-6.1 Sol as fallback. Show no-findings, limited-coverage, and retryable-failure outcomes. Identify unreviewed content. A limited review cannot label, close, penalize, or claim full verification. Large or binary evidence must not silently exhaust attempts.

Slopbot assesses PR size and value and credits useful reviews under section 7. Maintainers decide merges. Preserve repository opt-outs and exemptions.

### Closure eligibility and consent

Automatic closure requires all of the following:

- A registered project with saved closure consent and a qualified category.
- A non-maintainer author who is a Slop member, matched by permanent GitHub ID.
- The author's authenticated `trace_runs` record for that project.
- A `pull_request_opened` event naming the exact PR node ID.
- Required independent confirmation, caps, source checks, and production activation.

A copied marker or footer proves none of these facts. Closure alone does not authorize a penalty.

New project drafts start with closure selected. Keep the control editable and save an explicit opt-out. Missing saved consent means false. Registration and installation alone are not consent. Do not alter existing projects' consent. No separate `.github/slopbot.json` is required, but preserve existing file opt-outs and category restrictions.

Uncertain findings go to the maintainer. After seven days without action, Slopbot may apply the verdict as a label only. An uncertain finding never closes a PR. Preserve maintainer reopen decisions.

On paused, flagged, or quarantined projects, authorized security review may only comment and apply the scam label. Retired projects receive no review. These projects remain unavailable for contributor work.

### Appeals, qualification, and cost

Slopbot triages appeals and drafts a resolution. A moderator decides escalated cases under section 9. A scam or malicious closure also creates one moderator Inbox notice to review the account.

Qualify closure with reviewed real cases and counterexamples. A fixed 14-day or 50-item threshold is not sufficient. Fixtures prove controls, not model quality. Keep the global switch off until explicit production activation. Record the reviewed evidence and any qualified objective verifier.

Ongoing value scoring uses alerts-only spending: no monthly hard cap or fixed attempt reserve. Email the operator at each crossed $500 monthly milestone. Alert on low Surplus balance and provider failures. Retain immutable attempts, actual or unknown costs, duplicate refusal, and queue limits. Capped mode retains numeric reservations. Missing or malformed configuration stops inference.

Paid API assessment begins on 1 November 2026 UTC. September and October assessments use ChatGPT subscription subagents. The Slop repository slice may instead use Claude subscription subagents or Codex subscription sessions/subagents with GPT-6.1 Sol. Import results through the standard assessment journal with exact attribution. A subscription declaration is not an API receipt or billing proof. Section 7 defines the historical publication hold.

## 6. Funds and payments

### Assets and funding

Monthly contribution rewards use one project vault, network, asset, and deposit balance. Private awards may use supported direct payments or an existing separate bounty vault. Preserve ordinary and bounty purposes.

Anyone may deposit into a vault. All deposits share one bucket. Only the owner's refund destination receives free-fund withdrawals. State this before deposit signature. Reserved awards and fees cannot be withdrawn. Funding is optional; a pledge is not available funds.

Support approved stablecoins, standard ERC-20 tokens, classic SPL tokens, native ETH, and native SOL. Use native coins directly, not wrapped substitutes. Separate principal from network fees and preserve Solana rent reserves.

The supported Token-2022 subset permits only `MetadataPointer` and `TokenMetadata` mint extensions. Mint and freeze authorities must be disabled. Token accounts may have `ImmutableOwner` or no extensions. Reject all other or unknown extensions. Exclude transfer-fee, rebasing, transfer-hook, confidential-transfer, interest-bearing, and other balance-changing behavior.

Verify the asset identity, token program, decimals, behavior, and finality throughout each flow. Use integer base units and largest-remainder allocation. Never assume six decimals, add unlike assets, or present a token amount as dollars.

### Monthly allocation

Automatic monthly payment is the default when funds are committed. The owner sets the monthly cap during setup and may change it or opt out. Vault creation enables monthly commitment unless the owner opts out.

The period is the calendar UTC month, starting November 2026. The trusted monthly workflow freezes the complete closed-month ledger and writes each project's proposal once. A repeat run must not add or replace rows. Store allocations privately in D1, not new cycle files.

The owner may adjust amounts or finalize early. At 72 hours after month end, the automatic process freezes the current allocation once. Do not publish adjustment history or require public reasons. Retain records needed for disputes and reconciliation.

Only accepted-work Points for that project and period set shares. Rollover never increases a later monthly cap. An underfunded month creates no obligations until the entire allocation is covered. Prevent manual and automatic duplicate payments.

Keep walletless funded awards reserved without expiry. One recipient's failure must not block others. Preserve historical cycles' original review windows and frozen terms.

### Fees and payment evidence

For ordinary awards and free-fund withdrawals, the fee is `ceil(gross / 50)`: 2%, rounded up. A 100 USDC award pays 98 to the contributor and 2 in fees. A one-base-unit award pays that unit in fees and zero net. Splitting must not reduce the fee.

Pay token fees in the same token. Do not charge again at claim or retry. Preserve funded awards' original fees through upgrades. Private bounties use section 8's split instead.

A project-operated or permissionless executor submits payments. Slop operates no payment key or payment relayer. Permissionless vault creation requires the owner's authority; remove the separate service charge.

Mark an obligation paid only after finalized evidence reconciles its exact vault or direct-payment source, recipient, principal, fee, and asset. Reject replay, wrong owner, wrong asset, partial completion, failed transfers, duplicates, and overpayment. Keep uncertain attempts until reconciliation; a missing receipt is not failure proof.

### Service signer boundaries

No application service may sign outside these limits. An owner-authorized agent may privately use necessary credentials for reviewed setup, testnet, or mainnet plans within the approved financial scope. Required acceptance, explicit activation, and release controls still apply. This permission does not expand service powers.

| Signer | Allowed scope |
| --- | --- |
| Identity attester | Attest authenticated GitHub identity for a wallet-signed binding and submit that binding. Sign bounded monthly allocation roots and the limited approvals below. |
| Fee-wallet key | Claim accrued fees from reviewed vaults into the same fee wallet. Convert only received fees through approved routes within all limits. |
| Referral root poster | Post cumulative referral roots only after separate reactivation. It remains disabled for launch. |

One identity authority may serve the three EVM networks. The EVM fee wallet also shares one key across those networks. Solana has a separate fee wallet. Store dedicated fee keys as Worker secrets. Fee keys hold no vault role and cannot touch free funds, principal, reserved awards, or payments.

A monthly root commitment is limited by the owner's cap, opt-out, and one commitment per period. Anyone may submit the signed commitment after the cutoff. The attester cannot withdraw, choose a payout destination, or execute payment through this power.

The attester may cancel only its own obsolete pending EVM wallet-binding transaction. Use the same nonce, zero native value, its own address, and empty data within existing gas limits. Retain both signed attempts. Either may become the canonical finalized winner. This exception does not permit payment or monthly-commitment cancellation.

For a wrong-total monthly reserve, require a current owner request and the complete retained allocation. Fresh finalized evidence must prove a matching root, wrong total, and no prior settlement or release. Refuse missing, healthy, stale, partially settled, or released allocations. Derive the whole untouched reserve; never accept a chosen amount. The attester signs approval; the owner signs the release transaction. The Worker never submits it. Release returns funds to the vault's free balance; it does not withdraw funds or alter valid awards.

Until a qualified reserve-release upgrade is active, an allocation that cannot settle remains reserved and blocks manual awards on that vault. Later monthly admissions, payments, deposits, and free-fund withdrawals still work. Time alone never releases the reserve.

Keep owner-controlled upgrade keys separate from service keys: one for EVM factories and vaults, one for Solana. Upgrades, award payments, wallet activation, and identity-authority rotation use zero-delay deployment configuration. Verify atomic EVM initialization, accepted implementations, upgrade authority, and exact Solana program bytes. Preserve existing immutable deployments.

Immediate upgrades can change logic governing deposited funds. A compromised attester plus an attacker-controlled wallet can redirect matured unpaid awards before owner cancellation. These accepted risks depend on key custody; do not describe a guaranteed intervention window.

### Received-fee handling

Convert received fees to USDC on Base, Ethereum, and Solana. Return proceeds to the same fee wallet. Robinhood Chain never converts or bridges fees: retain each asset and show **not converted**. Unavailable conversion elsewhere leaves the token pending or failed and never blocks contributor payment.

Convert on receipt only when the value is at least 5 USDC and ten times the gas cost. Limit slippage to 1%, price impact to 2%, value to 1,000 USDC per run, and 5,000 USDC per day.

| Network | Native ceiling per transaction | Native ceiling per UTC day |
| --- | --- | --- |
| Base | 0.0001 ETH, including a 0.00005 ETH data/operator reserve | 0.001 ETH |
| Ethereum | 0.001 ETH | 0.01 ETH |
| Robinhood Chain | 0.0002 ETH | 0.002 ETH |
| Solana | 0.005 SOL, including account creation and priority fees | 0.02 SOL |

These budgets are separate from token-value, keeper, and referral limits. Count approvals, claims, conversions, and replacements. Keep uncertain native spending reserved until finalized cost evidence resolves it. Refuse signing if limits or readiness are missing.

Verify deployment and fee recipient before each claim. Stop on unknown or mismatched state. Reconcile uncertain sends before retry and prove fee receipt before conversion.

Automatically replace an EVM keeper or fee-converter send only when it remains unmined because its maximum fee is below the network fee. Preserve nonce and transaction content. Increase only fees in bounded steps of about 25%, at most three times the original. Stay within network limits. Journal every attempt before broadcast and record one finalized outcome. Source approval alone does not activate replacement.

For an expired Solana fee send, require two independent full-history RPC providers before releasing its native reservation. Both must confirm an invalid blockhash at finalized commitment and find no signature or transaction. Retained history must cover the signed blockhash's slot. Disagreement, missing history, or provider failure keeps the hold. Retain observations and signed bytes.

For versioned Jupiter routes, resolve every address lookup and inspect all affected accounts. Verify signer, destination, token, native-debit, and rent limits. Unresolved accounts or unsupported extensions refuse signing.

Owners authorize sweeps to separate EVM and Solana software wallets. A human or authorized agent executes outside the Worker. Sweep keys stay in the owner's local `.env`. They are not cold-storage wallets.

### Separate contributor token allocation

Slop Cash S.P. sends this allocation from its own wallet. It is separate from Points, awards, vaults, and payment obligations. The application holds no key and signs or sends nothing.

The fixed actor-ID and amount list is `public/contributor-allocation.json`, changed only through reviewed PRs. `{"distribution": null}` publishes nothing.

Use the recipient's confirmed wallet for the allocation network. Its first confirmation must precede the published registration deadline. Replacement preserves that first time. Send each recipient once; a wallet change never causes a resend.

Payouts shows only the signed-in recipient's row: amount and Sent, Scheduled, Awaiting wallet, or Unclaimed. Scheduled requires a confirmed wallet. Awaiting wallet links to registration before the deadline. Unclaimed means the deadline passed without a wallet, or the final batch closed with the row unsent. Other accounts see nothing.

The sender records each transaction after sending. **Sent** includes the recorded transaction link. It means sender-recorded, not chain-verified by Slop.

## 7. Points, discovery, and clear pages

### Accepted-work Points

Publish one Points measure. Monthly and lifetime totals are views of the same history. Do not show a separate Slop Score or add converted credits twice. Verified money received remains a separate record.

Only accepted-work Points for the project and period determine reward shares. Participation, payout recognition, usage, and trace evidence never change a payment share. Preserve historical awards and compatibility fields without exposing another score.

| Accepted-work size | Points |
| --- | --- |
| Micro | 10 |
| Small | 30 |
| Medium | 90 |
| Large | 240 |
| XL | 450 |
| Exceptional | 750 |

| Review band | Points |
| --- | --- |
| Triage | 10 |
| Standard | 30 |
| Deep | 90 |
| Specialist | 240 |

Every accepted merge receives at least 10 Points, including a zero-size assessment. Keep source, rubric, model, and corrections with the record. Group split or related PRs into one work unit. Prevent duplicate credit across commits, stacked PRs, and indirect merges. Do not apply account-level caps or diminishing credit.

Share merge credit with verified implementation authors. Credit useful reviews separately. Exclude bots, self-review, post-merge reviews, repeated comments, and duplicate or empty reviews. A useful review may validate a change without requesting corrections.

Credit at most the first five distinct qualifying reviewers. Use each reviewer's highest band. The review pool is their summed bands, capped at the PR's assessed credit, with a 10-point minimum. Allocate proportionally by largest remainder in 10-point increments. Break ties by first qualifying review time, then review node ID.

Use reviewed evaluation manifests only for useful work that ordinary scoring does not cover. Never reward a source twice. A merged PR later removed by GitHub retains its recorded Points and reward eligibility.

Stop new welcome and X-connection awards from 24 October 2026. Preserve earlier awards unchanged; earned-work standings and rewards exclude them. Payout recognition is fixed per recipient, project, and cycle, never per dollar or transfer.

Apply payout exclusions prospectively for owners, funded employees, and related parties, subject to the period-specific exceptions below. Excluded weights must not reduce other contributors' shares. A ban never erases a funded award.

### Historical scoring and source integrity

The current size and review bands also apply to eligible unpaid work from 1 September through 31 October 2026. Preserve original Points and frozen terms for approved or funded awards, including scheduled and paid awards. Retain source IDs, occurrence times, and eligibility and penalty dates. Append corrections; never rewrite earlier records.

The September–October census has no special exclusion for team membership or Madyoun's former account unavailability. Normal source verification, sharing, duplicate-credit, participation-ban, funding, and wallet rules still apply. For November 2026, payout-exclusion lists remain empty for `slopdotcash`, `eliza`, `thenetwork`, and `asi`. These exceptions do not change funded awards or later periods.

Hold historical Points publication until the complete assessment journal and exact changes reconcile. Require source coverage, duplicate-credit, and funded-history checks before release. Other releases retain prior historical rules. Keep the standard importer and September candidate checks. Held or unassessed pre-November sources keep their earlier Points.

A no-change branch promotion earns no additional Points only when complete, hash-verified trees prove identical base, submitted head, and accepted merge content. Joint evidence must identify an earlier complete accepted source for every imported commit. Missing trees, changed content, unknown commits, or incomplete sources remain unresolved. Preserve original contributors, normal sharing, existing awards, required source review, and the historical publication hold. This rule grants no additional actor credit or branch authority.

### Penalties

Use the published table only for eligible authors under section 5. Maintainers and authors outside closure scope receive no penalty.

| Finding | Permitted action | Point debit |
| --- | --- | --- |
| Spam | Close | 30 |
| Scam or malicious | Close and notify a moderator to review the account | 240 |
| Clear violation of a quoted project rule | Close | 10 |
| Low quality | Close when the category is qualified | 0 |
| Duplicate | Close | 0 |
| Out of scope | Label | 0 |

A debit affects only that UTC month's accepted-work Points and cannot reduce them below zero. It cannot change an approved, scheduled, or paid award. Record each debit and upheld-appeal reversal once. Reopen, retry, and appeal must not multiply them. Later table changes are prospective.

### Discovery and public records

Retain every open issue and PR in snapshots for source-count integrity. Publish a deterministic selection decision for each item. Advertise only bounded, unblocked work and require a live GitHub check before action.

The rolling ledger covers a complete 35-day window. Publish exact bounds and counts; deduplicate permanent GitHub IDs. Default rankings to Points. Preserve equal ranks, shareable filters, source coverage, and exact periods. Slopbot does not enter human rankings.

Make Featured and Community projects discoverable. An administrator's Featured setting controls the D1 listing tier, independent of funding or payment history. Apply the same rules to ordinary and bounty projects. Featuring never guarantees payment.

Paused projects remain listed, but their repositories are not collected or scored. Retired projects disappear from lists while history still resolves. Legacy community projects remain retired. Their IDs exist only in `src/lib/legacy-projects.json` for Points and profile validation; never list, collect, score, or pay them.

Profiles and cycle pages show finalized ordinary vault payments with project, recorded contribution month, net asset amount, and transaction link. If the contribution month is missing, show it as unavailable. Never infer it from indexing time. Preserve closed-account privacy and distinguish pending or unavailable evidence from payment.

Do not publish private case amounts, counts, queues, or revealing totals through ordinary profiles, balances, rankings, cycles, or notices.

### Interface requirements

Use existing routes and shared controls. Show the result, next action, and restriction together. Keep required consent, amounts, and evidence visible. Avoid decorative controls or explanatory clutter. Interface changes require an approved requirement or a reproduced broken flow.

Home provides distinct contribution and private-report entry points. Show current security offers before project lists and rankings. Keep generic agent setup available even when discovery fails or no project is cleared.

Preserve the campaign typing/deletion animation with a stable accessible heading. Disable it for reduced motion. Keep the header at the viewport top while scrolling. Keep the main landmark and keyboard navigation without the removed Skip to content link.

Support mobile screens, keyboards, screen readers, reduced motion, and 200% zoom. Meet Web Content Accessibility Guidelines (WCAG) AA. Use field-linked errors, status announcements, exact readable values, and useful recovery actions.

The public `/models` and `/receipts` pages remain removed. Do not show individual receipt details or evidence-bonus labels. Keep attribution, optional collection, APIs, and stored records. Cycle pages omit the Evidence section and original-record download links; retain existing data URLs. The intentionally removed `/data/cycles/eliza/2026-09/proposal.json` and `/downloads/contribute-to-eliza.skill` remain HTTP 404.

## 8. Security and private bounties

### Clear a project before execution

Require one complete successful admission scan for each nonexempt immutable registered repository. Routine source, dependency, skill, Markdown, and presentation changes retain admission. They are not represented as scanned. A different repository cannot inherit clearance.

Bind the assessment to its actual revision, commit, and template. An existing row, failed evidence check, or incomplete scan is not clearance. Explicit investigations and reinstatement still require current evidence and live source checks.

Scan for malicious code, wallet drainers, credential theft, secret export, harmful installation, suspicious downloads, unsafe execution, and prompt injection. Acquire the exact commit with one shallow Git fetch and verify it locally. Store inert content objects.

Run deterministic checks over every file. Review large content in token-budgeted batches, risky content first, then synthesize the repository result. Deterministic checks may cover dependency locks, data, generated bundles, and vendored copies; send every match to the model with context. Read every item marked reviewed.

There is no repository, entry-count, file, object, or run size refusal. Repeating the same scan cannot be the sole remedy for a large repository. Incomplete review never passes.

Use Surplus Opus 5.5 first. Use GPT-6.1 Sol or specialist investigation only for ambiguous or high-risk findings. Use one disposable Cloudflare sandbox per risky artifact, with internet off and no secrets. Full runtime execution of every project is not required.

A passed scan means every defined check ran on the bound revision and found no malicious result. Record checks and coverage gaps. It is not a guarantee of safety. Uncovered executable content makes the scan incomplete unless a check, isolated execution, or specialist review covers it.

### Exemptions and restrictions

Migration `0075_vetting_grandfathered_projects.sql` permanently fixes the existing-project exemption set in each environment. Those projects need no normal admission scan, including after executable changes. Later projects cannot join that set. Display an exemption, never a passed scan.

A separate owner-approved Umia fork exemption requires an audited administrator record. Bind it to the current D1 revision, permanent repository identity, steward, approving actor, reason, and time. Display **Owner-approved exemption**. Another repository or steward cannot inherit it. Other grants require a separate human owner decision. Retain previous assessments and audited revocations; revocation restores ordinary admission.

Exemptions do not override investigations, flags, pauses, bans, or fresh reinstatement checks.

A flag is eligible only from a member with a GitHub account at least 30 days old and one accepted Slop contribution. Owners and maintainers cannot flag their own project. One flag remains private. Two distinct eligible flags pause the project and notify moderators. A flag counts for 90 days; withdrawal stops it counting.

Skills refuse installation and work on flagged projects. A fresh clean scan automatically reinstates a flag-only pause and resolves the flags counted toward it. Stale evidence cannot reinstate a project.

After confirmed malice, reinstatement requires a fresh clean scan and a moderator decision. A moderator decides any ban from the evidence. Identify responsible accounts individually; do not infer responsibility from current ownership or the original application. Project reinstatement does not clear account bans. Record a separate account decision when evidence supports it.

A banned account cannot start participation, earn new contribution or review credit, or receive new awards. Preserve funded awards and appeal access, including after project transfer. During quarantine or a ban, existing funded payments may continue but no new commitments start.

### Researcher journey

1. Open a project's confidential-report entry or published bounty offer.
2. Review scope, safe-test rules, funding status, and any gross, net, and Slop-share amounts.
3. Sign in and write the affected component, source revision, impact, and safe reproduction evidence.
4. Review the exact report, eligibility, and privacy terms, then submit.
5. Receive a durable Slop receipt in Inbox.
6. Follow screening and human review; provide requested information or appeal privately.
7. If awarded, confirm the payment destination and follow funding and payment progress.
8. Track remediation and any separately approved disclosure.

Any registered user may report to a registered project, including one without a bounty. Use the primary repository if no intake repository is set. An unpaid intake promises no award. Uncertain eligibility never justifies a public issue or induced loss.

### Offers and report intake

Eligible projects may offer bounties through Add project. All names, source revisions, scope, contacts, amounts, and splits derive from D1. Do not hardcode a program or prefill its terms, deployments, or commit in product code.

Owners publish scope and acceptance criteria; do not impose another program's critical-severity or loss-of-funds restriction. Preserve the protected program terms below and each report's receipt terms. A bounty award requires paid terms to have been published when the case was received. Only administrator-controlled manifest terms may grant an award-split exception.

Show researcher net prominently, with gross, Slop share, scope, and pledged or verified funding. A prefunded program opens only after verified funds. An explicit `after-approval` program may open as a discretionary pledge. An open offer does not prove available funds.

Keep owner setup separate from reporting. Group offer, scope/testing, contacts/response targets, and preview/publish. Verify owner authority before showing setup. Project stewards or repository administrators manage case contacts without routine platform approval. Keep bounty funds separate from contribution funds, with observation time and stale status.

Reporting uses Write report and Review and submit on one route. Classification is optional. Keep drafts in account-and-project-bound session storage. Clear them on sign-out or account change. Preserve the idempotency key through uncertain retries and show storage failure. Do not add persistent local-storage drafts, server autosave, or an attachment service.

Retain the exact report in private object storage before optional forwarding. Bind its digest, reporter, repository, receipt time, and effective terms. Atomically create the case and reporter Inbox receipt. Never put report bodies in D1, public pages, logs, analytics, notifications, or generated artifacts.

### Screening, human review, and forwarding

Screen before notifying the project owner. Use the existing Surplus account and requested model `claude-opus-5.5`. The marketplace model identity is not independently verified. Use no provider fallback and execute no submitted code. Treat every report field as untrusted data.

Screen for plausibility, reproducibility, missing evidence, duplication, and spam. Screening is advisory and separate from severity, acceptance, award, payment, and disclosure. Missing evidence, suspected spam, uncertainty, or provider failure must remain recoverable. An authorized owner may review or override a held result. Notify owners only for plausible or owner-approved reports, through private Inbox and verified email notices.

Inbox combines reports and notification events without view tabs. Preserve case/submission deep links and `/security`. Show one report entry even when it has separate submission and case records. Preserve read and acknowledgment state. Show each case stage separately, with the next action and recoverable access errors. Mobile details provide Back to reports. Clear retained private data on account change.

Give authorized reviewers direct actions to request information, decide a finding, decide an award, and prepare payment. Record scope, reproducibility, covered impact, duplicate identity, and private rationale as applicable. Do not preselect human severity from model screening.

GitHub forwarding is optional and requires the researcher's explicit authorization. Preserve authorship and verify its receipt separately from the Slop receipt. Use only the researcher-authorized user token to create or change an advisory. The existing GitHub App may request advisory write permission, but backend installation tokens remain read-only.

Keep submission credentials only as long as completion or reconciliation requires. Reconcile an uncertain send before retrying. Failed forwarding must not lose the report or block private review. Never fall back to a public issue. Provider retention follows applicable account terms; do not claim unconfirmed zero retention.

### Award, payment, and disclosure

The owner or maintainer decides technical acceptance and discretionary awards. The financial approver authorizes payout. Screening, forwarding, a critical defect, or potential loss never authorizes payment. Refuse unauthorized self-approval. Slopbot triages disputes; a moderator decides escalated cases.

Record the first verified qualifying report for each underlying finding. Use safe evidence; actual loss is neither required nor permitted. A fixed after-approval offer uses the gross amount frozen at receipt: award that amount or none. Preserve historical amount rules.

An unfunded award decision creates no funded reservation or payment claim. Require approval and verified funds before reservation. A vault-backed award reserves only its bounty vault's finalized free balance. Prevent duplicate reservations. Private awards never use the automatic monthly-payment fallback.

The standard split is 75% to the researcher and 25% to Slop. Its gross amount must divide by four in asset base units. An authorized full-award exception pays 100% to the researcher and needs no such divisibility rule. Add no ordinary 2% fee or claim fee. Show exact gross and net amounts before authorization.

Use a released, qualified payment path for the award's frozen asset and split. Existing 75/25 vaults must never pay a full-award case. A selected award or verified funds alone do not prove that a suitable path is available.

For direct payments, record each finalized leg separately and show only unpaid legs for action. Mark paid only when the researcher amount and any Slop share are proved. Direct fees enter the same received-fee accounting as vault fees. Notify the reporter, current security maintainers, and financial approvers with private content omitted.

Keep the report and its fix as one financial work unit unless approved terms say otherwise. Separate eligible ordinary work may still earn rewards.

Use independent private patch review and exact-revision tests. Remediation, payment, or an expired deadline never authorizes disclosure. Require approval of the exact redacted content, retain embargo history, and obtain separate recognition consent. Maintainers should provide an email or Signal contact for private coordination.

### Protected program terms

These terms protect existing offers and received reports. They do not restrict new programs to named projects or replace the D1 registry.

**Umia Protocol.** Each accepted critical loss-of-funds finding carries a 10,000 USDC gross offer on Base. The first qualifying reporter receives 7,500 USDC; Slop receives 2,500 USDC. The maintainer may grant the receipt-time amount or none. There is no single-award program limit.

The program is an after-approval pledge. Slop fronts an approved award through its separate bounty vault after verified funding. Umia reimbursement occurs off chain. Verify the registered repository and current authority from D1 and GitHub. `lalalune` (GitHub actor 18633264) is the intended owner and technical contact. Private vulnerability reporting must be enabled on the registered fork for optional researcher-token forwarding.

**Slop mainnet contracts.** Each accepted critical loss-of-funds finding carries a $10,000 offer, paid entirely to the first qualifying reporter. Slop takes no share or payout fee. The maintainer may grant the published amount or none; there is no predetermined award count. `lalalune` reviews findings and decides awards.

Scope covers reviewed Slop mainnet deployments from `contracts/evm/src` and `contracts/solana/programs`. It includes vaults, factories, monthly reserves, and other contracts in those paths only after qualifying mainnet deployment. Loss means theft or permanent freezing of user, contributor, owner, or vault funds.

Exclude third-party contracts, off-chain and frontend defects, testnet/local deployments, known or previously reported findings, and losses requiring compromised privileged keys or intended owner actions. This after-approval offer belongs to the `slopdotcash` platform project and binds no 75/25 bounty vault. The full-award payment-path requirement above applies.

### Private data and retention

| Data | Access and retention rule |
| --- | --- |
| Private reports | Only the reporter and currently authorized case reviewers may read retained bodies. Audit every read. Keep cases and obligations through recovery and role changes. |
| Scanner evidence | Only `lalalune` and `drew-dot-com` may read through audited 15-minute grants. `lalalune` owns this policy. |
| Successful admission evidence | Retain permanently, including original evidence behind reused results. Missing or corrupt evidence is never valid. |
| Other scanner evidence | Retain while open and for 90 days after closure. Clean scans close automatically; incomplete or malicious cases require `lalalune` to close them. |
| Scanner recovery records | Daily private backups retained for 30 days; access logs retained for one year. Prove restoration before activation. |
| Contributor traces | Permanent private R2 objects. No website or API may return a body to anyone, including its contributor or an operator. |

Store scanner objects once by SHA-256 in private R2 using 8 MiB upload parts. D1 holds manifests and digests. Reuse existing objects by reference; delete shared bytes only after all retained references end. Policy changes require a reviewed source change, not a deployment attestation.

Trace upload remains optional, authenticated, bounded, checksum-verified, write-only, and fail-closed. Failure or refusal must not block contribution. Keep only safe metadata and digests in public artifacts. Preserve existing audit records. The MVP accepts the absence of a durable per-actor upload quota; this does not remove size or authentication controls.

## 9. Operations and launch decisions

### Administrator and moderator journey

1. Sign in and open the queue permitted by the current role.
2. Recheck project identity and current authority before viewing evidence or acting.
3. Review the source record and any Slopbot recommendation.
4. Record the permitted decision and reason.
5. Confirm the resulting restriction, notice, or recovery state.
6. Preserve history, funded obligations, and appeal access.

Administrators manage Featured placement, authorized exceptions, restrictions, and incomplete ordinary assessments. Use quarantine to hold a project. They do not approve routine project admission or automatically gain private-case access.

Moderators are `lalalune` (GitHub actor 18633264) and `drew-dot-com` (202660855). Escalate when an appellant or maintainer rejects Slopbot's proposed resolution. Escalate appeals or disputes that involve bans, confirmed malice, private security cases, or debits of at least 240 Points. Escalate when Slopbot's confidence is below 0.9. Escalate an appeal still unresolved after seven days.

Incomplete ordinary PR assessments appear once in the current maintainers' and administrators' private Inbox. Show the public PR and retry state. Retain the entry through retries and remove it on completion. Recheck authority on each read; unavailable checks produce a retryable failure. Never expose this queue to unrelated or former maintainers.

### Notifications

Use one Inbox for wallet changes, payout exceptions, project decisions, appeals, and case notices. Save each notice with its source change. Replay must not duplicate it. Keep private notifications generic and link to the secure Inbox.

Activity email is optional. Show the verified destination before consent and bind consent to its exact version. A changed address needs new consent. Opt-out cancels queued activity mail, including during outages. Opt-in does not send old history. Wallet-security and private-case notices use their separate policies.

Recheck roles and destinations before sending. Provider acceptance does not prove inbox delivery or user acknowledgment. Verify actual receipt separately. Bound retries and reconcile uncertain sends before retry. Escalate failed or overdue case notices to a current approved backup. Notification failure never deletes a case.

### Dependencies and local operation

Public pages use cached D1 data or published snapshots. Refresh failure retains the last good value with a stale label. Sensitive actions require fresh authority.

| Dependency | Required failure behavior |
| --- | --- |
| GitHub identity, authority, and source | Refuse sensitive actions on unavailable proof; retain recoverable drafts and records. |
| D1 and private R2 storage | Require durable receipt and verifiable evidence; never report a partial write as success. |
| Review providers and isolated execution | Preserve incomplete or retryable states; never invent a completed review. |
| RPC services and supported payment paths | Retain pending obligations and uncertain attempts until exact finality is established. |
| Email provider | Preserve Inbox access, explicit delivery state, and escalation. |

The public repository picker uses the read-only `SLOP_GITHUB_READ_TOKEN` in production and staging. It grants no write, private-repository, or organization authority.

Local development uses durable isolated report storage, background assessment, API flows, and real authorization. The existing GitHub App supplies a loopback-bound single-use identity handoff. Local and production stores remain separate; local handoffs cannot create production assertions. Require no separate developer App or local production secret. Do not silently send real mail or enable a production signer.

The obsolete `protocol/wallet-possession.md` document, isolated test identity stack, and v1 secure-VM vetting pipeline remain retired. Retain the runtime wallet-possession verifier and its callers. Keep `deck.slop.cash` detached.

### Decisions still required

The product owner must approve new service targets, support commitments, phase scope, and activations outside existing standing approvals. Keep implementation and evidence in the repository review process. Section 11 defines the required completion record.

## 10. Private bounty acceptance

These tests cover the complete private-report journey, including reports without paid terms. Apply the scoped evidence exceptions in section 11 without treating them as passed tests.

| Area | Required result |
| --- | --- |
| Offer | Registry-derived scope, named sponsor, payer, and dispute contact, exact gross/net/split, and clear pledged or verified funding. No invented award for unpaid intake. |
| Intake | Durable Slop receipt before optional forwarding. Enabled, disabled, stale, denied, unavailable, interrupted, and direct-intake paths preserve data correctly. |
| Screening | Plausible, incomplete, suspected-spam, and provider-failure cases remain distinct. No automatic rejection, award, or submitted-code execution. |
| Authority | Refuse self-approval, unrelated case access, revoked roles, and stale authority. Keep technical, financial, and moderator powers separate. |
| Terms | Preserve receipt-time eligibility and amount. Apply the program's scope rather than a universal severity threshold. |
| Funding | Distinguish approval, pledge, verified funds, and reservation. One finding cannot create duplicate reserves or automatic monthly payouts. |
| Amounts | Prove 75/25 and authorized 100% paths. Reject inexact splits, wrong assets, and stacked fees. |
| Payment and recovery | Test missing wallets, changed destinations, renewed consent, partial legs, uncertain sends, restart, replay, and old-request retirement. Finality precedes paid. |
| Privacy | No case bodies, counts, amounts, or revealing totals in unauthorized pages, APIs, logs, analytics, caches, downloads, or notices. |
| Forwarding | Preserve reporter authorship and separate receipt times. Use the authorized user token; never use an installation token to write an advisory. |
| Remediation and disclosure | Verify the exact patch and mitigation. Require separate exact-content disclosure approval, embargo history, and recognition consent. |
| Notices | Prove sender, destination, consent, current role, quota, isolation, actual receipt, acknowledgment, bounded retry, and escalation. |
| Continuity | Restore backups. Preserve cases and obligations through role loss, account closure, transfer, ban, recovery, and intake outage. |
| Interface | Complete the researcher and maintainer journeys on desktop and mobile, with keyboard, 200% zoom, reduced motion, and recoverable errors. |

## 11. Source, delivery, and acceptance

### Whole-product acceptance

Cite the relevant section and observable acceptance result in each implementation PR. Historical PAY, SKL, TOK, and MVP identifiers remain valid in existing records. This document adds no work-package taxonomy. Section 12 retains the five current STATE requirements.

| Product area | Acceptance result |
| --- | --- |
| Accounts | GitHub identity survives renames. Consent, visibility, closure, wallet replacement, and recovery follow section 3 without cross-account leakage. |
| Contributors | Complete discovery, verified installation when used, attributed submission, acceptance, and Points. For an eligible funded award, also complete payment. Optional evidence never blocks submission. |
| Maintainers | Complete and resume setup without routine admin approval. Verify authority, installation, admission, immutable revisions, and independent funding readiness. |
| Slopbot | Review registered repositories for free. Preserve incomplete outcomes, qualified closure scope, consent, reopen protection, penalties, and appeal escalation. |
| Points | Complete source coverage, correct work/review shares, single debits and reversals, preserved history, and no duplicate credit. |
| Security admission | Prove complete scans, honest exemptions, eligible two-flag pause, skill refusal, fresh reinstatement, and human confirmed-malicious decisions. |
| Private reports | Meet section 10 for paid and unpaid intake, including privacy, partial payments, recovery, and separate disclosure authority. |
| Monthly rewards | Prove one proposal and final allocation, full funding, owner adjustment/opt-out, cutoff fallback, permanent reserves, and exact finalized payment. |
| Fee handling | Prove receipt, claim, conversion, reconciliation, and failure/restart controls. Keep Robinhood assets unconverted and enforce every value and gas limit. |
| Operations | Prove role-scoped queues, idempotent notices, current consent, restoration, isolated local development, and explicit unavailable states. |
| Interface | Verify all affected desktop/mobile flows, keyboard access, screen readers, 200% zoom, reduced motion, downloads, links, and console/network behavior. |
| State correctness | Meet section 12 with source mappings, reachable scenarios, implementation evidence, and explicit gaps. |

Use real provider calls for model behavior and real browser, database, and chain evidence where applicable. Record exact source revisions, client versions, providers, models, results, and limitations. Follow [CONTRIBUTING.md](../CONTRIBUTING.md) for required checks and affected agent-client coverage. Never publish secrets, private prompts/responses, source evidence, credentials, sessions, traces, or signing material.

### Release workflow

Use reviewed PRs into `development`, then batch promotions to `main`. Reviewed development PRs may merge before hosted continuous integration (CI) finishes. Fix or revert failures promptly. Main must pass the full trusted quality gate before deployment.

Production deploys only through the checked-in main workflow and main-only production environment. Keep publication credentials out of PR runs. Use the shared publication lock and bind deployment to the tested source. Staging uses separate storage, identity, and secrets. No separate manual release approval or branch-protection rule is required. Do not add rulesets unless requested.

Normal releases sync the current D1 registry and collect live GitHub data. An explicit manual main release may set `use_published_data` to retain validated production rankings and profiles. Preserve their timestamps, history, and counts. The option defaults to false and cannot run on staging or with bootstrap data. It cannot use the PR adapter or skip any code, browser, sandbox, environment, source, or deployed-byte check. Missing or invalid data stops release.

Install pinned publication tooling without lifecycle scripts. Do not cache dependencies in trusted publication jobs. Verify deployment identity, current-main equivalence, served bytes, DNS, TLS, redirects, and headers separately.

The separate hourly private-reporting health job never publishes code or holds the publication lock. A status older than 24 hours blocks optional trace collection only. Website deployment and ordinary GitHub contribution remain independent.

### Activation gates and accepted risks

Launch the non-money product first. Mainnet activation is explicit, one network at a time: Base, Solana, then Robinhood Chain. Ethereum retains its separate waiver below. Exact assets, authority, finality, deployment bytes, and applicable testnet results remain required.

Native-asset and Token-2022 scope permits implementation and local testing, not a mainnet upgrade, funding, or signer activation. Qualify creation, deposits, refunds, reservations, payouts, claims, and accounting. Token-2022 also requires the fully inspected conversion path. Each upgrade or funding step needs its own reviewed execution plan and owner authorization.

Private-report intake is approved for staging and production after the reviewed release. This standing approval does not prove deployment or successful delivery.

Fee handling on Base, Ethereum, and Robinhood requires funded fee wallets and verified limits and readiness. The fee-converter release variable must be enabled. Keep Solana outside the production network list until its independent full-history recovery RPC, first registered vault, and all readiness checks pass. A reviewed main release then activates it. The Solana controls release, existing program upgrade, and approved 0.05 SOL gas top-up are recorded as complete. Do not repeat them; consult retained execution evidence before any later operation.

Launch requires real-case qualification and explicit production activation of automatic closure. Keep its global switch off before that activation. Closure categories that require an objective-defect receipt stay unavailable without their own qualified verifier. Keep `SLOPBOT_QUALITY_QUALIFIED_PROFILE_SHA256` unset for launch.

A private full-award case remains unpayable until its suitable payment path is approved, released, and qualified. Advisory permission setup alone does not prove delivery. Qualify a real authorized report and verify its separate GitHub receipt before declaring forwarding available.

### Limited network qualification

These limits apply to the one-time qualification sequence, not ongoing service spending. Check retained execution records and never repeat completed steps. Qualify Base first, then Solana, then Robinhood Chain. Do not activate a later network before the required earlier qualification reconciles.

| Limit | Base | Solana | Robinhood Chain |
| --- | --- | --- | --- |
| Asset | USDC | USDC | USDG |
| Monthly cap | 1,000 USDC | 1,000 USDC | 1,000 USDG |
| Automatic monthly payment | Off | Off | Off |
| Deposit | 10 USDC | 10 USDC | 10 USDG |
| One gross transfer | 1 USDC | 1 USDC | 1 USDG |
| Recipient net / fee | 0.98 / 0.02 USDC | 0.98 / 0.02 USDC | 0.98 / 0.02 USDG |
| Total gas ceiling | 0.001 ETH | 0.01 SOL | 0.001 ETH |

The recipient is `lalalune`, GitHub actor 18633264. Base uses Slop's Base/USDC vault; its gas ceiling covers the reviewed upgrade and entire sequence across wallets. Solana and Robinhood use their first qualifying vaults.

Keep qualification transfers outside earned-reward cycles, evaluations, and payout-recognition Points. Preserve independently earned credit and ordinary payout exclusions. Recheck eligibility, simulation, and reconciliation before each signature; stop on failure. No Ethereum qualification project or vault is required under the waiver below.

### Evidence exceptions

These exceptions preserve recorded approvals. They do not remove product behavior, authorize spending, or prove MVP completion.

| Evidence item | Approved treatment | Requirements that remain |
| --- | --- | --- |
| Independent contract audit and signer/attester legal review | Waived, not completed. | Review, exact execution plan, required checks, and explicit mainnet activation. |
| Second-operator and different-machine Solana build | Waived. | Pinned deterministic build image, artifact/on-chain hash comparison, public-testnet evidence, and authorized upgrade. |
| Separate Ethereum first-vault live qualification | Waived in favor of successful Base and Robinhood shared-EVM coverage. | Ethereum asset, authority, finality, and explicit activation checks. |
| Two real contributor accounts for flag testing | Deployed-staging fixture evidence accepted. | Two eligible flags pause and refuse skills with HTTP 410; fresh reinstatement works; stale scans, bans, and newer evidence remain protected. |
| Objective-quality verifier at launch | Deferred. | Dependent closure stays unavailable; other closure categories retain all controls. |
| Specific private-report live checks | Non-admin delivery, automatic analysis, maintainer notices, interrupted submission recovery, and funded settlement evidence were waived. | Preserve access controls and repair known defects. Later email, direct-payment, and recovery changes require complete affected-flow verification. |
| First natural monthly cutoff observation | Not required for release or issue closure. | Prove monthly behavior through the required qualification and exact limits. |

The prior `shawgotbags` test is not a launch gate. Restricted pilot delivery is not proof of general email readiness. Keep passed, failed, waived, untested, and unavailable evidence distinct.

### Referral program

Referrals remain deferred. Keep `REFERRAL_ACCRUAL_MODE="off"` and `REFERRAL_PROGRAM_ENABLED="false"`. File no accruals and post no roots. Token setup, funding, qualification, and watcher activation do not gate launch.

Slop Cash S.P. funds this separate program from its program-token allocation. It does not alter Points, project manifests, scoring, cycles, ordinary payouts, or settlement. Preserve its code and records under the following deferred requirements.

The submitting maintainer may name a signed-in referrer. Keep the record immutable under migration `0055_project_referrer.sql`. Refuse self, steward, administrator, and moderator referrals at capture.

Accrue only from finalized project payouts recorded as `paid` in `payment_obligations`. The first period is November 2026. Only payouts within 12 months of the project's first paid obligation qualify. The initial rate is 3 program tokens per 1 USDC of gross payout, calculated per stablecoin micro-unit. The lifetime pool is 2,000,000 tokens; each referred project has a 250,000-token lifetime cap. Rate changes are prospective. Record each applied rate and never change filed accruals.

Exclude team accounts (`lalalune`, `drew-dot-com`, administrators, and moderators), participation-banned accounts, non-stablecoin payouts, and projects with a public hold.

File each closed UTC month once, in order, as an append-only public record that anyone can recompute from payment evidence. Publish through `workers/referral-accrual` and `GET /api/v1/referrals/accruals`. Include cumulative referrer totals and a Merkle root over authorized Robinhood Chain wallets. Carry walletless referrers into later roots.

`ReferralDistributor` accepts cumulative roots. Each root is immediately claimable. Referrers sign claims using the wallet pinned to that root. The owner may void only the latest root before its first successful claim. A successful claim seals the root; paid tokens cannot be recovered. Earnings distinguishes accrued, pending, claimable, and claimed amounts using cached finalized evidence. Stale or uncertain evidence does not prove a claim.

Keep the root-posting key as a Worker secret, separate from the contract owner. It may only post roots, not transfer tokens or control project funds. Whole-root growth cannot exceed 2,000,000 tokens. Poster gas ceilings are 0.0002 ETH per transaction and 0.002 ETH per UTC day. Pause above either ceiling and retain uncertain attempts. An independent watcher is required. There is no guaranteed intervention window; pause or key rotation cannot recover paid tokens.

Reactivation requires separate owner approval. After approval, accrual stays `off` or `dry_run` until the token exists, funding is agreed, and the watcher operates. The owner must explicitly activate posting. Posting stays on Robinhood Chain Testnet until that activation. Counsel review is not required. Publish no announcement before activation.

### Completion and change control

Maintain implementation evidence in repository reviews and verification records. Update requirements in their owning sections when policy changes. Preserve an approval link and effective date when historical terms depend on them; do not append a second competing rule.

MVP completion requires a reviewed record covering every requirement and release gate. Include exact tested revisions, real end-to-end results, applicable deployment/provider/chain evidence, approved waivers, and resolution of blocking defects. A source merge, local pass, partial rollout, or this document cannot establish completion.

## 12. State correctness and Quint verification

Review every explicit and implicit state transition in the application. Cover UI, APIs, workers, databases, files, queues, jobs, contributor tools, contracts, and release workflows. This requirement grants no new product, policy, deployment, funding, or signing authority.

- **STATE-01 — Inventory.** Keep source-to-model mappings in `formal/`. Include flags, optional values, collections, times, caches, pending requests, files, database records, and external evidence. List every entry point, unmodeled transition, and assumption.
- **STATE-02 — Models.** Define initial states, actions, refusal conditions, invariants, and reachable outcomes. Cover loading, empty, stale, invalid, error, success, authorization, expiry, cancellation, retry, duplicates, concurrency, partial writes, interruption, and recovery. Preserve immutable history, distinct financial states, and integer amounts. Model uncertainty without treating a request or signature as finality. Check parent/child and cross-subsystem composition.
- **STATE-03 — Conformance.** Compare models with actual workflows through model-derived traces or equivalent named scenarios at real entry points. Database races need database evidence; UI changes need browser evidence. Keep required provider and chain checks. Models cannot replace them.
- **STATE-04 — Fix and maintain.** Reproduce discrepancies, fix their causes, and repeat affected checks. Update models, mappings, and implementation evidence when behavior changes. Never weaken an invariant or remove a failure path to hide a defect.
- **STATE-05 — Verification evidence.** Pin Quint in the lockfile. Run `bun run formal:check` and `bun run formal:verify`. Record tool versions, source hashes, scenarios, backend, finite bounds, results, and unresolved gaps. Distinguish simulation, exhaustive finite exploration, implementation conformance, and live integration.

Passing abstract models does not prove implementation refinement or the absence of every possible state error. Completion requires reviewed models and implementation evidence for every inventoried transition, corrected discrepancies, passing checks, and explicit assumptions. Keep this requirement open while any required coverage or evidence is incomplete.

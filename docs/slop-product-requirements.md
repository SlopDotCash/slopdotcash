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
- The programmatic SLOP buyback and burn funded by half of fee income, described in section 6.
- The separate contributor token allocation described in section 6.

Support Base, Ethereum, Robinhood Chain, and Solana. Each project selects one network and asset. Section 6 defines supported assets and payment restrictions.

### Boundaries

Score accepted outcomes, not commits, comments, token use, or test counts. Any provider, model, or agent client may participate with exact attribution. Manual work is also permitted.

Only project owners and maintainers open issues. Contributors use approved requirements and existing issues. An issue alone does not approve scope. The target repository's contribution rules still apply.

Slop must not infer copyright ownership, legal capacity, assignment, wallet control, or payment authority from GitHub identity. Slop does not guarantee awards or vault funds.

Referral roots remain unposted and outside launch scope; accrual only records (section 11). Do not start a later phase until maintainers record MVP completion and approve that phase. New product requirements need human approval before implementation.

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
| Points and corrections | Append-only journal with source identity, occurrence time, and recording time. Operator decision, 20 November 2026: the Points of a project month with a recorded payment are frozen; the generator holds a candidate revision that would change them and publishes the rest, and the import still refuses a batch that changes one. Operator decision, 21 November 2026: a trusted production release also reads the protected project months from a private route (`GET /api/v1/operator/protected-point-months`, answered only with the `POINTS_PROTECTION_TOKEN` Pages secret as a bearer token and otherwise not found), which answers from the same settlement records as the import and names project months and projects only, never an amount or a recipient. The generator holds the union of that answer and the committed list; without the secret, or when the read fails, it uses the committed list alone. |
| Monthly proposals and final allocations | D1 allocation records; owner cuts and their reasons are public. |
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

Settings, Payouts, and Inbox are separate pages reached from the account menu. Do not add shared account navigation tabs. Settings contains wallet management and email preferences, both always expanded. Payouts links to wallet management when needed. Preserve existing wallet deep links. The account menu also links to the settings page of each project the signed-in account stewards (operator decision, 23 November 2026). The Inbox follows the owner pages' return rule (section 6): when its tab is shown again it rechecks the signed-in account behind the reports already on screen and refreshes its list in the background, and a changed or ended session closes the private reports once the recheck answers (operator decision, 21 November 2026).

Keep current-session sign-out and backend session validation, expiry, revocation, account closure, and appeal records. Do not restore the session list, Connections card, or Security card. Keep recovery, closure, and account-appeal controls out of Settings. Do not add a payout-wallet shortcut to contributor profiles. The Activity email switch has no outer button border.

The configured production owner receives a seven-day site session after a
fresh GitHub sign-in (owner decision, 17 November 2026). The numeric GitHub
identity must also be a current platform administrator at sign-in. Other
accounts receive one-hour site sessions. Each privileged action still checks
current authority. Existing sessions keep their recorded expiration.
The short-lived GitHub authorization and one-use identity assertion retain
their existing expiration.

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

Maintainers may remove a registered project after a fresh check of their GitHub authority. Removal appends a paused, retired revision and hides the project from public discovery, work collection, and skill publication. Keep registry history, earned Points, private cases, and funded obligations. The applicant may cancel a pending application, including a pending update, without publishing it. Retain the cancelled record and prevent later publication. These maintainer controls are approved for the MVP (owner decision, 11 November 2026).

### Maintainer agent entry

Owner request, 13 November 2026: add a maintainer skill and a Contributor / Maintainer homepage switch within the MVP. The maintainer skill supports adding or resuming a project, reviewing GitHub work, repairing CI, maintaining project rules, handling authorized private reports, preparing monthly allocations, and removing a project or cancelling a pending application. It follows the user's requested task and the repository's rules; it does not create unrelated work or require renewed approval for actions already authorized.

Keep one canonical global contributor skill and one canonical global maintainer skill, published at `/contribute/SKILL.md` and `/maintain/SKILL.md`. Keep `/SKILL.md` as the shared entry point. It routes an explicit contribution, review, private-report, or maintenance request to the corresponding skill and asks which journey only when the intent is missing or ambiguous. Publish each entry's source revision and integrity metadata through the existing build and discovery process. Project-specific contributor and reviewer skills retain their existing generation and installation contract; do not add per-project maintainer copies.

The maintainer skill uses ordinary authorized GitHub tools for repository work and the existing authenticated Slop website for management. Choosing Maintainer is an intent, not proof of authority. Verify the current account and permanent repository identity, and recheck the required role before sensitive reads or writes. Do not substitute GitHub CLI authentication for a Slop session, extract browser cookies, or introduce a new terminal authentication mechanism. Without browser tools, complete independent repository work and prepare the exact remaining website steps.

Preserve human decisions on bounty awards, escalated disputes, bans, and disclosure, and the existing financial and signer boundaries. Sign-in, installation consent, legal terms, and wallet authorization use their existing controls. Retain expected revisions, idempotency and uncertain attempts; a setup check may activate a project and is not a read-only poll. Do not change closure consent, funding requirements, payment policy, or production activation through this entry flow.

### Setup requirements

Project contains the repository, integration branch, and contribution rules. Provide one picker for the user's public repositories and URL entry for other public repositories. Load repository facts after selection.

Verify permanent repository and actor IDs, current write or maintain authority, license facts, integration branch, and reward terms. Record the license URL, commit, and digest. Read Slopbot installation status before creation.

A current GitHub administrator of the same registered repository can change its primary integration branch. Require the current registry revision and an exact GitHub head with a committed Slop authority declaration matching the project, repository, steward, branch, and policy revision. Append one immutable revision and preserve identity, restrictions, admission requirements, reward terms, prior revisions, and frozen allocations. Both generated skills use the new branch. The same revision can update its contribution instructions.

Collect scope, contribution guidance, supported tasks, required tests, review expectations, security contact, closure policy, and maintainer notes. Preview both generated skills. Missing required skill fields prevent skill publication.

Rewards offers a monthly pool or Private bounty. New monthly projects use one contribution pool, not a second review budget. Preserve historical review-budget commitments. Bounty-only projects have no monthly pool.

Monthly rewards and bounties use the same network and asset choices. A new bounty records the selected branch's immutable revision, owner-defined scope, acceptance criteria, and safe-test rules. Its creator is the initial contact and sponsor. Show gross award, researcher share, Slop share, and private-report terms before creation.

New bounties use a 75/25 split and an after-approval pledge. Owners cannot grant split exceptions. Creation neither proves funds nor requires a bounty vault. Section 8 defines award and payment rules.

An optional custom project image falls back to the GitHub owner avatar. Do not use social-preview images. Save changes as presentation revisions.

Show one setup summary with separate authority, Slopbot, security, and funding results, plus the next action. Activate after complete setup, current authority, installation, and valid admission clearance. Economic policy changes apply from the next UTC calendar month; preserve frozen terms and funded obligations.

Owners may append public GitHub repositories to an existing project on its manage page. An appended repository cannot be a fork or archived, and no project may already list its permanent numeric and node IDs. The owner needs current write, maintain, or admin authority through a Slopbot installation on that repository. Its work counts from the first day of the next UTC month. An append never removes, reorders, or renames a listed repository. Each repository needs its own admission scan or owner-approved exemption, and the project is cleared only when every repository is. Appending to an active project pauses it. A clean scan of the last uncleared repository reactivates it; after an exemption, the owner runs the setup check. The monthly close skips a paused project, so if a scan has not cleared when the month closes, that month has no allocation. A flag-only pause or a moderator reinstatement needs a fresh clean scan of every repository. Operator decision, 12 November 2026.

### Skill source and installation

Generate each project-specific skill from one canonical generic template and the approved D1 project revision. The same inputs must produce the same bytes. Maintainer notes cannot weaken template rules. Do not store per-project skill copies.

The trust root is the canonical immutable template commit and approved D1 revision digest. The checksum detects corruption only. Resolve the full 40-character commit through the fixed canonical GitHub API. Verify the complete tree against immutable GitHub bytes and verify the rendered output against the approved digest.

Any resolved canonical commit may supply the template, including unreleased, divergent, older, or previously revoked commits. Do not add freshness, ancestry, release-label, or revocation gates. These checks prove source identity, not maintainer approval.

Ordinary updates must not decrease the D1 revision. Explicit rollback rechecks retained bytes, the digest, and current installation clearance. Installation, update, and rollback require current project status and clearance.

Reject missing or extra files, mutable redirects, working-tree provenance, and byte mismatches. Preserve immutable sibling versions, the process-bound kernel lock, atomic relative-symlink activation, and prior verified versions. Tests may inject deterministic `file://` authorities only through the generator's test option.

Installed `authorize` and `start` validate local provenance, complete hashes, and receipt schema without live authorization calls. A local checkout is not an installation. Existing installs need one verified update to gain this behavior; never rewrite historical templates.

Repository access, live work selection, submission checks, and consent rules still apply. Inspect malicious code and prompt-injection risks before installation or execution. Report a risk and stop the local workflow.

### Submission and optional evidence

A PR states the problem, approved requirement, useful result, implementation choice, and real evidence. Include `Made via @slopdotcash` once and the exact provider, model, and client. Agents star and fork only when they can use browser or computer control. Stars and forks earn nothing.

After opening the PR, the skill records `pull_request_opened` with the exact PR node ID through the author's authenticated Slop session. This evidence supports automation eligibility; it is not a prerequisite for ordinary GitHub submission.

A project's own repository rules may require a submission fee before review, for example a small payment the repository refunds when the pull request merges and keeps when it is closed. The repository runs it. This is separate from the platform submission fee in section 5, which Slop operates for projects that turn it on. Slop does not collect, check, refund or enforce such a fee, and it is not a vault deposit, project funding or a Points input. Contribution skills follow repository rules but never move money: the agent hands the payment step to the person it works for. Operator decision, 18 November 2026.

Signed receipts and minimized private traces are optional. Under private trace contract version 2 a client may offer upload by default with a shown one-line decline. The contributor or the client redacts the trace before upload. The uploader stores those exact bytes. Usage totals are diagnostic and never change Points, rank, share, or payment. A device signature proves byte continuity, not provider billing.

The separate reviewer skill is advisory. It checks correctness, tests, security, scope, duplication, abuse, evidence, and usefulness. Place its recommendation before the exact provider, model, and client footer.

## 5. Slopbot

### Review and scoring

Slopbot is required, always free, and limited to registered repositories. Never charge a project vault for bot review. The review stays free under the submission fee below: the fee is a refundable deposit and no charge for the review, and an unpaid pull request simply waits for its review. Free advisory reviews are capped at 2,000 pull requests or issues per repository per UTC month; later reviews of an item already reviewed that month are not limited, and value assessment is not capped (operator decision, 16 November 2026).

Apply effective repository security, scope, ignore, and rejection rules before review. Review exact source against approved base-branch rules. Run untrusted code only in approved isolation without secrets or posting credentials.

Operator decision, 16 November 2026: use Surplus Intelligence first and Orbio as the backstop. Start with Claude Sonnet 5.5 through Surplus, then Surplus GPT-6.1 Terra, then Claude Sonnet 5.5 through Orbio. A Surplus spending denial skips the remaining Surplus model and goes directly to Orbio. If Orbio does not serve a valid result, the request waits for the Surplus budget reset. This replaces the owner decision of 11 November 2026, which used Orbio first and Surplus as backup. Use these lower-cost models for active API review, scoring, repository scanning, and private-report analysis. Preserve historical model attribution and billing records. Show no-findings, limited-coverage, and retryable-failure outcomes. Identify unreviewed content. A limited review cannot label, close, penalize, or claim full verification. Large or binary evidence must not silently exhaust attempts.

Slopbot assesses PR size and value and credits useful reviews under section 7. Maintainers decide merges. Preserve repository opt-outs and exemptions.

Operator decision, 16 November 2026: a project owner may turn on the `slopbot:ready` label in project settings; absent settings mean off, and each change is an immutable revision. While it is on, Slopbot labels an open pull request and adds one line to its review comment only when all of these hold at the exact head commit: GitHub reports the branch mergeable with every check passing; Slopbot's own review of that commit has no finding and no coverage limitation; the required number of approvals (default one) on that commit come from distinct accounts with write access, other than the author, and no such account has an open change request; the change is under the owner's size cap; and it touches no protected path. The protected set covers `.github/` and CI configuration, dependency manifests and lockfiles, contracts and payment code, skill, agent and policy files, the Slop project manifest, `SECURITY.md`, binary files, deleted files and large deletions; an owner can add paths but never remove these. Slopbot removes the label on a new push or as soon as a condition stops holding. The label is the only effect: a human merges, Slopbot never merges, and Points and scoring do not change. It needs no new GitHub App permission.

Operator decision, 17 November 2026: a project owner may set an intake cap in project settings, one whole number from 1 to 500: pause new contributors when this many outside pull requests are open. Absent means off, and each change is an immutable owner revision, not a material term. The count is every open pull request from an outside contributor (author not an owner, member or collaborator, not a bot, not a draft) in one repository, answered or not, stored by the scheduled merge activity read (section 9); a project with a cap is read at every hourly run. While the latest count of any of the project's repositories is at or above the number, the project is left out of the home page, /sponsors and agent discovery, its page says that it has paused new contributors because its review queue is full and that accepted work still records Points, and Slopbot skips its free advisory review of an outside pull request it has not reviewed before, recording the skip and posting nothing. The project comes back by itself when a later count is below the number. A count that was never read, could not be read or is older than three days pauses nothing. Skills keep serving by direct link, and private security reporting is unaffected. Points, value assessment, scoring, the monthly close and payment do not change: work a maintainer merges scores exactly as before.

Backlog rule. Operator decision, 23 November 2026, in effect from 1 December 2026 (`BACKLOG_RULE_FROM`, `src/lib/backlog-rule.mjs`). It applies to every active, listed monthly-pool project the same way, team projects included, with no exemption by project or account. External-prize projects and security-only programs (a bounty-only security program, or one beside a monthly amount of zero, such as Umia and Orbio) are not judged. The inputs are the stored merge activity rows (section 9) read within the last three days: the number of outside pull requests waiting seven days or more for a maintainer, summed over the project's repositories, and the latest merge of any of its repositories. No such row means no decision, and the project stays listed. A project is over the limit when 50 or more outside pull requests wait; this limit is required and is not an owner setting, and the owner's intake cap stays as the owner's own optional lower limit. A project is dormant when at least one outside pull request waits and no pull request was merged in 14 days, or none was ever found; a quiet project with nothing waiting is never dormant. A project over the limit or dormant is out of rotation: it is left out of the home page, /sponsors and agent discovery, exactly where the intake cap removes it, and its page says why in one line. Nothing else changes: Points keep recording, funded pools keep paying, Slopbot keeps reviewing, and the page and skills still open by direct link. The project returns by itself at the first recent read where neither condition holds; one merge clears dormancy. Before 1 December nothing leaves rotation and pages show nothing; the owner gets one Inbox notice if the project would leave on current figures. Catching up on reviews: an owner may set `slopbot.catchUpUntil` in project settings, an immutable owner revision like every other setting and not a material term, for at most 14 days from now; while it runs the rule does not take the project out of rotation and its page says the maintainers are catching up on reviews until that date. A pause starts at most once per UTC month, the owner may end it early at any time, and a running pause cannot be moved past 14 days from its start. Only the server writes `slopbot.catchUpHistory`, one entry per start, and refuses any owner change to it; a new project cannot submit either field. Owner notices go to the user steward, or to the account that listed the project when the steward is an Organization, under the `project_revision` kind with an event key under `backlog-rule:`: a preview once before 1 December, a warning once dormancy is four days away (10 days without a merge while work waits), and one notice each time the project leaves rotation, keyed on the reason and the last merge date. The scheduled Slopbot run sends them right after it refreshes merge activity; a failure to send never fails that read. No notice names a contributor or an amount.

Operator decision, 21 November 2026: wanted issues. A project owner may turn on wanted issues in project settings; it starts on for new projects that take contributions, absent is off, and each change is an immutable owner revision, not a material term. Every project uses the one standard GitHub label `slop-wanted`, so contributor skills need no configuration. When it is on, the scheduled merge activity read (section 9) creates the label on each listed repository if it is missing, the only GitHub write that read makes, and stores the open issues that carry it, refreshed every six hours. The project page lists those issues first under Suggested work, issues without an open closing pull request ahead of those with one. The generated contributor skill starts with an unclaimed `slop-wanted` issue that no open pull request closes, on any repository, and never opens a second pull request for an issue that already has one. Nobody claims or is assigned an issue. Points, value assessment, scoring, the monthly close and payment never read the label; the submission fee reads it only to send back a deposit on invited work (see "Submission fee").

### Submission fee

Operator decision, 18 November 2026: Slop offers a refundable submission fee as a platform feature. A project whose owner has the setting on asks an outside contributor to deposit a small fee before Slopbot reviews a pull request. It applies only to a project whose owner has turned it on, and only while the platform switch is `live` (see the end of this subsection). The separate repository-run fee in section 4 is a repository's own arrangement and is not this feature.

The setting is `slopbot.submissionFee` in the project record: on or off, with a stablecoin amount from 1.00 to 10.00 that defaults to 2.00. Absent means off. Owners change it themselves on the settings page; each change is an immutable owner revision and not a material term. The new project form starts with it on for every project that takes contributions, whatever its pool, and leaves it out of a listing that is only a security program. Existing projects are not changed. A change applies to pull requests first asked after it: the amount of a pull request is fixed when Slopbot first asks, and a pull request opened before the setting was turned on is never asked.

A contributor pays in the network stablecoin (USDC on Base or USDG on Robinhood Chain) or, at half the price, in SLOP on Robinhood Chain at Slop's published rate. Any wallet may pay; no registered wallet is needed. The deposit goes into Slop's deposit contract, which names the pull request and fixes at deposit time where a kept fee goes. Outcomes:

| What happens | Stablecoin deposit | SLOP deposit |
| --- | --- | --- |
| The pull request is merged | Sent back to the wallet that paid | Sent back to the wallet that paid |
| No maintainer merges or closes it within 14 days of the deposit | Sent back | Sent back |
| It closes a wanted issue and is closed without a merge, and 7 days later no maintainer has added `slop-keep-fee` | Sent back | Sent back |
| It closes a wanted issue, is closed without a merge, and a maintainer added `slop-keep-fee` within 7 days | Kept by Slop as fee income | Burned |
| Any other pull request closed without a merge and still closed 7 days later | Kept by Slop as fee income | Burned |
| The deposit names the wrong item or destination, or a lower amount | Sent back | Sent back |

A deposit of any other token pays nothing and is never resolved; its payer takes it back from the deposit contract after 30 days (section 6, FEE-01).

Wanted work (operator decision, 22 November 2026). A wanted issue is an invitation, and several pull requests may answer one while the maintainer merges only the one they prefer. The fee filters work nobody asked for; it must not charge a contributor for losing that choice. So a pull request whose closing references (GitHub's `closingIssuesReferences`) include an issue of the same repository that carried the `slop-wanted` label at the moment the pull request was opened is invited work. A label added after the pull request was opened does not count; one removed after it was opened still counts. Closed without a merge, invited work is sent back after the usual 7 days unless a maintainer has added the label `slop-keep-fee` to the pull request by then, for example on a submission that only pretends to answer the issue. GitHub lets only accounts with triage access or more label a pull request, so the label is a maintainer's act; no model output keeps a fee. Slopbot creates the label on the repository when such a pull request closes. When GitHub cannot be read, nothing is decided and Slopbot reads it again within a day. Which pull request to merge is the maintainer's choice, never the first to arrive.

A kept stablecoin fee is Slop fee income like any other, so section 6's buyback rule applies to it. A kept SLOP fee goes to the burn address. The maintainer who decides the pull request gains nothing either way. Never describe a refund as guaranteed before its finalized transfer, and never call a deposit a payment for review.

Slopbot's part: the fee applies to a pull request when the project's setting is on, the author is an outside contributor under Slopbot's existing rule (not the owner, not an account with write access, not a member of the organisation), the pull request is not a bot's and not a draft, and it was opened after the setting was turned on. At first sight Slopbot records the pull request with the project's fee at that moment, posts one comment, adds the label `slopbot:fee-needed` and skips its review with the recorded reason `fee-needed`. The comment gives the pay page link, and for each accepted way the network, token address, amount, deposit contract address and item value (SLOP only while a rate is in force, at the amount of that moment, with the address that gives the amount due now); it states the outcomes above, that the only valid addresses are the ones Slop publishes, and that an agent hands the payment to its operator. Slopbot finds its own comment by the App's account, never by text, so a pasted marker or a hand-added label pays nothing. When an accepted deposit is recorded, Slopbot swaps the label for `slopbot:fee-paid`, updates the comment and runs the review it held back. It then records the outcome that is due: refund when the pull request is merged or is still open 14 days after the deposit, kept when it has stayed closed without a merge for 7 days, counted from the later of the close and the deposit, except invited work as above; a reopen before then records nothing. A separate Worker sends what is due; Slopbot moves no money. If that Worker withdraws a payment because its deposit was reorganised away before it was final, Slopbot asks again.

The pay page. Slopbot's comment links `https://slop.cash/fee/<owner>/<repo>/<number>`, a public page that needs no sign-in (operator decision, 19 November 2026). The address only names the pull request. The page takes the repository's numeric GitHub id from the project registry, computes the item value itself, and reads the pull request's stored fee record from the public read in section 6 ("Submission fee deposits"); it makes no GitHub call, and a repository that no project lists has no fee. It shows whether a fee was asked, each way to pay what is due, a recorded deposit with its transaction and whether its block is final, and the recorded outcome with its transaction. Before any wallet is chosen it states the outcomes above, that a deposit nothing settles can be taken back from the contract after 30 days, and that the only valid deposit contract is the address on this page and in Slopbot's comment. It offers a way to pay only when the record's deposit contract, chain, token and kept-to address equal the tables published in `src/lib/submission-fee.mjs`, its item equals the value the page computed, a stablecoin amount equals the pull request's recorded fee, and a SLOP amount equals that fee at Slop's published SLOP rate (the rate in force or, during its 48 hours, the previous one, read from the public rate route in section 6); a record that differs in any of these is refused whole and nothing is offered from it. When the published rate cannot be read, the SLOP amount cannot be checked, so SLOP is not offered and the stablecoin ways remain (operator decision, 19 November 2026). Any wallet may then approve the exact amount and deposit, as one request where the wallet already executes batches atomically and as two requests otherwise. The page never takes a contract, token, amount, item or kept-to address from the address bar or from typed input, reads the fee record again just before it asks the wallet, and asks for nothing when the pull request is already recorded as paid or the amount due has changed. It reports a deposit as received once the contract's own event is in a canonical block and as finished only when that block is final, says that a refund or a kept fee waits for the final block, and never calls a refund guaranteed. While `SUBMISSION_FEE_SWITCHED_ON` is false the page says the fee is not switched on and offers no way to pay; a deposit that was already recorded is still shown.

Limits that always hold. Slopbot never closes a pull request for an unpaid fee and applies no penalty for one. The fee never blocks a maintainer: an unpaid pull request can be reviewed and merged by a person, and it scores exactly as before. Value assessment, Points, scoring, the monthly close and payment do not read the fee. An unpaid pull request never gets the `slopbot:ready` label. No fee is asked for a review that the intake cap or the monthly review cap would refuse anyway. When the owner turns the setting off, or the author gains write access, an unpaid ask is taken back: the label comes off, the comment says so and the review runs. Contribution skills never move money.

Activation. `SUBMISSION_FEE_MODE` is `off`, `dry_run` or `live`. It was `dry_run` (record-only) from 19 November 2026 and is `live` since 21 November 2026 (operator decision): Slopbot asks for the fee on a project whose owner turned the setting on, and on no other project; that day the owners of `slopdotcash` and `toon-plugins` turned it on, and no other project had it on. In `dry_run` Slopbot records what it would ask and writes nothing to GitHub; the review runs as it does today. That record is Slopbot's own and is not a fee ask: a deposit naming a pull request that was only recorded counts as a deposit for an unknown item and is refunded (FEE-01). While no deposit contract address is published in `src/lib/submission-fee.mjs`, the fee does nothing in any mode. Going `live` was its own reviewed change after the contracts were deployed and their addresses published. The owner's settings page says the fee is not switched on yet unless Slopbot's mode is `live` (`SUBMISSION_FEE_SWITCHED_ON` in `src/lib/submission-fee.mjs`, changed in that same reviewed change; operator decision, 19 November 2026). Document changes and merged code alone activate nothing.

### Standing deposit

Operator decision, 23 November 2026. A regular contributor can post one standing deposit instead of paying the submission fee on every pull request. While it stands, Slopbot does not ask that contributor the fee on a project that has the fee on, accepts standing deposits, and has already merged at least one of their pull requests. Constants and the pure rules live in `src/lib/standing-deposit.mjs`.

The deposit is SLOP on Robinhood Chain worth 10 US dollars at Slop's published SLOP rate (section 6, FEE-04) when the contributor asks for it, rounded up to a whole SLOP. SLOP only; anyone who prefers a stablecoin pays the fee per pull request as before. It is posted from `https://slop.cash/deposit` by a signed-in contributor; any wallet may pay, and a refund always goes to the wallet that paid. One standing deposit per account at a time.

What it covers. A pull request is covered when all of these hold at the moment Slopbot would otherwise ask the fee: the author's deposit is paid and has no outcome, the author has not asked to withdraw it, it was paid less than 340 days ago, the project's owner has not refused standing deposits, the author has at least one merged pull request on the project's registered repositories, and fewer than 10 of the author's covered pull requests are open. Otherwise the fee is asked as usual. An unpaid fee ask on a pull request is taken back and the pull request covered once all of this holds; a paid fee is never taken back. Slopbot posts its comment, adds the label `slopbot:deposit-covered` and runs its review. The project setting is `slopbot.submissionFee.standingDeposits`; absent means accepted, and the owner refuses with a checkbox on the settings page, an ordinary owner revision.

When it is kept. Only when a maintainer closes a covered pull request without a merge within 21 days of the later of its opening and the deposit's payment, adds the label `slop-keep-fee` to it, and the close and the label both still stand 48 hours after Slopbot first saw them. The whole deposit is then kept and burned, and it covers nothing more; the contributor may post a new one. An ordinary close costs nothing, so a pull request that answered a `slop-wanted` issue and was not chosen never costs anything unless a maintainer adds the label. A merged pull request never costs anything. No model output can keep a deposit. When GitHub cannot be read, nothing is decided and Slopbot reads it again.

When it is sent back. The contributor can withdraw at any time from the same page. Coverage of new pull requests stops at once; pull requests already covered keep their review and are not asked the fee. The deposit is sent back 21 days after the request, unless a strike on a covered pull request is still in its 48 hours, in which case the outcome waits for it. A deposit paid 340 days ago is treated as withdrawn on that day, so its last window and the wait both end before the contract's 365-day reclaim. An unpaid standing deposit can be cancelled; a deposit sent for it afterwards is refused and sent back.

The deposit sits in a second deployment of the unchanged `SubmissionDeposits` contract whose reclaim delay is 365 days (section 6, FEE-08). It was deployed on Robinhood Chain on 24 November 2026 at `0x446604d5c3Cc99c60CCE3d5C4357BC60f5b45993` and its address and start block are published in `src/lib/standing-deposit.mjs` (operator decision); before that, nobody could post one. Never describe it as buying a faster or better review, and never call it a stake or an investment.

### Closure eligibility and consent

Automatic closure requires all of the following:

- A registered project with saved closure consent and a qualified category.
- A non-maintainer author who is a Slop member, matched by permanent GitHub ID.
- The author's authenticated `trace_runs` record for that project.
- A `pull_request_opened` event naming the exact PR node ID.
- Required independent confirmation, caps, source checks, and production activation.

A copied marker or footer proves none of these facts. Closure alone does not authorize a penalty.

Operator decision, 18 November 2026: contributor skills must require evidence before submission. The target branch's contribution instructions govern project-specific checks. The PR body uses `## Evidence` with `Change types:`, `Test results:`, and `Proof of change:`, plus `UI video:`, `Runtime logs:`, `Benchmarks:`, and `On-device testing:` for applicable changes. A UI change also needs `UI screenshots:` with linked before-and-after images when the evidence section of the target repository's contribution guide lists that field (#3198, 21 November 2026). Tests and artifacts must demonstrate the actual outcome. Unnecessary complexity on speculative paths is a violation when the repository's guidance prohibits it.

For an eligible PR carrying the standalone `Made via @slopdotcash` footer, Slopbot may close for objectively missing required evidence when the published contribution guide defines this evidence format. A deterministic check identifies absent, empty or placeholder fields, and the final fresh GitHub read must independently reproduce the same finding. Judgments about the merits, omitted change types or the quality of supplied artifacts remain advisory under this category. This path has its own production activation, preserves project consent and category opt-outs, and applies a 10-Point debit once per confirmed close under the existing appeals and reversal rules.

New project drafts start with closure selected. Keep the control editable and save an explicit opt-out. Missing saved consent means false. Registration and installation alone are not consent. Do not alter existing projects' consent. No separate `.github/slopbot.json` is required, but preserve existing file opt-outs and category restrictions.

Uncertain findings go to the maintainer. After seven days without action, Slopbot may apply the verdict as a label only. An uncertain finding never closes a PR. Preserve maintainer reopen decisions.

On paused, flagged, or quarantined projects, authorized security review may only comment and apply the scam label. Retired projects receive no review. These projects remain unavailable for contributor work.

### Appeals, qualification, and cost

Slopbot triages appeals and drafts a resolution. A moderator decides escalated cases under section 9. A scam or malicious closure also creates one moderator Inbox notice to review the account.

Qualify closure with reviewed real cases and counterexamples. A fixed 14-day or 50-item threshold is not sufficient. Fixtures prove controls, not model quality. Keep the global switch off until explicit production activation. Record the reviewed evidence and any qualified objective verifier.

Ongoing value scoring uses alerts-only spending: no monthly hard cap or fixed attempt reserve. Email the operator at each crossed $500 monthly milestone. Alert on low Surplus balance and provider failures. A failure email waits two minutes; it is not sent, and a suppression record with its reason is kept instead, when a later call in the same route served the same job (never for a spending denial) or when the same model and cause was emailed in the last six hours. When a model reply is refused as invalid, keep one plain reason: the missing, unexpected or mistyped field, the value outside its allowed list, the named check it failed, or why the text was unreadable. Never keep the reply text. Operator decisions, 17 November 2026. Retain immutable attempts, actual or unknown costs, duplicate refusal, and queue limits. Capped mode retains numeric reservations. Missing or malformed configuration stops inference.

Paid API assessment begins on 1 November 2026 UTC. September and October assessments use ChatGPT subscription subagents. The Slop repository slice may instead use Claude subscription subagents or Codex subscription sessions/subagents with GPT-6.1 Sol. Import results through the standard assessment journal with exact attribution. A subscription declaration is not an API receipt or billing proof. Section 7 defines the historical publication hold.

## 6. Funds and payments

### Assets and funding

Monthly contribution rewards use one project vault, network, asset, and deposit balance. Private awards may use supported direct payments or an existing separate bounty vault. Preserve ordinary and bounty purposes.

Anyone may deposit into a vault. All deposits share one bucket. Only the owner's refund destination receives free-fund withdrawals. State this before deposit signature. Reserved awards and fees cannot be withdrawn. Funding is optional; a pledge is not available funds.

Operator decision, 18 November 2026: any wallet may deposit into an active project's recorded vault from that project's public page. The public control only deposits; withdrawals stay on the owner's manage page. Before a wallet is chosen it states that depositors have no refund right and that the project owner can withdraw free funds, less the 2% withdrawal fee. A deposit never changes the monthly amount, which only the owner sets, so extra money covers more months: the project page and the funding page show how many whole months of the current monthly amount the free funds cover. Deposits are public. The payments Worker records each finalized deposit event of every recorded ordinary vault, from the vault's creation, with its depositing address, amount and block time, and the project page lists them under "Funded by". A depositor is named by GitHub login only when exactly one public Slop account currently has that address registered and the wallet itself signed that registration; an unsigned registration proves no control of the address, so it neither names a depositor nor hides one (21 November 2026). Private bounty vaults are not listed. The list is display evidence only: balances, funded months, listing and payment still come from the finalized vault counters, and a failed deposit read is retried without failing or delaying a payout step.

Show a monthly amount as vault-backed only when the money is in the vault. In the homepage and /sponsors listings, show each positive amount for the current UTC month and its funding status. Use "Vaulted" or "in the vault" when backing is verified, "Promised" for an owner who has opted in without verified backing, and "Configured" for other positive amounts. Show "Not vaulted" beside a Promised or Configured amount when the backing is insufficient, and "Vault funding unverified" when the vault evidence is missing. Balances come from the cached finalized vault counters (section 9). Operator decisions, 15, 17 and 18 November 2026.

The owner may opt in during setup or in project settings for a positive monthly pool. The option starts unchecked and each change is published in an immutable project revision. Existing projects remain opted out until their owner changes it. When the current UTC month's amount is positive and backing is unverified, the project overview shows the opted-in amount with "Promised · Not vaulted" or "Promised · Vault funding unverified", according to the evidence. The project owner makes the promise; Slop does not guarantee or arrange an off-vault payment. Verified vault backing takes precedence over any promise. A zero amount remains Points only. This public display does not change eligibility for automated allocations, settlement, homepage listing, sponsor listing, or agent discovery. Owner decision, 17 November 2026.

From December 2026 a month is shown as vault-backed only if it was funded on the 1st: the vault's first finalized read of the UTC month, within an hour of 00:00 UTC, must hold that month's amount plus the previous month's amount, which pays out after its cutoff. The amount stays shown as vault-backed only while the vault still covers what is owed. Keep the first read of each month for each vault; it never changes. The contract lets the owner withdraw free funds at any time, so Slop's own pages refuse a withdrawal that would leave the vault below the promised amount, and when a month funded on the 1st no longer is covered after a withdrawal, the project page says that funds were withdrawn during that month. Enforcing this in the contract needs a separate reviewed upgrade. Operator decision, 15 November 2026.

An owner may lock months in an upgraded vault (operator decision, 15 November 2026): one owner transaction pledges an amount for each of 1 to 12 months from the current UTC month, only from free funds not already pledged. A pledge can be raised, never lowered or cancelled. This month's pool is then locked in the vault until it is paid out: the contract refuses a withdrawal or an owner award that would take pledged funds, and the executor may reserve a pledged month even when the owner turned automatic payment off. The owner can still cut individual amounts before the cutoff with a public reason. A pledged month freezes at the cutoff whatever the automatic default says, and while the project is paused or restricted, but never once the project is retired. Only a pledge in the vault that pays the month counts; a pledge left in a replaced vault gives no consent. A pledge closes when its month is reserved. One never reserved stays locked after the month's commit window closes, at 00:00 UTC on the 4th of the second month after it, until a release transaction is sent (`expirePledge` on EVM, `expire_pledge` on Solana); anyone may send it, and the project's manage page offers it to the connected wallet. The released amount returns to the owner's free funds. For a vault with pledge support a month is funded when the pledges for it, summed over the project's paying vaults with pledge support, reach the month's amount; its free funds alone do not count. A vault without pledge support keeps the rule above. The vault contract can still be upgraded by Slop's upgrade key, so a lock is not a guarantee against that key. A vault has pledge support only after the contract upgrade in section 11.

The owner may fund a new EVM token vault before it is registered. Once the creation transaction is in a successful canonical block and matches the reviewed request, show the owner the funding form for that vault and state that the creation is not final. Register the vault only from a finalized creation. Count a deposit only from a finalized block and the vault's own deposit event, and only for a registered vault. If the block is replaced, withdraw the form and say so. A deposit confirmed while the vault was not on chain moved nothing; report it as failed, never as received or funded. Native-coin vaults, bounty vaults, other depositors, withdrawals, and Solana vaults wait for registration. Operator decision, 14 November 2026.

Keep funding an EVM vault to as few owner steps as the wallet allows (operator decisions, 12 to 14 November 2026). A token approval moves no funds and never counts as funding, so it is the one owner step that proceeds at canonical inclusion instead of finality; the deposit review reads the live allowance again. When the connected wallet already reports atomic batch support on that chain (EIP-5792 `atomic.status` of `supported`), send the exact approval and the deposit as one wallet request. Never ask a wallet to upgrade for this. If the wallet refuses the batch before sending anything, fall back to the two requests. Prove a batched deposit by its finalized vault deposit event, never by the wallet's batch status. Check a saved deposit, withdrawal, or approval transaction without a click: every 3 seconds for the first 20 checks, then every 15 seconds, up to 240 checks, with no check while the page is hidden. Check a saved vault creation for registration the same way: every 10 seconds for the first 6 checks, then every 30 seconds, up to 120 checks, stopping at a failed creation or three failed checks in a row. Show why an automatic check failed, keep checking, and withdraw the message when a later check works; an automatic check never clears an error from an owner action. Before finality, a deposit or withdrawal in a successful canonical block that carries the vault's own event reads "Deposit received" or "Withdrawal sent" and says it counts once the network finalizes that block. That wording is display only: balances, funded months, listing, registration, and payment still come only from finalized reads. Solana vault actions keep their existing flow. Operator decision, 17 November 2026: a saved vault creation keeps being checked while its tab is in the background, for up to 120 further checks, so a hidden tab still registers the vault; and the server keeps the owner's register request for a creation that is not final yet and repeats it as the same account, through the same route and with every check of that route, every 2 minutes for 15 checks and then every 10 minutes, behind later project API requests, until the vault registers, the creation is refused, or two days pass. At most three such requests wait per project. A deposit notice for a vault that is not registered yet says the vault is recorded once its creation is final. An owner page rechecks the signed-in account when its tab is shown again without rebuilding the page: the same account keeps its form, saved wallet requests and running checks, a changed or ended session closes the page once the recheck answers, and the server still refuses a request from any other account.

Support approved stablecoins, standard ERC-20 tokens, classic SPL tokens, native ETH, and native SOL. Use native coins directly, not wrapped substitutes. Separate principal from network fees and preserve Solana rent reserves.

The supported Token-2022 subset permits only `MetadataPointer` and `TokenMetadata` mint extensions. Mint and freeze authorities must be disabled. Metadata must be self-hosted with disabled pointer and update authorities, and the mint account cannot exceed 1,024 bytes. Token accounts may have `ImmutableOwner` or no extensions. Reject all other or unknown extensions. Exclude transfer-fee, rebasing, transfer-hook, confidential-transfer, interest-bearing, and other balance-changing behavior.

Verify the asset identity, token program, decimals, behavior, and finality throughout each flow. Use integer base units and largest-remainder allocation. Never assume six decimals, add unlike assets, or present a token amount as dollars.

Owner decision, 11 November 2026: display project-token tickers with exactly one leading dollar sign, such as `$CREDIT` and `$EPYH`. Native and approved stablecoin tickers, including SOL, ETH, USDC and USDG, remain unprefixed. This is ticker notation, not a USD valuation. Preserve canonical stored asset symbols, integer amounts, existing dollar-denominated amount formatting and reward terms.

### Monthly allocation

Automatic monthly payment is the default when funds are committed. The owner sets the monthly cap during setup and may change it or opt out. Vault creation enables monthly commitment unless the owner opts out.

The period is the calendar UTC month, starting November 2026. The trusted monthly workflow freezes the complete closed-month ledger and writes each project's proposal once. A repeat run must not add or replace rows. Store allocations in D1, not new cycle files.

The owner may adjust amounts or finalize early. At 72 hours after month end, the automatic process freezes the current allocation once. A change that sets a contributor below their proposed amount is a cut. A cut needs a written reason of 20 to 500 characters. Each current cut, with its proposed amount, new amount, reason and time, is public on the cycle page, and the contributor gets an Inbox notice. Increases and changes at or above the proposal need no reason and stay private. The contributor gets 24 hours of notice: with automatic finalization on, cuts close 24 hours before the cutoff, and the owner can finalize only 24 hours after the latest cut. Operator decision, 15 November 2026. Retain every change and cut record for disputes and reconciliation.

Operator decision, 19 November 2026: close ASI's November pool for accepted work from 1 November UTC through 18 November UTC. Use a gross cap of 150 USDG on the recorded ASI vault and the ordinary per-award fee. A guarded import binds the complete cutoff-specific source, current Points checkpoint and registry revision to the one November proposal. The recorded close time is 19 November at 00:00 UTC. The owner can finalize those exact allocations after that time. Record the actual finalization timestamp. Existing restriction, eligibility, funding, duplicate, wallet signature and finalized chain checks still apply. The ordinary month-end calendar and the automatic on-chain commitment window apply to every other action.

Apart from a published maintainer share (below), only accepted-work Points for that project and period set shares. Rollover never increases a later monthly cap. An underfunded month creates no obligations until the entire allocation is covered. Prevent manual and automatic duplicate payments.

Keep walletless funded awards reserved without expiry. One recipient's failure must not block others. Preserve historical cycles' original review windows and frozen terms.

Operator decision, 18 November 2026: a project owner may set a maintainer share in project settings, from 0 to 30% of the monthly amount, stored as `reward.maintainerShare` in basis points. Absent means none. Each change is an immutable owner revision and starts with the next UTC month; the month in which it is made and every earlier month keep the share they had. The share is taken out of the monthly amount before the Points split, so a month never distributes more than its amount and the vault's monthly limit is unchanged. It is split among the GitHub users who merged or closed another person's outside pull request (author not an owner, member or collaborator, and not a bot) in the project's counted repositories during that UTC month, in proportion to the number each decided, by largest remainder in the asset's base units, with ties to the lower GitHub actor ID. GitHub lets only an account with maintainer rights merge another person's pull request, so a merging account is treated as the maintainer and no permission list is read. A close is different: deleting the head branch or the fork closes the pull request and GitHub records the deleting account as the closer. So a close does not count when the closer owns the fork the pull request came from, when that fork no longer exists, or when the closer deleted the head branch within a minute of the close (operator decision, 20 November 2026). An author's own close and a close or merge by a bot count for nobody, and a reopened pull request counts once, for its last close. A merge and a close count the same. A month with no counted decision has no maintainer share, and the whole amount stays with contributors. An account on the payout exclusion list is left out of the split. A maintainer's own accepted work still records Points as before, and merging alone still records none; an account with a Points share and a part of the maintainer share has one proposed amount. The trusted monthly workflow reads the decisions from public GitHub data after the month closes and stores the record and its digest with the proposal. If that read fails for a project, its month is not proposed until a later run reads it completely; other projects are not held back. The owner's later changes, cuts and the automatic cutoff apply to these amounts like any other. The project page, the home card and `/sponsors` show the share.

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
| Fee-wallet key | Claim accrued fees from reviewed vaults into the same fee wallet. Convert only received fees through approved routes within all limits. For the buyback share only: bridge USDC to the Robinhood Chain fee wallet through the approved bridge, buy SLOP there into the same wallet, and send the burn share of acquired SLOP to the burn address. |
| Referral root poster | Post cumulative referral roots only after separate reactivation. It remains disabled for launch. |
| Submission-fee resolver | Mark an open submission-fee deposit "refund" (to its payer) or "kept" (to the destination fixed when the deposit was made), for finalized deposits only. It cannot send a deposit anywhere else and holds no tokens. Off until separate activation. |

One identity authority may serve the three EVM networks. The EVM fee wallet also shares one key across those networks. Solana has a separate fee wallet. Store dedicated fee keys as Worker secrets. Fee keys hold no vault role and cannot touch free funds, principal, reserved awards, or payments.

A monthly root commitment is limited by the owner's cap, opt-out, and one commitment per period. Anyone may submit the signed commitment after the cutoff. The attester cannot withdraw, choose a payout destination, or execute payment through this power.

The attester may cancel only its own obsolete pending EVM wallet-binding transaction. Use the same nonce, zero native value, its own address, and empty data within existing gas limits. Retain both signed attempts. Either may become the canonical finalized winner. This exception does not permit payment or monthly-commitment cancellation.

For a wrong-total monthly reserve, require a current owner request and the complete retained allocation. Fresh finalized evidence must prove a matching root, wrong total, and no prior settlement or release. Refuse missing, healthy, stale, partially settled, or released allocations. Derive the whole untouched reserve; never accept a chosen amount. The attester signs approval; the owner signs the release transaction. The Worker never submits it. Release returns funds to the vault's free balance; it does not withdraw funds or alter valid awards.

Until a qualified reserve-release upgrade is active, an allocation that cannot settle remains reserved and blocks manual awards on that vault. Later monthly admissions, payments, deposits, and free-fund withdrawals still work. Time alone never releases the reserve.

Keep owner-controlled upgrade keys separate from service keys: one for EVM factories and vaults, one for Solana. Upgrades, award payments, wallet activation, and identity-authority rotation use zero-delay deployment configuration. Verify atomic EVM initialization, accepted implementations, upgrade authority, and exact Solana program bytes. Preserve existing immutable deployments.

Immediate upgrades can change logic governing deposited funds. A compromised attester plus an attacker-controlled wallet can redirect matured unpaid awards before owner cancellation. These accepted risks depend on key custody; do not describe a guaranteed intervention window.

### Received-fee handling

Convert received fees to USDC on Base, Ethereum, and Solana. Return proceeds to the same fee wallet. Outside the buyback share below, Robinhood Chain never converts or bridges fees: retain each asset and show **not converted**. Unavailable conversion elsewhere leaves the token pending or failed and never blocks contributor payment.

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

### Submission fee deposits

Operator decision, 18 November 2026. The refundable submission fee is held by a small deposit contract, `SubmissionDeposits`, one each on Base and Robinhood Chain, not upgradeable. A deposit names its pull request, its token, its amount and where it goes if it is kept. A resolver key can only mark an open deposit "refund" (to its payer) or "kept" (to that destination). If nothing resolves a deposit for 30 days, its payer takes it back. The Slopbot side (who is asked, labels, when a fee is due back or kept) is in section 5.

- **FEE-01 — What counts.** A deposit pays for a pull request only when Slop asked a fee for that pull request and it is still unpaid and undecided; the token is the network's stablecoin (USDC on Base, USDG on Robinhood Chain) or SLOP on Robinhood Chain; the kept destination is the network fee wallet for a stablecoin and the burn address `0x000000000000000000000000000000000000dEaD` for SLOP; and the amount is at least the amount due at the deposit's block time. Anything else is refused with a recorded reason and never kept. A refused deposit of an accepted token is refunded. A deposit of any other token is never resolved: the resolver makes no call into a token outside the table and spends no gas on it, and its payer takes it back from the contract after 30 days. A deposit for a pull request with no fee request waits 24 hours after it is finalized before it is refused.
- **FEE-02 — Paid, then final.** A pull request is marked paid once its deposit has the network's confirmation count on top of it (30 blocks on Base, 1,200 on Robinhood Chain). If a reorganisation removes that deposit before it is finalized, the pull request stops being paid. Refunds and kept fees are sent only for finalized deposits, and a deposit's final state is recorded only from the contract's own finalized events.
- **FEE-03 — Sending.** The Worker (`workers/submission-fee`) sends what the pull request's row says is due and never decides a merge or a close. A fee is kept only for the deposit that paid that pull request, when its row says kept. Before sending it reads the contract's own record of each deposit. It records the signed transaction before broadcasting it, resends the same bytes after an uncertain send, never signs a second transaction for a network while one is unsettled, and stays inside a per-transaction and a daily native-fee ceiling. One transaction resolves up to twenty deposits and is all or nothing, so a deposit whose payout the token refuses (a refund to a payer the token has blacklisted) is set aside when the simulation names it, and the rest are sent; a revert that no single deposit explains sets none aside. A deposit set aside is simulated again once a day and returns to the queue when its payout would go through. Its payer can still reclaim it after 30 days where the token allows.
- **FEE-04 — SLOP rate.** One platform rate, whole SLOP per 1.00 of stablecoin. A project's SLOP fee is half its stablecoin fee at that rate, rounded to two significant digits. The rate is read hourly from the official SLOP / USDG pool on Robinhood Chain, set first from a full day of readings, reset every seven days from the seven-day average, and reset early from the 24-hour average when the SLOP fee is worth less than 35% or more than 65% of the stablecoin fee. A new rate takes effect at the next UTC hour; the previous one still counts for 48 hours. When the pool cannot be read the last rate stays. Before a first rate exists SLOP is not accepted. A refund is always the amount deposited.
- **FEE-05 — Kept fees.** A kept stablecoin fee is Slop fee income like any other, so half of it funds the SLOP buyback below. It counts only from the contract's finalized `Resolved` event, proven by the finalized receipt's transfer of the deposit's exact amount to the fee wallet. Kept SLOP goes to the burn address and is not income. Refunds and reclaims are not income.
- **FEE-06 — Switch.** `SUBMISSION_FEE_MODE` is `off`, `dry_run` or `live`. `dry_run` reads deposits and records what it would send; it loads no key and signs nothing. A network whose contract is not deployed is not read. Going `live` is a separate reviewed change after the contracts are deployed, their addresses and start blocks are recorded, and the Worker holds the resolver key. The release refuses `live` otherwise. Both contracts were deployed on 19 November 2026 at `0xDe40B32A4156ABC2A05987367966d994BcFbf8D8`, owned by the S.P. operating wallet; the same day the owner named the Worker's resolver `0xB3a6E36f23B74C870b56fE3CCE425a78a0a8f525` on both and the Worker received its key. Their addresses and start blocks are recorded (`contracts/DEPLOY-MAINNET.md`). The mode was `dry_run` in Slopbot and in the Worker from 19 November 2026 (operator decision): Slopbot recorded what it would ask and wrote nothing to GitHub, and the Worker read deposits and recorded what it would send. The Worker's first hour in that mode failed, because the public chain endpoints refuse its log reads from Cloudflare; it reads through keyed endpoints since. Both are `live` since 21 November 2026 (operator decision): Slopbot asks for the fee on projects whose owner turned it on, and the Worker signs the resolver's refunds and kept fees within its gas ceilings.
- **FEE-07: Report deposits.** The same Robinhood Chain contract holds the refundable deposit on a private security report (section 8, "Report deposit"; operator decision, 21 November 2026). The deposit's item is `keccak256("slop-report-v1" followed by the Slop case id)`, so it names no project and no report and can never equal a pull request's item. It pays a report only when a deposit is asked for that item, the network is Robinhood Chain, the token is SLOP, the kept destination is the burn address, and the amount is at least the SLOP amount fixed when the report was accepted. Anything else is refused and handled by FEE-01. The security API decides what is due back and what is kept from the report's own state; the Worker sends it under FEE-02 and FEE-03 and never decides it. A kept report deposit is burned and is not fee income. `SECURITY_REPORT_DEPOSIT` is `live` in production since 21 November 2026 (operator decision).
- **FEE-08: Standing deposits.** A second deployment of the same `SubmissionDeposits` contract on Robinhood Chain, with a reclaim delay of 365 days, holds standing deposits (section 5, "Standing deposit"; operator decision, 23 November 2026). The deposit's item is `keccak256("slop-standing-v1" followed by the account's numeric GitHub id and the deposit's round, each as uint64)`, so it names no pull request and can never equal another kind of item. It pays a standing deposit only when the website created that row for that item and it is not cancelled, not already paid by another deposit and has no outcome, the token is SLOP, the kept destination is the burn address, and the amount is at least the SLOP amount fixed for the row. Anything else is refused and handled by FEE-01. Slopbot decides what is due back and what is kept from the covered pull requests; the Worker sends it under FEE-02 and FEE-03 and never decides it. The Worker keeps this contract's deposits, sends and cursor apart from the per pull request contract on the same chain, uses the same resolver key and the same daily native-fee ceiling, and never signs for one while the other has an unsettled transaction on that chain. A kept standing deposit is burned and is not fee income. The contract was deployed on 24 November 2026 at `0x446604d5c3Cc99c60CCE3d5C4357BC60f5b45993` (block 122128533), owned by the S.P. operating wallet, with the Worker's resolver `0xB3a6E36f23B74C870b56fE3CCE425a78a0a8f525` named at deployment (`contracts/DEPLOY-MAINNET.md`).

Public reads: `GET /api/v1/submission-fee/rate` gives the rate in force, when it took effect, and the previous rate during its 48 hours. `GET /api/v1/submission-fee/items/<repositoryId>/<pullNumber>` gives each way to pay what is due, whether the pull request is paid, and its outcome. `GET /api/v1/submission-fee/reports/<caseId>` gives the same for the deposit asked for one private report (FEE-07): the item, the SLOP amount, the payment and the outcome, never cached, and never the project, the reporter, a title or any report text; it answers not found unless a deposit is asked for that report. All serve stored records only.

Accepted risks: the resolver key can refund or keep any open deposit wrongly, so custody of that key is the protection; it cannot send a deposit to any other address. Anyone can make a deposit of an accepted token that does not count and cost the resolver the gas of its refund, bounded by the daily ceiling. A refund the token itself refuses stays in the contract until the token allows it. The hourly price readings are spot prices. No deposit is guaranteed to be refunded sooner than the contract's 30-day reclaim.

Solana. Operator decision, 18 November 2026: the fee can also be paid in USDC on Solana, with the same outcomes, and a kept USDC fee goes to Slop's Solana fee wallet; SLOP stays payable on Robinhood Chain only. The program that will hold those deposits, `slop-submission-deposits` (`contracts/solana/programs/slop-submission-deposits`), is in the repository since 20 November 2026 and is not deployed. No Worker reads it, the pay page does not offer it, and the fee tables name no Solana network, so FEE-01 to FEE-06 above describe Base and Robinhood Chain only. It keeps the contract's rules (a deposit goes back to its payer or to the kept wallet fixed at deposit time, the resolver chooses only between those two, the payer reclaims after 30 days) and differs where Solana requires: a deposit's record is closed on its outcome and its rent returns to the payer, payouts go to the wallet's associated token account, and only classic SPL Token mints are admitted (`contracts/solana/README.md`, "Submission deposits"). A Solana program is deployed with an upgrade authority that can replace its code; the program is described as fixed only once that authority has been removed. Deploying it, removing that authority, reading it and offering it are each a separate reviewed change.

### SLOP buyback and burn

Owner decision, 10 November 2026. Half of all fee income funds a programmatic buyback of SLOP, the Slop Cash token at `0xfeb4e36fa4a2a494ff25ae4a63491e4c584a67ae` on Robinhood Chain. This is 1% of an ordinary award or withdrawal and 12.5% of a private security bounty. The other half keeps the handling above. This section supersedes "never converts or bridges" for the buyback share only.

- **BUY-01 — Share.** Count verified fee income from an activation instant: finalized conversions into USDC, finalized USDC fee claims, completed direct-award fees, and kept stablecoin submission fees the deposit contract sent to the fee wallet ("Submission fee deposits" below). The buyback may take at most the floor of half of that cumulative total, less every amount already committed. A fee in another token counts once, as its conversion output. Earlier income never counts. A retry, restart, or repeated run must not take a share twice.
- **BUY-02 — Bridge.** On Base, Ethereum, and Solana, bridge the buyback share of USDC to the Robinhood Chain fee wallet as Paxos USDG through one deBridge DLN order at a time. Before signing, verify the exact amount, asset, destination chain, and the fee wallet as receiver, order authority, and refund beneficiary. Refuse any external call, affiliate fee, unknown reserved taker, or unchecked byte. Refuse an order below the minimum value or above the cost limit. On EVM, approve exactly the order amount to the pinned bridge contract first.
- **BUY-03 — Arrival.** Credit an arrival once, from the order's fulfilled status at a finalized Robinhood Chain block. Release a deposit only after a proven refund. A deposit without either stays in transit. The Worker never cancels an order. Report an order that stays unfilled; cancellation is an owner action.
- **BUY-04 — Purchase.** On Robinhood Chain, claim accrued fees from reviewed vaults when the buyback is active. Spend each proven arrival in full, and each fee received there at the buyback share, on SLOP through the approved swap route with output to the same fee wallet. Apply the purchase limits for minimum value, slippage, price impact, and value per run and day. The retained half of a Robinhood fee stays unconverted. SLOP received as a fee needs no purchase: its buyback share counts as acquired.
- **BUY-05 — Burn.** Keep purchased SLOP in the Robinhood Chain fee wallet. Send half of all SLOP acquired, rounded down and less every burn already committed, to `0x000000000000000000000000000000000000dEaD`. The retained half is never burned again. SLOP has no holder burn function, so `totalSupply` does not fall; the burn address balance is the public record. A paused token waits.
- **BUY-06 — Records.** Journal every approval, order, purchase, and burn before broadcast in the existing fee journal. Record one finalized outcome per send and one proven outcome per deposit. Mark a state final only from finalized evidence. Show the ledger in the private administrator report.
- **BUY-07 — Activation.** The buyback has its own mode, off by default. A live buyback needs a live converter, Robinhood Chain enabled with its key and native limits, and every limit set explicitly. Source approval does not activate it.

| Limit | Value |
| --- | --- |
| Buyback share of fee income | 50% |
| Burn share of acquired SLOP | 50% |
| Minimum bridge order | 25 USDC of available buyback funds |
| Maximum bridge cost: spread, fixed protocol fee, and network fee | 10% of the order |
| Fixed protocol fee ceiling, Base and Ethereum | 0.001 ETH per order |
| Solana order native ceiling: order-account rent, fixed fee, and network fee | 0.05 SOL per order, 0.1 SOL per UTC day |
| Minimum purchase and minimum burn | 25 USDG and 5 USDG of value |
| Purchase slippage and price impact | 1% and 3% |
| Bridge and purchase value | 1,000 per run and 5,000 per rolling 24 hours, per network and leg |

The owner confirmed the original limits on 10 November 2026, including a 500 USDC bridge minimum and a 1.5% bridge cost cap, and confirmed that the burn takes half of the SLOP the buyback acquired, once. Owner decisions, 16–17 November 2026: start checking new buybacks when at least 25 USD of buyback funds is available, and allow total bridge costs of at most 10%. This changes the bridge minimum and cost cap to the values above. Count only unspent buyback entitlement from verified fee income or proven arrivals, bounded by the wallet balance and remaining caps; the retained half of fees and unrelated deposits do not make an order eligible. Below the minimum, do not request a new bridge or reference-asset purchase route. Other assets may need a valuation quote before their dollar eligibility is known. Continue reconciling existing orders, refunds and arrivals, and keep owed burns subject to their own limits. These checks do not change the 50% fee allocation, purchase slippage, burn share, native ceilings or other value caps.

Confirmation did not activate the buyback. Operator decision, 12 November 2026: the production buyback is live and counts fee income from `2026-11-12T00:00:00.000Z`; staging stays off. The Solana order ceiling is separate from the fee-conversion native budget.

The buyback trusts the pinned deBridge contracts and program, the pinned swap router, and the SLOP token, whose owner can pause and mint. It measures price impact from the aggregator's own prices. A hot fee-wallet key can sign any transaction from its wallet; the checks above bound what the Worker signs, not what a stolen key can do. Do not describe the buyback as guaranteed, and do not publish a burn before its finalized receipt.

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

Determine implementation recipients from GitHub-linked primary commit authors. Opening, recreating, updating, or merging a PR alone earns no implementation share. For a commit without an eligible linked author, retain the source PR creator as the fallback; use the original PR creator when verified retained-copy evidence binds that commit to an original PR. A reference in a PR description alone is insufficient. Commit counts do not increase the work unit's Points. Preserve frozen awards and append corrections for eligible unpaid work.

Owner decision, 13 November 2026: keep the PR or grouped work unit's value score unchanged and split its implementation Points in proportion to each recipient's additions plus deletions in the unique accepted, non-merge commits, on every base branch. Exclude synchronization merges and work already credited in another accepted source. For a retained-copy claim, count the accepted copy's changed lines. Allocate whole Points by largest remainder, breaking ties by immutable GitHub actor ID; no per-recipient minimum may inflate the total. Complete zero-line evidence uses equal shares for binary or empty changes. Missing line evidence for multiple recipients holds the allocation; it never implies equal weights. A sole verified recipient receives the whole score. Rebalancing without a current value assessment preserves the complete previously recorded PR total, including a former carrier's share, and changes only its recipients. Keep original occurrence dates and append corrections; approved, funded, scheduled and paid rewards remain unchanged.

Credit at most the first five distinct qualifying reviewers. Use each reviewer's highest band. The review pool is their summed bands, capped at the PR's assessed credit, with a 10-point minimum. Allocate proportionally by largest remainder in 10-point increments. Break ties by first qualifying review time, then review node ID.

Use reviewed evaluation manifests only for useful work that ordinary scoring does not cover. Never reward a source twice. A merged PR later removed by GitHub retains its recorded Points and reward eligibility.

Stop new welcome and X-connection awards from 24 October 2026. Preserve earlier awards unchanged; earned-work standings and rewards exclude them. Payout recognition is fixed per recipient, project, and cycle, never per dollar or transfer.

Apply payout exclusions prospectively for owners, funded employees, and related parties, subject to the period-specific exceptions below. Excluded weights must not reduce other contributors' shares. A ban never erases a funded award.

### Historical scoring and source integrity

The current size and review bands also apply to eligible unpaid work from 1 September through 31 October 2026. Preserve original Points and frozen terms for approved or funded awards, including scheduled and paid awards. Retain source IDs, occurrence times, and eligibility and penalty dates. Append corrections; never rewrite earlier records.

Owner decision, 14 November 2026. For the October settlement of Eliza, Slop, ASI, Feed and The Network, give the full implementation Points of a verified replacement PR to the verified original contributor. A maintainer may carry the PR and add accepted follow-up commits without taking a share of its implementation Points. Require complete evidence that binds accepted work to the original PR and identifies its sole originating contributor by permanent GitHub ID. A commit by the same verified carrier in the original PR qualifies as a follow-up only when authenticated Git parent edges prove that it descends from an original contributor commit in that PR. When complete disjoint claim proofs identify multiple original contributors, divide the unchanged implementation Points by their accepted changed lines using the existing largest-remainder rule. Redirect verified carrying and follow-up work to its originating contributor; independently initiated accepted work keeps its normal changed-line share. Hold ambiguous claim attribution for review. Preserve the accepted-work score, occurrence dates, useful review credit, duplicate-credit controls and frozen awards. Use the existing changed-line allocation for ordinary PRs and other months.

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

Points are not shown as a public score. Contributor profiles show the contribution record (pull requests, projects worked on this month, payments and penalties) without a Points total, recent Points figure or daily Points chart. /points is a contributor directory with no ranking and no Points. The account menu shows no Points total. Points stay visible only where they explain a payout or a penalty: a project's monthly contributor standings, cycle records and penalty history. Operator decision, 18 November 2026. A page reading published contribution data (leaderboard, Points journal, profiles) waits up to 60 seconds for those files, since they are large; account and API reads keep their 15-second limit (operator decision, 23 November 2026).

Make Featured and Community projects discoverable. An administrator's Featured setting controls the D1 listing tier, independent of funding or payment history. Apply the same rules to ordinary and bounty projects. Featuring never guarantees payment.

The homepage lists qualifying active projects in separate Featured and Community sections according to their registry tier. It shows project cards once the funding read is complete, with the funding disclosures in section 6. Featured uses cards. Community uses a list with up to ten projects per page. Each homepage project description shows at most its first 500 characters, followed by an ellipsis if shortened. A funding read never moves a project between sections. Homepage listings omit merge statistics and bounty funding-state labels, including Pledged. Project pages retain full descriptions and reward terms. The homepage shows no Points leaderboard. Operator decisions, 17 and 18 November 2026.

The homepage, /sponsors and agent discovery (`/.well-known/slop/projects.json`) require a positive configured amount for the current UTC month, an open security program, or an external prize share. Resolve exact-month overrides from the project registry. Zero-amount projects with no other reward stay out even when funding data is missing. The registry and intake gates still apply. Vault evidence labels the amount and governs payment under section 6. Project pages and skills retain their direct-link access rules. Operator decision, 18 November 2026.

A project over its owner's intake cap (section 5) is also left out of the homepage, /sponsors and agent discovery until its count falls below the cap. Operator decision, 17 November 2026. From 1 December 2026 a project the backlog rule takes out of rotation (section 5) is left out of the same three places until it clears, unless its owner marked it as catching up on reviews. Operator decision, 23 November 2026.

Until 8 December 2026 00:00 UTC the homepage shows a one-line notice inviting maintainers to enter a repository for the sponsored pools round, linking to https://record.slop.cash/sponsored-pools. A visitor can dismiss it; the dismissal is kept in that browser's local storage, and blocked storage closes it for the current page only. The notice stops rendering at that instant with no release, names no vote date beyond "early December" and changes no listing, Points or payment. Operator decision, 23 November 2026.

A project page shows the network of each recorded vault (with its payout asset when known), the project's website and its X account, each only when present. Owners set or clear the website and X account on Add project and in project settings; they are presentation links (`links.website`, `links.x`) published as an immutable owner revision, not material terms (operator decision, 16 November 2026; #2295).

A project's Payments label reads Enabled, and its Vault label Live, only when the project has a recorded vault on a network whose payout execution is on (section 11). The legacy `reward.paymentMode` field does not decide either label. An empty vault can still read Enabled: the label describes the network switch, not the balance. Operator decision, 15 November 2026.

Paused projects with a qualifying reward remain on /sponsors. Paused projects are excluded from homepage listings, agent discovery, collection and scoring. Retired projects disappear from lists while history still resolves. Legacy community projects remain retired. Their IDs exist only in `src/lib/legacy-projects.json` for Points and profile validation; never list, collect, score, or pay them.

Profiles and cycle pages show finalized ordinary vault payments with project, recorded contribution month, net asset amount, and transaction link. If the contribution month is missing, show it as unavailable. Never infer it from indexing time. Preserve closed-account privacy and distinguish pending or unavailable evidence from payment.

Do not publish private case amounts, counts, queues, or revealing totals through ordinary profiles, balances, rankings, cycles, or notices.

Public record pages. slop.cash publishes /record (money that has reached contributors, the monthly cycles, the pools and the sources), /receipts, the program terms pages /referrals, /buyback, /october-allocation and /sponsored-pools, and /privacy; they replace the retired record.slop.cash site. Every release build, fresh or published-data, rebuilds `/data/record.json` (`scripts/record/`) from slop.cash's own public data and the pinned archive commit, in the shape of the retired site's snapshot; any failure publishes the previous record unchanged and never fails the release. /receipts shows one receipt for each project month in which a project's vault sent money to at least one contributor who is neither a team account nor the project's owner, every recipient named and each transaction final on chain; a published receipt never disappears. These are payout receipts, not the removed run-receipt page. The pages read only that file. Operator decision, 23 November 2026.

### Interface requirements

Use existing routes and shared controls. Show the result, next action, and restriction together. Keep required consent, amounts, and evidence visible. Avoid decorative controls or explanatory clutter. Interface changes require an approved requirement or a reproduced broken flow.

Home provides distinct contribution and private-report entry points. Show current security offers before project lists. Keep generic agent setup available even when discovery fails or no project is cleared.

The hero has one Contributor / Maintainer switch above the headline. Contributor is the default; `?audience=maintainer` opens the maintainer view and an invalid value uses Contributor. Preserve the selected journey on reload and through browser navigation without cookies or local storage. The switch changes the headline, copied prompt, and every agent's skill destination together. Contributor keeps "Make money shipping open source"; Maintainer uses "Ship faster. With contributors." Both use the short instruction "Paste into your agent." Reset copy feedback and headline animation when switching. URL-only launchers receive the selected skill URL. Keep the direct Add a project route and the shared discovery sections. Use existing controls and icons with short accessible labels; add no role dashboard or explanatory cards. How it works links to both journeys and states that funding is optional. These interface changes are approved by the owner request of 13 November 2026.

Preserve the campaign typing/deletion animation with a stable accessible heading. Disable it for reduced motion. Keep the header at the viewport top while scrolling. Keep the main landmark and keyboard navigation without the removed Skip to content link.

Support mobile screens, keyboards, screen readers, reduced motion, and 200% zoom. Meet Web Content Accessibility Guidelines (WCAG) AA. Use field-linked errors, status announcements, exact readable values, and useful recovery actions.

The public `/models` page remains removed; `/receipts` now shows payout receipts (Public record pages), never run receipts. Do not show individual receipt details or evidence-bonus labels. Keep attribution, optional collection, APIs, and stored records. Cycle pages omit the Evidence section and original-record download links; retain existing data URLs. The intentionally removed `/data/cycles/eliza/2026-09/proposal.json` and `/downloads/contribute-to-eliza.skill` remain HTTP 404.

## 8. Security and private bounties

### Clear a project before execution

Require one complete successful admission scan for each nonexempt immutable registered repository. Routine source, dependency, skill, Markdown, and presentation changes retain admission. They are not represented as scanned. A different repository cannot inherit clearance.

Bind the assessment to its actual revision, commit, and template. An existing row, failed evidence check, or incomplete scan is not clearance. Explicit investigations and reinstatement still require current evidence and live source checks.

Scan for malicious code, wallet drainers, credential theft, secret export, harmful installation, suspicious downloads, unsafe execution, and prompt injection. Acquire the exact commit with one shallow Git fetch and verify it locally. Store inert content objects.

Run deterministic checks over every file. Review large content in token-budgeted batches, risky content first, then synthesize the repository result. Deterministic checks may cover dependency locks, data, generated bundles, and vendored copies; send every match to the model with context. Read every item marked reviewed.

There is no repository, entry-count, file, object, or run size refusal. Repeating the same scan cannot be the sole remedy for a large repository. Incomplete review never passes.

Use Surplus Claude Sonnet 5.5 first. Use GPT-6.1 Terra or specialist investigation only for ambiguous or high-risk findings. Use one disposable Cloudflare sandbox per risky artifact, with internet off and no secrets. Full runtime execution of every project is not required.

A passed scan means every defined check ran on the bound revision and found no malicious result. Record checks and coverage gaps. It is not a guarantee of safety. Uncovered executable content makes the scan incomplete unless a check, isolated execution, or specialist review covers it.

Operator decision, 19 November 2026: admission clearance follows the scanner's own evidence, not a reviewer's hedge.

- Agent-instruction checks match wording that conceals something from the user, sends a secret to a destination, overrides instructions, or hides text. Protective guidance such as "do not tell the user to buy tokens" or "never paste your token" does not match.
- A scan pass runs on the deployed isolated runner when it reports the controller's own commit, or an earlier commit of the same branch with no scanner input (the scanner's code, its imports, the isolated runner, the vetting API, the workflow and the dependency lock) changed since, so merges that do not touch the scanner do not hold scans until their own release (operator decision, 23 November 2026). Each release publishes that input list for its commit at `/scanner-inputs.json`, so a scheduler without a checkout applies the same rule.
- Install-time shell helpers are followed through ordinary shell syntax: commands inside substitutions, subshells, conditionals, loops and braces are read as if they run, and a `cd` that may not run leaves the directory unknown, so a later local launch stays a gap (operator decision, 23 November 2026). `eval`, `case`, dynamic commands and unclosed substitutions still keep install coverage partial.
- An image whose name and complete byte structure agree on PNG, JPEG, GIF or WebP is listed by digest and is not a quarantined binary. A font is treated the same way when its name and structure agree on TrueType or OpenType (tables inside the file, a header table, nothing after the last table), WOFF, or WOFF2 (a recorded length equal to the file length) (operator decision, 23 November 2026). Any other undecodable or binary content stays quarantined.
- Slop's queued canonical skill template is Slop's own code at the template digest the queue assigned. Every deterministic check reads it; it is listed by digest and is not sent to the models. Only the controller can mark a file as template input. A repository file under the reserved template prefix is a scanner gap.
- A reviewer that marks a threat partial or missing must name what stopped it. The scanner checks each reason against what it supplied: content supplied to that call and not reviewed, a partial area without a reason, and any missing area keep the scan incomplete; content another completed batch reviewed or a deterministic check covered resolves the reason; content outside the acquired revision is recorded as `outside-revision` and is advisory. Install-time downloads the scanner finds stay scanner gaps.
- Info, low and medium model findings are advisory and recorded. A high or critical finding from either review, suspected malice, a deterministic high or critical finding, a scanner gap, an unreleased artifact, or a review that did not complete keeps the scan incomplete. An escalated result still needs the specialist review.
- Results recorded before this decision keep their disposition and meaning; a historical `<reviewer>:<threat>:partial` gap still blocks. The rule is qualified with real Surplus calls (`scripts/qualify-vetting-review.ts`).

### Exemptions and restrictions

Migration `0075_vetting_grandfathered_projects.sql` permanently fixes the existing-project exemption set in each environment. Those projects need no normal admission scan, including after executable changes. Later projects cannot join that set. The exemption covers each project's original repositories; a repository appended later needs its own admission scan or owner-approved exemption. Display an exemption, never a passed scan.

A separate owner-approved Umia fork exemption requires an audited administrator record. Bind it to the current D1 revision, permanent repository identity, steward, approving actor, reason, and time. Display **Owner-approved exemption**. Another repository or steward cannot inherit it. Other grants require a separate human owner decision. Retain previous assessments and audited revocations; revocation restores ordinary admission.

Owner decision, 11 November 2026: administrators may approve community admission after a cursory malicious-code review of the latest development source. Use the project's registered integration branch; use its current `develop` branch when the owner selects that branch for the review. An older source pin or an unproven source-to-binary match does not block this manual review. Record the actual branch and head observed, review scope, limitations, approving administrator and owner decision in the audited admission-exemption record. Keep its **Owner-approved exemption** label; do not present it as a complete passed scan or rewrite earlier assessments. Contributors still review the project themselves before installing or running it.

The approving platform administrator need not have write access to a third-party repository. Verify the registered project's creator or individual steward still has current GitHub write or maintain authority through its Slopbot installation, and bind the grant to the current immutable repository, steward and D1 revision. Record the administrator as the approver, without impersonating the maintainer. Missing installation, unavailable authority, restrictions and confirmed malice still refuse approval. Automated scan results keep their actual source bindings and complete-evidence requirements.

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

Every program page shows one Slop-wide "Does not qualify" list after its scope facts (operator decision, 16 November 2026): no runnable proof against the published source revision; known, public, accepted or by-design risks; attacks needing a compromised privileged key or the reporter's own stolen keys or accounts; front end, website, DNS, email, phishing and social engineering; denial of service with no loss of funds; testnets, old revisions and code outside the scoped commit; third-party dependencies outside the listed scope; duplicates after the first qualifying reporter; findings made by testing live systems or touching other people's funds; and reports the reporter cannot reproduce or explain, including unverified AI output. The list lives in one constant, `SECURITY_DEFAULT_EXCLUSIONS` in `src/lib/security-bounty.mjs`. Owners may add up to 20 more lines of 3 to 300 characters as `scope.excludedFindings`; terms without the field have none. Changing them publishes a new terms revision, so it applies only to later reports. Screening, case analysis and appeal triage receive both lists with the scope and name a matching line; that remains advisory and never decides validity, an award or payment. Only the routine decisions below close a report on a matching line.

Show researcher net prominently, with gross, Slop share, scope, and pledged or verified funding. A prefunded program opens only after verified funds. An explicit `after-approval` program may open as a discretionary pledge. An open offer does not prove available funds.

Keep owner setup separate from reporting. Group offer, scope/testing, contacts/response targets, and preview/publish. Verify owner authority before showing setup. Project stewards or repository administrators manage case contacts without routine platform approval. Keep bounty funds separate from contribution funds, with observation time and stale status.

Reporting uses Write report and Review and submit on one route. Classification is optional. Keep drafts in account-and-project-bound session storage. Clear them on sign-out or account change. Preserve the idempotency key through uncertain retries and show storage failure. Do not add persistent local-storage drafts, server autosave, or an attachment service.

Retain the exact report in private object storage before optional forwarding. Bind its digest, reporter, repository, receipt time, and effective terms. Atomically create the case and reporter Inbox receipt. Never put report bodies in D1, public pages, logs, analytics, notifications, or generated artifacts.

Operator decision, 20 November 2026: a report may carry one optional proof-of-concept file beside the description, written as a test that can be applied and run. It is plain UTF-8 text of 1 to 60,000 bytes with no NUL byte, named with letters, digits, dots, hyphens and underscores (1 to 200 characters) and ending in `.patch`, `.diff`, `.sol` (including `.t.sol`), `.ts`, `.js`, `.rs`, `.py` or `.go`. The form reads the file in the browser, shows its name and size with a Remove control, and keeps it in the draft; a Load report from file control fills the description from a `.md` or `.txt` file in the browser only. The file is stored inside the retained report, so it is versioned and digested with it, and the whole stored report stays within the existing size limit. Screening, case analysis and the routine pass read it as the reporter's own untrusted proof-of-concept file and never run it, and a report version that carries one always has proof present. The reporter and the authorized case readers see it in Inbox with a download. GitHub forwarding appends it to the description as its own section, a heading "Proof of concept: <file name>" and the file in a fenced block whose fence is longer than any backtick run inside it. The description with that section must fit in 65,000 characters, the bound the description alone had; intake refuses a longer combination and asks the reporter to shorten the description, never truncating it.

### Report deposit

Operator decision, 21 November 2026. A private report filed through Slop needs a refundable deposit of SLOP on Robinhood Chain worth 5 US dollars at Slop's published SLOP rate (section 6, FEE-04) when the report is filed, rounded up to a whole SLOP. SLOP only; there is no stablecoin option. The amount is fixed when the report is accepted. Constants and the pure rules live in `src/lib/security-report-deposit.mjs`; the ask, the hold and the outcome live in `backend/security/report-deposit.ts`.

The report is accepted and stored privately at once, with its time, exactly as without a deposit. Until the deposit is recorded, nothing else happens to it: it is not screened, the program owner is not notified, it is in nobody's list or count but its reporter's, the routine pass does not read it, nobody can decide it, and GitHub forwarding refuses with a plain reason. The reporter can read it, add a version and see "Deposit needed" with the exact SLOP amount and a link to the pay page. A report is never closed or deleted for an unpaid deposit. When the deposit is recorded, the next security API request starts the screening that waited. A report that waits is never counted as an earlier report against someone else's.

The deposit is sent back to the wallet that paid when the report gets a first response that is not one of the three closes below: it is acknowledged or in triage, it is accepted, a maintainer approved it for routing, the reporter answered a person's request for information, or it is rejected without the spam mark. It is also sent back when 14 days pass after payment with no response at all, and when the program's owner turns the deposit off while it is still undecided.

The deposit is kept only when the report is closed as a duplicate, as out of scope (a finding the program's "Does not qualify" list names), or as spam, the latest decision on it has stood for 7 days, and no appeal is open. In the record that means: receipt state `duplicate` or `out-of-scope`, written by the routine pass under its published rules, by a security maintainer's decision, or by a reviewer upholding an appeal; or receipt state `rejected` whose latest decision is a security maintainer's and carries the maintainer's own spam mark. Screening's "spam" verdict is advisory and never keeps a deposit, and no model output alone does. An open appeal waits. An appeal that returns the report to the owner stops the clock, and the outcome follows the owner's final decision. A deposit already due to be kept is not changed by a later appeal. A kept deposit goes to the burn address `0x000000000000000000000000000000000000dEaD`. Neither Slop nor the project receives it, so nobody gains from closing a report.

A report closed because proof never arrived is sent back: it is not one of the three closes (operator decision, 22 November 2026). The deposit filters spam, duplicates and findings the program excludes; a report without proof is more often a real finding written thinly than one of those. That close is made automatically when the 14-day clock runs out, and an automatic close never keeps a deposit. A maintainer who judges such a report to be spam can still reject it with the spam mark, and the deposit is then kept under the rule above.

The spam mark is a checkbox beside the outcome "Rejected" on the owner's decide form, shown only while the report deposit is switched on, and sent with the decision. It is the only record that closes a report as spam (operator decision, 21 November 2026).

On by default for every project, existing ones included. The owner can turn it off in project settings (`project.security.reportDeposit`, an ordinary owner revision that is live at once); absent means on. Reports that existed before the switch-on are never asked: a deposit row is written only together with a new case. Later versions and corrections of a report are not asked again. Not asked: the project's steward, its named security approvers, an account that published a revision of the project or applied for it, an account with current write, maintain or admin access to its repository, Slop moderators and admins. When GitHub cannot be read for that last check, the account is asked. When no SLOP rate is in force, nobody is asked and reports proceed as before. A reporter who links a report they already filed on GitHub creates a Slop case, so they are asked the same way, and the owner's notice and the analysis wait for the deposit; a maintainer's own import of GitHub reports asks nobody.

The deposit sits in the `SubmissionDeposits` contract already deployed on Robinhood Chain (section 6). No new contract and no new key. If nothing is ever decided, the payer takes it back from the contract after 30 days. Any wallet can pay. The deposit is public on chain: it shows the paying wallet, the amount, and that it is a Slop deposit. It does not show the project or the report, and the pay page says so before a wallet is chosen.

`SECURITY_REPORT_DEPOSIT` in the Pages configuration is `off`, `dry_run` or `live`; any other value is off. `dry_run` writes a `recorded` row for each report that would have been asked and holds nothing: the report proceeds exactly as before, and a recorded row is not a deposit ask. `live` asks. Production is `live` since 21 November 2026 (operator decision; it ran record-only for part of that day) and staging is `off`. Setting the mode to `off` or `dry_run` releases every report that waits, and sends back every paid deposit that has no outcome yet; no deposit is kept while the mode is not `live`. The pay page and the report form offer the deposit only while `REPORT_DEPOSIT_SWITCHED_ON` in `src/lib/security-report-deposit.mjs` is true, which a release test ties to the production mode. Changing the mode is its own reviewed change. Never say the deposit buys a faster or better review, and never call it a stake, an airdrop or an investment.

### Screening, human review, and forwarding

Screen before notifying the project owner. Use the existing Surplus account and requested model `claude-sonnet-5.5`. The marketplace model identity is not independently verified. Use no provider fallback and execute no submitted code. Treat every report field as untrusted data.

Screen for plausibility, reproducibility, missing evidence, duplication, and spam. Screening is advisory and separate from severity, acceptance, award, payment, and disclosure. Missing evidence, suspected spam, uncertainty, or provider failure must remain recoverable. An authorized owner may review or override a held result. Notify owners only for plausible or owner-approved reports, through private Inbox and verified email notices.

Operator decision, 17 November 2026: the screening agent decides routine reports itself; award approval stays human. A bounded, repeatable pass works through reports still in `received`, oldest first, with a limit per pass and per day. It records one result for each report with an audit record: the models, the prompt label, the published line or earlier report relied on, and the time.

- **Duplicate.** The report's digest equals an earlier report's in the same program, or two independent model calls both name the same earlier report as the same finding. Close it as a duplicate of an earlier report. Do not reveal the other reporter or the other report's content.
- **Does not qualify.** Two independent model calls both name the same published line, a default line or an owner line, and neither finds that the report plausibly describes theft or permanent freezing of funds. Close it with that line quoted.
- **Needs proof.** The report has no reproduction steps or runnable proof. Do not close it. Mark it as waiting on the reporter, say what is missing, and start a 14-day clock. Close it as no proof received only when the clock runs out with no new report version.
- **Everything else.** Acknowledge it with a real status change, so the reporter sees it was read, and put it on a short ranked list in the program owner's Inbox: plausible severity first, then proof present, then age.

Never close a report automatically when any call finds loss of funds plausible, when a call was unavailable or the calls disagree, when an appeal or a report correction is open, or when the report is on GitHub, where a maintainer may already be discussing it. The reporter receives an Inbox notice with the plain reason and may appeal once. That appeal returns the report to the program owner for a human decision through the existing appeal action, and the pass never reads the report again. A model never confirms a finding and never approves or pays an award.

`SECURITY_ROUTINE_DECISIONS` in the Pages configuration is `off`, `dry_run` or `live`. `dry_run` runs every rule and stores the decisions it would make, readable as aggregate counts, without changing a report or notifying anyone. Production started in `dry_run` and staging `off`. Operator decision, 20 November 2026: production is `live`, after the dry-run record showed no close on a plausible loss of funds. Every program page says under its "Does not qualify" list that reports matching it, duplicates and reports without proof are closed with a reason and can be appealed.

Operator decision, 24 November 2026: a report's automatic analysis runs behind the request that filed it, within a 25-second background limit, and is not retried by itself, so an operator job retries a report's missing or failed analysis with the full time limit an owner's Analyze uses. It runs one analysis per request, oldest open report first (`received` or `triaging`, not waiting for its deposit), only where the owner's Analyze would run, at most four attempts per report version, at least 30 minutes apart, and no attempt once 150 attempts started in the current UTC day. A keyed operator read gives per-project queue counts (open reports, reports without an analysis, reports whose analysis failed, reports undecided after seven days, the oldest open report's time) without case ids, reporters, report text or advisory ids (`/api/v1/operator/security-queue`, answered only with the `OPERATOR_FEED_TOKEN` Pages secret as a bearer token and otherwise not found). The analysis stays advisory, exactly as from the owner's Analyze.

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

**Slop payout code.** Operator decision, 20 November 2026, replacing the offer of 28 October 2026: Slop's own security program is funded only by its holders. It opens only if the Slop Cash decision market of 24 November 2026 passes the option "Fund the pool and a Slop security program", which moves 10,000 USDG for the program from the treasury to the Slop Cash S.P. Until then, and if that option does not pass, Slop offers no paid award for its own code; reports are still received and handled privately.

Each accepted critical finding carries a $5,000 award, paid entirely to the first qualifying reporter. Slop takes no share or payout fee. There are at most two awards. The program closes 12 months after it opens or after its second award, whichever comes first, and the S.P. returns whatever has not been awarded to the treasury. The S.P. confirms each finding and its severity. Because the funds sit with the S.P., it pays an approved award directly to the researcher and publishes the transaction after the fix is released; no Slop vault or payment rail is involved.

A finding qualifies if it is reported privately through Slop's security intake and shows a loss of funds from a Slop vault, from a contributor payout, or from Slop's other payout contracts (project escrow on Base, Ethereum, Robinhood Chain and Solana; submission deposits; the referral distributor), including the off-chain Slop services that compute, record or send those payouts. Loss means theft or permanent freezing of user, contributor, owner or vault funds, or a payout sent to someone not entitled to it. The first qualifying report of each distinct problem is considered.

Exclude third-party contracts, website and frontend-only defects, testnet and local deployments, known or previously reported findings, reports filed before the program opens, and losses requiring compromised privileged keys or intended owner actions. This offer belongs to the `slopdotcash` platform project and binds no 75/25 bounty vault.

### Private data and retention

| Data | Access and retention rule |
| --- | --- |
| Private reports | Only the reporter and currently authorized case reviewers may read retained bodies. Audit every read. Keep cases and obligations through recovery and role changes. |
| Scanner evidence | Only `lalalune` and `drew-dot-com` may read through audited 15-minute grants. `lalalune` owns this policy. |
| Successful admission evidence | Retain permanently, including original evidence behind reused results. Missing or corrupt evidence is never valid. |
| Other scanner evidence | Retain while open and for 90 days after closure. Clean scans close automatically; incomplete or malicious cases require `lalalune` to close them. |
| Scanner recovery records | Daily private backups retained for 30 days; access logs retained for one year. Prove restoration before activation. |
| Contributor traces | Permanent private R2 objects. No website or API may return a body to anyone, including its contributor. Under contract version 2, designated operators may export a licensed trace only to fulfil a sale, with an audit record. |

Store scanner objects once by SHA-256 in private R2 using 8 MiB upload parts. D1 holds manifests and digests. Reuse existing objects by reference; delete shared bytes only after all retained references end. Policy changes require a reviewed source change, not a deployment attestation.

Trace upload remains optional, authenticated, bounded, checksum-verified, write-only, and fail-closed. Failure or refusal must not block contribution. Operator decision, 22 November 2026: private trace contract version 2 (`backend/trace/README.md`, published at `/protocol/private-trace-v2.md`) lets a client upload by default after showing the file and a one-line decline, and adds paid licensing as a separate account opt-in. Operator decision, 23 November 2026: licensing is available from the account settings, off by default, and turning it on needs the contributor's confirmation that their model provider's terms allow it. It covers each trace uploaded under version 2 while the setting is on; any other trace of the account, including version 1 traces, is licensed only when the contributor opts it in explicitly, one by one or every listed trace at once after seeing the list and its count. Turning the setting off, or closing the account, withdraws every unsold licence; closing also turns the setting off, and reopening restores neither. A participation-banned account cannot turn it on or opt in. No trace has been sold or exported. Only traces joined to a merged or closed pull request with a recorded outcome may be sold, to AI model developers and data vendors under a licence that forbids re-identification and resale. Contributors receive 50% of each sale, split evenly across its traces, paid to their registered payout wallet. Slop scans each trace for credentials before it leaves Slop. Version 1 stays published unchanged for the traces uploaded under it. Operator decision, 23 November 2026: private trace contract version 3 (published at `/protocol/private-trace-v3.md`) keeps the contents of files inside the project's registered public repository, tracked or created by the agent and not ignored, only when GitHub reports an OSI-approved licence for it at the time of the run; otherwise the version 2 rule applies. The run's pull request is recorded on the measured run before the trace is uploaded. A version 3 upload is licensed at upload only while the setting is on and its latest confirmation was given under version 3; a setting turned on under version 2 is confirmed again without turning anything off or changing a licence. Versions 1 and 2 stay published unchanged. Keep only safe metadata and digests in public artifacts. Preserve existing audit records. The MVP accepts the absence of a durable per-actor upload quota; this does not remove size or authentication controls.

## 9. Operations and launch decisions

### Administrator and moderator journey

1. Sign in and open the queue permitted by the current role.
2. Recheck project identity and current authority before viewing evidence or acting.
3. Review the source record and any Slopbot recommendation.
4. Record the permitted decision and reason.
5. Confirm the resulting restriction, notice, or recovery state.
6. Preserve history, funded obligations, and appeal access.

Administrators manage Featured placement, authorized exceptions, restrictions, and incomplete ordinary assessments. Use quarantine to hold a project. They do not approve routine project admission or automatically gain private-case access.

Moderators are `lalalune` (GitHub actor 18633264) and `drew-dot-com` (202660855). Escalate when an appellant or maintainer rejects Slopbot's proposed resolution. Escalate appeals or disputes that involve bans, confirmed malice, private security cases, or debits of at least 240 Points. Escalate a repeat appeal of a finding on an item whose earlier appeal was denied, awaits a moderator, or has an unanswered deny draft, so a new revision cannot reopen that debit without a moderator; the same check runs again before an appellant accepts an uphold draft (operator decisions, 21 November 2026). Escalate when Slopbot's confidence is below 0.9. Escalate an appeal still unresolved after seven days.

Incomplete ordinary PR assessments appear once in the current maintainers' and administrators' private Inbox. Show the public PR and retry state. Retain the entry through retries and remove it on completion. Recheck authority on each read; unavailable checks produce a retryable failure. Never expose this queue to unrelated or former maintainers.

### Notifications

Use one Inbox for wallet changes, payout exceptions, project decisions, appeals, and case notices. Save each notice with its source change. Replay must not duplicate it. Keep private notifications generic and link to the secure Inbox.

Activity email is optional. Show the verified destination before consent and bind consent to its exact version. A changed address needs new consent. Opt-out cancels queued activity mail, including during outages. Opt-in does not send old history. Wallet-security and private-case notices use their separate policies.

An operator service may read which accounts have a funded award still reserved, with the project, the network and whether the account still needs a confirmed wallet or the payout authorization, and without amounts or wallet addresses, to remind them (`GET /api/v1/operator/reserved-awards`, answered only with the `OPERATOR_FEED_TOKEN` Pages secret as a bearer token and otherwise not found; team accounts and closed accounts are left out). Operator decision, 17 November 2026.

Recheck roles and destinations before sending. Provider acceptance does not prove inbox delivery or user acknowledgment. Verify actual receipt separately. Bound retries and reconcile uncertain sends before retry. Escalate failed or overdue case notices to a current approved backup. Notification failure never deletes a case.

### Dependencies and local operation

Public pages use cached D1 data or published snapshots. Refresh failure retains the last good value with a stale label. Sensitive actions require fresh authority.

Operator decision, 19 November 2026: published contribution data refreshes itself. Once a day (07:17 UTC) a scheduled job starts one fresh production collection on main unless a collection is already running; after each main release it publishes that release's own collection through a `data_from_run` release when main moved before it could publish, resumes a failed collection once from its checkpoint, and fails visibly when the live data is more than 48 hours old. Operator decision, 21 November 2026: GitHub fires scheduled and after-release jobs only from the repository's default branch, so while the default branch is not main an outside scheduler starts main's scheduled workflows by hand (the daily collection and its after-release follow-up, the monthly close, the hourly watches and the nightly checks), using a GitHub App token limited to starting workflows in this repository; it stops by itself when main is the default branch again.

An active project's page shows how promptly it merges outside work: when it last merged a pull request, how many outside pull requests (author not an owner, member or collaborator, not a bot, not a draft) have waited seven days or more without a review or comment from anyone who can merge, and the median time to merge of outside pull requests merged in the last 30 days, with the date checked. Each /sponsors card shows a short version of the same figures; homepage listings omit them. The Slopbot schedule reads each repository once a day into D1 and `GET /api/v1/merge-activity` serves the stored rows; a failed read keeps the last values. It changes no score, status or payment (operator decision, 15 November 2026; #1993). The same read also stores each repository's count of open outside pull requests, used only for an owner's intake cap (section 5; operator decision, 17 November 2026). The waiting count and the last merge also decide the backlog rule (section 5; operator decision, 23 November 2026), which changes only listing, never a score, status or payment.

Production `slop.cash` may load Cloudflare Web Analytics through Cloudflare's automatic setup, only to count page views by path and referring site. Cloudflare does not inject into HTML the site's Pages Function serves, so that function adds the beacon tag itself on the production host only, set to report to the site's own origin as the automatic tag does. The beacon uses no cookies or local storage, logs no query strings and reports to the site's own origin, so private Inbox, case and admin parameters never reach it. Staging, local development and tests never load it. No page depends on it: a blocked or failed beacon changes nothing. Add no other analytics or third-party script without a separate owner decision. Operator decision, 11 November 2026.

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
| Maintainers | Complete and resume setup without routine admin approval. Enter through the maintainer skill, preserve the user's task and existing authorization, and verify current authority for each sensitive action. Verify installation, admission, immutable revisions, and independent funding readiness. Remove a project with current authority or cancel a pending application; preserve history and obligations and refuse stale or unauthorized writes. |
| Slopbot | Review registered repositories for free. Preserve incomplete outcomes, qualified closure scope, consent, reopen protection, penalties, and appeal escalation. |
| Points | Complete source coverage, correct work/review shares, single debits and reversals, preserved history, and no duplicate credit. |
| Security admission | Prove complete scans, honest exemptions, eligible two-flag pause, skill refusal, fresh reinstatement, and human confirmed-malicious decisions. |
| Private reports | Meet section 10 for paid and unpaid intake, including privacy, partial payments, recovery, and separate disclosure authority. |
| Monthly rewards | Prove one proposal and final allocation, full funding, owner adjustment/opt-out, cutoff fallback, permanent reserves, and exact finalized payment. |
| Fee handling | Prove receipt, claim, conversion, reconciliation, and failure/restart controls. Keep Robinhood assets unconverted and enforce every value and gas limit. |
| Operations | Prove role-scoped queues, idempotent notices, current consent, restoration, isolated local development, and explicit unavailable states. |
| Interface | Verify all affected desktop/mobile flows, keyboard access, screen readers, 200% zoom, reduced motion, downloads, links, and console/network behavior. The audience switch, copied prompt, and agent skill URL agree after switching, reload, and browser navigation; copy failures remain recoverable. All three global skill entries are published with matching discovery integrity metadata. |
| State correctness | Meet section 12 with source mappings, reachable scenarios, implementation evidence, and explicit gaps. |

Use real provider calls for model behavior and real browser, database, and chain evidence where applicable. Record exact source revisions, client versions, providers, models, results, and limitations. Follow [CONTRIBUTING.md](../CONTRIBUTING.md) for required checks and affected agent-client coverage. Never publish secrets, private prompts/responses, source evidence, credentials, sessions, traces, or signing material.

### Release workflow

Use reviewed PRs into `development`, then batch promotions to `main`. Reviewed development PRs may merge before hosted continuous integration (CI) finishes. Fix or revert failures promptly. Main must pass the full trusted quality gate before deployment.

Production deploys only through the checked-in main workflow and main-only production environment. Keep publication credentials out of PR runs. Use the shared publication lock and bind deployment to the tested source. Staging uses separate storage, identity, and secrets. No separate manual release approval or branch-protection rule is required. Do not add rulesets unless requested.

Normal releases sync the current D1 registry and collect live GitHub data. A fresh manual main release may resume public PR discussion reads from a recent trusted main release attempt. Every reused response requires live GitHub revalidation; the current registry, census, scoring inputs and release checks still run. A collection that stops at its checkpoint deadline cannot publish. Operator decision, 19 November 2026: the checkpoint also keeps the reads that a commit id in their address fixes (commit file pages, compare pages and Git commit, tree and blob objects) for registered repositories; a resumed run asks GitHub again with the saved ETag, and each kept body must name the commit in its address. Operator decision, 20 November 2026: a main collection that is not a retained-data release makes a bare clone of this repository, and of any repository named in the `LOCAL_GIT_REPOSITORIES` variable, in the runner's temporary directory and answers Git tree and commit object reads from it; a read the clone cannot answer exactly goes to GitHub unchanged, a failed clone only turns this off, and the clone is never part of the published bundle. A transient GitHub answer is retried in place and changes no result: any exact GitHub GET retries a 502, 503 or 504 twice, and pull request file, review, comment and commit pages, issue comment, event and timeline pages, exact commit file pages, and a commit's pull request pages retry a 500 twice; the hosted value feed retries an outage on the delays in `SLOP_VALUE_FEED_RETRY_DELAYS_MS`, which the release and monthly workflows set and which unset means one attempt (operator decisions, 19 November 2026). Any other failure still ends the collection. Operator decision, 19 November 2026: collection is incremental. Each successful trusted main collection keeps a memo of immutable commit line statistics and of commit attributions with every input they were derived from; the next trusted main collection, and the monthly close, reuse an attribution only when the live census values and every recorded pull request, reference and incoming cross-reference still match, re-read actors live, and recompute about one in fifty reused answers as an audit that discards all reuse on any difference. Operator decision, 24 November 2026: a saved attribution survives code changes that leave the attribution rules alone. The memo records `ATTRIBUTION_RULES_VERSION` (`scripts/collection-memo.ts`), and a change that could make a saved answer come out differently must raise it; a test pins the rule sources so such a change cannot land unnoticed. When other code changed since the memo, the audit recomputes about one in ten reused answers, and each saved answer is recomputed live at the latest seven days after it was computed, on a spread of days, instead of a weekly full recomputation. Operator decision, 25 November 2026: the accepted implementation memo (native change digests of exact Git objects and observations of earlier merged pull requests) has the same treatment. It records `IMPLEMENTATION_MEMO_RULES_VERSION` (`scripts/collection-memo.ts`) and a test pins its rule sources; a memo written under other code is kept, about one in fifty reused entries (one in ten after a code change) is read again live, and one definitive difference discards every saved entry and reads that evidence again in the same collection. Its seven-day limits are unchanged. Every census, hydration, review census and consistency guard still reads GitHub live. Operator decision, 21 November 2026: before its sequential value-history loop the collector reads the first history page or pages of each outcome from the hosted value feed ahead of time, at most `SLOP_VALUE_FEED_CONCURRENCY` at once (1 to 16; six in the release and monthly workflows; unset reads one at a time), and a read that fails there is dropped and repeated by the loop in its own turn, so decisions, held work units and failures are those of the one-at-a-time reader. Operator decision, 20 November 2026: an enumerated source that GitHub cannot resolve still discards the attempt and forces one complete recollection, except a joint value-record member outside the live census. When three availability probes a few seconds apart all report that member unavailable, the first attempt records it as an unavailable source and holds its work unit, exactly as the recollection would. Any differing or failed probe keeps the recollection. A memo older than seven days, a raised attribution rules version or `full_collection` recomputes every attribution, and a missing or unverifiable memo means a full collection, never a failed release. An explicit manual main or development release may set `use_published_data` to retain the validated rankings and profiles last published by its own environment (production or staging; operator decision, 13 November 2026). Preserve their timestamps, history, and counts. The option defaults to false and cannot run with bootstrap data. It cannot use the PR adapter or skip any code, browser, sandbox, environment, source, or deployed-byte check. Missing or invalid data stops release. Operator decision, 18 November 2026: such a main release may also name in `data_from_run` a completed trusted main release whose own fresh collection succeeded at an ancestor commit, and then takes that run's collected rankings and profiles from its checked bundle instead of the live site; it still refuses data older than the live publication. A manual release may separately set `skip_proofs` (section 12, STATE-05); that option leaves out only the state-model and LemmaScript proof stages. Operator decision, 14 November 2026: a manual main or development release may also set `skip_browser_tests`. That run runs the browser smoke lane against the built bundle instead of the complete browser lanes. Pull requests still run the lanes their files affect, and a push release still runs all of them. Bundle, data, integration, installer, sandbox, environment, source and deployed-byte checks still run. The option defaults to false. A release that skipped the browser lanes is not evidence that they passed. Operator decision, 20 November 2026: a manual main release may set `defer_retained_attribution`, which holds the retained-copy attribution check for merged pull requests that replaced a closed submission; a held pull request keeps its prior journal row, is not memoized, and is resolved live by a later collection. It may set `parallel_collection`, which collects on GitHub-hosted runners in its own concurrency lane beside a collection that is already running. Both default to false. A collection runs on a GitHub-hosted runner with a 360-minute job limit and a 19,200-second collector deadline. The repository variable `SLOP_COLLECTOR_RUNNER` can name a self-hosted runner for a fresh main collection, with a 24-hour job limit and a 72,000-second deadline; pull requests, retained-data releases and `parallel_collection` runs never use it. It was set on 20 and 21 November 2026 for one complete collection and is unset since, and the repository has no self-hosted runner (operator decision, 22 November 2026).

Operator decision, 18 November 2026: main-branch collection and the monthly close may read GitHub through a dedicated read-only GitHub App (contents, issues, pull requests and metadata on this repository's installation) instead of the shared workflow token, which every workflow in the repository spends. The token is minted only on `main`, renewed before its one-hour expiry while collection runs, and replaced by the workflow token if minting fails. The admission-scan dispatcher may likewise use a separate App limited to Actions write on this repository, with the same fallback. Neither App holds publication or payment authority. The admission scan step reads the outside repository with that dispatch App's token when the token can read it, and otherwise with the shared token; a failed acquisition read records which read failed and its HTTP status, never the response text (operator decision, 23 November 2026).

Install pinned publication tooling without lifecycle scripts. Do not cache dependencies in trusted publication jobs. Verify deployment identity, current-main equivalence, served bytes, DNS, TLS, redirects, and headers separately.

The separate hourly private-reporting health job never publishes code or holds the publication lock. A status older than 24 hours blocks optional trace collection only. Website deployment and ordinary GitHub contribution remain independent.

### Activation gates and accepted risks

Launch the non-money product first. Mainnet activation is explicit, one network at a time: Base, Solana, then Robinhood Chain. Ethereum retains its separate waiver below. Payout execution is on for Base (owner decision, 24 October 2026) and for Robinhood Chain and Solana (operator decision, 14 November 2026); Ethereum stays off. The reviewed switch is `workers/payment-executor/mainnet-execution.mjs`. Exact assets, authority, finality, deployment bytes, and applicable testnet results remain required.

Month pledges (section 6) need upgrades signed with the owner-controlled upgrade keys: the EVM factory's vault template and each recorded EVM vault, and the Solana program followed at once by `migrate_project` on every Solana vault. Until a vault is upgraded it reports no pledge support and follows the funded-on-the-1st rule. The upgrades were requested on 16 November 2026 (#2884).

Native-asset and Token-2022 scope permits implementation and local testing, not a mainnet upgrade, funding, or signer activation. Qualify creation, deposits, refunds, reservations, payouts, claims, and accounting. Token-2022 also requires the fully inspected conversion path. Each upgrade or funding step needs its own reviewed execution plan and owner authorization.

Private-report intake is approved for staging and production after the reviewed release. This standing approval does not prove deployment or successful delivery.

The production SLOP buyback configuration is live by operator decision of 12 November 2026, at the limits the owner confirmed on 10 November 2026. The dry-run period and the small verified live order that this gate required were not run because no fee income existed to run them. On 15 November 2026 UTC, the readiness check verified the deployed configuration, finalized-state reads through the Worker's Robinhood Chain endpoint, and fee-wallet balances that cover the configured native ceilings for one cycle on the enabled networks. See the [readiness evidence](slop-buyback.md#production-readiness-check-15-november-2026-utc).

Operational qualification still requires finalized production receipts for the first real order's fill, purchase, and burn. Publish a burn only after its finalized receipt. Missing fee income leaves qualification pending. Do not create fee records or spend unrelated wallet funds to replace it. Any change to the mode, the start instant, or a limit is a reviewed change.

Fee handling on Base, Ethereum, and Robinhood requires funded fee wallets and verified limits and readiness. The fee-converter release variable must be enabled. Keep Solana outside the production network list until its independent full-history recovery RPC, first registered vault, and all readiness checks pass. A reviewed main release then activates it. The Solana controls release, existing program upgrade, and approved 0.05 SOL gas top-up are recorded as complete. Do not repeat them; consult retained execution evidence before any later operation.

Launch requires real-case qualification and explicit production activation of automatic closure. Keep its global switch off before that activation. Closure categories that require an objective-defect receipt stay unavailable without their own qualified verifier. Keep `SLOPBOT_QUALITY_QUALIFIED_PROFILE_SHA256` unset for launch.

A private full-award case remains unpayable until its suitable payment path is approved, released, and qualified. Advisory permission setup alone does not prove delivery. Qualify a real authorized report and verify its separate GitHub receipt before declaring forwarding available.

### Limited network qualification

These limits apply to the one-time qualification sequence, not ongoing service spending. Check retained execution records and never repeat completed steps. Qualify Base first, then Solana, then Robinhood Chain. Do not activate a later network before the required earlier qualification reconciles. Operator decision, 14 November 2026: Robinhood Chain and Solana were activated without their qualification transfers below; the first real finalized payout on each network stands in for that evidence. Both networks paid October monthly payouts on 16 November 2026.

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

Referrals remain inactive. Keep `REFERRAL_PROGRAM_ENABLED="false"` and post no roots until the activation checks below hold. Keep `REFERRAL_ACCRUAL_MODE="off"` and file no accruals unless the reactivation approval below is in effect; under that approval the mode may be `off` or `dry_run`, and `dry_run` files accrual records and posts nothing. Token setup, funding, qualification, and watcher activation do not gate launch.

Slop Cash S.P. funds this separate program from its program-token allocation. It does not alter Points, project manifests, scoring, cycles, ordinary payouts, or settlement. Preserve its code and records under the following deferred requirements.

The submitting maintainer may name a signed-in referrer. Keep the record immutable under migration `0055_project_referrer.sql`. Refuse self, steward, administrator, and moderator referrals at capture. Publish the registered projects that carry a referrer at `GET /api/v1/referrals/projects`: project ID, registry status, registration time, and the referrer's GitHub account, oldest first. Every listed project is already public and the accrual files publish the same referrer, so the list has no session and no write route (operator decision, 14 November 2026).

A signed-in member may choose a name for their own referral link (migration `0124_referral_codes.sql`, `backend/referrals/codes.ts`). `/referral/<name>` forwards to the project form with that member's GitHub login as the referrer. The name is only a pointer to the GitHub account: capture, the immutable record and accrual are unchanged. Refuse reserved names, another GitHub account's login, a name another account holds or has held, and administrator and moderator accounts. A member has one name in use, may replace it, and may hold five names in all; a replaced name stops forwarding and stays with its account. A name nobody has in use forwards to the form without a referrer. The path with no name (`/referral`) opens the Settings section where a member chooses one (operator decision, 14 November 2026). Settings shows the link and states no reward. Operator decision, 14 November 2026.

Requested repos (migration `0147_repo_requests.sql`, `backend/referrals/repo-requests.ts`, page `/requested`). A signed-in member with merged work on Slop (a current Points award for a merged pull request with a positive amount) may flag a public GitHub repository that is not on Slop as one they would work on. Refuse team accounts, forks, archived, private and missing repositories, the member's own repository, and a repository already in the project registry, matched by GitHub id or listed name. Slop reads the repository once on GitHub per flag and never writes to GitHub. A flag is stored by GitHub repository id, counts for 90 days, can be renewed or withdrawn, and an account holds at most 10 active flags; rows are never deleted. `GET /api/v1/repo-requests` is public and lists repositories with active flags by count, never who flagged them; a repository listed on Slop later leaves the list. Each row offers a pitch carrying the viewer's own referral link; the referrer is recorded only by the existing capture rules, and flagging earns nothing. The contributor skill may suggest one repository a session to its operator with the `/requested?flag=` link; the operator decides, and the agent never flags, comments, opens an issue or pull request, or mentions Slop on that repository. Operator decision, 22 November 2026.

Accrue only from finalized project payouts recorded as `paid` in `payment_obligations`. The first period is November 2026. Only payouts within 12 months of the project's first paid obligation qualify. The initial rate is 3 program tokens per 1 USDC of gross payout, calculated per stablecoin micro-unit. The lifetime pool is 2,000,000 tokens; each referred project has a 250,000-token lifetime cap. Rate changes are prospective. Record each applied rate and never change filed accruals.

Exclude team accounts (`lalalune`, `drew-dot-com`, administrators, and moderators), participation-banned accounts, non-stablecoin payouts, and projects with a public hold.

File each closed UTC month once, in order, as an append-only public record that anyone can recompute from payment evidence. Publish through `workers/referral-accrual` and `GET /api/v1/referrals/accruals`. Include cumulative referrer totals and a Merkle root over authorized Robinhood Chain wallets. Carry walletless referrers into later roots.

`ReferralDistributor` accepts cumulative roots. Each root is immediately claimable. Referrers sign claims using the wallet pinned to that root. The owner may void only the latest root before its first successful claim. A successful claim seals the root; paid tokens cannot be recovered. Earnings distinguishes accrued, pending, claimable, and claimed amounts using cached finalized evidence. Stale or uncertain evidence does not prove a claim.

Keep the root-posting key as a Worker secret, separate from the contract owner. It may only post roots, not transfer tokens or control project funds. Whole-root growth cannot exceed 2,000,000 tokens. Poster gas ceilings are 0.0002 ETH per transaction and 0.002 ETH per UTC day. Pause above either ceiling and retain uncertain attempts. An independent watcher is required. There is no guaranteed intervention window; pause or key rotation cannot recover paid tokens.

The operator proposed reactivation on 9 November 2026 in #2445. The owner agreed to the plan on 10 November 2026 in a direct message to the operator, and the operator merged #2445 on that basis. That agreement is the separate approval the deferral required. Accrual stays `off` or `dry_run` until the token exists, funding is agreed, and the watcher operates. The program token exists at `0xfeb4E36FA4a2A494FF25ae4a63491e4c584A67AE` on Robinhood Chain. The program-token allocation is part of the token reserve of the Slop Cash S.P. treasury on Robinhood Chain (`0x96028De971a9D37404F5030F6284b40640E2D1a2`, about 22,000,000 tokens on 10 November 2026). That reserve moves only through a decision market: a public proposal on the token's Umia market (`https://app.umia.finance/p/slop-cash`) that token holders trade for a fixed window and that carries one encoded treasury action. A proposal passes when that market resolves it as passed under its own published rules and its action executes on chain. Funding is agreed only when such a proposal passes and its action transfers 2,000,000 tokens from the treasury to the mainnet `ReferralDistributor`; the finalized transfer is the evidence. If it does not pass, the program stays inactive and no claim can be paid. Deploying that contract to receive the transfer is not activation. That proposal passed on 12 November 2026, and its finalized action transferred 2,000,000 tokens to the mainnet `ReferralDistributor` at `0x6A24E993E59cbA950C6F91A964BEF2A5F91227CC`, so funding is agreed. Operator decision, 12 November 2026: production accrual is `dry_run` and its configuration names the mainnet distributor so the independent watcher reads it; the program flag stays false, no poster key is installed and no root is posted. The owner must explicitly activate posting. Counsel review is not required. The funding proposal and these terms may be public before activation. Publish no other announcement before activation.

### Completion and change control

Maintain implementation evidence in repository reviews and verification records. Update requirements in their owning sections when policy changes. Preserve an approval link and effective date when historical terms depend on them; do not append a second competing rule.

MVP completion requires a reviewed record covering every requirement and release gate. Include exact tested revisions, real end-to-end results, applicable deployment/provider/chain evidence, approved waivers, and resolution of blocking defects. A source merge, local pass, partial rollout, or this document cannot establish completion.

## 12. State correctness and Quint verification

Review every explicit and implicit state transition in the application. Cover UI, APIs, workers, databases, files, queues, jobs, contributor tools, contracts, and release workflows. This requirement grants no new product, policy, deployment, funding, or signing authority.

- **STATE-01 — Inventory.** Keep source-to-model mappings in `formal/`. Include flags, optional values, collections, times, caches, pending requests, files, database records, and external evidence. List every entry point, unmodeled transition, and assumption.
- **STATE-02 — Models.** Define initial states, actions, refusal conditions, invariants, and reachable outcomes. Cover loading, empty, stale, invalid, error, success, authorization, expiry, cancellation, retry, duplicates, concurrency, partial writes, interruption, and recovery. Preserve immutable history, distinct financial states, and integer amounts. Model uncertainty without treating a request or signature as finality. Check parent/child and cross-subsystem composition.
- **STATE-03 — Conformance.** Compare models with actual workflows through model-derived traces or equivalent named scenarios at real entry points. Database races need database evidence; UI changes need browser evidence. Keep required provider and chain checks. Models cannot replace them.
- **STATE-04 — Fix and maintain.** Reproduce discrepancies, fix their causes, and repeat affected checks. Update models, mappings, and implementation evidence when behavior changes. Never weaken an invariant or remove a failure path to hide a defect.
- **STATE-05 — Verification evidence.** Pin Quint in the lockfile. Run `bun run formal:check` and `bun run formal:verify`. Record tool versions, source hashes, scenarios, backend, finite bounds, results, and unresolved gaps. Distinguish simulation, exhaustive finite exploration, implementation conformance, and live integration. Operator decision, 12 November 2026: an exhaustive verification that runs its whole time allowance without a result is recorded as "not verified within its time bound", shown as a warning, and does not fail the release gate. A counterexample, crash, broken model, unstable input or failed scenario check still fails it, and every identity, command, tool and view check still applies to the timed-out stage. Operator decision, 14 November 2026: an explicit manual main or development release may set `skip_proofs`. That run repeats neither the Quint state-model stages nor the LemmaScript proofs. Pull requests still run the models and proofs their files affect, a push release still runs all of them, and a scheduled run checks all of them on the default branch every night without blocking a release. Both inventory checks and every code, browser, sandbox, environment, source and deployed-byte check still run in the skipping release. The option defaults to false. A release that skipped the proofs is not evidence that they passed.

Passing abstract models does not prove implementation refinement or the absence of every possible state error. Completion requires reviewed models and implementation evidence for every inventoried transition, corrected discrepancies, passing checks, and explicit assumptions. Keep this requirement open while any required coverage or evidence is incomplete.

# Slop Product Requirements

Make money shipping and securing open source.

Slop connects useful open-source contributions and private security reports to human review and verified rewards. GitHub is where work is submitted and accepted. Slop records policy, decisions, and payment evidence.

## 1. Product and scope

The minimum viable product (MVP) supports two journeys: contribute useful work, or report a vulnerability privately. Published rules and Slopbot make routine decisions; humans decide exceptions, escalated disputes, and bounty awards. Both end with verified payment when eligible. Security clearance protects both.

Contributors use any disclosed agent/model or work manually. Maintainers define scope and accept outcomes. Researchers report privately. Funders review terms before depositing. Moderators decide escalated disputes, escalated appeals, and confirmed-malicious bans. Operators handle incidents, audited access to private evidence, and redirected wallet recovery. Neither role approves routine project admission.

Scope: accounts, wallets, projects, generated skills, Slopbot, security checks, rankings, vaults, private bounties and automatic private-report submission, and fee-wallet conversion. Networks: Base, Solana, Robinhood Chain, and Ethereum, using approved stablecoins or supported project tokens. Maintainers can pay in their own token if it’s a standard ERC-20 or SPL token. Measure accepted work, validated reports, verified fixes, eligible payments, delays, missed notices, and reconciliation errors.

Only owners and maintainers open issues. Contributors use approved requirements or existing issues. Issues alone do not approve scope: the contribution guidelines set for the project, along with the AGENTS.md and CONTRIBUTING.md (and README.md) are all considered.

## 2. Authority and records

- GitHub establishes repository identity, permissions, work, and acceptance.

- The D1 database holds the only project inventory. Authorized project owners publish permanent revisions through self-service setup. Published rules apply restrictions automatically; moderators decide escalated disputes and confirmed-malicious bans.

- The account service holds private settings, sessions, social links, and wallet records.

- Project owners set award policy and act by exception. The automatic monthly process distributes funded allocations that the owner does not change. Private bounty awards stay owner decisions. Finalized chain evidence proves deposits and payments.

- A score, model result, device signature, or database entry cannot replace another required proof.

## 3. Accounts and wallets

GitHub is the only login. Use its permanent actor ID through renames. Account holds profile, connections, wallets, preferences, and sessions, with links to Inbox and Payouts. Social connections are optional. Record walletless awards against the account; a verified wallet is required only to receive payment.

Public GitHub work stays public. Show private case status only in the authorized user's private account area. Keep private case amounts out of ordinary balances and public rankings. X connection shows on the profile with consent and permits no posting or messaging. Support account closure.

Store only ID, optional username, verification time, and visibility. Reserve that ID to the first verified GitHub identity, including after disconnect. Public display requires membership and link consent. Grant no points or authority. Joining earns no welcome points; welcome and X-connection points are removed (D2, section 11).

Users can add EVM and Solana payout wallets. If users have not added wallets, they can claim payouts they should have already received.

## 4. Projects and contribution skills

Setup has four steps: Repository, Contribution rules, Rewards, Review. Funding terms belong in Rewards. Project owners must be logged in with Github to create a project. Preview the page and both skills. Show one setup status that reports GitHub authority, Slopbot installation, the security scan, and funding separately, with the next action.

Projects start without routine admin approval after complete setup, verified GitHub authority, Slopbot installation, and either a successful security scan or the permanent existing-project exemption in section 8. Funding is optional and has a separate status. Contributor skills check for malicious code and injection risks before installation or execution. They report risks and stop the local workflow. Two distinct contributor flags pause the project and remove it from available work. A clean fresh scan reinstates a project that flags alone paused.

The home page always offers the generic agent setup instructions, including when discovery is unavailable or no project is cleared. Project-specific installation still checks project restrictions and clearance.

Generate each skill from its single template and project revision. Check for updates and install only verified updates from the trusted source. Recheck project restrictions and live GitHub before installation, work selection, execution, and submission. Do not install or work on flagged projects. Respect assignments, reviews, drafts, and claims. Do not invent work for points.

PRs explain the problem, requirement, result, implementation choice, and real evidence. Include Made via @slopdotcash and exact provider/model/client. A signed run receipt is optional and never blocks submission. After opening a PR, the contributor skill records a pull_request_opened event that names the PR node ID through the author's own authenticated Slop session (recorded attribution decision, section 11). Follow the effective trace policy; contributors inspect/redact permitted private uploads. Usage totals never set rewards. Economic changes are prospective; preserve funded awards. Agents should, if they can use computer use or browser use, star and fork the repos they are working on.

## 5. Slopbot

Slopbot is always free. It runs only on repositories registered on slop.cash. Installation is required before a project is ready. Suspended, flagged, or removed projects cannot enter contributor work; authorized security review may continue.

Review project contributions under the effective repository rules. Apply security, scope, and ignore rules first.

Review exact source against approved base-branch rules. Run untrusted code only in approved isolation, without secrets or posting credentials. The recorded route is Surplus Opus 5.5, then GPT-6.1 Sol fallback.

Slopbot reviews contributions, estimates each PR's size and value, and assigns its score. It closes clearly bad, fake, scam, or harmful Slop-skill contributions under the project rules. Uncertain findings go to the maintainer first. If no maintainer acts within 7 days, Slopbot applies its verdict as a label only; an uncertain finding never closes a contribution. Free service does not charge project vaults. For ongoing value scoring, send operator email alerts at each $500 of monthly spending, with no monthly hard cap (owner decision, 24 October 2026). Keep per-attempt accounting and queue limits. Historical September and October 2026 assessment uses the ChatGPT subscription only.

Automatic closure applies only to verified slop.cash members using the skill, never project maintainers. Verified means a slop.cash member matched by immutable GitHub ID, with a trace_runs row from their own authenticated Slop session for this project and a pull_request_opened event that names this PR node ID (recorded attribution decision, section 11). A copied marker alone is never proof. Preserve maintainer reopen decisions. Slopbot triages each appeal first and drafts a resolution; a moderator decides escalated appeals. Closure alone does not authorize a financial penalty.

## 6. Funds and payments

Each project uses one project vault, network, reward asset, and deposit balance. Project maintainers can deposit and withdraw. Reserved awards and fees cannot be withdrawn.

Support the approved stablecoin, ERC-20, or classic SPL token. Exclude transfer-fee, rebasing, and Token-2022 tokens. Verify identity, decimals, behavior, and finality. Use integer base units; never add unlike assets or present tokens as dollars.

Awards: projected, under review, approved, excluded. Payments: underfunded, awaiting wallet, ready, held, submitted, paid. A failed attempt preserves the award and reserve; one recipient's failure cannot block others.

Automatic monthly payment is the default for every project with funds committed in its vault. Vault creation sets the monthly commitment with the owner's monthly cap unless the owner opts out; the owner can turn it on or off later and can change allocations before execution (D1, section 11). If the owner does not distribute the funds, the automatic monthly process distributes the current allocations. Do not create unfunded obligations or pay twice. The period is the calendar UTC month, starting with 2026-11. Owners may change allocations or finalize early until 72 hours after the month ends; the automatic process then freezes the current allocations once. An underfunded month creates no obligations until the whole month is covered. Private bounty awards remain discretionary.

Ordinary award and free-fund withdrawal fee: floor(gross / 50) (2%). A 100 USDC award pays 98 and 2. Project-token awards pay both amounts in that token. No second fee at claim/retry. Every new project draft uses this fee (200 bps) and vault-custody wording, including drafts without a vault (D3, section 11). Preserve historical terms. Private bounties instead use section 8's 75/25 split.

A project-operated or permissionless executor submits payments; Slop operates no payment key/relayer. Payments are stored in a vault/escrow contract to show that they have been committed. Projects are not obligated to commit funds. Wallet binding requires authenticated account evidence and the wallet signature. Neither signature proves both identities. Mark paid only after exact finalized principal, fee, asset, and destination reconciliation; prevent replay.

Automatically sell project-token fees into USDC when the fee wallet receives them. Convert only received fees, never contributor principal or vault funds. Proceeds return to the same fee wallet. Each network uses one dedicated fee-claim and conversion key, held as a Worker secret and limited by per-run and daily caps; Slop owners manually sweep USDC proceeds to separate owner-controlled software wallets. The owner chose local `.env` custody for those sweep-wallet keys; they are not cold storage and are not held by the conversion Worker. The same key may submit permissionless fee claims on reviewed vaults, moving only accrued fees to that same fee wallet (owner approval, 24 October 2026). It never holds a vault role, withdraws free funds, or touches contributor principal, reserved awards, or payments. Verify the reviewed deployment and configured fee recipient before a claim; unknown or mismatched state must stop the claim. Reconcile uncertain sends before retrying, and verify the fee receipt before conversion. A remote signer may replace it later. Use approved routes and bounded slippage. If a route, liquidity, or signer is unavailable, retain the token and show the conversion as pending or failed. This supersedes the earlier Robinhood USDG conversion target; verify a supported USDC asset and route before activation there.

## 7. Points, discovery, and clear pages

Use one public Points measure; do not show a separate Slop Score. Accepted-work credits already convert into the points journal and must not be added a second time. Money received remains a separate record of verified payments. Owner decision, 24 October 2026: consolidate score into Points. Only accepted-work points for the project and payment period determine reward shares. Welcome and X-connection points are removed: none are granted from 24 October 2026, and recorded ones stay in the journal but count in no displayed total or ranking (D2, section 11). Payment-recognition and other bonuses never affect payouts. Monthly and lifetime totals are views of the same points history. Preserve funded awards, historical payment calculations and source identifiers; old score fields are compatibility encodings, not another public metric.

The homepage cycles the original campaign phrases with typing and deletion (owner decision, 24 October 2026). Keep a stable accessible heading and disable the animation for reduced motion.

Default rankings to Points. Preserve equal ranks, shareable filters, exact periods, and source coverage. Missing data is not zero.

Share merge credit with verified commit authors. Do not reward the same commit twice. Credit useful reviews separately; a recipient's own review earns no credit. Split review credit among up to the first five distinct qualifying reviewers, not five comments from the same person. Each pull request's review pool is the sum of the credited reviewers' highest review bands, capped at the pull request's own assessed size credit, with a minimum of 10 points. Shares follow each reviewer's highest band, with largest-remainder allocation in 10-point increments; ties go to the earlier first qualifying review, then the review node ID. Every accepted merge earns at least 10 points, including a merge assessed at zero. This policy applies to work accepted from 2026-11-01T00:00:00Z; earlier work keeps its recorded terms.

A useful review can identify a correction or validate the change. A request for changes is not required. Repeated, empty, or duplicate reviews earn no extra credit.

Slopbot determines the value of each PR based on T-shirt sizing and assigns accepted-work points.

Record qualifying penalties and reversals once. Reopen, appeal, and retry cannot multiply a debit. Slopbot applies penalties from one published penalty table. The repository owner approves the table once; later changes are prospective. An upheld appeal reverses a penalty once. Penalties include spam, malicious PRs, and PRs that clearly violate the guidelines of the project.

Published penalty table (approved 24 October 2026, in points):

| Slopbot category | Action | Debit |
| --- | --- | --- |
| Spam | Close | 30 |
| Scam or malicious | Close; one moderator Inbox notice to review the account | 240 |
| Clear violation of a quoted project rule | Close | 10 |
| Low quality | Close (closure-eligible authors only) | 0 |
| Duplicate | Close | 0 |
| Out of scope | Label | 0 |

A debit reduces only that UTC month's accepted-work points and never takes it below zero. A debit never changes an approved, scheduled, or paid award. Maintainers and authors outside the closure scope receive no penalty.

Exclude Slopbot from scoring and human rankings.

Use explicit payout exclusions for owners, funded employees, and related parties. Apply changes prospectively. Excluded weights cannot reduce other contributors' shares.

Slopbot triages each dispute first and drafts a resolution; a moderator decides escalated disputes. Awards use an honor and reputation model. Owners may change proposed amounts; do not publish adjustment history or require a public explanation. Keep only the records needed for allocation, dispute handling, and payment reconciliation. A ban does not erase a funded award.

Slopbot assesses size and value from the PR and its evidence. Use these accepted-work point bands: micro 10, small 30, medium 90, large 240, XL 450, exceptional 750. Review bands are triage 10, standard 30, deep 90, specialist 240. These are the existing credit amounts expressed in points, not additional awards. Keep source, rubric, model, and corrections with the points. Preserve historical awards and prevent duplicate credit across stacked or indirect merges.

Make Featured and Community projects easy to find. Show real funding, suitable work, and freshness. Featuring does not guarantee payment.

Use one account area, one shared ranking view, and one status summary per project. Show the result, the next action, and any restriction together. Put optional explanations after the action. Keep required consent, amounts, and evidence visible.

Support mobile, keyboard access, screen readers, reduced motion, and 200% zoom. Meet WCAG AA accessibility requirements.

Keep loading, empty, stale, invalid, denied, unavailable, and failed states distinct. Each failure needs a useful next action.

### User journeys

Use the existing routes and shared controls. These are acceptance requirements, not claims that every live service is ready.

| Person and goal | Shortest complete flow | Required outcome or recovery |
| --- | --- | --- |
| Contributor | Home → project → eligible work → skill → GitHub PR → Payouts | Clear scope, safe execution, accepted outcome, final award status, and verified payment; wallet setup uses Account |
| Researcher | Project security terms → report through Slop → verified private GitHub receipt → Security cases → decision → payment | Visible net award and privacy terms; confirmed receipt; next action and deadline; private appeal; no public fallback |
| Maintainer | Add project → four setup steps → Slopbot installation → security scan → automatic activation | Resume draft, preview page and skills, see setup status; owners publish updates; changed executable content needs fresh clearance unless the project has the section 8 exemption |
| Funder or owner | Project funding → terms and balance → deposit, approve, or withdraw → receipt | Separate available and reserved funds; show asset, gross, fee, net, signer, and finality; reconcile an uncertain send before retry |
| Member | GitHub login → Account → connections, wallets, sessions → Inbox/Payouts | Preserve return destination and drafts; independent consent; revoke sessions; private recovery and account closure |
| Moderator | Admin → escalated dispute, appeal, or confirmed-malicious result → evidence and Slopbot triage → decision | Current authority, saved reason, fresh scan; flag-only pauses reinstate automatically after a clean scan; preserve awards |
| Security operator | Private vetting evidence → authorized reasoned grant → inspect → record result | Exact retained bytes, explicit coverage gaps, audited access; "scan passed" only when every defined check ran (section 8) |
| Visitor | Projects, profiles, shared rankings, models/clients, receipts, cycles, sponsors, How it works | Consistent amounts and periods; explain score, funding, and verification once; retain old URLs and raw downloads |

## 8. Security and private bounties

### Clear a project before execution

Scan submitted project code for malicious behavior, including wallet drainers, password and credential theft, secret exfiltration, harmful installation scripts, unsafe execution, suspicious downloads, and agent prompt injection.

The scan is bounded. By default it checks the supported source files, manifests and dependencies, install and build scripts, and agent instructions (skills, AGENTS.md, and similar files) of the checked revision. Run code in isolation only for artifacts that these checks mark as risky, for example an install script that downloads or runs code, or an opaque binary. Use a second model or a specialist investigation only for ambiguous or high-risk results, not for every clean project. Put no secrets in untrusted execution. A full runtime of every project is not required.

Bind the result to the checked revision and reuse it for identical content. Outside the existing-project exemption below, a change to executable source, dependencies, install instructions, or skill content needs a fresh scan; a presentation-only change does not.

Permanent existing-project exemption (owner decision, 24 October 2026): projects present in each environment’s D1 registry when migration `0075_vetting_grandfathered_projects.sql` runs are exempt from normal scan clearance, including for future executable changes. The migration fixes that set permanently; later projects cannot join it. Exempt projects may activate, appear in discovery and publish skills without an assessment. Represent this as an explicit exemption, never as a passed scan. This accepts that future executable changes may become available without scanning. Contributor flags, pauses, confirmed-malicious bans and account restrictions still apply. Reinstatement after a flag pause requires a fresh clean scan; reinstatement after confirmed malice also requires the moderator decision. The exemption does not override those restrictions.

"Scan passed" means that every defined check ran on the bound revision and found no malicious result. It is not a guarantee of safety and does not claim complete runtime coverage. Record which checks ran and which content they did not cover. A scan is incomplete when a defined check did not run, or when content that runs at install or execution time was not covered by a check, isolated execution, or specialist review. An incomplete scan does not establish clearance and is never recorded as passed; do not convert earlier incomplete results to passed. Confirmed malicious projects leave contributor discovery. Two distinct contributor flags automatically pause a project and notify moderators. Skills must refuse installation and work on flagged projects. A clean fresh scan reinstates a project that flags alone paused.

After a confirmed malicious result, the owner can appeal. A moderator decides whether to reinstate or ban the project. The moderator must identify each responsible account from the evidence. Do not infer responsibility from current ownership or the original application. Reinstating a project does not clear account bans. Record a separate decision for each account cleared by the evidence. A banned account cannot start new Slop participation, receive new contribution or review credit, or receive new awards. Preserve funded awards and access to appeals, including for a responsible account that no longer owns the project.

### Report and decide privately

Any registered user can report. Route exploitable findings privately even when bounty eligibility is uncertain. Never fall back to a public issue. Use GitHub private advisories for technical evidence and restricted Slop records for terms, decisions, appeals, and payments.

The researcher submits through Slop. With the researcher's GitHub authorization, Slop sends the report through GitHub's private reporting route. Slop automatically verifies receipt, analyzes the report, and notifies the maintainer. Submission must preserve the researcher's identity. Keep submission credentials private and retain them only as needed to complete or reconcile the submission. Analyze private report text only through Surplus Intelligence with `SURPLUS_API_KEY`. Request `claude-opus-5.5`; the marketplace model identity is not independently verified. Do not fall back to another provider. A zero-data-retention agreement is not required. Provider retention follows the applicable account terms; do not claim zero retention without confirmation. Preserve reporter identity and reconcile uncertain submissions before retry. Never publish a report as a fallback. The maintainer or owner decides whether to award a bounty and approves its payout. Critical bugs and potential loss of funds are priorities, not an automatic payout promise. Slopbot triages disputes first; moderators decide escalated disputes. Neither automatic reporting nor dispute handling grants payment authority.

Use safe evidence of a critical bug or potential loss of funds. Actual loss is not required and must not be induced. Record the first verified qualifying report for each underlying finding. Prevent duplicate reservations. Discretionary approval precedes any award reservation; private bounties do not use the monthly automatic-payment fallback.

Keep receipt, remediation, award, payment, and disclosure states separate. Use independent private patch review and exact-revision tests. A fix, payment, or expired deadline never authorizes disclosure. Maintainers should supply an e-mail address, Telegram or Signal address to be contacted by reporters and moderators.

### Pay a private award

The researcher receives 75% of the gross award; slop.cash receives 25%. This replaces the ordinary 2% commission. Add no ordinary payout or claim fee. Use gross amounts divisible by four minor units. A 100 USDC award pays 75 and 25. The report and its fix are one financial work unit unless approved terms say otherwise.

Reuse existing payment rails, wallet authorization, recovery, and finality checks. Use a separate bounty vault and private ledger. Ordinary balances, cycles, notices, and account views must reveal no case-related amounts or changes. Restrict case identifiers, counts, queues, and totals.

## 9. Operations and launch decisions

Public pages use cached D1 data or published snapshots. On refresh failure, retain the last good value with a stale label. Sensitive actions recheck current authority.

### Notifications

Use one Inbox for wallet changes, payout exceptions, project decisions, appeals, and case notices. Save each notice with the source change; replay must not duplicate it. Keep private notices generic. Read, acknowledged, provider-accepted, delivered, failed, and uncertain are different states.

Activity email is optional. Show the verified destination before opt-in. Bind consent to its exact version. A changed address needs new consent. Opt-out cancels queued activity mail and works during outages; opt-in does not send old history. Essential wallet-security and private-case notices use their separate policies.

Recheck roles and destinations before sending. Verify actual inbox receipt separately from provider acceptance. Bound retries; reconcile uncertain sends before retry. Escalate failed or overdue case notices to a current approved backup. Preserve cases when notification fails.

### Recorded decisions and remaining gates

| Area | Recorded decision | Remaining approval or evidence |
| --- | --- | --- |
| Authority | Repository PRD; D1 inventory; GitHub work; owner-set awards with default automatic monthly distribution; chain finality | Reconcile older trace, scoring, and key instructions before the affected action |
| Fees | Public awards and free-fund withdrawals: 2%; private bounties: 25%; no stacked fee | Keep historical terms; approve changes prospectively |
| Wallet recovery | Fresh account and wallet proof; one operator for redirected recovery; changed or recovered payout wallets activate immediately, with no waiting period | Implement immediate wallet activation before launch; approved funded awards never expire and stay reserved until paid |
| Mainnet | Four approved networks; owner waived the independent smart-contract audit and signer/attester legal review | Exact assets, finality, authority, testnet results, and explicit activation |
| Fee conversion | Automatic conversion of received project-token fees to USDC; separate owner-controlled fee signer; human withdrawals | Verified USDC routes per network and Solana role separation; limits and custody recorded in section 11 |
| Slopbot | Required and always free; registered repositories only; size-based PR scoring and useful review credit | Verified closure scope, Slopbot appeal triage with moderator escalation, free-service capacity limits, and production qualification |
| Private programs | Automatic private reporting; discretionary owner awards; Slopbot-triaged disputes with moderator escalation; 75/25 payment | Published program terms, safe testing, verified reserves after approval, and activation per program |
| Moderation and evidence | Staging pilot: lalalune (18633264), drew-dot-com (202660855) | Qualify staging, the bounded malicious-code scan in section 8 with an isolated runner for risky artifacts (a universal Linux/KVM runtime is not required), external retention/recovery controls, and production release |

## 10. Private bounty acceptance

| Check | Required result |
| --- | --- |
| Program | Different amounts and sponsors; published terms; discretionary awards; named payer and dispute contact |
| Intake | Enabled, disabled, stale, denied, unavailable, direct, and interrupted paths; verified authorship, receipt time, policy, and evidence version; no public fallback |
| Eligibility and fix | Safe critical-bug or potential-loss evidence; discretionary award approval; private patch review and tests; deployed mitigation |
| Access and decisions | Refuse self-approval, cross-case/project access, and revoked roles; two authorities: the project owner or maintainer decides technical, award, and disclosure questions, and a moderator decides escalated appeals and disputes |
| Capacity | Verified funds versus pledges; reserve only approved awards; one reservation per finding; no automatic bounty payout |
| Amounts | 10,000 gross pays 7,500 and 2,500; reject inexact minor-unit splits and stacked fees; preserve the agreed asset and historical terms |
| Payment and recovery | Reporter chain consent; correct vault, asset, destination, and unsigned owner request; missing wallets, changed destinations, partial results, uncertain sends, restart, and replay; finality before paid |
| Privacy | No case data, counts, or revealing totals in public pages, APIs, logs, analytics, caches, downloads, rankings, or notices |
| Disclosure | Exact redacted-content approval and embargo history; separate recognition consent; no automatic publication after fix, payment, or deadline |
| Compatibility | No second cash award for the same report/fix; preserve ordinary rewards for separate eligible work |
| Notices | Verified sender, binding, destination, current role, quota, isolation, inbox receipt, explicit acknowledgment, bounded retry, and escalation |
| Continuity | Restore backups; preserve obligations through account recovery, role loss, project transfer, ban, closure, and intake outage |
| Release | All section 7 journeys, accessibility checks, sanitized evidence, and exact deployed revision |

## 11. Source, delivery, and acceptance

The repository PRD is canonical. The Google Docs copy mirrors it after repository review. Owner decisions in this revision supersede conflicting older requirements: self-service admission; required free Slopbot on registered repositories; size-based PR scores and useful review credit; two-flag pauses; automatic private reporting with discretionary bounty payouts; no public award-adjustment history; automatic monthly payment by default for funded projects; and received-fee conversion to USDC. The 23 October 2026 revision adds: automatic reinstatement after flag-only pauses; a 7-day maintainer window before Slopbot labels uncertain findings; one published penalty table; Slopbot-first triage of appeals and disputes; two bounty authorities; one operator for redirected wallet recovery; and a lighter isolated scanner runtime, used only for risky artifacts within the bounded scan in section 8. The owner waived the independent smart-contract audit and signer/attester legal review on 24 October 2026. Explicit mainnet activation remains required.

These are target requirements, not claims that current code or deployed services implement them. Preserve existing funded obligations and historical scoring terms. Keep implementation and evidence in the existing GitHub issues. This revision defines no requirement or MVP work-package IDs. Cite the section number and the acceptance result. Older IDs (for example PAY-05, SKL-03, TOK-07, and MVP-07c) remain valid references in existing records, code, and decisions. The old detailed delivery prose is superseded where it conflicts with this revision.

Before release, prove self-service setup, malicious-code detection, two-flag pause and skill refusal, automatic reinstatement after a clean scan, moderator decisions on confirmed-malicious results, free registered-repository bot review, scoring without duplicate review credit, monthly payment fallback, discretionary private reporting and settlement, and USDC fee conversion. Include failed, unavailable, and uncertain paths. Verify the exact source and deployed revision, real browser flows, access controls, recovery, and required network evidence. Both external reviews are waived, not completed. Explicit mainnet activation remains required. Maintainers approve completion from evidence; a source merge alone is not completion.

### Recorded owner decisions (24 October 2026)

The owner recorded these values. They apply prospectively and do not change historical scores or awards. Configuration that implements them stays fail-closed until it is set.

| Decision | Recorded value |
| --- | --- |
| Monthly period model | Calendar UTC month; first period 2026-11; cutoff 72 hours after the month ends (section 6) |
| Review-credit pool | Sum of the credited reviewers' highest bands, capped at the pull request's assessed size credit, minimum 10 points; largest remainder; effective 2026-11-01T00:00:00Z (section 7) |
| Flag lifetime and resolution | A flag counts for 90 days. A clean-scan reinstatement resolves every flag counted toward that pause; a withdrawn flag stops counting. Only a member whose GitHub account is at least 30 days old and who has at least one accepted Slop contribution may flag; owners and maintainers cannot flag their own project. One flag stays private |
| Fee conversion timing and dust | Convert on receipt when the value is at least 5 USDC and at least 10 times the gas cost; slippage 1%, price impact 2%, 1,000 USDC per run, 5,000 USDC per day. Capped fee-claim and conversion keys (section 6); claims move only accrued fees to the same fee wallet. Robinhood Chain stays pending until a Circle USDC route is verified. Solana live conversion waits for the separate attester role |
| Attribution for automatic closure | An ordinary submission needs the visible Slop attribution line and the exact provider, model, and client; a signed receipt is optional. Closure and penalties need the author's own authenticated Slop run for that project and a pull-request-opened event that names the exact pull request. A copied marker is never proof |
| Penalty table | Section 7 table |
| Escalation criteria | A moderator decides when the appellant or maintainer rejects Slopbot's drafted resolution; the case involves a ban, a confirmed-malicious result, or a private security case; the debit is 240 points or more; Slopbot's confidence is below 0.9; or the case is unresolved 7 days after the appeal |
| Restricted projects | Security-only review on a paused, flagged, or quarantined project may comment and apply the scam label only. Retired projects get no review. Approved funded payouts continue during quarantine or a ban; no new commitments start |
| Setup | Creating a project requires a Slopbot installation read. Economic changes apply from the next UTC calendar month. Amounts use asset base units. Admins use quarantine to hold a project |
| Account closure | Closure is reversible through an explicit reopen. Wallets, obligations, settlement records, identity reservations, and private-case records remain |
| Wallet activation | Changed or recovered payout-wallet addresses activate immediately after the required account and wallet-control proof. The waiting period is zero ([owner decision](https://github.com/SlopDotCash/slopdotcash/issues/904#issuecomment-6379760881)). Award payments and identity-authority rotations also have no waiting period (see Contract timelocks) |
| Solana upgrade authority | Retain owner-controlled upgrade authority in production, without a timelock. The upgrade key is separate from the identity attester and fee-conversion keys. Verify its public key and exact finalized program bytes before activation. This supersedes the prior requirement to revoke production upgrade authority. |
| EVM upgrade authority | The deployment authority may upgrade replacement EVM factories and individual vaults without a timelock. This power can change logic governing deposited funds. Fee-conversion and identity-attester keys have no upgrade power. Initialization is atomic. Each accepted implementation and upgrade authority must be verified before payment evidence is accepted. Existing immutable deployments remain unchanged. |
| Contract timelocks | Award payments and identity-authority rotations have no mandatory waiting period. Deploy replacement EVM contracts and update Solana deployment configuration for zero delay. Preserve reserved awards, required authorization, wallet-control proofs and replay protection. Calendar-month accounting and evidence retention remain separate policies. |
| Accepted attester-compromise risk | Keep immediate wallet binding. The owner explicitly accepts that a compromised identity-attester key, together with an attacker-controlled wallet, can redirect unpaid awards without an owner-veto waiting window ([owner decision](https://github.com/SlopDotCash/slopdotcash/issues/904#issuecomment-6381602244)). This acceptance does not waive other contract fixes, review, required checks or deployment verification. |
| Funded-award expiry | Approved funded awards never expire. Keep funds reserved until payment, including when the recipient has no confirmed payout wallet. Time alone never releases the reserve to the project ([owner decision](https://github.com/SlopDotCash/slopdotcash/issues/904#issuecomment-6379763484)) |
| External reviews | The independent smart-contract audit and signer/attester legal review are waived by the owner, not completed. This supersedes both earlier external-review prerequisites. Explicit mainnet activation remains required ([owner decision](https://github.com/SlopDotCash/slopdotcash/issues/903#issuecomment-6379783252)) |
| Fee-sweep custody | Use separate owner-controlled EVM and Solana software wallets, with keys stored locally in `.env`. No hardware wallet is required. Sweeps remain human-signed and separate from the conversion Worker ([owner decision](https://github.com/SlopDotCash/slopdotcash/issues/905#issuecomment-6379777455)) |
| Private bounties | Reserve against the bounty vault's finalized free balance. The researcher submits through Slop, which sends the report privately to GitHub with the researcher’s authorization. Verify receipt through authorized advisory read access. Two authorities, as in section 10. Awards only for cases received while paid terms were published |
| Contracts before launch | Remove the service charge. Permissionless vault creation by its owner, with separate ordinary and bounty purposes. A bounded monthly commitment that anyone may submit after the cutoff, signed by the identity attester and limited by the owner's monthly cap, one commitment per period, and the owner's opt-out |
| Scanner evidence retention | Only lalalune and drew-dot-com may read evidence, through audited 15-minute grants; lalalune owns the policy. Keep raw evidence while its case is open and for 90 days after closure. Clean scans close automatically; incomplete or malicious cases stay open until lalalune explicitly closes them. Keep daily private backups for 30 days and access logs for one year; prove restoration before activation. This policy does not change permanent contributor traces |
| Slopbot spending limit | Alerts-only: no monthly hard cap on Slopbot inference spending. Email the owner at every crossed $500 milestone. Per-attempt cost reservations, duplicate refusal and queue limits still apply, and missing or malformed configuration still stops inference (owner decision, 24 October 2026, in #1141) |
| Existing-project scan exemption | Permanently exempt the projects captured by migration `0075_vetting_grandfathered_projects.sql` from normal scan clearance, including future code changes. Later projects still require scans. Flags, pauses, confirmed-malicious bans and fresh-scan reinstatement remain effective. An exemption is not a passed scan ([owner decision](https://github.com/SlopDotCash/slopdotcash/pull/1114#issuecomment-6382081150)) |
| Scanner and runner | Surplus Opus 5.5 first; GPT-6.1 Sol only for ambiguous or high-risk results. One disposable Cloudflare sandbox per risky artifact, with internet access off and no secrets |
| D1 Monthly at vault creation | Vault creation sets the automatic monthly commitment with the owner's monthly cap. The owner may opt out at creation and turn it on or off later (section 6) |
| D2 Participation points | No welcome (5) or X-connection (10) points for anyone from 24 October 2026. Recorded awards stay in the append-only journal but count in no displayed total or ranking (sections 3 and 7) |
| D3 New project drafts | Every new draft uses the ordinary 2% fee (200 bps) and vault-custody wording, including drafts without a vault. Historical projects and revisions keep their recorded terms (section 6) |
| D4 Scam closure notice | A Slopbot closure in the Scam or malicious category also creates one idempotent moderator Inbox notice to review the account, alongside the label (section 7) |
| Moderators | lalalune (18633264) and drew-dot-com (202660855) |
| Launch order | The non-money product launches first. Mainnet requires explicit activation, one network at a time: Base, Solana, Ethereum, then Robinhood Chain |

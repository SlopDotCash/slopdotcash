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

Store only ID, optional username, verification time, and visibility. Reserve that ID to the first verified GitHub identity, including after disconnect. Public display requires membership and link consent. Grant no points or authority.

Users can add EVM and Solana payout wallets. If users have not added wallets, they can claim payouts they should have already received.

## 4. Projects and contribution skills

Setup has four steps: Repository, Contribution rules, Rewards, Review. Funding terms belong in Rewards. Project owners must be logged in with Github to create a project. Preview the page and both skills. Show one setup status that reports GitHub authority, Slopbot installation, the security scan, and funding separately, with the next action.

Projects start without routine admin approval after complete setup, verified GitHub authority, Slopbot installation, and a successful security scan. Funding is optional and has a separate status. Contributor skills check for malicious code and injection risks before installation or execution. They report risks and stop the local workflow. Two distinct contributor flags pause the project and remove it from available work. A clean fresh scan reinstates a project that flags alone paused.

Generate each skill from its single template and project revision. Check for updates and install only verified updates from the trusted source. Recheck project restrictions and live GitHub before installation, work selection, execution, and submission. Do not install or work on flagged projects. Respect assignments, reviews, drafts, and claims. Do not invent work for points.

PRs explain the problem, requirement, result, implementation choice, and real evidence. Include Made via @slopdotcash and exact provider/model/client. A signed receipt is optional for an ordinary submission; automatic closure and penalties require the evidence in section 11. Follow the effective trace policy; contributors inspect/redact permitted private uploads. Usage totals never set rewards. Economic changes are prospective; preserve funded awards. Agents should, if they can use computer use or browser use, star and fork the repos they are working on.

## 5. Slopbot

Slopbot is always free. It runs only on repositories registered on slop.cash. Installation is required before a project is ready. Suspended, flagged, or removed projects cannot enter contributor work; authorized security review may continue.

Review project contributions under the effective repository rules. Apply security, scope, and ignore rules first.

Review exact source against approved base-branch rules. Run untrusted code only in approved isolation, without secrets or posting credentials. The recorded route is Surplus Opus 5.5, then GPT-6.1 Sol fallback.

Slopbot reviews contributions, estimates each PR's size and value, and assigns its score. It closes clearly bad, fake, scam, or harmful Slop-skill contributions under the project rules. Uncertain findings go to the maintainer first. If no maintainer acts within 7 days, Slopbot applies its verdict as a label only; an uncertain finding never closes a contribution. Free service does not charge project vaults; internal budgets and queue limits control cost.

Automatic closure applies only to verified slop.cash members using the skill, never project maintainers. Preserve maintainer reopen decisions. Slopbot triages each appeal first and drafts a resolution; a moderator decides escalated appeals. Closure alone does not authorize a financial penalty.

## 6. Funds and payments

Each project uses one project vault, network, reward asset, and deposit balance. Project maintainers can deposit and withdraw. Reserved awards and fees cannot be withdrawn.

Support the approved stablecoin, ERC-20, or classic SPL token. Exclude transfer-fee, rebasing, and Token-2022 tokens. Verify identity, decimals, behavior, and finality. Use integer base units; never add unlike assets or present tokens as dollars.

Awards: projected, under review, approved, excluded. Payments: underfunded, awaiting wallet, ready, held, submitted, paid. A failed attempt preserves the award and reserve; one recipient's failure cannot block others.

Automatic monthly payment is the default for every project with funds committed in its vault. The owner sets the monthly amount during setup, can change allocations before execution, and can turn the default off. If the owner does not distribute the funds, the automatic monthly process distributes the current allocations. Do not create unfunded obligations or pay twice. The period is the calendar UTC month, starting with 2026-11. Owners may change allocations or finalize early until 72 hours after the month ends; the automatic process then freezes the current allocations once. An underfunded month creates no obligations until the whole month is covered. Private bounty awards remain discretionary.

Ordinary award and free-fund withdrawal fee: floor(gross / 50) (2%). A 100 USDC award pays 98 and 2. Project-token awards pay both amounts in that token. No second fee at claim/retry. Preserve historical terms. Private bounties instead use section 8's 75/25 split.

A project-operated or permissionless executor submits payments; Slop operates no payment key/relayer. Payments are stored in a vault/escrow contract to show that they have been committed. Projects are not obligated to commit funds. Wallet binding requires authenticated account evidence and the wallet signature. Neither signature proves both identities. Mark paid only after exact finalized principal, fee, asset, and destination reconciliation; prevent replay.

Automatically sell project-token fees into USDC when the fee wallet receives them. Convert only received fees, never contributor principal or vault funds. Proceeds return to the same fee wallet. Each network uses one dedicated conversion-only key, held as a Worker secret and limited by per-run and daily caps; Slop owners sweep USDC proceeds to cold storage. The key never holds a vault role or touches contributor principal, reserved awards, or vault funds. A remote signer may replace it later. Use approved routes and bounded slippage. If a route, liquidity, or signer is unavailable, retain the token and show the conversion as pending or failed. This supersedes the earlier Robinhood USDG conversion target; verify a supported USDC asset and route before activation there.

## 7. Scores, discovery, and clear pages

Keep two measures distinct: Slop Score for accepted-work value and earned points and Money received for verified ordinary payments.

Default rankings to Slop Score. Preserve equal ranks, shareable filters, exact periods, and source coverage. Missing data is not zero.

Share merge credit with verified commit authors. Do not reward the same commit twice. Credit useful reviews separately; a recipient's own review earns no credit. Split review credit among up to the first five distinct qualifying reviewers, not five comments from the same person. Each pull request's review pool is the sum of the credited reviewers' highest review bands, capped at the pull request's own assessed size credit, with a minimum of one third. Shares follow each reviewer's highest band, with largest-remainder integer thirds; ties go to the earlier first qualifying review, then the review node ID. Every accepted merge earns at least one third, including a merge assessed at zero. This policy applies to work accepted from 2026-11-01T00:00:00Z; earlier work keeps its recorded terms.

A useful review can identify a correction or validate the change. A request for changes is not required. Repeated, empty, or duplicate reviews earn no extra credit.

Slopbot determines the value of each PR based on T-shirt sizing and assigns a standardized score.

Record qualifying penalties and reversals once. Reopen, appeal, and retry cannot multiply a debit. Slopbot applies penalties from one published penalty table. The repository owner approves the table once; later changes are prospective. An upheld appeal reverses a penalty once. Penalties include spam, malicious PRs, and PRs that clearly violate the guidelines of the project.

Published penalty table (approved 24 October 2026, in Slop Score thirds):

| Slopbot category | Action | Debit |
| --- | --- | --- |
| Spam | Close | 3 |
| Scam or malicious | Close; moderator reviews the account | 24 |
| Clear violation of a quoted project rule | Close | 1 |
| Low quality | Close (closure-eligible authors only) | 0 |
| Duplicate | Close | 0 |
| Out of scope | Label | 0 |

A debit reduces only that UTC month's score and never takes it below zero. A debit never changes an approved, scheduled, or paid award. Maintainers and authors outside the closure scope receive no penalty.

Exclude Slopbot from scoring and human rankings.

Use explicit payout exclusions for owners, funded employees, and related parties. Apply changes prospectively. Excluded weights cannot reduce other contributors' shares.

Slopbot triages each dispute first and drafts a resolution; a moderator decides escalated disputes. Awards use an honor and reputation model. Owners may change proposed amounts; do not publish adjustment history or require a public explanation. Keep only the records needed for allocation, dispute handling, and payment reconciliation. A ban does not erase a funded award.

Slopbot assesses size and value from the PR and its evidence. Use the existing size bands (integer thirds): micro 1, small 3, medium 9, large 24, XL 45, exceptional 75. Retain the review bands: triage 1, standard 3, deep 9, specialist 24. Keep source, rubric, model, and corrections with the score. Preserve historical awards and prevent duplicate credit across stacked or indirect merges.

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
| Maintainer | Add project → four setup steps → Slopbot installation → security scan → automatic activation | Resume draft, preview page and skills, see setup status; owners publish updates, and changed executable content needs fresh clearance |
| Funder or owner | Project funding → terms and balance → deposit, approve, or withdraw → receipt | Separate available and reserved funds; show asset, gross, fee, net, signer, and finality; reconcile an uncertain send before retry |
| Member | GitHub login → Account → connections, wallets, sessions → Inbox/Payouts | Preserve return destination and drafts; independent consent; revoke sessions; private recovery and account closure |
| Moderator | Admin → escalated dispute, appeal, or confirmed-malicious result → evidence and Slopbot triage → decision | Current authority, saved reason, fresh scan; flag-only pauses reinstate automatically after a clean scan; preserve awards |
| Security operator | Private vetting evidence → authorized reasoned grant → inspect → record result | Exact retained bytes, explicit coverage gaps, audited access; "scan passed" only when every defined check ran (section 8) |
| Visitor | Projects, profiles, shared rankings, models/clients, receipts, cycles, sponsors, How it works | Consistent amounts and periods; explain score, funding, and verification once; retain old URLs and raw downloads |



## 8. Security and private bounties

### Clear a project before execution

Scan submitted project code for malicious behavior, including wallet drainers, password and credential theft, secret exfiltration, harmful installation scripts, unsafe execution, suspicious downloads, and agent prompt injection.

The scan is bounded. By default it checks the supported source files, manifests and dependencies, install and build scripts, and agent instructions (skills, AGENTS.md, and similar files) of the checked revision. Run code in isolation only for artifacts that these checks mark as risky, for example an install script that downloads or runs code, or an opaque binary. Use a second model or a specialist investigation only for ambiguous or high-risk results, not for every clean project. Put no secrets in untrusted execution. A full runtime of every project is not required.

Bind the result to the checked revision and reuse it for identical content. A change to executable source, dependencies, install instructions, or skill content needs a fresh scan; a presentation-only change does not.

"Scan passed" means that every defined check ran on the bound revision and found no malicious result. It is not a guarantee of safety and does not claim complete runtime coverage. Record which checks ran and which content they did not cover. A scan is incomplete when a defined check did not run, or when content that runs at install or execution time was not covered by a check, isolated execution, or specialist review. An incomplete scan does not establish clearance and is never recorded as passed; do not convert earlier incomplete results to passed. Confirmed malicious projects leave contributor discovery. Two distinct contributor flags automatically pause a project and notify moderators. Skills must refuse installation and work on flagged projects. A clean fresh scan reinstates a project that flags alone paused.

After a confirmed malicious result, the owner can appeal. A moderator decides whether to reinstate the project or ban it and the maintainer.

### Report and decide privately

Any registered user can report. Route exploitable findings privately even when bounty eligibility is uncertain. Never fall back to a public issue. Use GitHub private advisories for technical evidence and restricted Slop records for terms, decisions, appeals, and payments.

The researcher submits through Slop. With the researcher's GitHub authorization, Slop sends the report through GitHub's private reporting route. Slop automatically verifies receipt, analyzes the report, and notifies the maintainer. Submission must preserve the researcher's identity. Keep submission credentials private and retain them only as needed to complete or reconcile the submission. Analyze private report text only through a direct model provider under zero data retention, never through a marketplace route. Preserve reporter identity and reconcile uncertain submissions before retry. Never publish a report as a fallback. The maintainer or owner decides whether to award a bounty and approves its payout. Critical bugs and potential loss of funds are priorities, not an automatic payout promise. Slopbot triages disputes first; moderators decide escalated disputes. Neither automatic reporting nor dispute handling grants payment authority.

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
| Wallet recovery | Fresh account and wallet proof; one operator for redirected recovery; the binding delay and owner cancellation protect against a stolen key | Wallet-change delay and funded-award expiry policy |
| Mainnet | Four approved networks; independent audit before deployment | Exact assets, finality, authority, counsel review, testnet results, and explicit activation |
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

The repository PRD is canonical. The Google Docs copy mirrors it after repository review. Owner decisions in this revision supersede conflicting older requirements: self-service admission; required free Slopbot on registered repositories; size-based PR scores and useful review credit; two-flag pauses; automatic private reporting with discretionary bounty payouts; no public award-adjustment history; automatic monthly payment by default for funded projects; and received-fee conversion to USDC. The 23 October 2026 revision adds: automatic reinstatement after flag-only pauses; a 7-day maintainer window before Slopbot labels uncertain findings; one published penalty table; Slopbot-first triage of appeals and disputes; two bounty authorities; one operator for redirected wallet recovery; and a lighter isolated scanner runtime, used only for risky artifacts within the bounded scan in section 8. Independent audit and explicit mainnet activation remain required.

These are target requirements, not claims that current code or deployed services implement them. Preserve existing funded obligations and historical scoring terms. Keep implementation and evidence in the existing GitHub issues. This revision defines no requirement or MVP work-package IDs. Cite the section number and the acceptance result. Older IDs (for example PAY-05, SKL-03, TOK-07, and MVP-07c) remain valid references in existing records, code, and decisions. The old detailed delivery prose is superseded where it conflicts with this revision.

Before release, prove self-service setup, malicious-code detection, two-flag pause and skill refusal, automatic reinstatement after a clean scan, moderator decisions on confirmed-malicious results, free registered-repository bot review, scoring without duplicate review credit, monthly payment fallback, discretionary private reporting and settlement, and USDC fee conversion. Include failed, unavailable, and uncertain paths. Verify the exact source and deployed revision, real browser flows, access controls, recovery, and required network evidence. Independent audit and explicit mainnet activation gates remain in force. Maintainers approve completion from evidence; a source merge alone is not completion.

### Recorded owner decisions (24 October 2026)

The owner recorded these values. They apply prospectively and do not change historical scores or awards. Configuration that implements them stays fail-closed until it is set.

| Decision | Recorded value |
| --- | --- |
| Monthly period model | Calendar UTC month; first period 2026-11; cutoff 72 hours after the month ends (section 6) |
| Review-credit pool | Sum of the credited reviewers' highest bands, capped at the pull request's assessed size credit, minimum one third; largest remainder; effective 2026-11-01T00:00:00Z (section 7) |
| Flag lifetime and resolution | A flag counts for 90 days. A clean-scan reinstatement resolves every flag counted toward that pause; a withdrawn flag stops counting. Only a member whose GitHub account is at least 30 days old and who has at least one accepted Slop contribution may flag; owners and maintainers cannot flag their own project. One flag stays private |
| Fee conversion timing and dust | Convert on receipt when the value is at least 5 USDC and at least 10 times the gas cost; slippage 1%, price impact 2%, 1,000 USDC per run, 5,000 USDC per day. Capped conversion-only keys (section 6). Robinhood Chain stays pending until a Circle USDC route is verified. Solana live conversion waits for the separate attester role |
| Attribution for automatic closure | An ordinary submission needs the visible Slop attribution line and the exact provider, model, and client; a signed receipt is optional. Closure and penalties need the author's own authenticated Slop run for that project and a pull-request-opened event that names the exact pull request. A copied marker is never proof |
| Penalty table | Section 7 table |
| Escalation criteria | A moderator decides when the appellant or maintainer rejects Slopbot's drafted resolution; the case involves a ban, a confirmed-malicious result, or a private security case; the debit is 24 thirds or more; Slopbot's confidence is below 0.9; or the case is unresolved 7 days after the appeal |
| Restricted projects | Security-only review on a paused, flagged, or quarantined project may comment and apply the scam label only. Retired projects get no review. Approved funded payouts continue during quarantine or a ban; no new commitments start |
| Setup | Creating a project requires a Slopbot installation read. Economic changes apply from the next UTC calendar month. Amounts use asset base units. Admins use quarantine to hold a project |
| Account closure | Closure is reversible through an explicit reopen. Wallets, obligations, settlement records, identity reservations, and private-case records remain |
| Private bounties | Reserve against the bounty vault's finalized free balance. The researcher submits through Slop, which sends the report privately to GitHub with the researcher’s authorization. Verify receipt through authorized advisory read access. Two authorities, as in section 10. Awards only for cases received while paid terms were published |
| Contracts before audit | Remove the service charge. Permissionless vault creation by its owner, with separate ordinary and bounty purposes. A bounded monthly commitment that anyone may submit after the cutoff, signed by the identity attester and limited by the owner's monthly cap, one commitment per period, and the owner's opt-out |
| Scanner and runner | Surplus Opus 5.5 first; GPT-6.1 Sol only for ambiguous or high-risk results. One disposable Cloudflare sandbox per risky artifact, with internet access off and no secrets |
| Moderators | lalalune (18633264) and drew-dot-com (202660855) |
| Launch order | The non-money product launches first. Mainnet follows the independent audit, one network at a time: Base, Solana, Ethereum, then Robinhood Chain |

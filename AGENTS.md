# Slop repository instructions

Slop is a GitHub-native incentive network for open-source work. The public
product promise is **make money shipping open source**: contributors use any
agent or model to ship useful work, maintainers accept outcomes in the project’s
own repository, and Slop publishes Points, review state, and the verified
settlement record.

This is a private application, not a library. Cloudflare Pages serves the
static site at `slop.cash` and `slop.tech`; `eliza.army` is a compatibility
alias only.

## Product principles

- Score accepted outcomes, not activity.
- GitHub is the work, review, and policy authority.
- Slopbot decides routine cases under published rules; humans decide
  exceptions, escalated disputes, bounty awards, and confirmed-malicious bans.
- Projected, under-review, approved, scheduled, paid, unclaimed, held, and
  excluded are different states.
- Any provider, model, and agent client may participate when its exact identity
  is disclosed.
- Slop never infers copyright ownership, legal capacity, assignment, wallet
  control, or payment authority.
- Slop never holds keys, signs transactions, broadcasts payments, or claims
  success before public evidence proves it, except for the four narrowly scoped
  kinds of key below. No other application-service exception exists.
  - The escrow identity attester key (PAY-05, approved by the repository owner
    on 14 October 2026). It only attests the authenticated GitHub actor for a
    destination binding that the destination wallet also signs, and it submits
    those binding transactions. It cannot choose an amount or reach free
    funds. A binding activates immediately and the award delay is zero (#1086,
    #1100), so a stolen attester key with a wallet it controls can redirect and
    pay any matured unpaid award before the owner can cancel. Protection rests
    on custody of this key (`docs/security/red-team-2026-10-24.md`). A rotation
    by the registrar replaces the key, and the attester cannot block it. Owner
    decision of 24 October 2026: after the reviewed contract change, it also
    signs each funded project's monthly allocation root (the owner waived the
    independent audit, PRD section 11 "External reviews"). The contract limits
    that commitment to the owner's monthly cap, one commitment per period, and
    the owner's opt-out; the attester still cannot withdraw, redirect, or pay
    funds. Owner decision of 25 October 2026: it may automatically cancel its
    own obsolete pending EVM wallet-binding transaction with a same-nonce,
    zero-native-value transfer to itself, with empty data and the existing gas
    limits. Retain both signed attempts and reconcile either canonical
    finalized winner. The old binding may still win. Missing evidence is not
    cancellation proof. This exception does not authorize cancellation of
    payments or monthly commitments.
    Owner decision of 25 October 2026: on a current project owner request,
    the attester may sign release of the whole untouched monthly reserve only
    after fresh finalized evidence proves that the complete retained allocation
    matches the admitted root but has the wrong total. Missing, healthy, stale,
    partly settled or already released allocations refuse. The owner separately
    signs the release transaction. The Worker never submits it or withdraws funds.
  - One fee-wallet hot key for the shared EVM fee wallet of Base, Ethereum
    and Robinhood Chain, and one for the Solana fee wallet (PRD TOK-07,
    MVP-07c, owner decisions of 18 October 2026 and 29 October 2026, #1467
    item 3.10e). Each key controls only its fee wallet. It signs
    only the conversion of fees received in that wallet to USDC, through
    allowlisted routes, within the slippage limit, with output to the same
    wallet. Robinhood Chain retains each received asset without conversion or
    bridging (PRD section 11, 25 October 2026). Owner decision of 24 October
    2026: it may also submit permissionless fee claims on reviewed vaults,
    moving only accrued fees to that same fee wallet. It holds no vault role
    and cannot withdraw free funds or touch contributor principal, reserved
    awards or payments. Per-run and daily caps bound it. Owners authorize USDC
    sweeps to separate owner-controlled software wallets, with sweep keys held
    in their local `.env`, not by the Worker (PRD sections 6 and 11,
    24 October 2026). Owner decision of 10 November 2026 (PRD section 6,
    "SLOP buyback and burn"): half of all fee income funds a programmatic
    buyback of SLOP (`0xfeb4e36fa4a2a494ff25ae4a63491e4c584a67ae` on Robinhood
    Chain). For that share only, the same keys may also sign: an exact
    approval and one deBridge DLN order that sends USDC from Base, Ethereum
    or Solana to the Robinhood Chain fee wallet as USDG; on Robinhood Chain,
    fee claims on reviewed vaults, an exact approval and a checked swap of the
    buyback share into SLOP with output to the same wallet; and a transfer of
    half of the acquired SLOP to the burn address
    `0x000000000000000000000000000000000000dEaD`. Every order names that fee
    wallet as receiver, order authority and refund beneficiary, checked before
    signing. The other half of each fee keeps its earlier handling; on
    Robinhood Chain it stays unconverted. `BUYBACK_MODE` is live in the
    production configuration from 12 November 2026 (operator decision; PRD
    section 6) and off on staging. Changing the mode, the start instant or any
    limit needs its own reviewed change and the readiness checks in
    `workers/fee-converter/README.md`. The
    Worker never cancels an order; cancelling an unfilled order is an owner
    action. `workers/fee-converter/wrangler.toml` sets the mode of
    each network. The Worker deploys only when the
    `SLOP_FEE_CONVERTER_RELEASE` repository variable is `enabled`. Fee handling starts only after the fee wallets are
    funded and the limits and readiness are verified (PRD section 11, #1285).
  - The referral root-posting key (PRD section 11, "Referral program", owner
    decision of 25 October 2026). It posts cumulative Merkle roots to the
    ReferralDistributor and is separate from the contract owner key. It does
    not transfer tokens; referrers claim their own tokens immediately after a
    root is posted (owner decision, 26 October 2026). The owner can void the
    latest root only before its first successful claim; paid tokens cannot be
    clawed back. There is no guaranteed intervention window. Owner decision,
    27 October 2026: defer referrals from launch. Keep the accrual mode off and
    program flag false; do not file accruals or post roots. Referral setup,
    funding and qualification do not gate launch. Preserve code and history.
    Any later reactivation needs separate owner approval. After that approval,
    the accrual job may run only in off or dry_run until the program
    token exists, the funding line is agreed, an independent root watcher is
    operating, and the owner explicitly activates posting. Counsel review is
    not required (owner decision, 26 October 2026). No root is
    posted until that activation; production accrual is dry_run against the
    mainnet distributor, which holds the 2,000,000 tokens since 12 November
    2026 (PRD section 11). This
    exception grants no authority over project vaults or contributor payments.
    The whole-root growth limit is 2,000,000 program tokens; each project still
    has a 250,000-token lifetime cap. The separate poster gas ceilings are
    0.0002 ETH per transaction and 0.002 ETH per UTC day (owner decision,
    25 October 2026). Pause above either ceiling; retain uncertain attempts.
    These limits do not authorize funding or activation.
  - The submission-fee resolver key (PRD section 6, "Submission fee
    deposits", operator decision of 18 November 2026). It calls only
    `resolve` and `resolveMany` on the `SubmissionDeposits` contracts on Base
    and Robinhood Chain. For each open deposit it can choose only between the
    two outcomes fixed when the deposit was made: a refund to the payer, or
    "kept" to the deposit's own destination (the fee wallet for a stablecoin,
    the burn address for SLOP). It cannot send a deposit anywhere else, holds
    no tokens, and is never the contract owner. A stolen key can refund or
    keep open deposits wrongly; it cannot take them. `workers/submission-fee`
    sends only for finalized deposits, keeps a fee only for the deposit that
    paid a pull request whose row says kept, records each signed transaction
    before broadcasting it, and stays inside its native-fee ceilings.
    `SUBMISSION_FEE_MODE` is `live` since 21 November 2026 (operator
    decision); `dry_run` loads no key. Operator decision of 21 November 2026:
    the same key resolves the deposit on a private security report (PRD
    section 8, "Report deposit") with the same two outcomes, a refund to the
    payer or "kept" to the burn address, for the row the security API marked.
- The owner may authorize an agent to use necessary existing credentials
  privately and execute reviewed setup, testnet or mainnet plans (owner
  decision, 25 October 2026; PRD section 11). Stay within the authorized
  financial scope. Never print secrets or signing material. This permission
  does not expand application-service signer powers or waive acceptance,
  explicit mainnet activation or the reviewed release flow.
- Never publish secrets, prompts, responses, source files, credentials, session
  identifiers, private trajectories, or signing material.

## Scope and contribution rules

The [canonical Slop PRD](docs/slop-product-requirements.md) defines product
scope, acceptance, and completion. The repository PRD governs; the Google Docs
version mirrors it. [CONTRIBUTING.md](CONTRIBUTING.md) holds the full
contributor rules. Read both before you select work, propose a change, review
a PR, or implement a feature. The hard rules:

- Scope: work only inside the approved MVP. Cite the PRD section and the
  acceptance result. Existing code, an open issue, a model suggestion, or a
  PRD entry marked Future does not approve implementation. A new requirement
  needs human discussion and an approved PRD update first. Unresolved PRD
  choices are decision gates, not authority for an agent to choose economic,
  security, or product policy. Do not start later PRD phases before
  maintainers record MVP completion in the PRD
  ([MVP scope and phase gate](CONTRIBUTING.md#mvp-scope-and-phase-gate)).
- Issues: only project owners and maintainers open issues, here and in every
  target project. An agent that works for a contributor never opens, drafts
  for submission, or submits an issue by any path. It fixes and proves a
  defect in a pull request
  ([Issues: owners and maintainers only](CONTRIBUTING.md#issues-owners-and-maintainers-only)).
- Bounty: this repository has a $1,000 monthly contributor pool. UI, style,
  and copy changes are not accepted, except a fix to a broken user flow with
  before and after video
  ([Slop bounty: what is accepted](CONTRIBUTING.md#slop-bounty-what-is-accepted)).
- UI: do not change the interface unless it is necessary to fix a reproduced
  broken user flow or deliver an explicitly approved MVP requirement. Preserve
  the existing layout, style, labels, and controls in other work. Make the
  smallest necessary change and explain why the existing interface cannot
  meet the requirement. Do not add collapsible sections, accordions, eyebrow
  labels, extra headings, explanatory text, helper copy, badges, cards, or
  controls without a demonstrated need. Keep required actions, consent,
  amounts, restrictions, and evidence visible. Review the actual UI diff and
  reject unrelated changes or clutter; passing tests alone are insufficient.
  Necessary UI changes require before and after video and the full UI checks
  ([Preserve the user interface](CONTRIBUTING.md#preserve-the-user-interface)).
- Real LLM calls: prove model-backed behavior with real provider calls, never
  with mocked or recorded output
  ([Test with real LLM calls](CONTRIBUTING.md#test-with-real-llm-calls)).
- Agent clients: test the affected workflow in the agent clients that use it.
  Record each client, version, provider, model, and result
  ([Test in more than one agent client](CONTRIBUTING.md#test-in-more-than-one-agent-client)).
- Stars and forks: an agent stars and forks the repository only when it can
  use computer use or browser use (PRD section 4). Stars and forks are never
  scored or paid.

## Source of truth

The D1 project registry (`projects`, `project_revisions`, and
`project_applications` in `slop-private`) is the only project and repository
inventory. Never hardcode a project, repository, reward, steward, status, or
funding route elsewhere. Every manifest change appends an immutable revision.
`bun run projects:sync` snapshots the registry from `GET /api/v1/projects` and
`GET /api/v1/project-revisions` into `src/lib/project-registry.generated.mjs`
and `src/lib/project-revisions.generated.json`; generated registries and
public pages derive from that snapshot. Never edit the snapshot by hand.

Projects listed before the registry were removed with their manifests and
history records. `src/lib/legacy-projects.json` keeps only their ids and
repository ids so contributor points and profiles still validate. It is never
listed, collected, scored, or paid. Unit tests use the frozen fixture registry
under `tests/fixtures/`, loaded by `bunfig.toml`.

Project skills are generated, never stored per project (PRD SKL-03, owner
decision of 18 October 2026). The repository keeps one canonical generic
contributor template and one canonical generic reviewer template. Slop
renders each project's skills from its approved D1 revision (scope,
contribution guide, supported tasks, required tests, review expectations,
security contact, closure policy and maintainer notes) and those templates.
The same template revision and D1 revision produce the same bytes. Maintainer
notes cannot weaken a template rule. Do not add per-project skill folders or a
second skill copy. `scripts/prepare-site.mjs` builds raw Markdown endpoints
and downloadable `.skill` archives from the generated output and publishes the
cycle index.

Generated files under `public/downloads/`, `public/projects/`,
`public/protocol/`, and `public/data/cycles/` are build outputs. Never edit
them by hand.

Operational guides under `backend/`, `cycles/`, `disclosures/`, `evaluations/`,
`funding/`, `protocol/`, and `workers/` define subsystem contracts. Keep them focused and
current.

## Repository map

```text
docs/           canonical PRD, runbooks, and security records
skills/         general Slop skill and canonical generic project-skill templates
evaluations/    reviewed awards for otherwise-unscored useful work
cycles/         historical cycle format notes; monthly allocations live in D1
funding/        project vault funding guide; legacy records stay in git history
disclosures/    payouts sent outside the verified settlement flow
protocol/       public attribution, privacy, scoring, and Slopbot contracts
data/           committed points journal, profile seed, and snapshots
contracts/      EVM and Solana escrow and referral contracts
migrations/     append-only D1 migrations
backend/        API handlers for registry, accounts, payments, and traces
functions/      Cloudflare Pages Functions entry points
workers/        narrowly scoped Cloudflare services
src/            React product and strict browser/domain contracts
scripts/        ingestion, packaging, rewards, settlement, and evidence
tests/          end-to-end, integration, and fixture coverage
```

## Add a project

Projects are added on the website, never by pull request. The PRD now requires
self-service setup: verify current GitHub authority, complete project terms,
install Slopbot, and obtain malicious-code clearance before automatic activation.
PRD section 8 permanently exempts the existing projects captured by migration
`0075_vetting_grandfathered_projects.sql` from normal scan clearance, including
future executable changes. Later projects require one successful admission scan of their immutable GitHub
repository. Routine commits, dependencies, Markdown, skill and presentation
changes keep that admission; do not claim the later content was scanned. Keep successful bounded admission-scan evidence permanently, including original evidence used by a reused result (owner decision, 27 October 2026). Other scanner cases keep their existing retention rules.
Keep the original complete assessment and retained evidence. Another repository
cannot inherit a nonexempt admission. An owner may append public repositories on the
manage page; each needs the owner's current authority through Slopbot, counts from
the next UTC month, is never removed or reordered, and needs its own admission scan
or exemption, because the migration-0075 exemption covers only original repositories.
Explicit security investigations control
nonexempt admission (owner decision, 27 October 2026, PRD section 8).
Admission scans have no repository size limit (owner decision, 28 October
2026, PRD section 8): acquisition is one shallow Git fetch of the exact commit,
verified locally, and a large inventory is reviewed in token-budgeted batches
with a repository-level synthesis (`workers/vetting/ACQUISITION.md`,
`workers/vetting/review-plan.ts`). Retained scanner evidence has no object or
run size limit: objects are stored once by SHA-256 in private R2 in 8 MiB
parts and referenced by every run that declares them
(`backend/vetting/EVIDENCE.md`). Never reintroduce an entry, file, total or
evidence size refusal, and never record a partly reviewed repository as passed.
Operator decision, 19 November 2026: clearance follows the scanner's own
evidence. Info, low and medium model findings and reviewer coverage reasons the
scanner verifies as outside the acquired revision are advisory; unreviewed
supplied content, a missing or unexplained coverage area, a high or critical
finding, suspected malice and scanner gaps still block. Slop's queued template
is checked deterministically and not sent to the models; well-formed images and
fonts are listed by digest (PRD section 8). Record the existing-project exemption
explicitly, never as a passed scan; its project-ID scope is unchanged. Flags,
pauses, confirmed-malicious bans and fresh-scan reinstatement requirements
still apply.

Owner decision, 27 October 2026: the registered Umia Protocol fork may receive
an explicit, audited normal-admission exemption through the administrator
interface. Bind it to the current D1 project revision, immutable repository
identity and steward; keep the frozen migration-0075 set unchanged. No other Slop-owned
repository is automatically exempt. A later grant needs its own human owner
decision. Display "Owner-approved exemption", never a passed scan. Retain
earlier assessments; later investigations, flags, pauses, account restrictions,
confirmed malice and fresh reinstatement checks still apply. Retain revocations
and restore the ordinary admission gate after revocation.
Owner decision, 11 November 2026: an administrator may record community
admission after a cursory review of the latest development source under PRD
section 8. An old pin or unproven source-to-binary match is not a manual-review
gate. Record the actual branch/head, scope and limitations, and display
"Owner-approved exemption", never a complete passed scan. The approver needs
platform administrator authority; the registered creator or individual steward
must separately retain current GitHub write/maintain authority through Slopbot.
Do not impersonate that maintainer. Keep immutable identity/revision binding,
earlier assessments, restrictions and confirmed-malicious controls. Contributors
still review before installation. Automated results retain their actual pins
and complete-evidence requirements.
Funding is optional and has a separate readiness state. Owners publish immutable
revisions; admins handle restrictions and disputes, not routine approval.
Two distinct contributor flags pause the project. A clean fresh scan reinstates
a project that flags alone paused; a moderator decides only after a confirmed
malicious result. Contributor skills must not install or work on flagged
projects.

The owner creates and updates projects through `backend/projects/`. Preserve
permanent repository and actor IDs when checking current GitHub write/maintain
authority. A stored application can be published by its applicant through the
same checks; it does not need an admin decision.

A paused project is registered and listed, but none of its repositories is
collected, so nothing on them reaches the ledger or the leaderboard. It
publishes no skill until its revision has the maintainer-authored skill
fields. Verify immutable repository and
actor IDs, repository license facts, GitHub stewardship, integration branch,
reward policy, and failure paths before activating receipts or money states.
Stewardship is a GitHub identity only.

Registry rows cannot be deleted. Pause a project, or append a revision with
`listingTier: "retired"` to hide it from every page and list while its history
still resolves.

The contributor skill must inspect live GitHub, select bounded unblocked work,
follow the target repository’s rules, test the result, prepare evidence, and
emit the required attribution. It must not claim platform authority over an
issue or create placeholder submissions.

The current reviewer skill is separate and advisory. It checks correctness,
tests, security, evidence, duplication, abuse signals, scope, and usefulness.
It places its recommendation before a footer that discloses the actual
provider, exact model, and client.

Slopbot is required and always free, and runs only on registered repositories.
It scores PRs by perceived size and value, credits useful reviews, and applies
the published penalty table. A project owner may turn on the refundable
submission fee (`slopbot.submissionFee`; operator decision, 18 November 2026;
PRD section 5). The review stays free: an outside contributor's pull request
waits for its review until a deposit is recorded, with one comment and the
label `slopbot:fee-needed`. A merge, or 14 days without a maintainer decision,
makes the deposit due back; a pull request closed without a merge for 7 days
keeps it (a stablecoin fee to Slop as fee income, a SLOP fee burned), except
one that closes an issue labelled `slop-wanted` before it was opened, which is
sent back unless a maintainer adds `slop-keep-fee` (operator decision,
22 November 2026). Slopbot
moves no money, never closes a pull request for an unpaid fee, and never
blocks a maintainer's own review or merge; scoring does not read the fee.
The comment links the pay page
`/fee/<owner>/<repo>/<number>` (`src/SubmissionFeePage.tsx`; operator
decision, 19 November 2026). The page needs no sign-in, takes the repository
id from the project registry, and offers a way to pay only when the stored
record's contract, chain, token and kept-to address equal the tables in
`src/lib/submission-fee.mjs`; it takes none of them from the address bar or
from input, and offers nothing while `SUBMISSION_FEE_SWITCHED_ON` is false.
`SUBMISSION_FEE_MODE` in `workers/slopbot/wrangler.toml` is `off`, `dry_run`
or `live`. It is `live` since 21 November 2026 (operator decision; record-only
from 19 November): Slopbot asks for the fee on a project whose owner turned
it on, and on no other project. Automatic closure is limited to verified
Slop-skill participants, excluding maintainers: a slop.cash member whose own
authenticated Slop run records a `pull_request_opened` event for that exact PR
(PRD section 11). A copied marker is never proof. An uncertain finding goes to
the maintainer first; after 7 days without maintainer action, Slopbot applies
its verdict as a label only and never closes. A Scam or malicious closure also
creates one idempotent moderator Inbox notice to review the account (PRD
section 7 penalty table). Slopbot triages each appeal first,
and a moderator decides escalated appeals. Do not charge project vaults for bot
reviews. The current global closure switch stays off until reviewed production
activation. Document changes alone do not activate closure, payments, or
security enforcement.

Automatic closure also requires explicit consent in project settings. Start
the control unchecked and treat absent consent as false; registration or App
installation alone is not consent. A separate `.github/slopbot.json` file is
not required, but preserve its existing opt-outs and category restrictions
and the repository's rejection rules. Use existing immutable project revisions
and current GitHub authority checks. Qualify closure with reviewed real cases
and counterexamples, not a fixed 14-day and 50-item threshold. Keep independent
confirmation, caps, appeals, reopen protection, the seven-day uncertain
label-only rule and explicit production activation. Fixtures prove controls,
not actual model qualification (owner decision, 25 October 2026).

## Installer and attribution

The public checksum detects corruption only. The trust root of a project
skill is the pair (immutable canonical GitHub template commit, approved D1
revision digest) (PRD section 4). The installer resolves the requested full
40-character commit through the fixed canonical repository API and checks the
complete file tree against immutable GitHub bytes. The registry API publishes
the approved D1 revision digest; the installer refuses bytes that do not match
the rendering of that pair. Disclose that maintainer-authored fields come from
Slop's registry. These checks prove source identity, not maintainer approval.

Owner decision, 27 October 2026: any such committed template revision may be
installed, including an unreleased, divergent, older or previously revoked
revision. There is no template freshness, main ancestry, release-label or
revocation gate. Explicit template selection may move backward; ordinary
updates must still not decrease the D1 revision. Explicit rollback rechecks
canonical bytes, the approved registry digest and current project installation
clearance before activating a retained version.

Installed skills verify their local provenance, complete file tree, hashes and
receipt schema for `authorize` and `start`, without a live GitHub or registry
authorization call. A local checkout alone does not qualify as an installation.
Project status and clearance still gate installation, updates and rollback;
repository access, safe work selection and submission rules still apply.
Offline behavior requires a template containing this change: existing installs
need one verified update after publication. Historical template bytes are never
rewritten and may retain their original online behavior.

Reject missing or extra files, working-tree provenance, mutable redirects and
byte mismatches. Preserve immutable sibling version directories, the
process-bound kernel lock, atomic relative-symlink activation and prior verified
versions. Tests may inject only deterministic `file://` authorities through the
generator's test option.

Every contribution discloses exact provider, model, and client. Ordinary GitHub
submission does not require a measured run, device key, policy acknowledgement,
private trace, usage collection, or payout registration. Optional signed receipts
bind their actual evidence; missing evidence never earns a trace bonus. A device
signature proves byte continuity, not provider billing truth. Token evidence is
diagnostic and never changes score, rank, share, or payment.

## Private security reporting

Owner decision, 27 October 2026: all registered projects retain confidential
reporting. Umia Protocol has a paid security bounty (Slop's own program is
described below). The Umia bounty's
$10,000 gross award per accepted critical loss-of-funds finding splits $7,500
to the first qualifying reporter and $2,500 to slop.cash. The maintainer reviews
and awards each finding. The offer is pledged with funding after approval,
not an upfront-funded vault; reserve and pay only after verified funding. Slop fronts an approved award through the existing private
bounty settlement; reimbursement by Umia is off chain. Publish project terms
only through immutable D1 revisions. Preserve prior cases and funded awards.

Operator decision, 20 November 2026, replacing the offer of 28 October 2026:
Slop's own security program opens only if the Slop Cash decision market of
24 November 2026 passes the option "Fund the pool and a Slop security
program", which moves 10,000 USDG from the treasury to the Slop Cash S.P. It
pays $5,000 per accepted critical finding, entirely to the first qualifying
reporter with no Slop share, at most two awards, and closes after 12 months or
its second award; unawarded funds return to the treasury. In scope: a loss of
funds from a Slop vault, a contributor payout, or Slop's other payout
contracts (project escrow, submission deposits, the referral distributor),
including the off-chain Slop services that compute, record or send those
payouts. Out of scope: third-party contracts, frontend-only defects, testnet
and local deployments, known or previously reported findings, reports filed
before the program opens, and losses needing compromised privileged keys or
intended owner actions. The S.P. confirms each finding and pays an approved
award directly, publishing the transaction; no Slop vault or payment rail is
involved. Until the program opens, and if the option does not pass, no paid
award is offered. Report through the same private Slop intake; never a public
issue. See PRD section 8.

The canonical skills direct researchers to the authenticated Slop interface.
Accept and retain the report privately before optional GitHub forwarding;
show its receipt and status in Inbox. Screen with the approved Surplus route
before owner notification. Missing evidence, suspected spam and unavailable
analysis stay recoverable for human review. A model never approves an award.
Operator decision, 17 November 2026 (PRD section 8): a bounded routine pass
(`backend/security/routine-decisions.ts`) decides reports still in `received`.
It closes a duplicate, a report on which two independent model calls name the
same published "Does not qualify" line, and a report without proof once its
14-day clock ends with no new version, each with a plain reason and one appeal
that returns the report to the program owner. It acknowledges everything else
and ranks it for the owner. It never closes on a plausible loss of funds, an
unavailable or disagreeing reading, an open appeal or correction, or a report
on GitHub. `SECURITY_ROUTINE_DECISIONS` is `off`, `dry_run` or `live`, set in
`wrangler.toml` (production, `live` since 20 November 2026) and
`wrangler.staging.toml` (`off`); `dry_run` records decisions only.
Operator decision, 21 November 2026 (PRD section 8, "Report deposit"): a
private report filed through Slop needs a refundable deposit of SLOP on
Robinhood Chain worth 5 US dollars at Slop's SLOP rate, rounded up to a whole
SLOP, held in the existing `SubmissionDeposits` contract. The report is
accepted and stored at once. Until the deposit is recorded it is not screened,
the owner is not notified, the routine pass and the owner's lists leave it
out, nobody can decide it and GitHub forwarding refuses; it is never closed or
deleted for an unpaid deposit. Every such path checks the one condition in
`backend/security/report-deposit-hold.ts`; never add a path around it. The
deposit is sent back on a first response that is not a keeping close, after 14
silent days, or when the owner turns it off. It is kept, and burned, only when
the report is closed as a duplicate, as out of scope, or rejected by a person
who marked it spam, and that close stood 7 days with no open appeal. A model's
screening verdict never keeps a deposit. A report closed for missing proof is
sent back. The setting `project.security.reportDeposit` is on unless the owner
turns it off. The project's owner, its maintainers, Slop moderators and admins
are not asked, nobody is asked while no SLOP rate is in force, and a report
that existed before the switch-on is never asked. `SECURITY_REPORT_DEPOSIT` is
`off`, `dry_run` or `live`, set in `wrangler.toml` (production, `live` since
21 November 2026, operator decision) and `wrangler.staging.toml` (`off`);
`dry_run` records which reports would have been asked and holds nothing.
Change the mode only together with `REPORT_DEPOSIT_SWITCHED_ON` in
`src/lib/security-report-deposit.mjs`. Say "sent back" and "kept"; never say a
deposit buys a faster or better review.
Use generic private email notices with secure Inbox links. GitHub forwarding
requires the researcher's authorization and separate verified receipt; it is
not a prerequisite for Slop intake or owner review. Retained private report
reads require current case authority and an audit record. Contributor trace
bodies remain unreadable, except operator export of a licensed trace under
contract version 2. See PRD sections 8–10.

## Private traces

Contributors may opt into the minimized contribution-specific trace defined by
`backend/trace/README.md#private-trace-privacy-contract`. Declining or failing upload never blocks submission. The contributor inspects and
redacts the selected file; the uploader stores its exact bytes and performs no
automatic redaction.

Operator decision, 22 November 2026: contract version 2
(`backend/trace/README.md#private-trace-privacy-contract-v2`) lets a client
upload by default after showing the file and a one-line decline, and adds paid
licensing as a separate account opt-in: 50% of each sale to contributors,
merged or closed pull requests only, never re-identification or resale.
Version 1 keeps governing traces uploaded under it. Operator decision,
23 November 2026: licensing is available from the account settings
(`/account#trace-licensing`), off by default, and turning it on needs the
provider-terms confirmation. A contributor's earlier or unlicensed traces are
licensed only by an explicit opt-in, one by one or all listed at once; turning
the setting off or closing the account withdraws every unsold licence. No trace
has been sold or exported.

Trace bodies are permanent private R2 objects. D1 stores only safe metadata and
digests. No website or API route returns a trace body, including to
contributors, project owners, operators, and the public. Under version 2,
designated operators may export a licensed trace only to fulfil a sale, with
an audit record.

The contributor upload route is write-only, bounded, authenticated,
checksum-verified, and fail-closed. Public artifacts contain only safe metadata
and the trace digest. Only optional trace collection depends on the independently renewed private
request status. Website deployment and GitHub contribution remain independent.

## Scoring and work selection

Snapshots retain every open issue and PR for source-count integrity. Each item
publishes a deterministic selection decision, and the UI advertises only
bounded unblocked candidates. Existing assignees, maintainer claims, drafts,
active review requests, approvals, changes requested, security labels,
human-gated work, and epics fail closed. Re-read live GitHub before acting.
Issues labelled `slop-wanted` are the ones maintainers most want done (PRD
section 5, operator decision of 21 November 2026). The contributor skill
starts with an unclaimed one that no open pull request closes; the label never
changes Points, scoring or payment.
From 1 December 2026 an active monthly-pool project with 50 or more outside
pull requests waiting a week for a maintainer, or with work waiting and no
merge in 14 days, leaves the home page, /sponsors and agent discovery until
that clears (PRD section 5, "Backlog rule", operator decision of 23 November
2026). The owner may mark it as catching up on reviews for up to 14 days, once
per UTC month; the rule never changes Points, scoring, payment or Slopbot
reviews.
The contributor skill may suggest one public repository not on Slop per
session to its operator with `https://slop.cash/requested?flag=<owner>/<name>`;
only the signed-in operator flags it, and the agent never flags, comments,
opens an issue or pull request, or mentions Slop on that repository (PRD
section 11, "Requested repos", operator decision of 22 November 2026).

The rolling ledger covers a complete 35-day window, publishes exact bounds and
record counts, and deduplicates immutable GitHub IDs. Exclude bots, self-review,
post-merge review, and repeated low-value comments. Every accepted merge gets
at least 10 accepted-work points (one legacy credit-third). Group split or related pull requests into one work
unit; do not apply account-level caps or diminishing credit.

Unusual useful work may score only through a strict reviewed `evaluations/`
manifest. Never double-score a source already rewarded by the ordinary ledger.
Slopbot may assign scores, apply the published penalty table, label uncertain
findings after the maintainer window, close under PRD section 5, and triage
appeals and disputes. No LLM or automation may ban a person, decide an
escalated dispute, approve a bounty award, or move money outside the contract's
automatic monthly distribution.

## Participation points

Slop Points are the single contribution and participation unit governed by
`docs/slop-product-requirements.md` section 7. From 24 October 2026, grant no welcome or
X-connection points (PRD section 11, Participation points). Keep every award
recorded before that date unchanged; never delete, rewrite, or reissue one.
Earned-point standings and rewards already exclude them. The X connection
stays an optional OAuth-authorized public profile link with no points.
Verified payout recognition is fixed per recipient/project/cycle, never per dollar
or transfer. X control never confers GitHub, organization, or payment authority.
Telegram is retired (PRD section 3). Preserve its historical records; do not
restore a bot, connection, public profile link, or support route.
Owner decision, 26 October 2026: active memberships and connected X profile
links are public, without a separate visibility opt-out. Existing private
memberships and already-connected X links become public at the next
authenticated sign-in; explicit reopening and new X connections are public.
Disclose visibility before sign-in or connection. Keep closed accounts private,
removed links disconnected, and private cases, traces, wallet records, email
consent and historical Points unchanged. Public reads perform no transition.

Only accepted-work points for the project and period determine reward shares;
never feed historical participation or payout-recognition bonuses into rewards. Preserve
historical settlements and compatibility fields without exposing a separate
score metric. Preserve the append-only journal,
source coverage, original contribution dates, and distinct recording dates.
Generated points projections are build outputs; do not edit them by hand.

Operator decision, 20 November 2026: the Points of a project month that has a
recorded payment are frozen. The points generator holds any candidate revision
that would add or change an award in such a month, or move one out of it, and
publishes the rest; `data/points/protected-months.json` lists those months and
mirrors the private settlement tables. The atomic import still refuses a batch
that changes a protected award, so a month missing from the list fails closed.
Add a month to the list when its first payment is recorded.
Operator decision, 21 November 2026: a trusted `main` release also reads the
protected months from the private route
`GET /api/v1/operator/protected-point-months` (bearer token
`POINTS_PROTECTION_TOKEN`, an optional Pages secret and repository Actions
secret) and holds the union of its answer and the committed list. The route
uses the import guard's own tables and clauses and names project months and
projects only, so with both secrets set a new month needs no hand edit.
Without the secret the generator uses the committed list alone; a failed or
invalid read is one warning and the committed list alone. Never print the
token or the months the route returns.

## Rewards, funding, and settlement

Monthly allocations are D1 records. The trusted `monthly-rewards.yml`
workflow freezes the complete ledger of the closed UTC month and writes each
funded project's proposal to D1 once; a repeat run never adds or replaces
rows. The owner changes amounts, and the owner or the automatic cutoff
freezes the final allocation (`backend/payments/README.md`). A change below
a contributor's proposed amount is a cut: it needs a 20 to 500 character
reason, is public with its reason, and sends the contributor an Inbox notice.
Cuts close 24 hours before the cutoff while automatic finalization is on, and
the owner can finalize only 24 hours after the latest cut. Operator decision,
15 November 2026.
`cycles/` keeps only the format notes of historical cycles; do not add cycle
files.

Monthly allocations use integer base units of the project asset and largest
remainder. Never use floats for money, assume six decimals, or let rollover
increase a later monthly cap.

New project setup uses one monthly pool. Preserve historical committed review
budgets and their terms; do not offer a second review budget for new projects.
Review credit follows the canonical scoring policy.

A project owner may set a maintainer share of 0 to 30% of the monthly amount
(`reward.maintainerShare`, basis points; operator decision, 18 November 2026;
PRD section 6). It comes out of the monthly amount before the Points split, so
a month never distributes more than its amount. It is split among the GitHub
users who merged or closed another person's outside pull request in that UTC
month, in proportion to the number each decided. A month with no such decision
has no maintainer share. Accounts on the payout exclusion list receive none.
A change starts with the next UTC month. The monthly workflow reads the
decisions from public GitHub data and stores the record with the proposal;
never compute a split from a partial read.

Automatic monthly payment is the PRD default for every project with funds
committed in its vault. The owner sets the monthly amount during setup, can
adjust allocations before execution, and can turn the default off. Only cuts
below the proposed amount are public, each with its required reason; other
changes stay private. Distribute the current
allocations at the monthly cutoff if the owner has not done so. The period is
the calendar UTC month, starting with 2026-11, and the cutoff is 72 hours after
the month ends (PRD sections 6 and 11). Keep internal reconciliation and prevent
manual/automatic duplicate payments. Walletless funded awards remain reserved.
Private reports are automatic; bounty awards and payouts remain discretionary.
Slopbot triages disputes first, and a moderator decides escalated disputes.
Preserve already funded obligations.

Historical cycle records keep the 14-day review window and the public reasons
they were made under; new months use neither. This policy text never alters
contracts or authorizes live transactions.

One funding mode exists: the project vault contract (PRD section 6, owner
decision of 18 October 2026). Squads v4, Sablier, legacy direct and committed
instruments and the monthly-pool settlement rail are removed. Their
historical records stay in git history at their original revisions; they are
not an active funding route, balance or payment path. Each project has one
network (Base, Robinhood Chain, Ethereum or Solana) and one asset. Anyone may
deposit into a vault. All deposits share one bucket; there is no donor class.
All free funds are refundable only to the owner's refund destination, and the
deposit flow says so before signature. Operator decision, 18 November 2026:
an active project's public page offers a deposit-only control to any wallet,
states that depositors have no refund right and that the owner can withdraw
free funds less the 2% fee, shows how many months the free funds cover, and lists each
finalized deposit under "Funded by" with its address, amount and date (PRD
section 6). That list is display evidence only. `paid` requires finalized evidence that
reconciles the exact vault, obligation, recipient, principal and fee. Reject
replay, wrong mint or token, wrong owner, partial, duplicate, failed, or
overpaid state. Delta Star publishes external-prize shares only and never
enters the platform payment lifecycle. Never call vault funds “guaranteed.”
Keep project deployment bindings in the D1 project revision, never in a second
project inventory. No project activates escrow merely because the new code is
present. The scoped vault contract, identity attestation, and executor
services may execute isolated test-chain transactions under the PRD rules.
This supersedes the legacy unsigned-only model for the vault protocol only.
Testnet qualification never uses production credentials or moves mainnet
funds.

New ordinary public-work awards deduct 2% before display or payment.
Private security bounties use the PRD section 8 split instead: 75% to the
researcher and 25% to slop.cash. Do not add the ordinary 2% fee to a private
security bounty. For a project-token reward (PRD section 6, owner decision of
14 October 2026), the 2% is deducted in that token and paid in that token to
the network fee wallet at payout. No contract converts it. A scheduled backend
job converts fees already in the fee wallet to USDC (PRD section 6) inside
that wallet (TOK-07, MVP-07c). Robinhood Chain retains the received asset and
shows "not converted"; USDG stays USDG and project tokens stay unchanged.
When the SLOP buyback is active (owner decision, 10 November 2026), its half
of each fee is bridged or swapped into SLOP as PRD section 6 describes; the
retained half is handled exactly as before.
Other networks without a verified USDC route keep the fee token pending.
Conversion never blocks or touches a contributor payment. The approved keeper and
fee-converter EVM replacement changes only fee fields, with the same nonce and
transaction content, bounded steps of about 25%, at most three times the
original fees, and the existing per-network limits (PRD section 11). Source
approval does not activate this replacement behavior. Unused-fund withdrawals
deduct the same 2%, `ceil(gross / 50)`, enforced in the contracts, and reach
only the owner's refund destination; funded obligations cannot be withdrawn.
Historical v1 records retain their original fee and authority rules.

Approved assets are the network stablecoin or standard ERC-20 on Base,
Robinhood Chain (chain id 4663) and Ethereum, or classic SPL and the bounded
metadata-only Token-2022 subset on Solana (PRD section 6, owner decision of
26 October 2026, #905). Token-2022 mints may have only MetadataPointer and
TokenMetadata, with disabled mint/freeze authorities; token accounts may have
only ImmutableOwner, or no extensions. Reject every other extension, including
unknown extensions. Fee-on-transfer, rebasing and transfer-hook behavior
remain unsupported. Qualify the correct token program throughout escrow,
owner setup and fee handling, and resolve and inspect every account in a
versioned route under the existing native limits before releasing support.
Existing classic SPL vaults, funded obligations, fees and roles remain intact.
This is approved implementation scope, not deployed acceptance. Program
upgrades and token funding each need their own exact reviewed execution plan
and owner approval. Circle USDC is the Ethereum stablecoin; verify its address
from Circle's primary source before activation.

Public pages never read chain or GitHub state live per page view (PRD
section 9). They serve cached D1 data and snapshots that background jobs
refresh. Vault totals come from finalized on-chain counters cached in D1 with
their observed time. A failed refresh shows the last value as stale, never
zero. A monthly amount is shown to contributors only when the project's
vault holds it; otherwise the pool reads as points only (PRD section 6,
operator decision of 15 November 2026). From December 2026 a month is
promised only if the vault covered it on the 1st, and Slop's pages refuse a
withdrawal below the promised amount.

## Project authority and IP

Publish repository license facts as SPDX plus immutable LICENSE URL, commit, and
digest. Do not turn GitHub stewardship into an ownership claim. `unknown` and
`mixed` copyright terms with null legal fields are valid terminal states.

`sponsor-owned` remains schema-supported only when the project provides the
complete signed instrument set; otherwise fail closed. Legal arrangements are
executed outside Slop. External-prize shares allocate payout only and never
claim copyright.

## Deployment

`development` is the default integration branch and deploys to `staging.slop.cash`.
Promote changes through a reviewed
PR from `development` to `main`. Only `main` deploys to `slop.cash`.
Staging has a separate Pages project, D1 database, private R2 bucket, identity
Worker, and secrets. Staging login and writes never use production storage.
Both branches require the full CI and trusted policy checks.

Production deploys through the checked-in GitHub Actions workflow only. Never
deploy from a package script, local working tree, PR, feature branch, fork head,
or tag.

Required environment secrets are `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`; Actions supplies `GITHUB_TOKEN` for ingestion. The
`slop-production` environment allows only `main`. Merges to `main`
start the normal release workflow automatically. Branch protections and
rulesets are not a release requirement (owner decision, 25 October 2026).
Do not add or restore them during release work unless the owner asks.

Production releases use the main-only `slop-production` environment.
No separate manual release approval is required. Publication credentials must
never be exposed to pull-request runs. Every production release uses the
shared publication lock.

Every release snapshots the current D1 registry, passes the full quality gate,
and publishes through its branch's normal release job. Normal releases ingest
live GitHub data. An explicit manual `main` or `development` run may set
`use_published_data` to retain the last leaderboard and profiles published by
that run's own environment (production or staging) after validation, with their
original timestamps and history (operator decision, 13 November 2026). This
option cannot run with staging bootstrap; missing or invalid published data
stops the release. Such a `main` run may also name, in `data_from_run`, a
completed trusted `main` release whose own fresh collection succeeded at an
ancestor commit; it then takes that run's collected leaderboard and profiles
from its checked bundle instead of the live site, still refusing data older
than the live publication (operator decision, 18 November 2026). It never uses the pull-request data adapter or skips code, browser,
sandbox, source-identity or deployment checks. An explicit manual `main` or
`development` run may also set `skip_proofs` (operator decision, 14 November
2026; PRD section 12, STATE-05): it repeats neither the Quint state-model
stages nor the LemmaScript proofs. Both inventory checks and every code,
browser, sandbox, source-identity and deployment check still run. A push
release cannot skip them, pull requests still run the affected models and
proofs, and scheduled nightly runs check all of them on the default branch.
The same kind of run may set `skip_browser_tests` (operator decision,
14 November 2026; PRD section 9): it runs the browser smoke lane instead of
the complete browser lanes, and every other check still runs. A push release
cannot skip them. A release that skipped either set is not evidence that
the skipped checks passed.
To publish new data without a commit, run the release workflow by hand
(`workflow_dispatch`) with the `use_published_data` option off. The
`daily-collection.yml` workflow does this every day at 07:17 UTC unless a
collection is already running, publishes a superseded collection through a
`data_from_run` release, and resumes a failed collection once (operator
decision, 19 November 2026). GitHub fires scheduled and after-release jobs
only from the default branch, so while the default branch is not main an
outside scheduler starts main's scheduled workflows by hand with a token that
can only start workflows here (operator decision, 21 November 2026). A source GitHub cannot resolve still forces one
complete recollection, except a joint value-record member outside the live
census: when three availability probes a few seconds apart all report it
unavailable, the first attempt records it and holds its work unit; any
differing or failed probe keeps the recollection (operator decision,
20 November 2026). A manual main release may also set
`defer_retained_attribution`, which holds the retained-copy attribution check
for a later collection, or `parallel_collection`, which collects on hosted
runners beside a collection already running (PRD section 11; operator
decision, 20 November 2026). Every production release requires current main equivalence. Every
deployment is bound to its actual tested source SHA.

The separate hourly health workflow authenticates GitHub private-reporting
status and renews a D1 observation. It never publishes code or holds the site
publication lock. Status older than 24 hours blocks optional trace collection
only. Failed renewals are explicit operational failures.

The workflow installs lockfile-pinned Wrangler without lifecycle scripts.
Verify deployment identity, custom-domain DNS, TLS, redirects, headers, and
served bytes separately.

Claim the deploy/DNS lever on the issue before changing environment allowlists,
Pages, zones, nameservers, DNSSEC, custom domains, registrar state, or release
credentials.

## Working rules

Every explicit and implicit application state transition requires a reviewed
Quint model under [PRD section 12](docs/slop-product-requirements.md#12-state-correctness-and-quint-verification).
Maintain source mappings, assumptions, reachable scenarios and implementation
conformance evidence in `formal/`. Cover UI/UX, APIs, workers, storage, queues,
scheduled jobs, contributor tools, contracts and release workflows, including
failure, retry, expiry, cancellation, concurrency, interruption and recovery.
Review composed parent/child and cross-subsystem transitions, not only each
component in isolation.
Run `bun run formal:check` and `bun run formal:verify` with the existing required
checks. Fix model/code discrepancies without weakening product policy. Report
finite bounds and unresolved gaps; model simulation alone proves neither source
refinement nor the absence of every application state error.

- Preserve unrelated user changes and untracked files.
- Use a scoped branch from current `origin/development`; rebase before final
  review.
- Prefer deterministic scripts and strict schemas over duplicated prose or
  fallback success.
- Reject one-PR-per-file coverage farming, “no same-named test” tasks,
  barrel/type/schema/constant inventory suites, and shape-smoke assertions
  that prove only existence, type, finiteness, length, literals, export
  identity, or mocked calls.
- Reject copied or mismatched PR narratives and shotgun defensive series such
  as repeated NaN comparator fallbacks, CE year 0–99 handling,
  placeholder/config-shape guards, or Unicode truncation refinements. Fix the
  one demonstrated canonical boundary instead.
- Coverage discovery does not authorize theoretical parser, lookup, regex,
  word-boundary, or fallback micro-fixes per occurrence.
- Missing coverage, green tests, mutation counts, and plausible edge cases are
  not accepted outcomes. Low-value PRs and reviews earn no score and may be
  penalized or excluded from reward review.
- Keep UI loading, empty, stale, invalid, and error states distinct.
- Never fabricate an empty leaderboard after ingestion failure.
- Do not leave TODOs, placeholders, dead controls, or silent fallback success.
- Keep `AGENTS.md` and `CLAUDE.md` byte-identical.

Install the lockfile and local prover before running the checks.
`lemmascript:setup` downloads and checks the pinned Dafny 4.11.0 archive on
macOS arm64 and Linux x86_64. On other platforms, install official Dafny 4.11.0
and put `dafny` on `PATH`. Run from the repository root:

```bash
bun install --frozen-lockfile
bun run lemmascript:setup
bun run projects:sync
bun run leaderboard:generate
bun run projects:check
bun run evaluations:check
bun run cycles:check
bun run typecheck
bun run lint:check
bun run format:check
bun run build
bun run test:e2e
bun run verify
```

## Definition of done

Every PR must show a useful result and its PRD references. New features
remain blocked by the scope and phase gate in CONTRIBUTING.md. For
documentation-only changes, validate links, instructions, scope consistency,
and policy mirrors; explain why application acceptance does not apply to the
prose itself. Keep required repository checks. Do not fabricate UI or
deployment evidence.

Rebase onto current `origin/development`, install the lockfile and local prover
as above, sync the project registry with `bun run projects:sync`, and prepare the ledger with
`bun run leaderboard:generate`. Do not commit the generated registry snapshot.
Local pull-request checks may use the validated public-snapshot preparation in
[Local review checks](README.md#local-review-checks) instead of live ingestion.
Stop if ledger preparation fails; never use a leftover ledger. Normal releases
collect fresh GitHub data; the explicit manual-main exception is described in
[Deployment](#deployment). Run `bun run verify`, `bun run format:check`, and real-browser E2E against the exact head.
UI changes require desktop and mobile review, keyboard and 200% zoom checks,
WCAG AA, working copy feedback, raw Markdown and archive downloads, valid
GitHub links, zero first-party request failures, and zero application console
errors.

Attach exact-head evidence to the issue or PR: screenshots, accessibility
results, console/network logs, uploaded UI walkthrough and evidence videos, detailed
test steps and expected results, generated skill archive/checksum,
live GitHub snapshot, deploy log, immutable deployment URL, deployed-byte
comparison, DNS, TLS, redirects, and security headers. Use `N/A - <reason>`
only when genuinely inapplicable. Captured evidence is not committed.

A local test is not proof of merge. A merge is not proof of deployment. A
deployment is not proof of provider, device, identity, wallet, or settlement
availability. Report each boundary precisely.

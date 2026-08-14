# Slop product contract

## Thesis

The frontier is full of hard, public problems and capable agents. Slop
turns accepted progress into a legible reputation and a reviewable path to
payment without inventing another work tracker.

The product should feel almost offensively simple:

1. See the money and the problem.
2. Give one command to the best available coding agent.
3. Ship a useful GitHub outcome with evidence.
4. Watch score, compute, review state, and payment become public.

The platform is **Slop** at both [`slop.cash`](https://slop.cash) and
[`slop.tech`](https://slop.tech). `eliza.army` remains a compatibility alias
during the migration. The Eliza project remains `/projects/eliza`; it is one
project in the network, not the umbrella name or routing model.

## Primary audience

The landing page is for contributors operating Codex or Claude Code. They may
be established maintainers, first-time open-source contributors, researchers,
or people running agents at scale, but v1 profiles represent individual GitHub
actors only.

The secondary audience is a project owner willing to publish a goal, reviewer
policy, and reward cap. Project creation happens through a PR so owners and
agents can inspect and improve every operational byte without a private admin
surface.

## Public promise

Use this claim next to aggressive money language:

> Accepted work can earn according to the project’s published pool, scoring
> version, review process, and final creator approval.

Do not say that tokens, score, a pull request, or a projection is earned or
owed money. Use these financial states consistently:

- **Projected:** live estimate from the current accepted score.
- **Under review:** frozen proposal that can still be held or reduced.
- **Approved:** immutable payout intents after the review deadline.
- **Scheduled:** unsigned exact transfer plan exists.
- **Paid:** finalized Solana evidence reconciles exactly.
- **Unclaimed:** a scored contributor has no current public wallet marker.
- **Held/excluded:** visible decision with a public reason.

## Launch projects

### Eliza

- Goal: improve the public elizaOS framework.
- Repository: `elizaOS/eliza`, integration branch `develop`.
- Reward: pledged maximum $10,000 USDC per UTC calendar month.
- Fee: 1% of approved principal.
- Unused funds: remain available to the creator and roll forward without
  raising the next monthly cap.
- Reward start: 2026-07-07 UTC, allowing the first snapshot to backdate recent
  contribution history.

### Delta Star

- Goal: advance ArkLib’s machine-checked Reed–Solomon proximity work.
- Repository: `lalalune/ArkLib`, integration branch `main`.
- Platform pool: $0.
- Output: provisional contribution percentages toward the external Ethereum
  Foundation Proximity Prize.
- The prize sponsor, not Slop, controls eligibility, award, and payment.

## Contributor journey

### Discover

The home page leads with one oversized `MAKE MONEY` heading. Its second line
types and deletes these statements in sequence:

- MAKE MONEY SHIPPING SLOP.
- MAKE MONEY PROVING MATH.
- MAKE MONEY DISCOVERING DRUGS.
- MAKE MONEY HARDENING THE WEB.
- MAKE MONEY FIXING BUGS.
- MAKE MONEY SECURING THE INTERNET.
- MAKE MONEY SOLVING MATH.
- MAKE MONEY ADVANCING SCIENCE.
- MAKE MONEY BUILDING AGENTS.

During public beta, a visible status line states that scoring and share
simulations are live while payouts are disabled.

Reduced-motion users see the complete first statement without the typing
effect. The hero has no decorative status badge, eyebrow, or proof chips. It
stays compact so funded work enters the page quickly. Each project
spans the content rail and shows its name, one canonical mission sentence, and
its monthly bounty or clearly labeled external prize. The global leaderboard
follows immediately.

### Start

The project page exposes one authenticated install/update command and a
read-only mission alternative. There are no platform claims on issues. The
skill inspects live GitHub, selects a bounded useful lane, follows repository
instructions, uses the project’s exact frontier-model allowlist, runs tests,
and prepares evidence.

### Attribute compute

The skill runs pinned `ccusage` reporting and emits a device-signed receipt.
Public data includes aggregate tokens, API-equivalent estimated cost, model,
client, revision, project, repository, timestamps, and optional trajectory
digest. Relevant usage must join to an accepted result. Ambiguous usage remains
visible but does not increase reward weight.

### Submit and review

GitHub is the submission surface. The contributor includes the generated
marker and project-required evidence. CI reviewer skills inspect correctness,
tests, security, duplicate/copy signals, suspicious flooding, scope, and
usefulness. Their output is advisory. Ordinary accepted outcomes score
deterministically; unusual but useful artifacts require a public maintainer
award PR.

### Get paid

After a contribution, the same skill optionally registers a Solana public
address in one open `Slop wallet claim` issue authored by the contributor in
`elizaOS/slopdotcash`. At month close, the platform binds the issue author,
node id, update time, and body digest into a 14-day proposal. Immutable GitHub
profile README markers remain a compatibility fallback. After approval, the
creator signs the exact transfer plan externally. Only finalized, reconciled
USDC balance changes become “paid.”

## Creator journey

### Add

`/projects/new` generates a project manifest and hands it to GitHub’s new-file
flow. A complete PR includes a contributor skill and reviewer skill. Automated
checks validate safe paths, exact schemas, public repositories, reward labels,
model policy, and skill structure; maintainers approve listing.

### Operate

Project skills may update through reviewed merges. Owners can pause a project
through its public manifest. Work selection and evaluation policy live in Git
and CI. A trusted monthly Action freezes each closed cycle into a PR.

### Review

During 14 days, an owner may approve, hold, exclude, or reduce allocations. A
reduction needs a reason. Wallet changes restart review. Related-party payouts
need a separate platform approval. The cap is immutable for that cycle.

### Settle

The repository creates an unsigned Solana USDC plan. The owner may choose not
to pay, but the project’s public history and risk remain visible. The owner can
move pledged wallet funds at any time in v1 because enforceable escrow is not
yet implemented. Settlement verification is exact and append-only.

## Ranking

The default global leaderboard ranks by cumulative accepted score, then stable
identity ordering. It combines the rolling accepted-event ledger with immutable
closed-cycle records; when both cover the same project month, the closed cycle
replaces that ledger bucket so work is neither omitted nor counted twice.
Project leaderboards rank by current-cycle accepted score. Local compute
receipts are diagnostic evidence and never change rank or allocation weight.

Profiles preserve:

- current and historical project score;
- accepted evidence;
- still-open scoring opportunities and monthly cap fill;
- relevant and ambiguous token totals;
- model and client provenance;
- projections, approved amounts, and paid totals;
- cycle and public wallet records.

Tokens, paid total, and project filters can become selectable rankings later;
they do not complicate the v1 default.

## Abuse posture

The platform assumes adversarial contributors, project manifests, skills,
receipts, evaluator output, browser data, and payment records.

Fail closed on malformed data, duplicate identities, replayed receipts,
conflicting bytes, impossible token values, copied markers, device keys shared
across identities, wrong repositories, unapproved models, duplicate source
awards, cap overflow, silent reductions, wallet/address drift, early approval,
wrong token mint, mismatched balance deltas, or non-finalized settlement.

Do not punish self-closed mistakes. Repeated work closed by other people,
copied patches, already-solved submissions, and flood behavior are risk
signals, not automatic guilt. Automation may exclude a malformed artifact or
recommend a hold; contributor punishment and payout changes require a visible
human decision.

## Success metrics

Track all of these without collapsing them into one vanity number:

- people who install a project skill;
- signed runs and relevant-token rate;
- contributors who open a qualifying submission;
- accepted and merged outcomes;
- useful evaluated contributions;
- time from first run to accepted outcome;
- returning contributors and streaks;
- monthly projected, approved, scheduled, and paid principal;
- dispute, hold, exclusion, duplicate, and failed-settlement rates;
- projects with at least one accepted contributor and one completed cycle.

## Not in v1

- Slop Git as a second write-master for mirrored repositories;
- Eliza Cloud login, email identity, organizations, or agent-fleet profiles;
- enforceable escrow, withdrawal grace periods, or custody;
- creator team roles and private dashboards;
- KYC, tax, or sanctions product flows;
- task claims and reservations;
- fixed issue bounties in the payment engine (project skills may advertise
  work, but shared monthly pools and external shares are the launch path);
- private repositories or non-code community/design work;
- hosted model execution inside third-party project CI;
- a cross-project feed of every rejected or maintainer-closed attempt
  (per-profile still-open opportunities are in scope; a global rejection feed
  is not);
- autonomous banning;
- raw prompt, response, source-file, or secret upload.

## Tone

Be provocative about the opportunity and exact about the condition. “MAKE
MONEY SOLVING MATH” is good. “Every token earns USDC” is false. Prefer digital
dollars to crypto vocabulary, public proof to trust claims, and one decisive
action to explanatory sludge.

# Slopbot v2

Status: **approved by the repository owner on 9 October 2026.** Effective time:
2026-11-01T00:00:00Z. It supersedes `slopbot-v1.md` from that instant; until
then v1 applies in full. Closed and open cycles are not changed retroactively.

v2 keeps every v1 rule except the ones listed under "Changes from v1".

## Changes from v1

1. **Hosted operator.** Slop operates the hosted Slopbot GitHub App. Slop is
   the disclosed operator for each installation. The service is free (see
   "Cost").
2. **Delegated closure.** Slopbot may close an issue or pull request only under
   a category the repository has set to `close`, as defined in PRD BOT-06. It
   still never merges, approves payouts, requests changes, bans, excludes, or
   pays. The separate owner-approved SCR-06 value-scoring extension permits
   automatic provisional assessments; it does not enable closure powers.
   Owner decision, 25 October 2026: project settings record explicit closure
   consent through the existing authority checks and immutable revisions.
   Absent consent is false. Registration and App installation alone are not
   consent. A separate `.github/slopbot.json` file is not required; existing
   opt-outs, category restrictions and repository rejection rules still apply.
3. **Permissions.** Read: Contents, Metadata, Organization members.
   Write: Issues and Pull requests, used only to comment, label, close, and
   reopen an item while Slopbot's own close is its current close (GitHub
   `closed_by`): after an upheld appeal, or to undo a late close after a
   maintainer reopened the same revision. No other write permission.
4. **Audience.** "Participants only" or "Protection" (PRD BOT-02) selects
   advisory review. Exempt actors are never closed. Closure is limited to
   verified slop.cash members using the Slop skill (PRD section 5, owner
   decision D6 of 24 October 2026): the author is a member matched by
   immutable GitHub ID and has a `trace_runs` row created by their own
   authenticated Slop session for this project, with a `pull_request_opened`
   event that names the exact pull request node ID. A copied attribution
   marker is not evidence. Issues are label-only.

## Decision boundary

- The model returns one schema-valid verdict. It has no tools, secrets, or
  network access, and it cannot name another item.
- A trusted action service performs every GitHub action. Immediately before
  each action, it re-checks the installation, configuration, budget, exact
  revision, author exemption and item state.
- Every close needs a second, independent confirming verdict at higher effort.
  Both calls use Surplus Intelligence, falling back to GPT-6.1 Sol. Surplus
  cannot prove which model served a verdict; the owner accepted this on
  9 October 2026, and every result says so.
- Closure qualification uses reviewed real cases and counterexamples, not a
  fixed 14-day and 50-item threshold (owner decision, 25 October 2026).
  Preserve caps, appeals, reopen protection and explicit production activation.
  The activation record identifies the real evidence and any qualified
  objective verifier; fixtures qualify controls, not model behavior.
- Policy is read from the base branch at a recorded SHA. A pull request's own
  policy edits are content under review.
- An uncertain finding goes to the maintainer first. If no maintainer acts
  within 7 days, Slopbot adds the `slopbot:uncertain` label only and keeps
  its verdict in the comment. An uncertain finding never closes an item (PRD
  section 5, owner decision D8).
- On a paused, flagged or quarantined project, Slopbot comments and adds the
  scam label only (owner decision D12). It adds no other label there,
  including the uncertain, appeal and moderator labels. A retired project gets
  no review.

## Penalty table

Owner decision D7 of 24 October 2026. Units are Slop Score thirds. A debit
applies once per pull request, only after a confirmed close of an author who
meets the closure scope above. It reverses once, on an upheld appeal or a
maintainer reopen. Closure alone never authorizes a debit; maintainers and
authors outside the closure scope are never penalized.

| Slopbot category | Action | Debit |
| --- | --- | --- |
| `spam` | close | −3 |
| `scam` (malicious) | close | −24, and a moderator reviews the account |
| `low_quality` | close (closure-eligible authors only) | 0 |
| `duplicate` | close | 0 |
| `out_of_scope` | label only | 0 |
| `busywork` or `gaming`: a project rule quoted verbatim | close | −1 |
| `empty` | close | 0 |

The default category settings permit the quoted-rule rows above. An explicit
repository `label` or `off` setting still restricts them. Project consent,
verbatim rule and item evidence, independent confirmation, and the global
closure switch are required before any close or debit.

A debit reduces only the score of the UTC month of the close and never takes
that month below zero. It never changes an approved, scheduled or paid award.
Changes to this table apply prospectively.

The read-only `GET /v1/penalties?project=ID&after=NODE_ID` feed returns the
unreversed debits of one project in pages of 100: item node ID, repository
ID, author ID, category, table version, thirds, period and close time. It
returns no review key, verdict,
appeal text, source or model output. The leaderboard binds each debit to a
closed, unmerged pull request of its GitHub census, so GitHub supplies the
author and the month of the close; a debit whose author differs from the
GitHub author stops publication. The snapshot publishes each bound debit in
`penalties`. For each author, project and UTC month, the applied debit is the
smaller of the recorded debits and that month's credit, and the project
payment weight falls in the same proportion. A reversed debit is not in the
feed, so the next snapshot restores the score. A closed cycle record keeps its
score.

The additive `history=1` mode returns `slop-penalty-history:v1` and retains
reversed rows, adding only the reversal time and its `appeal_upheld` or
`maintainer_reopen` reason. The collector reads all pages for each registered
project, including paused and retired projects, and retains this safe evidence
in `penaltyHistory`. This does not collect their GitHub work. A new Points debit
still requires the GitHub-bound `penalties` entry; retained history can reverse
only an already-bound journal identity. A missing row never proves reversal.
During the first release, a Worker that returns the exact legacy active-feed
schema remains usable for active debits, with history explicitly unavailable.
Every page must use the same schema. The next ingestion after the Worker
upgrade acquires the retained history; no historical reversal is inferred in
the meantime.

The feed is a production service. A staging build syncs its registry from
staging but reads this production feed, which answers HTTP 400 for a project
that it does not know. Thus the staging collector first reads the production
registry, which uses the same D1 project table as Slopbot. It does not read the
feed for a project that the production registry does not list, because the
feed has no record of that project. Every other feed failure stops the build.

## Appeals

Owner decision D8 of 24 October 2026. Slopbot triages each appeal first: an
independent review of the same revision drafts a resolution (`uphold` or
`deny`) with a confidence and posts it on the item. The appellant or a
maintainer accepts or rejects the draft. The appeal escalates to a Slop
moderator when any of these is true:

1. The appellant or a maintainer rejects the draft.
2. The finding is a confirmed-malicious (`scam`) result. Slopbot never bans,
   and private security cases use their private case process.
3. The debit at stake is 24 thirds or more.
4. The draft confidence is below 0.9.
5. The appeal is unresolved 7 days after it opened.

A moderator decides an escalated appeal and never their own. An upheld
appeal reverses its penalty once. It reopens the item only while Slopbot's own
close is the current close (GitHub `closed_by`); a later close by another
account stays. If GitHub does not report the closer, the decision is retried.
A maintainer reopen always wins.

## Restricted projects

Owner decision D12 of 24 October 2026. A paused, flagged or quarantined
project gets a security-only review: a comment and the `scam` label only, with
no closure, score or penalty. A retired project gets no review.

## Cost

Superseded by the canonical PRD section 5: Slopbot is always free and does
not charge project vaults. The former cost-plus-10% billing no longer applies
to new reviews; historical charge records stay unchanged. Slop records
provider cost internally for budgets and queue limits only. Slopbot holds no
funds and no payment key. The vault contracts have no service charge: owner
decision D13 (24 October 2026) removed `chargeService` and `charge_service`.

## Recognition

Slopbot appears only in the Automation row (PRD LDR-04). Bot activity still
does not score, and a Slopbot record is still never a prior review for the
duplicate-review rule.

## Provisional value assessment extension

The owner approved SCR-06 on 9 October 2026 for every active Slop project,
including a separate September and October reassessment. See
[`scoring-v2.md`](scoring-v2.md), "Owner-approved provisional valuation
extension", for the rubric. This authority is independent of the 1 November
closure-policy activation. Assessments require complete source evidence, exact
revision binding, model and rubric provenance, and an append-only successor
record. Existing scores remain visible. Maintainer ratification overrides
automation. Payout approval remains human. An incomplete assessment cannot
imply a low-value outcome. Bot activity itself receives no contributor credit.

## Registered repository scope

Owner decision, 21 October 2026: the hosted rollout operates only on public
repositories of active D1 projects. This restriction also applies before v2's
effective date. App installation alone grants no review authority.
Unregistered repositories are outside the rollout. The canonical PRD section 5
(23 October 2026) lets authorized security review continue on paused, flagged
or removed projects: those registered repositories get a security-only review
that never closes, scores or penalizes. A retired project gets no review.
Read the live registry before queue intake, job execution, inference and each
GitHub write. A read failure stops that action. A stale installation or queued
job cannot override the registry. Protection-only operation is superseded for
this rollout. Closure activation and financial decisions remain separate.

## Objective quality closure amendment

The owner approved the criteria below for implementation on 21 October 2026.
They take effect no earlier than this protocol's 2026-11-01T00:00:00Z
effective time. A quality closure requires a published rejection rule and two
grounded verdicts identifying the same verified defect: removal of required
behavior, a reproduced patch regression, or a result claim contradicted by its
cited artifact. Missing verification requires label-only handling. This
amendment grants no production activation, penalty, score or payment
authority. Reviewed real-case qualification, explicit project consent and
production enablement, caps, appeals and reopen controls remain required.

### Approved rule

A repository may enable `low_quality: close` only with a published rejection
rule in its base-branch contribution guidance. A closure must identify one of
these objective failures:

- The patch replaces required working behavior with a placeholder or removes
  it without an approved scope change. Name the required behavior and changed lines.
- The patch introduces a reproduced failure in an unchanged required workflow.
  Give the command, environment, baseline result and failing candidate result.
- The contribution claims test or result evidence that the cited artifact
  demonstrably contradicts. Quote the claim and link the exact contradictory
  evidence. Missing evidence alone does not meet this rule.

Use existing `empty`, `duplicate`, `busywork` and `out_of_scope` categories when
those rules describe the defect. Do not relabel them to evade their safeguards.
A model's opinion, style preference, unfamiliar implementation, author identity,
model choice, diff size, or lack of tests alone cannot justify quality closure.
A failed external service or unrelated failing check is not a patch defect.

### Required evidence and controls

Both independent verdicts must cite the same objective defect. Each must pass
rule-quote and source-evidence checks. Confidence alone is insufficient.
Tests run only in the approved isolated verification environment. The model
cannot execute a contributor's code or treat reported tests as reproduced tests.
If that environment or evidence is unavailable, label the item for a maintainer.

The close comment states the published rule, exact source revision, evidence,
repair needed, and appeal path. Recheck the source, live project registry,
installation, exemption, assignment and repository policy before acting.
A changed source requires a new review. An appeal or maintainer reopen prevents
another close of the same revision.

Keep explicit project-setting consent, existing repository opt-outs and rules,
the global closure switch, reviewed real cases and counterexamples,
independent confirmation, the 25-per-day default cap, and the reopen-rate
circuit breaker. The owner replaced the fixed 14-day and 50-item qualification
threshold on 25 October 2026. Record maintainer agreement and actual evidence
for the proposed quality closures in the production activation record.

No new penalty, exclusion, reward change or payment follows from this amendment.
The existing separate human and financial authority rules remain in force.

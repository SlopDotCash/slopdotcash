# Specification migration verification

The branch starts at root commit `8cd5b6b2c402ea3fa3157e6e927acf03a28fe8e1`.
It has no parent from the prior Slop application or the Vibestack template.
The template, requirement and legacy-model revisions are pinned in
[source-manifest.json](source-manifest.json).

The requested `develop` source resolves to Slop's `development` branch.
The retained PRD bytes match that pinned source and the pinned main revision.
The user confirmed that new-project automatic closure starts unchecked.

On 14 November, the PRD blob also matched the fetched `development` tip
`85e831856386d212f8e321897eb48d898b254e9e`. The `main` tip had advanced to
`8d14a9692b998ee3f4479725b6323125f11f11be` with three added and three changed
model files. The model inventory and its legacy test results apply to the
pinned migration snapshot. All six later files also passed direct Quint
typechecking and seeded named tests. [Later main changes](validation/main-model-delta.json)

## Rules added

The specification tree defines account and browser ownership, project setup
and revisions, contributor installation and work, Points, security admission,
private cases, notifications, releases, settlement and fee handling. Each
formal rule is catalogued in [spec-catalog.json](spec-catalog.json).
The active tree contains 71 documents, 90 story groups and 296 rule groups.
The initial full-tree run covered 64 of those documents. The later additions
have their own source-bound checks below.
The retained source maps cover all 63 PRD sections and all 473 original models.

The frontend owns request identity, stale and unavailable reads, private draft
recovery, route access and public projections. Backend models own account and
wallet identity, consent, current project authority and immutable history.
Contributor models own complete-tree installation, atomic activation,
rollback, live selection, attribution and optional evidence.

Points models own accepted authorship, largest remainder, useful review credit,
append-only corrections, source coverage and monthly penalties. Security
models own complete admission, retained evidence, repository-scoped exemptions,
flags, human decisions, private intake, disclosure and receipt-time terms.
Operations own notices, consent, delivery, backups, local identity and releases.

Financial models own full-width amounts, reservations, monthly allocations,
exact payment evidence, recovery, scoped signers, fee conversion and buyback.
Composed models bind browser account ownership, registry/security eligibility,
and atomic vault/payment settlement.

## Rules discovered during verification

The proof and review passes exposed missing facts or incomplete transitions.
Their owning specs include the corresponding explanations and rules.

- A reviewed draft must already have its account, project and content identity
  before it can become a submitted draft.
- Admission counters start empty before acquisition, and permanent evidence
  must remain retained.
- An unsigned wallet-binding state cannot contain a prior signed attempt.
- Active installer stages require a selected version. Activation requires
  retained canonical bytes, approved rendering and current clearance.
- A retired project cannot finish an outstanding publication and become active.
- A second eligible flag requires a moderator notice as well as the pause.
- An open appeal retains a prior finding other than the temporary disputed state.
- Source census pages must be unique and within the expected page range.
- An active trace upload already has consent, inspected content and upload
  authorization before persistence can succeed.
- A frozen monthly proposal retains its allocations, and phases before reserve
  creation cannot contain paid recipients.
- A contributor allocation's first wallet-confirmation time remains valid
  before and after replacement.
- An unreceived fee state cannot carry spent funds, and signed conversion
  attempts retain their native hold and committed value budget.
- A wrong-total release retains its initial balances and prior-settlement
  history, so it cannot release a substituted amount.
- Buyback journal entries are positive and no later than the observed clock;
  future entries cannot silently enter a later rolling window.
- Referral receipt entries compare ordered actor and wallet identities and
  monetary values. Structural limb-array equality refused numerically equal
  amounts with trailing zero limbs. The corrected rule accepts that padding and
  rejects different amounts, wallets, order and entry counts.
- Referral publication settles gas against the exact unresolved journal entry
  and its reserved amount. Its settlement day must fall between the journal day
  and the current UTC day. Filed and prepared entries require a nonempty pinned
  wallet so a later pin cannot change the meaning of an old entry.

## Rules reconciled with the source

The migration preserves existing policy while making the state boundaries
explicit. Related-party and appeal decisions retain independent reviewers and
upheld or returned outcomes. Scope-only Slopbot findings remain label-only.
Exemptions apply to exact repositories and do not flow into appended repositories.
Current maintainers can act after ownership transfer while the original
applicant remains in history.

Financial reconciliation checks the exact source, asset, obligation, recipient,
fee recipient, principal, fee and finality. Full-award cases require their own
qualified rail. Concurrent reservations remain distinct. Empty months create
no obligations, and paused projects are excluded. Frozen rewards remain stable
while later valid Points decisions enter the journal.

New-project closure defaults to unchecked under the user's explicit migration
decision. The pinned source PRD remains unchanged for provenance.

The final coverage review added Featured and Community placement tied to the
exact authoritative project revision, full-width public payment amounts, the
approved homepage and setup presentation, and the production-only first-party
beacon policy. Referral accrual now retains immutable attribution, complete
ordered monthly filings, historical rates and multi-project cumulative caps.
Root publication preserves walletless accruals, pinned wallets, uncertain gas
holds, immediate claims and void/seal history. Poster operational pause and
the distributor's separate on-chain pause have distinct meanings. A stale
claim cache exposes an explicit unknown state.
The pinned referral source additionally requires lifetime wallet pins, exact
integer token base units per stablecoin micro-unit, canonical payout ordering
and calendar-anniversary eligibility with month-end clamping. Its distributor
owns zero-based epochs, funding and spacing checks, role rotation, exact claim
transfers and the rescue delay. The publication model binds its own record IDs
to the separate contract epoch and Merkle digest.

The account and wallet review compared the pinned source and legacy transitions
with the new models. Each session has its own expiry and can end independently.
Closing an account with typed confirmation ends all sessions, disconnects X,
withdraws email consent and cancels pending verification. Permanent X reservations,
wallet authorizations and financial history survive. A new session after
reopening starts with X disconnected. The separate sign-in visibility transition
leaves email consent intact.

Wallet registration retains immutable successors and distinguishes the current
registry claim from the last authorized payout destination. The challenge binds
the exact claim, message and wallet. A single request consumes it, and the
authorization transaction checks the claim again after consumption. The model
includes expiry, a concurrent winner, a failed write and retry after a lost
response. On-chain binding and reconciliation remain in the signer model.

## Proofs and checks

The toolchain uses Node 26.13.1, Quint 0.33.1 and Dafny 4.11.0. Exact commands,
source hashes, finite budgets, outcomes and retained logs are recorded in the
following files.

- [Legacy verification](legacy-validation.json) records successful typechecking
  and seeded named-test runs for all 473 original models. Those runs reported 4,160 passing named tests.
- [Root and journey proofs](root-proofs.json) and
  [journey verification](journey-verification.json) record the active browser,
  account, contributor and Points results.
- [Coverage verification](coverage-verification.json) records the final
  listing, full-width payment projection and presentation checks.
- [Security verification](security-verification.json) records admission,
  private-case, Slopbot and operations results.
- [Financial verification](financial-verification.json) records exact arithmetic,
  composed journeys and financial proof results. The independent BigInt
  differential check covered 11,027 comparisons, including 256-bit values.

Handwritten proof files sit beside their owning specifications. They supply
induction or set-membership reasoning through the checked Vibestack proof
pipeline. Source code, generated core, cache and acceptance files remain
separate. No proof exception has been accepted for this migration.

The focused reports count proved obligations once per current source unit.
The browser, backend, contributor and Points units have 967 proved obligations.
The security, Slopbot and operations units have 741. The account and email
models account for 233 of the first total. Their directed journeys
cover current-session sign-out, targeted revocation, exact expiry, closure
and reopening, and sign-in consent preservation. The wallet journeys covered
69 events across seven cases, and all 90 wallet obligations proved after
adding lemmas for predecessor ordering and unique consumption and authorization.
[Wallet proof results](validation/journeys/wallet-registration-helper-proofs.json)

The repaired referral journeys covered 182
events across 36 cases, reaching all 40 transitions and 11 goals. Two random
seeds also reached every transition and goal in the amended referral units,
including settlement after UTC-day rollover.

The money proof now verifies multiplication by one for arbitrary-width
amounts. Four laws remain open for division and fee conservation. The
financial report lists those laws and the dependent obligations.
[Money proof results](validation/finance/multiply-one-verified/verification.json)

The completed model and simulation stages checked all 64 baseline documents.
The 54 executable units passed invariant simulation, with 200 reachability and
guard results and 23,556 generated TypeScript replays. Replay covers the
sampled traces and definitions with available standalone inputs. The report
lists the definitions without standalone comparison.
[Full-tree simulation and replay](validation/full-tree/model-simulation-replay.json)

The assembled 71-document tree generated successfully and passed both VibeLang
typechecks. Baseline and focused results together replayed 23,809 traces across
all 61 current executable models. The integrated report lists the inputs
carried forward and the focused substitutions. The template tool suite passed
34 tests and the greeting app passed three. The greeting's conformance driver
also passed a directed journey, five malformed-input cases and 1,000 walks. The scratch checkout initially
lacked its design-package dependency link. After restoring the installed
link, the full rerun passed.
[Integrated generation and test results](validation/full-tree/integrated-generation.json)

The proof stage took its input after the verified wallet and money helpers
were installed. The two phase manifests bind the model and proof inputs to
those separate observation times. The baseline stage predates the later
model refinements. The retained checkpoint captured 61 of 65 proof units with
2,284 discharged obligations and 64 open obligations. Four units had no
completed cached result at that checkpoint. A separate exact-source buyback
proof reached Vibestack's 60-minute tool timeout during isolated assertion
checking and produced no unit verdict. The baseline reserve result is
superseded by the signed-attempt correction below.
[Buyback proof attempt](validation/finance/buyback-proof.json)
[Proof stage inputs](validation/full-tree/proof-stage-inputs.json) · [Template inputs](validation/full-tree/template-inputs.json) · [Proof checkpoint](validation/full-tree/proof-checkpoint.json)

## Additional source refinements

The later-main review made journal publication and historical corrections
explicit. Publication requires a canonical exact prefix and checks the current
public revision at commit. Corrections recheck the current predecessor and
protected financial history in the canonical append and treat an applied
manifest as replay after revocation. Targeted Quint simulation and TypeScript
replay reached all nine goals, and nine directed assertions passed. The
publication proof establishes all 37 obligations, including exact-prefix
transitivity across canonical and public state changes. Historical corrections
proved 15 of 18 obligations, including all transition rules. The three open
laws concern concrete protection-race, aggregate-weight and replay witnesses.
The attempted proof did not close their shared filter lemma. The directed
checks passed all three.
[Points evidence](validation/points/targeted.json) · [Publication proof](validation/points/publication-proof.json) · [Correction proof results](validation/points/baseline-proof.json)

The local Solana stages require a fresh owned validator receipt for each
shell stage and a confirmed local funding result before tests. The command
supervisor distinguishes interruption, the grace period, same-group escalation
and cleanup confirmation. The caller retains the first failure and waits for
owned validator stop before removing its acceptance ledger. The proof pass
identified two missing constraints. Interruption preserves a prior nonzero
status and stage progress stays within the current stage. All 76 obligations
proved after these changes. Three named Quint witnesses and 65 generated-core
events across five journeys passed in the focused checks.
[Local validator proofs](validation/journeys/local-validator-proof.json) · [Quint witnesses](validation/journeys/local-validator-witness.qnt) · [Generated-core journeys](validation/journeys/local-validator-stages.json)

Keeper reconciliation requires an exact chain preflight for the selected
endpoint, revision and deployment before any work. Receipt processing records
whether it failed during scanning, evidence verification or indexing.
Operational summaries contain fixed labels and aggregated counts, and healthy
or waiting work stays silent. These models preserve the keeper's identity,
budget and journal across RPC changes. All 40 keeper obligations proved. The
focused checks passed 210 simulation replays and 24 directed cases.
[Keeper rules](../spec/settlement/keeperScan.md) · [Keeper evidence](validation/journeys/keeper-delta-final.json)

A signed reserve release keeps the reviewed amount, request and attempt
identity across new chain observations and owner rotation. An exact finalized
failure retires the attempt for a fresh review, while an unfinalized or
mismatched result keeps it pending. A later competing finalized settlement
blocks release. The five named Quint journeys, 70 generated-core events and
100 seeded TypeScript replays passed on the repaired model. The adapter must
supply authenticated evidence for the retained deployment. An owner rotation
that changes the current deployment can make the pinned route refuse that
read, so deployment-changing rotations need shell conformance. The exact
reserve proof run with the signed-identity fold lemma discharged 139 of 146
obligations. The seven open clauses cover monetary equivalence, conservation
and dependent step preservation. Dafny reported zero tool errors or exhaustion
for that run.
[Reserve release evidence](validation/finance/reserve-release-signed-handoff.md)

Private-award destination recovery now requires a retired request to retain
renewed consent and exact retirement evidence before publishing a successor.
The proof pass found the missing reachable-state fact and a parameter that
shadowed its generated Dafny function. The repaired model proved all 20
obligations, replayed 200 traces and passed 11 directed events.
[Destination recovery evidence](validation/finance/recovery-current.json)

Slopbot measures the seven-day window from the first durably recorded
maintainer notice. An exact current review and timeline are required before
a label. A confirmed maintainer action, superseded source, upheld appeal or
verified reopen resolves the hold. Restricted projects can receive the
approved security comment and confirmed scam label. The new model passed 46
directed cases, including late or missing notice evidence, changed source,
pre-window and exact-deadline labeling, and the label-removal race.
[Slopbot closure witnesses](validation/journeys/closure-directed.json)

## Guard diagnostics

The simulation report may list guards it did not observe refusing an event.
`canChangeDestination` and `canObserveAvailability` deliberately accept an
observation in every state; their trusted adapters own sender and evidence
validation. `canAuthenticate` and draft `canOpen` require positive authenticated
identities. Release `canConfigure` requires Candidate and
`canObserveBranchHead` requires a positive source identity. The baseline
closure guard diagnostics predate the exact-source and maintainer-hold model.
The focused closure report covers those current inputs.
[Baseline diagnostics](validation/full-tree/model-simulation-replay.json)

## Acceptance boundaries

[requirements.json](requirements.json) retains and maps every PRD section.
[model-map.json](model-map.json) retains each original model's source entries,
state declarations, actions and named scenarios, with candidate successor specs.
This inventory establishes traceability. Per-transition equivalence of every
legacy model to its successor remains a separate review obligation.

This branch contains the template and specification work. Application
entry-point conformance, real provider and agent-client runs, database races,
browser acceptance, chain qualification and deployment evidence follow the
implementation phase. Their required outcomes are recorded in
[the migration acceptance contract](../docs/migration.md#implementation-acceptance-contract).

The user's specification review and `pnpm accept` remain outstanding.
The template acceptance ledger has not accepted the new product rules.
PRD STATE-01 through STATE-05 remain open wherever required equivalence or
implementation evidence is pending.

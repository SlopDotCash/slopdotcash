# Specification migration verification

The branch starts at root commit `8cd5b6b2c402ea3fa3157e6e927acf03a28fe8e1`.
It has no parent from the prior Slop application or the Vibestack template.
The template, requirement and legacy-model revisions are pinned in
[source-manifest.json](source-manifest.json).

The requested `develop` source resolves to Slop's `development` branch.
The retained PRD bytes match that pinned source and the pinned main revision.
The user confirmed that new-project automatic closure starts unchecked.

## Rules added

The specification tree defines account and browser ownership, project setup
and revisions, contributor installation and work, Points, security admission,
private cases, notifications, releases, settlement and fee handling. Each
formal rule is catalogued in [spec-catalog.json](spec-catalog.json).
The current tree contains 64 documents, 81 story groups and 270 rule groups.
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
  monetary values. Structural limb-array equality incorrectly refused a
  numerically equal amount with trailing zero limbs; the corrected rule
  still rejects different amounts, wallets, order and entry counts.

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

The current focused reports establish 763 obligations for the browser,
account, project, contributor and Points units, and 741 unique obligations
for security, Slopbot and operations. Historical repeated runs are excluded
from those totals. The financial signer has 19 proved obligations. General
full-width arithmetic, allocation and dependent financial invariants retain
the exact unresolved obligations listed in their report.

The full-tree `pnpm check` passed model parsing, typechecking, invariant
simulation, reachability and generated TypeScript replay for the reviewed
snapshot. Its proof stage is still running while these records are being
assembled. General full-width arithmetic and dependent financial invariants
remain unproved in the completed isolated attempts. The exact obligations and
attempts remain in the financial verification record. A prior passing snapshot
does not certify a later changed model.

## Guard diagnostics

The simulation report may list guards it did not observe refusing an event.
`canChangeDestination` and `canObserveAvailability` deliberately accept an
observation in every state; their trusted adapters own sender and evidence
validation. `canAuthenticate` and draft `canOpen` require positive authenticated
identities. Release `canConfigure` requires Candidate and
`canObserveBranchHead` requires a positive source identity. Closure's
`canRecordParticipant`, `canRecordQualification`, `canRecordActivation` and
`canRecordVerdict` refuse changes after closure. Their missing negative samples
are finite-coverage diagnostics, not evidence that these restrictions were
removed. The final full-tree log retains the actual diagnostic list.

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

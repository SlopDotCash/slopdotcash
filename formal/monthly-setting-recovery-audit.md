# Monthly-setting transaction evidence

This source-only follow-up starts at `120c7a22a121`. The user directed the team
to skip checks and focus on pushing. No typechecker, test, browser, simulation
or prover was run for this change. The model is authored but unverified. There
is no new runtime reproduction, screenshot or walkthrough for this revision.

## Source-confirmed path

`AutomaticMonthlyPayment.tsx` used `pending.hash` both for a wallet-returned
transaction identifier and for a value entered into the recovery input. Its
`check()` selected `pending.hash ?? recoveryHash`, then wrote the selected value
into `pending.hash` after the checker returned. Rendering hid the recovery
input once that hash produced an explorer link. Reload restored the same
non-null value, so there was no way to correct it within that pending request.

The missing-receipt branch is explicit in
`readFinalizedWalletTransaction` in `src/lib/evm-vault-actions.ts`: after wallet
account/network and hash-syntax checks, a null receipt returns `pending`.
`checkEvmMonthlySetting` forwards that result. The Solana helper also accepts
only `pending`, `failed` or `finalized`. Therefore a syntactically valid entered
identifier that receives `pending` can reach the hidden-input state. This is
source-path evidence, not a newly executed wallet or browser reproduction.

## Correction and preserved boundaries

The component now uses the existing `VaultActions.tsx` provenance convention:

- New identifiers returned by the wallet are marked `hashSource: "wallet"`
  and remain fixed.
- User-entered identifiers are marked `hashSource: "recovery"`. Pending
  verification retains the input and restores its value after reload.
- Legacy records without provenance remain editable. They cannot safely be
  assumed to contain a wallet-returned identifier.
- An invalid provenance marker, or a marker without a hash, takes the existing
  unreadable-record path. Storage failure keeps the pending request in memory
  and displays the identifier that the user must retain.

The storage key, wallet owner checks, reviewed cap/enabled target, Solana
blockhash, EVM calldata/event checks and finality helpers are unchanged. An
entered candidate is not labeled as a submitted wallet transaction. It does
not clear the pending request or enable a second automatic send. A verified
failed transaction and a verified successful setting both resolve the pending
request; only the latter reports that the setting changed.

The existing explicit user assertion, "Wallet confirms nothing was sent",
remains available when there is no retained hash. This is not chain proof and
can allow another request. The component still has no cross-tab mutex; neither
this change nor its model claims unconditional duplicate-send exclusion.

## Model and source review limits

`ui_monthly_setting_recovery.qnt` replaces the generic transaction abstraction
for this particular evidence-selection boundary. It has one pending monthly
setting request, one matching wallet and four identifier classes: empty,
nonexistent, matching and finalized mismatch. Named scenarios cover candidate
correction after reload, fixed wallet identifiers, legacy recovery, pending
storage failure, failed clearing, transient verification failure and explicit
user reset. Its bounded second send requires either resolved evidence or that
user assertion. A resolved setting is not a contributor payment.

A source-only peer review corrected the model's absent-storage projection:
after the application removes the key, stale model fields must not resurrect
an invalid record on reload. Reload now reads hash, provenance, draft and error
only from a present record. The same review covered verified completion,
confirmed-unsent clearing and failed unreadable-record clearing. Four named
clear/reload scenarios supplement the original ten; none were executed.

The model treats account/network/intent/finality validation as predicates
supplied by the unchanged adapters. It does not prove cryptography, arbitrary
storage failures, wallet extensions, React scheduling or backend refinement.
All model execution remains pending because of the instruction to skip checks.
Existing EVM and Solana wallet workflow files are linked as conformance
references; their earlier results do not certify this new source revision.

The same source-only pass inspected the payment-child call sites in
`SecurityBounty.tsx`, `DirectBountyPayment.tsx`, `SolanaBountyPayment.tsx`,
`BountySubmittedPayments.tsx`, plus monthly award/release call sites. Direct
EVM children are keyed by case and generation; Solana children also include the
message ID. Their fresh preflight compares the current request before signing,
and their storage records bind actor and generation. This pass did not prove
their complete parent/child composition. In particular, fallback submitted
payment recovery has asynchronous actor/storage loading not represented by
the generic `ui_transaction` model. That remains a model gap, not a demonstrated
authorization bypass or runtime defect.

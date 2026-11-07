# Frontend and shared-domain LemmaScript research

Reviewed on 7 November 2026 against `origin/development` at
`e3d7dea64f1171f5761033069b98de4fd5cc1e77`. The application on that branch is
the implementation target. The older dirty checkout is a different product
revision; its research and edits were not copied into this implementation.

## Recommendation

Prove the small policy and arithmetic functions that the real application
imports. Keep React effects, network requests, browser storage, URL parsing,
regular expressions, signatures and chain observations as explicit boundaries.
Quint covers state transitions; browser and integration tests establish real
entry-point behavior. LemmaScript covers source-level pure computations under
documented input contracts. None alone establishes complete application
correctness.

The reviewed surface has 59 top-level TSX components and 144 files under
`src/lib` at this revision, including declaration and generated files. The
candidate table below covers the major pure domain families and all UI journey
families. These file counts are an inventory, not a verification percentage.

The official [existing-code guide](https://docs.lemmascript.org/getting-started/),
[supported subset](https://docs.lemmascript.org/subset/) and
[implementation specification](https://github.com/midspiral/LemmaScript/blob/main/SPEC.md)
were reviewed. Actual checked syntax is determined by the pinned toolchain.
BigInt is the closest semantic match for monetary arithmetic. `number` is
modeled mathematically, without IEEE 754 rounding, NaN or Infinity. True
`await`, React, Web APIs and cryptographic primitives are not proved by these
contracts. An assumed external contract would move the trust boundary, not
prove the dependency. No external axioms are used for the integrated kernels.

## Ranked candidates

| Priority | Actual source / function | Useful contract and integration decision |
| --- | --- | --- |
| P0 | `payments/contracts.ts`: ordinary fee; `project-view.ts`, `funding-review-data.ts`, `scoring-policy.ts`: weighted allocation | Exact fee rounding and weighted quotient/remainder; floor quota; no loss or creation of units. Shared-money integration owns these. Full collection conservation also requires list lengths, unique IDs, total weights and residual distribution. |
| P0 | `contributor-allocation.ts`: `contributorAllocationState` | Sent takes precedence over closure; closure prevents rescheduling; only a registered authorized wallet may schedule; missing wallet becomes unclaimed at deadline. Implemented through `allocationDisposition`. |
| P0 | `use-public-resource.ts`: `isTransientFailure` | A 401/403 must drop the retained record and controls; status 0 or server failure permits retained data with visible error. Implemented status decision through `transientHttpStatus`; error classification and React cleanup remain runtime boundaries. |
| P0 | `intake-drafts.ts`: `needsDraft`, `pruneDrafts` | Never retain another origin's submission or an already recorded advisory; terminal failures are not retried; keep uncertain sends until reconciled. Implemented pure eligibility through `draftStillNeeded`; session storage deletion and account ownership still need browser/API evidence. |
| P0 | `payments/monthly-allocation.ts`: `assertAllocationChange`, `buildExecutionSnapshot` | Reject self-changes and excluded positive awards; sum replacements without exceeding cap; frozen rows preserve gross = net + fee; no payout is created by a score alone. BigInt kernels fit; full record and sequence proof is separate. |
| P0 | `score-penalties.ts`: `penaltyDeductions`; `score-records.ts` | Debit never exceeds available score in the same actor/project/month; repeated/reversed records preserve policy; never alter frozen awards. Requires maps, identity keys, deterministic ordering and safe numeric input bounds. |
| P1 | `funding-reminders.ts`: `cycleSettlementReminder` | Suppress reminders for external, settled, paid, wound-up and no-award records; do not imply verified funding. Implemented eligibility through `fundingReminderVisible`; zero-cap guard and message remain existing code. |
| P1 | `identity-flow.ts`: `requestIdentityAssertion` | Poll no later than the remaining expiry; retain bounded server interval; reject invalid authorizations; no wrong-audience assertions. Implemented arithmetic through `identityPollDelay`; real time, async cancellation and audience checking remain outside this proof. |
| P1 | `use-snapshot.ts`: `cachedSnapshot` | Cache is fresh only in the half-open age interval; reject backward clock movement and exact expiry. Implemented interval through `freshCacheAge`; registry identity, subscription ownership and cancellation stay in original code. |
| P1 | `reward-amount.ts`: `formatMicroUsdc` | Exact nearest-cent display without float conversion. Implemented BigInt `roundedUsdcCents`; Intl and text formatting remain runtime behavior. |
| P1 | `scoring-policy.ts`: `allocatePullRequestReviewCredit` | One source per reviewer, first five qualifying reviewers, highest band per reviewer, conservation of one capped review pool | Excellent sequence proof candidate. Date parsing, source validation and upstream exclusion checks must remain explicit. |
| P1 | `global-leaderboard.ts`, `project-view.ts`, `points.ts`, `payout-points.ts`, `points-summary.ts` | Immutable actor grouping; exclude archived overlap; separate Points, score, payable money and private cases | Map/list algorithms are candidates; complete evidence joins and aggregation overflow need explicit contracts. |
| P1 | `received-totals.ts`, `allocation-funding.ts`, `allocation-funding-basis.mjs` | Direct plus vault totals reconcile; only exact supported stablecoins contribute dollar totals; no double counting | BigInt kernels fit. Asset/network lookup and observed transfer evidence remain independent boundaries. |
| P1 | `security-program-draft.ts`, `security-bounty-proposal.ts`, `payout-consent.ts`, `project-capabilities.mjs` | Fail closed on payment availability and consent; distinguish bounty-only and monthly work | Extract checked decision functions only when inputs already establish identity, policy revision and authority. Do not model authorization as an unconstrained trusted boolean. |
| P2 | `base-units.mjs`, `payments/vault-amount.ts`, `reward-cap.mjs` | Exact decimal scaling, canonical amount roundtrip, unit bounds | Conversion arithmetic is useful; exponentiation and regex/string parsing need supported alternatives and faithful UTF-16 semantics. |
| P2 | `notifications.ts`, `incomplete-assessments.ts`, `project-revision-changes.ts`, `profile-activity.ts`, `reviewer-leaders.ts` | Stable recipient-bound pagination, preserved records, no misleading delivery labels | Good list/filter decisions, but schema checks and identity binding require actual parser/API evidence. |
| P2 | `site-routes.ts`, `login-return.ts`, `local-signin.ts`, `project-image.mjs`, `contact.ts` | Safe internal redirects and validated content sources | Security value is in URL/regex/browser behavior; do not claim a string wrapper proves platform parser correctness. |
| P2 | `wallets.ts`, `wallet-proof.ts`, `wallet-possession.ts`, `base58.ts`, `byte-encoding.ts`, `solana-signature.ts`, `sha256.ts` | Byte/encoding and length invariants | Algorithms can be checked separately, but signature truth, wallet control and external authority cannot be inferred from local proof. |
| P2 | `install-command.ts`, `project-skill*.mjs`, `fenced-record.ts`, `run-receipts.ts`, `review-records.ts`, `model-identity.ts` | Exact provenance and receipt/skill joins; no secret exposure | Generated installer execution and cryptographic evidence require dedicated end-to-end verification. A proof of a string builder is insufficient. |

## UI journey inventory

| Components and hooks | Pure-policy opportunities and remaining evidence |
| --- | --- |
| `App`, `PublicPages`, `HomeStandings`, `Profiles`, `ProfilePage`, `ProjectLeaderboard`, `Points*`, `Earnings`, `PaymentRecords`, `CyclePages` | Reuse exact formatting, grouping, pagination and status kernels. Browser navigation, accessibility, query changes and stale/error rendering are outside pure proof. |
| `Admin*`, `PendingProjectApplications`, `Operations`, `ProjectProposalPage`, `ProjectFormFields`, `ProjectImageField`, `GeneratedSkillPreview`, `ProjectSetupStatus`, `ProjectSecuritySettings` | Policy guards and revision comparison can be checked. Server authority, scans, file upload and asynchronous cleanup need backend/browser evidence. |
| `OwnerAwards`, `OwnerBountyVault`, `OwnerCommitment`, `OwnerReserveRelease`, `OwnerVaultSetup`, `OwnerPresentation`, `AutomaticMonthlyPayment`, `ContributorAllocation`, `EscrowFunding`, `FundingStatus`, `VaultActions`, `VaultPaymentHistory` | Largest-remainder, cap, fee, freshness, consent and state decisions are candidates. Wallet signatures, live vault state and transaction finality remain separate. |
| `DirectBountyPayment`, `SolanaBountyPayment`, `SolanaBountyRecovery`, `BountySubmittedPayments`, `PayoutConsent`, `PayoutRows`, `ReferralClaims` | Preserve each unpaid leg and immutable intent. No pure local proof establishes broadcast or paid status. Referral enablement and launch policy remain unchanged. |
| `SecurityBounty`, `SecurityOffer`, `SecurityProgramEditor`, `PrivateReportForm`, `PrivateReportSummary`, `IncompleteAssessments`, `ProjectRiskFlag`, `VettingEvidence` | Draft retention integrated. Review, appeal, report privacy, malicious-source isolation and actual deletion/storage need system evidence. |
| `Inbox`, `InboxEmail`, `use-action`, `use-payout-wallets`, `use-direct-transfers`, `use-vault-payments`, `use-public-resource`, `use-snapshot` | Async state machines belong to Quint; integrate only actual pure decisions. Server delivery acceptance is not inbox delivery. |
| `Presentation`, `Logo`, `ChainIcon`, `Link`, `ErrorBoundary`, DOM/head/copy helpers | Presentational and browser behavior; no new proof abstraction is justified merely to increase function count. |
| Generated registries, declaration files, asset SVGs, CSS | Data, declarations and layout; no executable LemmaScript target. Existing schema/build/accessibility checks apply. |

## Implemented proof boundary and callers

`src/lib/verified-frontend.ts` has seven functions. Each has production imports
and no runtime dependency on the verifier.

- `allocationDisposition`: all four inputs come from existing recipient,
  closed flag, authorized-wallet/date checks and current time. No precondition.
  The caller preserves early return for recorded transfers and closed files,
  so wallet parsing is not introduced on those paths. The proof establishes
  a complete equivalence for all four return states, including the useful
  awaiting-wallet case, not truth of recorded transfers.
- `transientHttpStatus`: receives the actual `ProjectApiError.status` in
  `usePublicResource`. No precondition. The proof excludes the entire 400–499
  range from transient status, including 401 and 403. The existing status-less
  network-error policy is unchanged and remains outside this function.
- `draftStillNeeded`: receives actual origin, Boolean advisory existence,
  state, and membership in the existing terminal-failure list. No precondition.
  The proof rules out retention for a nonlocal submission or recorded advisory
  and rules out terminal failed submissions. An exact equivalence also requires
  retaining local drafts in each pending or recoverable state. Storage
  operations are not proved.
- `fundingReminderVisible`: receives actual reward kind, settlement presence,
  lifecycle and parsed elapsed time. No precondition. It proves terminal-state
  suppression and the exact positive seven-day eligibility condition over
  mathematical integers. The
  caller still checks the zero cap before returning the original message.
- `identityPollDelay`: requires a 1–10 second interval. Existing checks after
  initial and pending responses enforce that exact integer range. It proves
  delay is no greater than remaining time or ten seconds, and nonnegative
  when remaining time is nonnegative. A clock jump can produce a negative
  remaining time; the proof does not pretend otherwise or change timer behavior.
- `freshCacheAge`: receives the actual age and 60,000 millisecond cache limit.
  No precondition. The proof rejects negative age and age at or beyond expiry.
- `roundedUsdcCents`: requires nonnegative BigInt micro-units. Ordinary callers
  pass balances and allocations from validated monetary records, but the
  exported formatter accepts a string and does not enforce this precondition
  itself. A direct negative input retains the previous formatter behavior and
  is outside the rounding theorem. The theorem proves half-up rounding with an
  exact quotient interval, not caller parsers or Intl formatting.

The first complete run reported **11 verified, 0 errors** with Dafny. This is
seven source functions plus generated obligations; it is not 11 application
functions. The proof uses no `assume`, `extern`, `admit`, or manual axioms.
The generated proof is kept beside its generated baseline in
`formal/lemmascript/src/lib/` and checked from the source by the repository gate.

Number functions are statements over mathematical integers. Actual callers
provide bounded intervals, finite millisecond values and integer HTTP status
codes. No theorem covers arbitrary NaN, Infinity, fractional timestamps or
JavaScript precision loss at extreme values. BigInt rounding has no
machine-number precision gap.

Caller obligations were reviewed in source, not discharged by the verifier.
The `identity-flow` interval has explicit safe-integer and range guards at
both assignment sites. The rounding amount's sign relies on upstream amount
schemas. `ProjectApiError.status` has no runtime range guard; NaN or Infinity
would retain the former JavaScript expression's behavior but are outside the
mathematical status theorem. The cache and reminder computations retain the
same JavaScript comparisons, including their behavior for invalid dates; only
validated finite timestamps are within the intended proof domain.

## Validation and residual work

The existing contributor-allocation and reward-display suites passed: 24 tests,
0 failures. They exercise the real public functions, including sent precedence,
closed/deadline behavior, authorized wallet requirements and asset labels.
The full repository and real browser checks are owned by the integration task.
No UI markup, text, feature, authority or payment policy changes were made by
this extraction.

No defect is claimed merely because a proof passes. These source changes make
existing policies mechanically reviewable. The principal residual work is
whole-list conservation, deterministic identity/order joins, robust parser
contracts, and end-to-end refinement of asynchronous flows. Retain those gaps
in the coverage report. Do not call either a finite Quint model or these small
pure-function proofs verification of every possible frontend execution.

## Independent integration review

The final contract review strengthened the complete truth tables for allocation
states, draft retention and funding reminders. Rejection-only contracts would
have allowed an implementation to suppress all legitimate drafts/reminders.
The revised equivalences forbid that omission. The polling contract now states
both branches of the minimum, so it cannot return an arbitrary smaller delay.
The full module still verifies: 11 generated declarations, zero errors.

Review of the shared monetary extraction found no changed fee behavior.
`payoutFee` validates positive bounded gross and exact divisibility before the
bounty kernel. `acceptsPayoutFee` still runs that validator before checking the
legacy ordinary fee. All five weighted-allocation call sites preserve their
original division/remainder arithmetic and tie ordering. Their whole-list
conservation and caller contracts remain outside the per-term proof.

The existing allocation-locale, quality-allocation-locale,
funding-review-allocation-locale, joint-value-scoring, monthly-reward preparation,
contributor-allocation and reward-display suites passed together: 34 tests,
zero failures. These exercise the public callers rather than copied kernels.
Browser regressions already exist for 503 retention followed by 401/403 removal
(`admin-refresh-retention`, `security-refresh`), cache expiry and retry
(`home-cache`), cancelled sign-in (`login`), private draft sign-out/account change
(`security-draft-signout`) and contributor allocation state. Their live browser
results must be recorded by the integration run; source inspection alone is not
a passing browser result.

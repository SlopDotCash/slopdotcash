// @source src/VaultActions.tsx
// @source src/OwnerCommitment.tsx
// @source src/OwnerVaultSetup.tsx
// @source src/AutomaticMonthlyPayment.tsx
// @source src/DirectBountyPayment.tsx
// @source src/SolanaBountyPayment.tsx
// @source src/ReferralClaims.tsx
// @source src/BountySubmittedPayments.tsx
// @source src/OwnerBountyVault.tsx
// @source src/OwnerAwards.tsx
// @source src/lib/use-action.ts
// @source src/lib/use-pending-wallet-attempt.ts
// VaultActions, OwnerCommitment, OwnerVaultSetup, AutomaticMonthlyPayment,
// DirectBountyPayment, SolanaBountyPayment, ReferralClaims.
// Models one wallet operation. Approval evidence is distinct from completion.
// Completion alone is not a contributor payment; financial reconciliation is
// represented by the operation-specific payment and funding models.
// Wrong-total reserve release is modeled by ui_monthly_reserve_release: its
// finalized outcome returns free funds and never means a contributor was paid.
module ui_transaction {
  var s: { phase: str, wallet: bool, reviewed: bool, matches: bool, stored: bool, requested: bool, hash: bool, verified: bool, completed: bool }
  action init = s' = { phase: "idle", wallet: false, reviewed: false, matches: true,
    stored: false, requested: false, hash: false, verified: false, completed: false }
  action connect = all { not(s.requested), s' = s.with("wallet", true).with("matches", true).with("reviewed", false) }
  action review = all { s.wallet, not(s.requested), s.matches, s' = s.with("reviewed", true).with("phase", "review") }
  action mismatch = all { not(s.requested), s' = s.with("matches", false).with("reviewed", false) }
  action recordIntent = all { s.wallet, s.reviewed, s.matches, not(s.requested),
    s' = s.with("stored", true).with("phase", "prepared") }
  action requestWallet = all { s.stored, s.phase == "prepared", s' = s.with("requested", true).with("phase", "pending") }
  action hashReturned = all { s.phase == "pending", s' = s.with("hash", true) }
  action uncertain = all { s.requested, not(s.verified), s' = s.with("phase", "uncertain") }
  action rejected = all { s.requested, not(s.hash), not(s.verified),
    s' = s.with("phase", "idle").with("requested", false).with("stored", false).with("reviewed", false) }
  action verifyPending = all { s.requested, s' = s }
  action failed = all { s.requested, not(s.verified), s' = s.with("phase", "failed").with("verified", true) }
  action approvalConfirmed = all { s.requested, not(s.verified), s' = s.with("phase", "approval-confirmed").with("verified", true) }
  action operationConfirmed = all { s.requested, not(s.verified), s' = s.with("phase", "confirmed").with("verified", true).with("completed", true) }
  action retry = all { Set("failed", "approval-confirmed").contains(s.phase),
    s' = s.with("phase", "idle").with("reviewed", false).with("stored", false)
      .with("requested", false).with("hash", false).with("verified", false) }
  action step = any { connect, review, mismatch, recordIntent, requestWallet, hashReturned, uncertain, rejected, verifyPending, failed, approvalConfirmed, operationConfirmed, retry, s' = s }
  val invariant = all { s.requested implies s.stored, s.completed implies s.verified and s.phase == "confirmed",
    s.phase == "uncertain" implies s.requested and not(s.completed) }
  run lostResultTest = init.then(connect).then(review).then(recordIntent).then(requestWallet).then(uncertain).expect(s.stored and not(s.completed))
  run approvalTest = init.then(connect).then(review).then(recordIntent).then(requestWallet).then(hashReturned).then(approvalConfirmed).expect(not(s.completed))
  run completedOperationTest = init.then(connect).then(review).then(recordIntent).then(requestWallet).then(hashReturned).then(operationConfirmed).expect(s.completed)
  run changedWalletTest = init.then(connect).then(review).then(mismatch).expect(not(s.reviewed) and not(s.requested))
}

// @source src/PayoutConsent.tsx
// @source src/lib/payout-consent.ts
// Consent verifies the prepared message and destination. It is never a paid receipt.
module ui_payout_consent {
  var s: { open: bool, phase: str, accountMatches: bool, networkMatches: bool, messageMatches: bool, signedMatches: bool, authorized: bool, paid: bool }
  action init = s' = { open: false, phase: "idle", accountMatches: false, networkMatches: false, messageMatches: false, signedMatches: false, authorized: false, paid: false }
  action openReview = s' = s.with("open", true)
  action connect = all { s.open, s' = s.with("accountMatches", true).with("networkMatches", true).with("phase", "connected") }
  action prepare = all { s.phase == "connected", s' = s.with("messageMatches", true).with("phase", "prepared") }
  action walletChanged = s' = s.with("accountMatches", false).with("phase", "error")
  action sign = all { s.phase == "prepared", s.accountMatches, s.networkMatches, s.messageMatches, s' = s.with("signedMatches", true).with("phase", "signed") }
  action accept = all { s.phase == "signed", s.signedMatches, s' = s.with("authorized", true).with("phase", "submitted").with("open", false) }
  action close = all { s.phase == "idle", s' = s.with("open", false) }
  action step = any { openReview, connect, prepare, walletChanged, sign, accept, close, s' = s }
  val invariant = all { not(s.paid), s.authorized implies s.messageMatches and s.signedMatches }
  run consentTest = init.then(openReview).then(connect).then(prepare).then(sign).then(accept).expect(s.authorized and not(s.paid))
  run changedAccountTest = init.then(openReview).then(connect).then(prepare).then(walletChanged).expect(not(s.authorized))
}

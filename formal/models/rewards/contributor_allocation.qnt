// @source src/lib/contributor-allocation.ts
// Sender-recorded token distribution, separate from earned on-chain payment.
module contributor_allocation {
  type S = { now: int, firstWalletAt: int, authorized: bool, closed: bool, sent: bool, state: str }
  var s: S
  action init = s' = { now: 0, firstWalletAt: -1, authorized: false, closed: false, sent: false, state: "awaiting-wallet" }
  val expected = if (s.sent) "sent" else if (s.closed) "unclaimed"
    else if (s.authorized and s.firstWalletAt >= 0 and s.firstWalletAt < 2) "scheduled"
    else if (s.now < 2) "awaiting-wallet" else "unclaimed"
  action project = s' = s.with("state", expected)
  action tick = all { s.now < 3, s' = s.with("now",s.now+1) }
  action authorize = s' = s.with("authorized",true).with("firstWalletAt", if(s.firstWalletAt < 0) s.now else s.firstWalletAt)
  action replaceWallet = all { s.authorized, s' = s }
  action closeBatch = s' = s.with("closed",true)
  action recordSent = s' = s.with("sent",true)
  action step = any { project,tick,authorize,replaceWallet,closeBatch,recordSent,s'=s }
  val invariant = all { s.firstWalletAt <= s.now, s.state == "sent" implies s.sent }
  run timelyReplacementTest = init.then(authorize).then(tick).then(tick).then(replaceWallet).then(project).expect(s.state=="scheduled" and invariant)
  run lateWalletTest = init.then(tick).then(tick).then(authorize).then(project).expect(s.state=="unclaimed" and invariant)
  run finalBatchTest = init.then(authorize).then(closeBatch).then(project).expect(s.state=="unclaimed" and invariant)
  run sentRecordTest = init.then(recordSent).then(closeBatch).then(project).expect(s.state=="sent" and invariant)
}

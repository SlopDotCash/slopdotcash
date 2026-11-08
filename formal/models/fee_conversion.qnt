// @source migrations/0022_fee_conversions.sql
// @source migrations/0076_fee_conversion_pending.sql
// @source migrations/0078_fee_conversion_transaction_size.sql
// @source migrations/0082_fee_claim_journal.sql
// @source migrations/0088_fee_approval_journal.sql
// @source workers/fee-converter/core.ts
// @source workers/fee-converter/config.ts
// @source workers/fee-converter/evm.ts
// @source workers/fee-converter/solana.ts
// @source backend/fee-conversions/handler.ts
// fee-converter/core.ts/config.ts and chain adapters. No activation is performed.
module fee_conversion {
  type S = { mode: str, network: str, phase: str, lease: bool, journal: bool,
    sent: bool, received: bool, sameWallet: bool, routeSafe: bool }
  var s: S
  action init = s' = { mode: "off", network: "base", phase: "idle", lease: false,
    journal: false, sent: false, received: false, sameWallet: true, routeSafe: false }
  action configure(mode: str, network: str): bool = all { s.phase == "idle",
    s' = s.with("mode", mode).with("network", network) }
  action acquire = all { s.mode != "off", s' = s.with("lease", true) }
  action quote = all { Set("idle", "quoted").contains(s.phase), s.lease, s.network != "robinhood", s' = s.with("phase", "quoted").with("routeSafe", true) }
  action noRoute = all { Set("idle", "quoted").contains(s.phase), s.lease, s' = s.with("phase", "no_route") }
  action journal = all { s.mode == "live", s.phase == "quoted", s.routeSafe, s.lease,
    s' = s.with("journal", true).with("phase", "prepared") }
  action send = all { s.journal, s.lease, s.mode == "live", s' = s.with("sent", true).with("phase", "unknown") }
  action expireLease = s' = s.with("lease", false)
  action finalized = all { s.sent, s' = s.with("received", true).with("phase", "finalized") }
  action step = any { configure("off", "base"), configure("dry_run", "base"), configure("live", "base"),
    configure("live", "robinhood"), acquire, quote, noRoute, journal, send, expireLease, finalized, s' = s }
  val invariant = all { s.sameWallet, s.sent implies (s.journal and s.mode == "live" and s.network != "robinhood"),
    s.received implies s.sent, s.mode != "live" implies not(s.sent) }
  run dryRunCannotSignTest = init.then(configure("dry_run", "base")).then(acquire).then(quote).then(journal.fail())
  run robinhoodRetainedTest = init.then(configure("live", "robinhood")).then(acquire).then(quote.fail())
  run staleLeaseRefusedTest = init.then(configure("live", "base")).then(acquire).then(quote).then(expireLease).then(journal.fail())
  run convertedTest = init.then(configure("live", "base")).then(acquire).then(quote).then(journal).then(send).then(finalized).expect(invariant)
}
// @source workers/fee-converter/dry-run.ts

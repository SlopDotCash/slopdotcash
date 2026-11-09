// @source migrations/0095_fee_solana_expiry.sql
// @source workers/fee-converter/solana-expiry.ts
// @source workers/fee-converter/native-gas.ts
// fee-converter/solana-expiry.ts, native-gas.ts; full-history independent providers.
module solana_expiry {
  type S = { signed: bool, hold: int, first: str, second: str, history: bool, released: bool }
  var s: S
  action init = s' = { signed: true, hold: 2, first: "unknown", second: "unknown", history: false, released: false }
  action observe(a: str, b: str, history: bool): bool = all { not(s.released),
    s' = s.with("first", a).with("second", b).with("history", history) }
  action release = all { s.first == "expired_absent", s.second == "expired_absent", s.history,
    s' = s.with("hold", 0).with("released", true) }
  action step = any { observe("expired_absent", "expired_absent", true), observe("expired_absent", "expired_absent", false),
    observe("expired_absent", "unknown", true), observe("found", "expired_absent", true), release, s' = s }
  val invariant = s.released implies all { s.hold == 0, s.history, s.first == "expired_absent", s.second == "expired_absent" }
  run independentProofTest = init.then(observe("expired_absent", "expired_absent", true)).then(release).expect(invariant)
  run missingHistoryTest = init.then(observe("expired_absent", "expired_absent", false)).then(release.fail())
  run disagreementTest = init.then(observe("expired_absent", "unknown", true)).then(release.fail())
}

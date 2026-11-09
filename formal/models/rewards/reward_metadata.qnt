// @source backend/projects/token-metadata.ts
// An unavailable RPC yields retry, not asset rejection. Decimals are required;
// symbol is optional display data. Native metadata needs no RPC lookup.
module reward_metadata {
  type S = { phase: str, attempts: int, symbol: str, stored: bool, network: bool }
  var s: S
  action init = s' = { phase: "input", attempts: 0, symbol: "submitted", stored: false, network: false }
  action native = all { s.phase == "input", s' = s.with("phase", "ready").with("symbol", "native").with("network", true) }
  action request = all { Set("input", "retry").contains(s.phase), s.attempts < 2,
    s' = s.with("phase", "reading").with("attempts", s.attempts + 1).with("network", false) }
  action identify(matches: bool): bool = all { s.phase == "reading",
    s' = s.with("network", matches).with("phase", if(matches) "reading" else "refused") }
  action unavailable = all { s.phase == "reading", s' = s.with("phase", "retry") }
  action invalid = all { s.phase == "reading", s' = s.with("phase", "refused") }
  action metadata(symbolReadable: bool): bool = all { s.phase == "reading", s.network,
    s' = s.with("phase", "ready").with("symbol", if(symbolReadable) "verified" else "submitted") }
  action store = all { s.phase == "ready", s' = s.with("stored", true) }
  action step = any { native, request, identify(true), identify(false), unavailable, invalid, metadata(true), metadata(false), store, s' = s }
  val invariant = all { s.stored implies s.phase == "ready" and s.network, s.attempts <= 2 }
  run rateLimitRetriesTest = init.then(request).then(unavailable).then(request).then(identify(true)).then(metadata(true)).then(store).expect(invariant)
  run malformedAssetRefusedTest = init.then(request).then(invalid).then(store.fail())
  run optionalSymbolPreservedTest = init.then(request).then(identify(true)).then(metadata(false)).then(store).expect(s.symbol == "submitted" and invariant)
  run nativeNoRpcTest = init.then(native).then(store).expect(s.attempts == 0 and invariant)
  run wrongNetworkCannotPublishTest = init.then(request).then(identify(false)).then(store.fail())
}

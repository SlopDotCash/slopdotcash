// @source src/lib/funding-address.mjs
// @source src/lib/record-validation.mjs
// @source src/lib/project-schema.mjs
// @evidence scripts/funding-address.test.ts
// Complete historical receiving-route validation, not a live route mutation.
// Three input rows represent the 0..32 production collection; oversized and
// nonarray are explicit refusal classes. Four canonical UTC time points, three
// exact canonical address identities, and every supported/unsupported network
// class. Address decoding is refined in funding_address_validation.
// Intervals are half-open: touching endpoints are allowed; null is unbounded.
// Same network+asset addresses are unique even across disjoint intervals.
// Exact UTC normalization makes lexical sorting agree with numeric time. The
// pairwise disjointness predicate equals the source's adjacent comparisons
// after sorting each group; output retains original input order.
// No storage/history mutation, funding authority, wallet control or current
// direct payment route is created. Current product funding uses escrow.
// Robinhood addresses remain valid for other consumers but this parser refuses
// direct Robinhood routes. Old named traces now exercise the actual parser.
// No parser, model checker or tests were executed for this source-authored model.
module funding_routes {
  val routeSlots = Set(0, 1, 2)
  val networks = Set("base", "ethereum", "bitcoin", "solana", "robinhood", "other")
  type Route = { network: str, asset: str, address: int, start: int, end: int, validity: str }
  val ordinary: Route = { network: "base", asset: "USDC", address: 1, start: 1, end: 0, validity: "valid" }
  var s: { phase: str, array: bool, oversized: bool, count: int, cursor: int,
    rows: int -> Route, parsed: List[Route], output: List[Route], error: str }
  action init = s' = { phase: "input", array: true, oversized: false, count: 0, cursor: 0,
    rows: routeSlots.mapBy(_ => ordinary), parsed: List(), output: List(), error: "none" }
  pure def asset(network: str): str = if (network == "bitcoin") "BTC"
    else if (network == "robinhood") "USDG"
    else if (Set("base", "ethereum", "solana").contains(network)) "USDC" else "none"
  pure def sameGroup(a: Route, b: Route): bool = a.network == b.network and a.asset == b.asset
  pure def disjoint(a: Route, b: Route): bool = (a.end != 0 and a.end <= b.start) or (b.end != 0 and b.end <= a.start)
  action collection(array: bool, count: int, oversized: bool): bool = all {
    s.phase == "input", 0.to(3).contains(count), s' = s.with("array", array).with("count", count).with("oversized", oversized) }
  action route(index: int, network: str, assetName: str, address: int, start: int, end: int): bool = all {
    s.phase == "input", routeSlots.contains(index), networks.contains(network), Set("USDC", "BTC", "USDG", "wrong").contains(assetName),
    Set(1, 2, 3).contains(address), 1.to(4).contains(start), 0.to(4).contains(end),
    s' = s.with("rows", s.rows.set(index, { network: network, asset: assetName, address: address,
      start: start, end: end, validity: "valid" })) }
  action invalid(index: int, kind: str): bool = all { s.phase == "input", routeSlots.contains(index),
    Set("record", "keys", "address", "timestamp").contains(kind),
    s' = s.with("rows", s.rows.set(index, s.rows.get(index).with("validity", kind))) }
  action begin = all { s.phase == "input", s' = s.with("phase",
    if (not(s.array) or s.oversized) "failed" else if (s.count == 0) "intervals" else "row")
    .with("error", if (not(s.array) or s.oversized) "collection" else "none") }
  action inspect = {
    val row = s.rows.get(s.cursor)
    val duplicate = routeSlots.filter(i => i < s.cursor).exists(i =>
      sameGroup(s.rows.get(i), row) and s.rows.get(i).address == row.address)
    val error = if (Set("record", "keys").contains(row.validity)) row.validity
      else if (row.network == "robinhood") "direct-robinhood"
      else if (asset(row.network) == "none" or row.asset != asset(row.network)) "asset"
      else if (row.validity == "address") "address"
      else if (row.validity == "timestamp") "timestamp"
      else if (row.end != 0 and row.end <= row.start) "interval-order"
      else if (duplicate) "duplicate" else "none"
    all { s.phase == "row", s' = if (error != "none") s.with("phase", "failed").with("error", error)
      else s.with("parsed", s.parsed.append(row))
        .with("cursor", if (s.cursor + 1 == s.count) s.cursor else s.cursor + 1)
        .with("phase", if (s.cursor + 1 == s.count) "intervals" else "row") }
  }
  val overlaps = routeSlots.exists(i => routeSlots.exists(j => i < j and j < s.count
    and sameGroup(s.rows.get(i), s.rows.get(j)) and not(disjoint(s.rows.get(i), s.rows.get(j)))))
  action intervals = all { s.phase == "intervals",
    s' = s.with("phase", if (overlaps) "failed" else "return").with("error", if (overlaps) "overlap" else "none") }
  action publish = all { s.phase == "return", s' = s.with("phase", "done").with("output", s.parsed) }
  action step = {
    nondet index = routeSlots.oneOf()
    nondet count = 0.to(3).oneOf()
    nondet address = Set(1, 2, 3).oneOf()
    nondet first = 1.to(4).oneOf()
    nondet last = 0.to(4).oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    nondet network = networks.oneOf()
    nondet assetName = Set("USDC", "BTC", "USDG", "wrong").oneOf()
    nondet kind = Set("record", "keys", "address", "timestamp").oneOf()
    any { collection(yes, count, other), route(index, network, assetName, address, first, last), invalid(index, kind),
      begin, inspect, intervals, publish, s' = s }
  }
  val invariant = all { s.cursor <= 2, s.parsed.length() <= 3,
    s.phase == "failed" implies s.output == List(),
    s.phase == "done" implies s.output.length() == s.count and not(overlaps)
      and routeSlots.filter(i => i < s.count).forall(i => s.output[i] == s.rows.get(i)) }
  action twoRows = collection(true, 2, false)
  action validateTwo = begin.then(inspect).then(inspect).then(intervals)
  run preservedHistoryTest = init.then(twoRows).then(route(0, "base", "USDC", 1, 1, 2))
    .then(route(1, "base", "USDC", 2, 2, 0)).then(validateTwo).then(publish)
    .expect(s.output.length() == 2 and s.output[0].end == 2 and invariant)
  run overlappingRefusedTest = init.then(twoRows).then(route(0, "base", "USDC", 1, 1, 3))
    .then(route(1, "base", "USDC", 2, 2, 0)).then(validateTwo).expect(s.error == "overlap" and invariant)
  run emptyHistoryIsValidTest = init.then(begin).then(intervals).then(publish).expect(s.output == List() and invariant)
  run oversizedCollectionRefusesBeforeRowsTest = init.then(collection(true, 3, true)).then(begin).expect(s.error == "collection" and invariant)
  run nonarrayRefusesTest = init.then(collection(false, 0, false)).then(begin).expect(s.error == "collection" and invariant)
  run duplicateAddressRefusesEvenDisjointIntervalsTest = init.then(twoRows).then(route(0, "base", "USDC", 1, 1, 2))
    .then(route(1, "base", "USDC", 1, 3, 0)).then(begin).then(inspect).then(inspect).expect(s.error == "duplicate" and invariant)
  run crossNetworkSameSpellingCanCoexistTest = init.then(twoRows).then(route(1, "ethereum", "USDC", 1, 1, 0))
    .then(validateTwo).then(publish).expect(s.output.length() == 2 and invariant)
  run unsortedInputKeepsItsOriginalOrderTest = init.then(twoRows).then(route(0, "base", "USDC", 2, 3, 0))
    .then(route(1, "base", "USDC", 1, 1, 2)).then(validateTwo).then(publish)
    .expect(s.output[0].address == 2 and s.output[1].address == 1 and invariant)
  run openPriorRouteCannotOverlapLaterRouteTest = init.then(twoRows).then(route(1, "base", "USDC", 2, 3, 0))
    .then(validateTwo).expect(s.error == "overlap" and invariant)
  run equalStartAndEndRefusesTest = init.then(collection(true, 1, false)).then(route(0, "base", "USDC", 1, 2, 2))
    .then(begin).then(inspect).expect(s.error == "interval-order" and invariant)
  run wrongAssetRefusesTest = init.then(collection(true, 1, false)).then(route(0, "bitcoin", "USDC", 1, 1, 0))
    .then(begin).then(inspect).expect(s.error == "asset" and invariant)
  run directRobinhoodRouteStillRefusesTest = init.then(collection(true, 1, false)).then(route(0, "robinhood", "USDG", 1, 1, 0))
    .then(begin).then(inspect).expect(s.error == "direct-robinhood" and invariant)
  run unknownFieldsRefuseTest = init.then(collection(true, 1, false)).then(invalid(0, "keys"))
    .then(begin).then(inspect).expect(s.error == "keys" and invariant)
  run noncanonicalTimeRefusesBeforeIntervalComparisonTest = init.then(collection(true, 1, false)).then(invalid(0, "timestamp"))
    .then(begin).then(inspect).expect(s.error == "timestamp" and invariant)
  run invalidAddressRefusesBeforeHistoryTest = init.then(collection(true, 1, false)).then(invalid(0, "address"))
    .then(begin).then(inspect).expect(s.error == "address" and invariant)
}

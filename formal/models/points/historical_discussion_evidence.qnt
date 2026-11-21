// @source scripts/historical-discussion-evidence.ts
// @source scripts/collect-implementation-corrections.ts
// @source workers/slopbot/value-evidence.ts
// @source .github/workflows/points-implementation-corrections.yml
// @evidence scripts/historical-discussion-evidence.test.ts
// A retained-copy discovery read for one PR. Complete GraphQL evidence is the
// conjunction of REST identity and count agreement, exhaustive pagination and
// complete public references. These are checked on concrete source records.
// A saved GraphQL response replays even when new GraphQL reads are disabled.
// Previously collected REST evidence takes priority over new reads.
module historical_discussion_evidence {
  var s: { phase: str, enabled: bool, savedGraph: bool, legacy: bool, qualified: bool,
    interrupted: bool, graphUsed: bool, restUsed: bool }

  action init = s' = { phase: "new", enabled: false, savedGraph: false, legacy: false,
    qualified: false, interrupted: false, graphUsed: false, restUsed: false }

  action chooseTransport(optedIn: bool, saved: bool, legacy: bool): bool = all {
    s.phase == "new",
    s' = s.with("enabled", optedIn).with("savedGraph", saved).with("legacy", legacy)
      .with("phase", if (saved or (optedIn and not(legacy))) "graphql" else "rest")
  }

  action graphReply(qualified: bool): bool = all {
    s.phase == "graphql",
    s' = s.with("qualified", qualified).with("graphUsed", qualified)
      .with("phase", if (qualified) "discovered" else "rest")
  }

  action restReply(complete: bool): bool = all {
    s.phase == "rest",
    s' = s.with("restUsed", complete)
      .with("phase", if (complete) "discovered" else "held")
  }

  action stop = all {
    Set("graphql", "rest").contains(s.phase),
    s' = s.with("phase", "checkpoint").with("interrupted", true)
  }

  action step = any {
    { nondet optedIn = Set(false, true).oneOf()
      nondet saved = Set(false, true).oneOf()
      nondet legacy = Set(false, true).oneOf()
      chooseTransport(optedIn, saved, legacy) },
    graphReply(false), graphReply(true), restReply(false), restReply(true),
    stop, s' = s
  }

  val invariant = all {
    s.graphUsed implies (s.savedGraph or (s.enabled and not(s.legacy))) and s.qualified,
    not(s.graphUsed and s.restUsed),
    (s.phase == "discovered") implies (s.graphUsed or s.restUsed) and not(s.interrupted),
    s.interrupted implies s.phase == "checkpoint" and not(s.graphUsed or s.restUsed)
  }

  run legacyPathTest = init.then(chooseTransport(true, false, true)).then(restReply(true))
    .expect(s.restUsed and invariant)
  run disabledPathTest = init.then(chooseTransport(false, false, false)).then(restReply(true))
    .expect(s.restUsed and invariant)
  run completeGraphqlPathTest = init.then(chooseTransport(true, false, false)).then(graphReply(true))
    .expect(s.graphUsed and invariant)
  run savedGraphqlReplaysWithNewReadsDisabledTest = init.then(chooseTransport(false, true, true))
    .then(graphReply(true)).expect(s.graphUsed and invariant)
  run incompleteGraphqlFallsBackTest = init.then(chooseTransport(true, false, false))
    .then(graphReply(false)).then(restReply(true)).expect(s.restUsed and invariant)
  run incompleteFallbackHoldsTest = init.then(chooseTransport(true, false, false))
    .then(graphReply(false)).then(restReply(false)).expect(s.phase == "held" and invariant)
  run quotaNeverLooksLikeDiscoveryTest = init.then(chooseTransport(true, false, false))
    .then(stop).expect(invariant).then(restReply(true).fail())
}

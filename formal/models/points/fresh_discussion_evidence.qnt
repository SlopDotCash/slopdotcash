// @source scripts/historical-discussion-evidence.ts
// @source scripts/value-ingestion.ts
// @source scripts/generate-leaderboard.ts
// @source workers/slopbot/value-evidence.ts
// @evidence scripts/fresh-discussion-evidence.test.ts
// @evidence scripts/retained-attribution-hold.test.ts
// One retained-copy discovery. Two available GraphQL points represent one
// optional attempt and one required timeline fallback. Concrete PR anchors,
// complete counts, ordering and response validity are source-test boundaries.
// A discovered reference still needs the separate retained-copy proof.
module fresh_discussion_evidence {
  var phase: str
  var qualified: bool
  var remaining: int
  var graphUsed: bool
  var restUsed: bool

  action init = all {
    phase' = "new", qualified' = false, remaining' = 0,
    graphUsed' = false, restUsed' = false
  }

  action start(trusted: bool, points: int): bool = all {
    phase == "new",
    phase' = if (trusted and points >= 2) "graphql" else "rest",
    remaining' = if (trusted and points >= 2) points - 1 else points,
    qualified' = qualified, graphUsed' = graphUsed, restUsed' = restUsed
  }

  action graphReply(complete: bool): bool = all {
    phase == "graphql",
    phase' = if (complete) "discovered" else "rest",
    qualified' = complete, graphUsed' = complete,
    remaining' = remaining, restUsed' = restUsed
  }

  action restReply(complete: bool): bool = all {
    phase == "rest",
    phase' = if (complete) "discovered" else "held",
    restUsed' = complete, graphUsed' = graphUsed,
    qualified' = qualified, remaining' = remaining
  }

  action checkpoint = all {
    Set("graphql", "rest").contains(phase),
    phase' = "checkpoint", qualified' = qualified, remaining' = remaining,
    graphUsed' = graphUsed, restUsed' = restUsed
  }

  action step = any {
    { nondet trusted = Set(true, false).oneOf()
      nondet points = Set(0, 1, 2).oneOf()
      start(trusted, points) },
    graphReply(true), graphReply(false),
    restReply(true), restReply(false), checkpoint,
    all {
      phase' = phase, qualified' = qualified, remaining' = remaining,
      graphUsed' = graphUsed, restUsed' = restUsed
    }
  }

  val invariant = all {
    phase == "graphql" implies remaining >= 1,
    graphUsed implies qualified,
    not(graphUsed and restUsed),
    phase == "discovered" implies (graphUsed or restUsed),
    phase == "checkpoint" implies not(graphUsed or restUsed)
  }

  run keepRequiredTimelinePointTest = init.then(start(true, 1))
    .expect(phase == "rest" and remaining == 1 and invariant)
  run probePreservesFallbackTest = init.then(start(true, 2))
    .then(graphReply(false)).then(restReply(true)).expect(restUsed and invariant)
  run completeProbeTest = init.then(start(true, 2))
    .then(graphReply(true)).expect(graphUsed and invariant)
  run untrustedClientUsesRestTest = init.then(start(false, 2))
    .expect(phase == "rest" and remaining == 2 and invariant)
  run quotaCheckpointDoesNotDiscoverTest = init.then(start(true, 2))
    .then(checkpoint).expect(invariant).then(graphReply(true).fail())
}

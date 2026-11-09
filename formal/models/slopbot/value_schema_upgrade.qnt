// @source migrations/0105_slopbot_value_terminal_states.sql
// @source migrations/0103_slopbot_value_retry_attempts.sql
// @source migrations/0052_slopbot_value_processing.sql
// Representation migration preserves all business-state fields. New terminal
// states become writable only after the schema can represent them.
module value_schema_upgrade {
  var schema: int
  var state: str
  var outcome: str
  var originalState: str
  var originalOutcome: str
  var attempts: int
  var token: int
  var retryAt: int
  action init = {
    nondet phase = Set("running", "waiting", "completed").oneOf()
    nondet result = Set("published", "current", "open", "historical", "source-incomplete", "authority", "budget", "retry").oneOf()
    all { schema' = 1, state' = phase, outcome' = result,
      originalState' = phase, originalOutcome' = result,
      attempts' = 2, token' = 1, retryAt' = 3 }
  }
  action migrate = all {
    schema == 1, schema' = 2, state' = state, outcome' = outcome,
    attempts' = attempts, token' = token, retryAt' = retryAt,
    originalState' = originalState, originalOutcome' = originalOutcome,
  }
  action step = migrate
  val invariant = all { attempts == 2, token == 1, retryAt == 3,
    state == originalState, outcome == originalOutcome, schema.in(Set(1, 2)) }
  run preserveHistoricalStateTest = init.then(migrate)
    .expect(attempts == 2 and token == 1 and retryAt == 3)
}

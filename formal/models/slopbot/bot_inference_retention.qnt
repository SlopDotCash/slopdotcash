// @source workers/slopbot/value-inference.ts
// @source migrations/0054_slopbot_value_inference_results.sql
// @source migrations/0104_slopbot_value_inference_attempts.sql
// @source migrations/0118_slopbot_zero_call_reconciliation.sql
// Retain validated inference after usage recording and before journal use.
// Attempt admission without a successful reservation cannot call a provider.
// An attempt reconciled with zero calls never reached the provider and does
// not count toward the attempt limit; an unreconciled attempt still counts.
// `attempts` is bounded at five only to keep the state space finite.
module bot_inference_retention {
  var s: { attempts: int, counted: int, reserved: bool, called: bool,
    closed: bool, usage: bool, valid: bool, retained: bool, published: bool }
  action init = s' = {attempts: 0, counted: 0, reserved: false, called: false,
    closed: false, usage: false, valid: false, retained: false, published: false}
  action admit = all { s.counted < 3, s.attempts < 5, not(s.retained),
    s' = s.with("attempts", s.attempts + 1).with("counted", s.counted + 1)
      .with("reserved", false).with("called", false).with("closed", false)
      .with("usage", false).with("valid", false) }
  action reserve = all { s.attempts > 0, not(s.closed), s' = s.with("reserved", true) }
  action call = all { s.reserved, not(s.called), not(s.closed), s' = s.with("called", true) }
  // The route returned before its first request (for example an authority
  // recheck refused or failed) and the attempt reconciles with zero calls.
  action reconcileZeroCall = all { s.reserved, not(s.called), not(s.closed),
    s' = s.with("closed", true).with("counted", s.counted - 1) }
  action recordUsage = all { s.called, s' = s.with("usage", true) }
  action validate = all { s.called, s' = s.with("valid", true) }
  action retain = all { s.usage, s.valid, s' = s.with("retained", true) }
  action publish = all { s.retained, s' = s.with("published", true) }
  action step = any { admit, reserve, call, reconcileZeroCall, recordUsage, validate,
    retain, publish, s' = s }
  val invariant = all { s.called implies s.reserved, s.retained implies s.usage and s.valid,
    s.published implies s.retained, s.counted <= 3, s.counted >= 0,
    s.counted <= s.attempts, s.closed implies not(s.called) }
  run usageFailureCannotPublishTest = init.then(admit).then(reserve).then(call).then(validate)
    .expect(not(s.retained) and not(s.published))
  run retainedResultReusedTest = init.then(admit).then(reserve).then(call).then(recordUsage).then(validate).then(retain)
    .then(publish).expect(s.attempts == 1 and s.published and invariant)
  run zeroCallAttemptsDoNotExhaustLimitTest = init
    .then(admit).then(reserve).then(reconcileZeroCall)
    .then(admit).then(reserve).then(reconcileZeroCall)
    .then(admit).then(reserve).then(reconcileZeroCall)
    .then(admit).then(reserve).then(reconcileZeroCall)
    .then(admit).then(reserve).then(call).then(recordUsage).then(validate).then(retain)
    .then(publish).expect(s.attempts == 5 and s.counted == 1 and s.published)
  run unreconciledAttemptsExhaustLimitTest = init.then(admit).then(reserve)
    .then(admit).then(reserve).then(admit).then(reserve)
    .expect(s.counted == 3).then(admit.fail())
}

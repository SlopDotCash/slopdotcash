// @source workers/slopbot/value-inference.ts
// @source migrations/0054_slopbot_value_inference_results.sql
// @source migrations/0104_slopbot_value_inference_attempts.sql
// Retain validated inference after usage recording and before journal use.
// Attempt admission without a successful reservation cannot call a provider.
module bot_inference_retention {
  var s: { attempts: int, reserved: bool, called: bool, usage: bool,
    valid: bool, retained: bool, published: bool }
  action init = s' = {attempts: 0, reserved: false, called: false, usage: false,
    valid: false, retained: false, published: false}
  action admit = all { s.attempts < 3, not(s.retained),
    s' = s.with("attempts", s.attempts + 1).with("reserved", false).with("called", false).with("usage", false).with("valid", false) }
  action reserve = all { s.attempts > 0, s' = s.with("reserved", true) }
  action call = all { s.reserved, not(s.called), s' = s.with("called", true) }
  action recordUsage = all { s.called, s' = s.with("usage", true) }
  action validate = all { s.called, s' = s.with("valid", true) }
  action retain = all { s.usage, s.valid, s' = s.with("retained", true) }
  action publish = all { s.retained, s' = s.with("published", true) }
  action step = any { admit, reserve, call, recordUsage, validate, retain, publish, s' = s }
  val invariant = all { s.called implies s.reserved, s.retained implies s.usage and s.valid,
    s.published implies s.retained, s.attempts <= 3 }
  run usageFailureCannotPublishTest = init.then(admit).then(reserve).then(call).then(validate)
    .expect(not(s.retained) and not(s.published))
  run retainedResultReusedTest = init.then(admit).then(reserve).then(call).then(recordUsage).then(validate).then(retain)
    .then(publish).expect(s.attempts == 1 and s.published and invariant)
}

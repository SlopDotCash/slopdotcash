// @source workers/slopbot/routing.ts
// @source workers/slopbot/contracts.ts
// Advisory eligibility and closure authority remain separate. This models
// route precedence, not a proof of the model's semantic classification.
module bot_review_admission {
  var s: { open: bool, draft: bool, bot: bool, humanReopened: bool,
    securityOnly: bool, qualified: bool, routed: bool, review: bool, close: bool }
  action init = s' = {open: true, draft: false, bot: false, humanReopened: false,
    securityOnly: false, qualified: false, routed: false, review: false, close: false}
  action context(open: bool, draft: bool, bot: bool, reopened: bool, security: bool, qualified: bool): bool = all {
    not(s.routed), s' = s.with("open", open).with("draft", draft).with("bot", bot)
      .with("humanReopened", reopened).with("securityOnly", security).with("qualified", qualified) }
  val eligible = s.open and not(s.draft) and not(s.bot) and not(s.humanReopened)
  action route = all { not(s.routed), s' = s.with("routed", true).with("review", eligible)
    .with("close", eligible and not(s.securityOnly) and s.qualified) }
  action step = { nondet open = Set(true, false).oneOf(); nondet draft = Set(true, false).oneOf()
    nondet bot = Set(true, false).oneOf(); nondet reopened = Set(true, false).oneOf()
    nondet security = Set(true, false).oneOf(); nondet qualified = Set(true, false).oneOf()
    any { context(open, draft, bot, reopened, security, qualified), route, s' = s } }
  val invariant = all { s.close implies s.review and s.qualified and not(s.securityOnly),
    s.review implies eligible }
  run humanReopenPreservedTest = init.then(context(true, false, false, true, false, true))
    .then(route).expect(not(s.review) and not(s.close))
  run pausedSecurityOnlyTest = init.then(context(true, false, false, false, true, true))
    .then(route).expect(s.review and not(s.close))
}

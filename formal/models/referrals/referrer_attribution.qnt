// @source migrations/0055_project_referrer.sql
// @source backend/projects/handler.ts
// @source backend/projects/cloudflare-persistence.ts
// Referral attribution is fixed at application submission and copied on
// approval. Lookup must find an existing signed-in non-conflicted account.
module referrer_attribution {
  type S = { application: bool, approved: bool, appReferrer: int, projectReferrer: int, paid: bool }
  var s: S
  action init = s' = { application: false, approved: false, appReferrer: 0, projectReferrer: 0, paid: false }
  action submit(id: int, signedIn: bool, conflicted: bool): bool = all {
    not(s.application), id == 0 or (signedIn and not(conflicted)),
    s' = s.with("application", true).with("appReferrer", id) }
  action approve = all { s.application, not(s.approved),
    s' = s.with("approved", true).with("projectReferrer", s.appReferrer) }
  action revise(id: int): bool = all { s.approved, id == s.projectReferrer, s' = s }
  action step = any { submit(0, false, false), submit(1, true, false), submit(1, false, false),
    submit(1, true, true), approve, revise(0), revise(1), revise(2), s' = s }
  val invariant = all { not(s.paid), s.approved implies s.projectReferrer == s.appReferrer }
  run approvedAttributionFixedTest = init.then(submit(1, true, false)).then(approve).expect(invariant).then(revise(2).fail())
  run absentAttributionCannotBeAddedLaterTest = init.then(submit(0, false, false)).then(approve).then(revise(1).fail())
  run conflictedReferrerRefusedTest = init.then(submit(1, true, true).fail())
}

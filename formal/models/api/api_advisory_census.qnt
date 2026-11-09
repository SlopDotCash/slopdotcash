// @source backend/security/advisories.ts
// Private report enumeration is complete or unavailable. No token, cross-origin
// pagination, truncated list or provider failure can become an empty success.
module api_advisory_census {
  var s: { token: bool, pages: int, expected: int, reports: int, failed: bool, status: str }
  action init = s' = {token: false, pages: 0, expected: 2, reports: 0, failed: false, status: "loading"}
  action authenticate = s' = s.with("token", true)
  action page(hasReport: bool): bool = all { s.token, s.status == "loading", not(s.failed), s.pages < s.expected,
    s' = s.with("pages", s.pages + 1).with("reports", s.reports + (if (hasReport) 1 else 0)) }
  action failedRead = all { s.status == "loading", s' = s.with("failed", true).with("status", "unavailable") }
  action complete = all { s.token, s.pages == s.expected, not(s.failed), s.status == "loading",
    s' = s.with("status", "ok") }
  action step = any { authenticate, page(true), page(false), failedRead, complete, s' = s }
  val invariant = s.status == "ok" implies s.token and s.pages == s.expected and not(s.failed)
  run partialIsUnavailableTest = init.then(authenticate).then(page(true)).then(failedRead)
    .expect(s.status == "unavailable" and s.reports == 1)
  run verifiedEmptyTest = init.then(authenticate).then(page(false)).then(page(false)).then(complete)
    .expect(s.status == "ok" and s.reports == 0)
}

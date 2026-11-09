// @source backend/security/advisories.ts
// @evidence backend/security/advisories.test.ts
// One list or exact-advisory call. The two-page bound represents the source's
// 20-page cap: completion at the cap is allowed, a further Link is unavailable.
// Each representative page has at most two rows. 0 is a nonqualifying record;
// 1/2 are valid reports ordered by their creation time/identifier. Parsing,
// token contents, HTTP deadlines and JSON byte limits are input predicates.
// Reports stay private until the whole list succeeds. Invalid rows are ignored,
// duplicates are retained, and failures never publish a partial/empty success.
// Same-origin pagination is the actual rule; no stronger path/repository rule
// is inferred. Provider response identity remains an external assumption.
// An invalid configured origin throws before the list's try block; the single
// lookup catches it after token retrieval. Normal deployments supply valid URLs.
// Rejected response-body disposal and the caller's later private authorization
// are outside this model. No source or model execution is claimed here.
module api_advisory_census {
  type State = { phase: str, mode: str, originValid: bool, token: bool,
    pages: int, fetches: int, buffered: List[int], published: List[int], status: str }
  var s: State
  val batches = Set(List(), List(0), List(1), List(2), List(2, 1), List(1, 1))
  def ordered(rows: List[int]): List[int] =
    rows.select(id => id == 1).concat(rows.select(id => id == 2))
  def stopped(status: str): State =
    s.with("phase", "done").with("status", status).with("published", List())
  action init = s' = { phase: "input", mode: "list", originValid: true,
    token: false, pages: 0, fetches: 0, buffered: List(), published: List(), status: "loading" }
  action begin(mode: str, repositoryValid: bool, idValid: bool, originValid: bool): bool = all {
    s.phase == "input", Set("list", "single").contains(mode),
    s' = (if (not(repositoryValid) or (mode == "single" and not(idValid))) stopped("unavailable")
      else if (mode == "list" and not(originValid)) stopped("thrown")
      else s.with("phase", "token"))
      .with("mode", mode).with("originValid", originValid) }
  action tokenReply(present: bool): bool = all { s.phase == "token",
    s' = (if (present and s.originValid) s.with("phase", "ready")
      else stopped("unavailable")).with("token", present) }
  action tokenReject = all { s.phase == "token", s' = stopped("unavailable") }
  action send = all { s.phase == "ready", s.token, s.originValid,
    s' = s.with("phase", "network").with("fetches", s.fetches + 1) }
  action response(ok: bool): bool = all { s.phase == "network",
    s' = if (ok) s.with("phase", "body") else stopped("unavailable") }
  action networkReject = all { s.phase == "network", s' = stopped("unavailable") }
  action bodyReject = all { s.phase == "body", s' = stopped("unavailable") }
  action listBody(rows: List[int]): bool = all {
    s.phase == "body", s.mode == "list", batches.contains(rows),
    s' = s.with("phase", "link").with("pages", s.pages + 1)
      .with("buffered", s.buffered.concat(rows.select(id => id > 0))) }
  action singleBody(qualifying: bool, id: int): bool = all {
    s.phase == "body", s.mode == "single", Set(1, 2).contains(id),
    s' = if (qualifying) s.with("phase", "done").with("status", "found")
      .with("buffered", List(id)).with("published", List(id))
      else stopped("unavailable") }
  action pagination(kind: str): bool = all {
    s.phase == "link", Set("end", "same-origin", "foreign-origin", "invalid-url").contains(kind),
    s' = if (kind == "end") s.with("phase", "done").with("status", "ok")
      .with("published", ordered(s.buffered))
      else if (kind == "same-origin" and s.pages < 2) s.with("phase", "ready")
      else stopped("unavailable") }
  action step = {
    nondet mode = Set("list", "single").oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    nondet origin = Set(false, true).oneOf()
    nondet rows = batches.oneOf()
    nondet id = Set(1, 2).oneOf()
    nondet kind = Set("end", "same-origin", "foreign-origin", "invalid-url").oneOf()
    any { begin(mode, yes, other, origin), tokenReply(yes), tokenReject, send,
      response(yes), networkReject, bodyReject, listBody(rows), singleBody(yes, id),
      pagination(kind), s' = s }
  }
  val invariant = all {
    s.pages <= 2, s.fetches <= (if (s.mode == "single") 1 else 2),
    s.buffered.length() <= 4,
    s.fetches > 0 implies s.token and s.originValid,
    Set("loading", "unavailable", "thrown").contains(s.status) implies s.published == List(),
    s.status == "ok" implies s.phase == "done" and s.mode == "list"
      and s.pages > 0 and s.published == ordered(s.buffered),
    s.status == "found" implies s.phase == "done" and s.mode == "single"
      and s.published.length() == 1
  }
  action authenticatedList = begin("list", true, true, true).then(tokenReply(true))
  action authenticatedSingle = begin("single", true, true, true).then(tokenReply(true))
  action page(rows: List[int]): bool = send.then(response(true)).then(listBody(rows))
  run partialIsUnavailableTest = init.then(authenticatedList).then(page(List(1)))
    .then(pagination("same-origin")).then(send).then(networkReject)
    .expect(s.status == "unavailable" and s.buffered == List(1) and s.published == List() and invariant)
  run verifiedEmptyTest = init.then(authenticatedList).then(page(List()))
    .then(pagination("same-origin")).then(page(List())).then(pagination("end"))
    .expect(s.status == "ok" and s.published == List() and invariant)
  run onePageCanCompleteTest = init.then(authenticatedList).then(page(List(2, 1)))
    .then(pagination("end")).expect(s.published == List(1, 2) and s.fetches == 1 and invariant)
  run duplicatesAreNotInventedOrRemovedTest = init.then(authenticatedList).then(page(List(1, 1)))
    .then(pagination("end")).expect(s.published == List(1, 1) and invariant)
  run nonqualifyingRecordsCanYieldVerifiedEmptyTest = init.then(authenticatedList).then(page(List(0)))
    .then(pagination("end")).expect(s.status == "ok" and s.published == List() and invariant)
  run noPartialPublicationBetweenPagesTest = init.then(authenticatedList).then(page(List(1)))
    .expect(s.status == "loading" and s.published == List() and invariant)
  run foreignLinkCannotReceiveTokenTest = init.then(authenticatedList).then(page(List(1)))
    .then(pagination("foreign-origin")).expect(s.status == "unavailable" and s.fetches == 1 and invariant)
  run malformedUrlIsUnavailableTest = init.then(authenticatedList).then(page(List(1)))
    .then(pagination("invalid-url")).expect(s.status == "unavailable" and s.published == List() and invariant)
  run completionAtPageCapIsAllowedTest = init.then(authenticatedList).then(page(List(2)))
    .then(pagination("same-origin")).then(page(List(1))).then(pagination("end"))
    .expect(s.pages == 2 and s.status == "ok" and s.published == List(1, 2) and invariant)
  run furtherPageAtCapRefusesWholeListTest = init.then(authenticatedList).then(page(List(1)))
    .then(pagination("same-origin")).then(page(List(2))).then(pagination("same-origin"))
    .expect(s.status == "unavailable" and s.fetches == 2 and s.published == List() and invariant)
  run missingTokenOwnsNoRequestTest = init.then(begin("list", true, true, true)).then(tokenReply(false))
    .expect(s.status == "unavailable" and s.fetches == 0 and invariant)
  run tokenRejectionOwnsNoRequestTest = init.then(begin("list", true, true, true)).then(tokenReject)
    .expect(s.status == "unavailable" and s.fetches == 0 and invariant)
  run invalidRepositoryDoesNotRequestTokenTest = init.then(begin("list", false, true, true))
    .expect(s.status == "unavailable" and not(s.token) and invariant)
  run invalidSingleIdentifierIsUnavailableTest = init.then(begin("single", true, false, true))
    .expect(s.status == "unavailable" and s.fetches == 0 and invariant)
  run invalidListConfigurationThrowsBeforeTokenTest = init.then(begin("list", true, true, false))
    .expect(s.status == "thrown" and not(s.token) and invariant)
  run invalidSingleConfigurationIsCaughtTest = init.then(begin("single", true, true, false)).then(tokenReply(true))
    .expect(s.status == "unavailable" and s.token and s.fetches == 0 and invariant)
  run redirectOrHttpRefusalIsNotAnEmptyListTest = init.then(authenticatedList).then(send).then(response(false))
    .expect(s.status == "unavailable" and invariant)
  run boundedJsonFailureDoesNotPublishEarlierRowsTest = init.then(authenticatedList).then(page(List(1)))
    .then(pagination("same-origin")).then(send).then(response(true)).then(bodyReject)
    .expect(s.status == "unavailable" and s.buffered == List(1) and s.published == List() and invariant)
  run exactSingleReportCanCompleteTest = init.then(authenticatedSingle).then(send).then(response(true))
    .then(singleBody(true, 2)).expect(s.status == "found" and s.published == List(2) and invariant)
  run nonqualifyingSingleReportStaysUnavailableTest = init.then(authenticatedSingle).then(send).then(response(true))
    .then(singleBody(false, 1)).expect(s.status == "unavailable" and s.published == List() and invariant)
}

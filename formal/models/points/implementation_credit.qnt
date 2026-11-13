// @source src/lib/commit-credit.ts
// @source src/lib/leaderboard.ts
// @source workers/slopbot/value-evidence.ts
// @source workers/slopbot/value-work-unit.ts
// @source scripts/generate-leaderboard.ts
// @source scripts/retained-commit-credit.ts
// @source scripts/value-ingestion.ts
// @evidence scripts/commit-credit.test.ts
// Finite abstraction of recipient selection for two primary commit authors.
// Humans 1 (carrier), 2 (contributor), 3 (original PR creator); 0 is unlinked,
// 4 a bot and 5 a vendor agent. Identity and retained-copy verification are
// external predicates: this model does not prove GitHub or patch identity.
// The existing score allocator is abstracted by an unchanged work-unit total.
module implementation_credit {
  val humans = Set(1, 2, 3)
  val authors = Set(0, 1, 2, 3, 4, 5)
  var s: { selected: bool, source: int, first: int, second: int,
    recipients: Set[int], recorded: bool, total: int }
  pure def recipient(source: int, author: int): Set[int] =
    if (humans.contains(author)) Set(author)
    else if (humans.contains(source)) Set(source) else Set()
  action init = s' = { selected: false, source: 0, first: 0, second: 0,
    recipients: Set(), recorded: false, total: 6 }
  action chooseRecipients(source: int, first: int, second: int): bool = all {
    not(s.selected), Set(0, 1, 3, 4).contains(source),
    authors.contains(first), authors.contains(second),
    s' = s.with("selected", true).with("source", source)
      .with("first", first).with("second", second)
      .with("recipients", recipient(source, first).union(recipient(source, second)))
  }
  action record = all { s.selected, not(s.recorded), s.recipients != Set(),
    s' = s.with("recorded", true) }
  action retry = s' = s
  action oldCarrierBonus = all { s.selected, s' = s.with("recipients", s.recipients.union(Set(1))) }
  action step = if (s.selected) any { record, retry } else any {
    { nondet source = Set(0, 1, 3, 4).oneOf()
      nondet first = authors.oneOf()
      nondet second = authors.oneOf()
      chooseRecipients(source, first, second) }, retry
  }
  val invariant = all {
    s.recipients.subseteq(humans), s.total == 6,
    s.selected implies s.recipients == recipient(s.source, s.first).union(recipient(s.source, s.second)),
    s.recorded implies s.selected and s.recipients != Set(),
    (s.selected and humans.contains(s.first) and humans.contains(s.second))
      implies s.recipients == Set(s.first, s.second)
  }
  run carrierGetsNoAutomaticShareTest = init.then(chooseRecipients(1, 2, 2)).then(record)
    .expect(s.recipients == Set(2) and invariant)
  run maintainerImplementationStillCreditedTest = init.then(chooseRecipients(1, 2, 1)).then(record)
    .expect(s.recipients == Set(1, 2) and s.total == 6 and invariant)
  run verifiedOriginalFallbackTest = init.then(chooseRecipients(3, 0, 0)).then(record)
    .expect(s.recipients == Set(3) and invariant)
  run ordinaryUnlinkedFallbackTest = init.then(chooseRecipients(1, 0, 2)).then(record)
    .expect(s.recipients == Set(1, 2) and invariant)
  run botsAndVendorAgentsCannotReceiveTest = init.then(chooseRecipients(3, 4, 5)).then(record)
    .expect(s.recipients == Set(3) and invariant)
  run missingHumanIdentityDoesNotCreditTest = init.then(chooseRecipients(4, 0, 5))
    .expect(s.recipients == Set() and invariant).then(record.fail())
  run repeatedCommitsAndRetriesDoNotMultiplyTest = init.then(chooseRecipients(1, 2, 2))
    .then(record).then(retry).then(retry).expect(s.recipients == Set(2) and s.total == 6 and invariant)
  run oldCarrierCreditNegativeControlTest = init.then(chooseRecipients(1, 2, 2))
    .then(oldCarrierBonus).expect(not(invariant))
}

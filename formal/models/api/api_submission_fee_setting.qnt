// @source src/lib/submission-fee-setting.mjs
// @source src/lib/submission-fee.mjs
// @source src/lib/project-schema.mjs
// @source src/ProjectProposalPage.tsx
// @source workers/slopbot/submission-fee.ts
// @evidence src/lib/submission-fee-setting.test.ts
// @evidence workers/slopbot/submission-fee.test.ts
// The owner's submission fee setting (operator decision, 18 November 2026;
// PRD section 5). `slopbot.submissionFee` is absent, on or off, with an
// optional amount; every change is an immutable owner revision. The new
// project form starts with it on for a project that takes contributions and
// leaves it out of a listing that is only a security program; an existing
// project has it only once its owner publishes it. Amounts are whole units:
// MIN..MAX abstract 1.00..10.00 and DEFAULT 2.00; an amount outside the range
// is refused and changes nothing. `since` is the revision at which the
// setting was last turned on: an amount change keeps it, off clears it, on
// again moves it. A pull request opened at or before `since` is never asked.
// The amount of a pull request is fixed when it is first asked; a later
// change applies to pull requests first asked after it.
module api_submission_fee_setting {
  pure val MIN = 1
  pure val MAX = 3
  pure val DEFAULT = 2
  pure val MAX_REVISION = 4
  var s: {
    exists: bool,       // the project was created
    state: str,         // absent, on, off
    amount: int,        // 0 abstracts "no amount stored"
    revision: int,
    since: int,         // 0 abstracts "off"
    opened: int,        // the revision in force when the pull request opened; 0: none
    asked: int          // the amount fixed for the pull request; 0: not asked
  }
  action init = s' = { exists: false, state: "absent", amount: 0, revision: 0,
    since: 0, opened: 0, asked: 0 }
  // The fee a project asks now: 0 when its setting is off or absent.
  val fee = if (s.state != "on") 0 else if (s.amount == 0) DEFAULT else s.amount
  // The new project form: on by default, never on a security-only listing.
  action create(takesContributions: bool, keepsDefault: bool): bool = all {
    not(s.exists),
    s' = if (takesContributions and keepsDefault)
        s.with("exists", true).with("state", "on").with("revision", 1).with("since", 1)
      else s.with("exists", true).with("revision", 1)
  }
  // An owner revision that turns the setting on or changes its amount.
  action publishOn(amount: int): bool = all { s.exists, s.revision < MAX_REVISION,
    amount >= MIN, amount <= MAX,
    not(s.state == "on" and s.amount == amount),
    s' = s.with("state", "on").with("amount", amount)
      .with("revision", s.revision + 1)
      .with("since", if (s.state == "on") s.since else s.revision + 1)
  }
  // An amount outside the range is refused by the schema: nothing changes.
  action refuseAmount(amount: int): bool = all { s.exists,
    amount < MIN or amount > MAX, s' = s }
  // Off keeps the last amount, so turning it back on restores it.
  action publishOff = all { s.exists, s.state == "on", s.revision < MAX_REVISION,
    s' = s.with("state", "off").with("revision", s.revision + 1).with("since", 0)
  }
  action contributorOpens = all { s.exists, s.opened == 0,
    s' = s.with("opened", s.revision) }
  // Slopbot's first ask fixes the amount; a later ask changes nothing.
  val applies = fee > 0 and s.opened > 0 and s.since > 0 and s.opened >= s.since
  action firstAsk = all { applies, s.asked == 0, s' = s.with("asked", fee) }
  action step = {
    nondet amount = Set(0, 1, 2, 3, 4).oneOf()
    nondet contributions = Set(true, false).oneOf()
    nondet keeps = Set(true, false).oneOf()
    any { create(contributions, keeps), publishOn(amount), refuseAmount(amount),
      publishOff, contributorOpens, firstAsk, s' = s }
  }
  val invariant = all {
    // A stored amount is always inside the range.
    s.amount == 0 or (s.amount >= MIN and s.amount <= MAX),
    (s.state == "on") == (s.since > 0),
    s.since <= s.revision,
    // Whatever was asked was a valid fee, and it never changes afterwards.
    s.asked == 0 or (s.asked >= MIN and s.asked <= MAX),
    // Nothing is asked of a pull request opened before the setting came on.
    s.asked > 0 implies s.opened > 0,
    not(s.exists) implies (s.state == "absent" and s.asked == 0),
  }
  run newContributionProjectStartsOnTest = init.then(create(true, true))
    .expect(s.state == "on" and fee == DEFAULT and s.since == 1)
  run securityOnlyListingStartsWithoutItTest = init.then(create(false, true))
    .expect(s.state == "absent" and fee == 0)
  run ownerMayUntickTheDefaultTest = init.then(create(true, false))
    .expect(s.state == "absent" and fee == 0)
  run amountOutsideTheRangeIsRefusedTest = init.then(create(true, true))
    .then(refuseAmount(4)).then(refuseAmount(0))
    .expect(s.amount == 0 and fee == DEFAULT and s.revision == 1)
  run amountChangeKeepsTheStartTest = init.then(create(true, true))
    .then(publishOn(3))
    .expect(fee == 3 and s.since == 1 and s.revision == 2)
  run offThenOnMovesTheStartTest = init.then(create(true, true))
    .then(publishOff).then(publishOn(1))
    .expect(fee == 1 and s.since == 3)
  run laterChangeDoesNotMoveAnAskedAmountTest = init.then(create(true, true))
    .then(contributorOpens).then(firstAsk).then(publishOn(3))
    .expect(s.asked == DEFAULT and fee == 3)
  run openedBeforeTheSettingIsNeverAskedTest = init.then(create(true, false))
    .then(contributorOpens).then(publishOn(2))
    .expect(not(applies) and s.asked == 0)
}

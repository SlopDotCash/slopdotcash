// @source src/StandingDepositPage.tsx
// @source src/lib/standing-deposit-page.ts
// @source backend/standing-deposit/handler.ts
// @evidence tests/e2e/standing-deposit.spec.ts
// @evidence backend/standing-deposit/handler.test.ts
// The /deposit page and its API for one signed-in contributor (operator
// decision, 23 November 2026; PRD section 5, "Standing deposit"). While no
// contract is recorded the page shows one sentence and no control. Otherwise
// it states the terms before any wallet, asks the API to create the row with
// the amount of the rate in force, and offers a wallet only for a record whose
// contract, item, token, burn address and whole-SLOP amount all match. It
// reads the record again just before asking the wallet and sends nothing when
// the amount changed or the row is already paid. The amount of an unpaid row
// changes only when the contributor asks for it. Withdraw needs a second
// press: it cancels an unpaid row, or records a paid row's request once.
module ui_standing_deposit {
  var deployed: bool
  var rate: bool
  var row: str        // none | unpaid | cancelled | paid | requested
  var amount: int     // the row's amount, 0 or 1 or 2
  var shown: int      // the amount the page last read
  var recordOk: bool  // the record matches the published tables
  var walletAsked: int   // 0, or 1 once a wallet was asked
  var confirming: bool

  action init = all { nondet d = Set(true, false).oneOf() nondet r = Set(true, false).oneOf()
    nondet ok = Set(true, false).oneOf()
    all { deployed' = d, rate' = r, row' = "none", amount' = 0, shown' = 0, recordOk' = ok,
      walletAsked' = 0, confirming' = false } }

  action post = all { deployed, rate, Set("none", "cancelled").contains(row), row' = "unpaid", amount' = 1,
    shown' = 1, deployed' = deployed, rate' = rate, recordOk' = recordOk, walletAsked' = walletAsked,
    confirming' = false }
  action refresh = all { row == "unpaid", rate, amount' = 2, shown' = 2, row' = row, deployed' = deployed,
    rate' = rate, recordOk' = recordOk, walletAsked' = walletAsked, confirming' = confirming }
  // Another tab refreshes the amount, or the Worker marks the row paid,
  // without this page reading it.
  action elsewhere = all { row == "unpaid", nondet n = Set(1, 2).oneOf() nondet paid = Set(true, false).oneOf()
    all { amount' = n, row' = if (paid) "paid" else row, shown' = shown, deployed' = deployed,
      rate' = rate, recordOk' = recordOk, walletAsked' = walletAsked, confirming' = confirming } }
  // Pay: read again, then ask the wallet only for an unchanged unpaid row.
  action pay = all { deployed, recordOk, row == "unpaid", amount == shown,
    walletAsked' = 1, row' = row, amount' = amount, shown' = shown, deployed' = deployed,
    rate' = rate, recordOk' = recordOk, confirming' = confirming }
  action payRefused = all { deployed, row == "unpaid", not(recordOk) or amount != shown,
    shown' = amount, walletAsked' = walletAsked, row' = row, amount' = amount, deployed' = deployed,
    rate' = rate, recordOk' = recordOk, confirming' = confirming }
  action pressWithdraw = all { Set("unpaid", "paid").contains(row), not(confirming), confirming' = true,
    row' = row, amount' = amount, shown' = shown, deployed' = deployed, rate' = rate,
    recordOk' = recordOk, walletAsked' = walletAsked }
  action confirmWithdraw = all { confirming,
    row' = if (row == "unpaid") "cancelled" else if (row == "paid") "requested" else row,
    confirming' = false, amount' = amount, shown' = shown, deployed' = deployed, rate' = rate,
    recordOk' = recordOk, walletAsked' = walletAsked }

  action step = any { post, refresh, elsewhere, pay, payRefused, pressWithdraw, confirmWithdraw,
    all { deployed' = deployed, rate' = rate, row' = row, amount' = amount, shown' = shown,
      recordOk' = recordOk, walletAsked' = walletAsked, confirming' = confirming } }

  val invariant = all {
    // Nothing is offered or created while no contract is recorded or no rate is in force.
    not(deployed) implies (row == "none" and walletAsked == 0),
    not(rate) implies row == "none",
    // A wallet is never asked for a record that fails the checks.
    not(recordOk) implies walletAsked == 0
  }

  run notDeployedOffersNothingTest = init.then(all { deployed' = false, rate' = true, row' = "none",
      amount' = 0, shown' = 0, recordOk' = true, walletAsked' = 0, confirming' = false })
    .then(post.fail())
  run changedAmountSendsNothingTest = init.then(all { deployed' = true, rate' = true, row' = "none",
      amount' = 0, shown' = 0, recordOk' = true, walletAsked' = 0, confirming' = false })
    .then(post).then(all { amount' = 2, row' = row, shown' = shown, deployed' = deployed, rate' = rate,
      recordOk' = recordOk, walletAsked' = walletAsked, confirming' = confirming })
    .then(pay.fail())
  run withdrawNeedsConfirmationTest = init.then(all { deployed' = true, rate' = true, row' = "none",
      amount' = 0, shown' = 0, recordOk' = true, walletAsked' = 0, confirming' = false })
    .then(post).then(pay).then(all { row' = "paid", amount' = amount, shown' = shown, deployed' = deployed,
      rate' = rate, recordOk' = recordOk, walletAsked' = walletAsked, confirming' = confirming })
    .then(confirmWithdraw.fail())
  run paidRowWithdrawRecordedTest = init.then(all { deployed' = true, rate' = true, row' = "paid",
      amount' = 1, shown' = 1, recordOk' = true, walletAsked' = 1, confirming' = false })
    .then(pressWithdraw).then(confirmWithdraw).expect(row == "requested" and invariant)
}

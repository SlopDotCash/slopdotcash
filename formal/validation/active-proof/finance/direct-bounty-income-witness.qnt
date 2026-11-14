module direct_bounty_income_witness {
  import fees__directBountyIncome as F from "../../../../gen/fees__directBountyIncome"
  import settlement__directBounty as D from "../../../../gen/settlement__directBounty"
  import settlement__money as M from "../../../../gen/settlement__money"

  var clock: int
  action init = clock' = 0

  pure val prepared = {
    val admitted = D::admit(D::initial, D::termsEvm, 1, true, true)
    val wallets = D::observeWallets(admitted, D::payerOne, D::reporterOne, true)
    val consented = D::consent(wallets, D::reporterOne, 1, true, 2)
    D::prepare(consented, D::evmIntent, 2, true, true, 1)
  }

  run verifiedFeeCashWaitsForCompleteCaseBookingTest = init.expect({
    val partial = D::recordTransfer(prepared, D::feeTransfer, 3, 0, true)
    val cash = F::recordCash(F::initial, partial, true)
    val complete = D::recordTransfer(partial, D::researcherTransfer, 4, 0, true)
    val booked = F::book(cash, complete, F::separateTimes, true)
    and {
      D::canRecordTransfer(prepared, D::feeTransfer, 3, 0, true),
      F::cashFact(partial, false).status == F::UnknownCash,
      F::cashFact(prepared, true).status == F::NoFeeReceipt,
      F::cashFact(partial, true).status == F::FeeReceived,
      F::canRecordCash(F::initial, partial, true),
      not(F::canRecordCash(cash, partial, true)),
      F::bookingStatus(partial, F::separateTimes, true) == F::AwaitingCompletion,
      not(F::canBook(cash, partial, F::separateTimes, true)),
      M::equalAmounts(F::receivedFor(cash, D::Base, "asset", "fees"), List(25)),
      M::equalAmounts(F::incomeFor(cash, D::Base, "asset", "fees"), M::zero),
      D::canRecordTransfer(partial, D::researcherTransfer, 4, 0, true),
      F::canBook(cash, complete, F::separateTimes, true),
      F::alwaysBookingBackedByCash(booked),
      not(F::canBook(booked, complete, F::separateTimes, true)),
      F::readback(booked, complete, F::separateTimes, true),
      booked.entries[0].sourceKey.transaction == "fee-tx", booked.entries[0].researcherTx == "researcher-tx",
      M::equalAmounts(F::incomeFor(booked, D::Base, "asset", "fees"), List(25)),
      M::equalAmounts(F::incomeFor(booked, D::Ethereum, "asset", "fees"), M::zero),
      M::equalAmounts(F::incomeFor(booked, D::Base, "asset", "different-wallet"), M::zero)
    }
  })

  run canonicalTimesExcludeEarlierIncomeAndHoldMissingEvidenceTest = init.expect({
    val complete = F::separatePaid
    val cash = F::recordCash(F::initial, complete, true)
    val missing = { ...F::separateTimes, feeTime: { ...F::feeClock, authenticated: false } }
    val wrong = { ...F::separateTimes, feeTime: { ...F::feeClock, transaction: "researcher-tx" } }
    val early = { ...F::separateTimes, feeTime: { ...F::feeClock, chainTime: F::buybackCutover - 1 } }
    val exactEdge = { ...F::separateTimes, feeTime: { ...F::feeClock, chainTime: F::buybackCutover } }
    val lateRecorded = { ...early, originalPreparedAt: F::buybackCutover + 1 }
    and {
      F::bookingStatus(complete, missing, true) == F::UnknownBooking,
      F::bookingStatus(complete, wrong, true) == F::UnknownBooking,
      not(F::canBook(cash, complete, missing, true)),
      F::bookingStatus(complete, early, true) == F::CompletedBeforeCutover,
      F::canBook(cash, complete, exactEdge, true),
      not(F::pinnedPreparedFilter(complete, exactEdge, true)),
      F::pinnedPreparedFilter(complete, lateRecorded, true),
      not(F::canBook(cash, complete, lateRecorded, true))
    }
  })

  run solanaBundleAddsOneFeeAndRequiresOneMatchingTimeTest = init.expect({
    val complete = F::bundledPaid
    val cash = F::recordCash(F::initial, complete, true)
    val inconsistent = { ...F::bundleTimes, researcherTime: { ...F::bundleClock, chainTime: F::buybackCutover + 2 } }
    val booked = F::book(cash, complete, F::bundleTimes, true)
    and {
      cash.received.length() == 1,
      F::canBook(cash, complete, F::bundleTimes, true),
      not(F::canBook(cash, complete, inconsistent, true)),
      booked.entries.length() == 1,
      booked.entries[0].sourceKey.transaction == booked.entries[0].researcherTx,
      M::equalAmounts(F::incomeFor(booked, D::Solana, "asset", "fees"), List(25)),
      not(F::canRecordCash(booked, complete, true)), not(F::canBook(booked, complete, F::bundleTimes, true))
    }
  })

  run caseAndNetworkTransactionIdentitiesCannotReplayTest = init.expect({
    val cash = F::recordCash(F::initial, F::separatePaid, true)
    val booked = F::book(cash, F::separatePaid, F::separateTimes, true)
    val otherCase = { ...F::separatePaid, terms: { ...F::separatePaid.terms, caseId: 2 } }
    val otherChain = { ...otherCase, terms: { ...otherCase.terms, network: D::Ethereum },
      feeReceipt: { ...otherCase.feeReceipt, network: D::Ethereum }, researcherReceipt: { ...otherCase.researcherReceipt, network: D::Ethereum } }
    val otherTimes = { ...F::separateTimes, feeTime: { ...F::feeClock, network: D::Ethereum },
      researcherTime: { ...F::researcherClock, network: D::Ethereum } }
    val padded = { ...F::separatePaid, feeReceipt: { ...F::separatePaid.feeReceipt, fee: List(25, 0) } }
    and {
      not(F::canRecordCash(booked, otherCase, true)), not(F::canBook(booked, otherCase, F::separateTimes, true)),
      F::canRecordCash(booked, otherChain, true),
      F::canBook(F::recordCash(booked, otherChain, true), otherChain, otherTimes, true),
      F::readback(booked, padded, F::separateTimes, true)
    }
  })
}

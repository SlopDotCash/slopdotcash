module direct_bounty_witness {
  import settlement__directBounty as D from "../../../../gen/settlement__directBounty"
  import settlement__money as M from "../../../../gen/settlement__money"

  var clock: int
  action init = clock' = 0

  pure def ready(terms: D::Terms, intent: D::Intent): D::DirectBounty = {
    val admitted = D::admit(D::initial, terms, 1, true, true)
    val wallets = D::observeWallets(admitted, D::payerOne, D::reporterOne, true)
    val consented = D::consent(wallets, D::reporterOne, 1, true, 2)
    D::prepare(consented, intent, 2, true, true, 1)
  }

  pure def sound(b: D::DirectBounty): bool = and {
    D::alwaysUnadmittedEmpty(b), D::alwaysAdmittedTerms(b), D::alwaysIntentBound(b),
    D::alwaysResearcherReceipt(b), D::alwaysFeeReceipt(b), D::alwaysSolanaReceiptAtomic(b),
    D::alwaysIndependentReceiptIds(b), D::alwaysNoOtherTransactionReuse(b)
  }

  run walletChangeHoldsOnlyResearcherAndOldFinalizedPayoutStillCountsTest = init.expect({
    val original = ready(D::termsEvm, D::evmIntent)
    val changed = D::observeWallets(original, D::payerOne, D::reporterTwo, true)
    val partial = D::recordTransfer(changed, D::feeTransfer, 3, 0, true)
    val oldReceipt = { ...D::researcherTransfer, principal: List(75, 0) }
    val complete = D::recordTransfer(partial, oldReceipt, 4, 0, true)
    and {
      sound(original), D::pendingResearcherRequest(original),
      D::heldResearcher(changed), not(D::pendingResearcherRequest(changed)), D::pendingFeeRequest(changed),
      D::canRecordTransfer(changed, D::feeTransfer, 3, 0, true),
      not(D::paid(partial)), D::heldResearcher(partial), not(D::pendingFeeRequest(partial)),
      M::equalAmounts(D::receivedFee(partial), List(25)),
      not(D::canRecordTransfer(partial, D::feeTransfer, 4, 0, true)),
      not(D::canRecordTransfer(partial, oldReceipt, 3, 0, true)),
      not(D::canRecordTransfer(partial, { ...oldReceipt, height: 1 }, 4, 0, true)),
      D::canRecordTransfer(partial, oldReceipt, 4, 0, true),
      D::paid(complete), sound(complete),
      not(D::pendingResearcherRequest(complete)), not(D::pendingFeeRequest(complete))
    }
  })

  run feeOnlySuccessorKeepsThePaidResearcherAndOriginalPayerTest = init.expect({
    val original = ready(D::termsEvm, D::evmIntent)
    val partial = D::recordTransfer(original, D::researcherTransfer, 3, 0, true)
    val changed = D::observeWallets(partial, D::payerOne, D::reporterTwo, true)
    val recovered = D::recover(changed, D::nextFeeIntent, D::feeRetirement, 4, true, 1)
    val newFee = { ...D::feeTransfer, nonce: 2, height: 3, transaction: "new-fee" }
    and {
      D::canRecordTransfer(original, D::researcherTransfer, 3, 0, true),
      D::sometimesPartialResearcher(partial),
      not(D::canConsent(changed, D::reporterTwo, 4, true, 2)),
      not(D::canRecover(changed, D::nextFeeIntent, D::feeRetirement, 4, true, 2)),
      not(D::canRecover(changed, D::nextFeeIntent, { ...D::feeRetirement, certified: false }, 4, true, 1)),
      not(D::canRecover(changed, { ...D::nextFeeIntent, researcherAnchor: 2 }, D::feeRetirement, 4, true, 1)),
      D::canRecover(changed, D::nextFeeIntent, D::feeRetirement, 4, true, 1),
      D::stepPaidLegsUnchanged(changed, recovered), D::stepIntentHistory(changed, "recover", recovered),
      recovered.priorIntents[0].retirement == D::feeRetirement,
      not(D::canRecordTransfer(recovered, newFee, 5, 0, true)),
      not(D::canRecordTransfer(recovered, D::feeTransfer, 5, 1, true)),
      D::canRecordTransfer(recovered, newFee, 5, 1, true),
      D::paid(D::recordTransfer(recovered, newFee, 5, 1, true))
    }
  })

  run renewedConsentAndFinalizedRetirementMustMatchTheUnpaidRequestTest = init.expect({
    val original = ready(D::termsEvm, D::evmIntent)
    val partial = D::recordTransfer(original, D::feeTransfer, 3, 0, true)
    val changed = D::observeWallets(partial, D::payerOne, D::reporterTwo, true)
    val renewed = D::consent(changed, D::reporterTwo, 4, true, 2)
    val recovered = D::recover(renewed, D::nextResearcherIntent, D::researcherRetirement, 5, true, 1)
    and {
      not(D::canRecover(changed, D::nextResearcherIntent, D::researcherRetirement, 4, true, 1)),
      D::canConsent(changed, D::reporterTwo, 4, true, 2),
      not(D::canRecover(renewed, D::nextResearcherIntent, D::researcherRetirement, 4, true, 1)),
      not(D::canRecover(renewed, D::nextResearcherIntent, { ...D::researcherRetirement, lowerSettled: false }, 5, true, 1)),
      not(D::canRecover(renewed, { ...D::nextResearcherIntent, researcherNonce: 1 }, D::researcherRetirement, 5, true, 1)),
      D::canRecover(renewed, D::nextResearcherIntent, D::researcherRetirement, 5, true, 1),
      D::pendingResearcherRequest(recovered), not(D::pendingFeeRequest(recovered)),
      not(D::canRecordTransfer(recovered, D::researcherTransfer, 6, 1, true)), sound(recovered)
    }
  })

  run everyRetainedSolanaMessageNeedsRetirementEvidenceTest = init.expect({
    val original = ready(D::termsSolana, { ...D::solanaIntent, earlierMessages: List("earlier") })
    val changed = D::observeWallets(original, D::payerOne, D::reporterTwo, true)
    val renewed = D::consent(changed, D::reporterTwo, 3, true, 2)
    val retirement = { ...D::solanaRetirement, coveredMessages: List("earlier", "message") }
    val priorBundle = { ...D::bundledTransfer, message: "earlier" }
    val complete = D::recordTransfer(original, priorBundle, 3, 0, true)
    and {
      D::pendingBundleRequest(original), not(D::pendingBundleRequest(changed)),
      not(D::canRecordTransfer(original, { ...priorBundle, message: "wrong" }, 3, 0, true)),
      D::canRecordTransfer(original, priorBundle, 3, 0, true), D::paid(complete), sound(complete),
      complete.researcherReceipt.transaction == complete.feeReceipt.transaction,
      not(D::canRecover(renewed, D::nextSolanaIntent, D::solanaRetirement, 4, true, 1)),
      D::canRecover(renewed, D::nextSolanaIntent, retirement, 4, true, 1)
    }
  })

  run uniqueCanonicalTransactionAcrossLegsAndLedgersTest = init.expect({
    val original = ready(D::termsEvm, D::evmIntent)
    val otherUse = { network: D::Base, transaction: D::feeTransfer.transaction }
    val elsewhere = D::recordOtherUse(original, otherUse, true)
    val pair = { researcher: D::researcherTransfer, fee: D::feeTransfer }
    val paid = D::recordPair(original, pair, 3, 0, true)
    and {
      D::canRecordOtherUse(original, otherUse, true),
      not(D::canRecordTransfer(elsewhere, D::feeTransfer, 3, 0, true)),
      not(D::canRecordPair(elsewhere, pair, 3, 0, true)),
      not(D::canRecordPair(original, { ...pair, fee: { ...D::feeTransfer, transaction: D::researcherTransfer.transaction } }, 3, 0, true)),
      D::canRecordPair(original, pair, 3, 0, true), D::paid(paid), sound(paid),
      not(D::canRecordOtherUse(paid, otherUse, true)),
      D::canRecordOtherUse(paid, { ...otherUse, network: D::Ethereum }, true)
    }
  })
}

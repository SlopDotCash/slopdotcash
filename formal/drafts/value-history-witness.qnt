module slopbotValueHistoryWitness {
  import slopbot__valueHistory as H from "./slopbot__valueHistory"

  pure val one = { through: 5, total: 3, rows: 1, nextAfter: 1 }
  pure val two = { through: 5, total: 3, rows: 2, nextAfter: 0 }
  pure val finalSingle = { through: 1, total: 1, rows: 1, nextAfter: 0 }
  pure val first = H::closePage(H::acceptRow(H::acceptPage(H::initial, one), H::rootRecord))
  pure val second = H::acceptRow(H::acceptPage(first, two), H::siblingRecord)
  pure val joined = H::closePage(H::acceptRow(second, H::joinedRecord))
  pure val single = H::closePage(H::acceptRow(H::acceptPage(H::initial, finalSingle), H::rootRecord))
  pure val fresh: H::Observation = { ...H::sourceObservation, sourceDigest: 3, membersDigest: 3, claimsDigest: 3,
    observedSources: Set(1, 2), verifiedLegacySources: Set(1, 2), legacy: Set(8) }

  run siblingRootsJoinAcrossSparsePinnedPagesTest = all {
    H::canAcceptPage(H::initial, one),
    H::canClosePage(H::acceptRow(H::acceptPage(H::initial, one), H::rootRecord)),
    H::canAcceptPage(first, two),
    H::canAcceptRow(second, H::joinedRecord),
    joined.phase == H::HistoryReady,
    joined.selected == H::joinedRecord.digest,
    joined.retired == Set(1, 2),
    joined.rows.nth(0).sequence == 1 and joined.rows.nth(1).sequence == 3 and joined.rows.nth(2).sequence == 5,
    H::consume(joined, fresh).outcome == H::Assessed,
  }

  run driftEarlyCompletionAndWrongContinuationRefuseTest = {
    val changed = { ...two, through: 6 };
    val missing = { ...two, rows: 1 };
    val wrong = { ...one, nextAfter: 2 };
    all {
      H::canRejectPage(first, changed),
      H::rejectPage(first, changed).outcome == H::Invalid,
      H::canRejectPage(first, missing),
      H::closePage(H::acceptRow(H::acceptPage(H::initial, wrong), H::rootRecord)).outcome == H::Invalid,
    }
  }

  run omittedCurrentOwnerAndIncompletePredecessorRefuseTest = {
    val omitted = { ...H::joinedRecord, parents: Set(1) };
    val incomplete = { ...H::joinedRecord, sources: Set(1) };
    val dangling = { ...H::joinedRecord, parents: Set(1, 2, 4) };
    val contested = { ...H::joinedRecord, sources: Set(1), parents: Set(1), claims: Set(1, 2) };
    all {
      H::canRejectRow(second, omitted),
      H::canRejectRow(second, incomplete),
      H::canRejectRow(second, dangling),
      H::canRejectRow(second, contested),
      H::rejectRow(second, contested).outcome == H::Invalid,
      H::rejectRow(second, contested).rows == second.rows,
    }
  }

  run retiredParentCannotForkAndUnrelatedRootRefusesTest = {
    val rootPage = { through: 7, total: 4, rows: 4, nextAfter: 0 };
    val firstRoot = H::acceptRow(H::acceptPage(H::initial, rootPage), H::rootRecord);
    val secondRoot = H::acceptRow(firstRoot, H::siblingRecord);
    val preFork = H::acceptRow(secondRoot, H::joinedRecord);
    val fork = { ...H::joinedRecord, sequence: 7, digest: 4, parents: Set(1, 2) };
    val otherRoot = { ...H::rootRecord, sequence: 7, digest: 4, sources: Set(3), claims: Set(3) };
    all {
      H::canRejectRow(preFork, fork),
      H::canAcceptRow(preFork, otherRoot),
      H::closePage(H::acceptRow(preFork, otherRoot)).outcome == H::Invalid,
    }
  }

  run completeEvidenceKindsStayDistinctTest = {
    val opening = H::closePage(H::acceptPage(H::initial, H::noPage));
    val absent = H::consume(opening, H::sourceObservation);
    val incomplete = H::consume(single, { ...H::sourceObservation, completeEvidence: false });
    val stale = H::consume(joined, { ...fresh, legacy: Set(9) });
    val unknown = H::consume(joined, { ...fresh, verifiedLegacySources: Set(1) });
    val unresolved = H::consume(joined, { ...fresh, everyUnitAssessed: false });
    val mismatched = H::consume(joined, { ...fresh, claimsDigest: 2 });
    all {
      absent.outcome == H::Missing and not(H::mayReuseCurrent(absent)),
      incomplete.outcome == H::Incomplete and not(H::mayReuseCurrent(incomplete)),
      stale.outcome == H::Stale and not(H::mayReuseCurrent(stale)),
      unknown.outcome == H::Invalid and not(H::mayReuseCurrent(unknown)),
      unresolved.outcome == H::Unresolved and H::mayReuseCurrent(unresolved),
      mismatched.outcome == H::Invalid and not(H::mayReuseCurrent(mismatched)),
    }
  }
}

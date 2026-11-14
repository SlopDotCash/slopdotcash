module direct_bounty_prompt_witness {
  import frontend__directBountyPrompt as P from "../../../../gen/frontend__directBountyPrompt"

  var clock: int
  action init = clock' = 0

  pure val noInput = { firstInput: P::noCandidate, secondInput: P::noCandidate }
  pure val clearedFirst = { ...noInput, firstInput: { supplied: true, hash: "" } }
  pure val enteredFirst = { ...noInput, firstInput: { supplied: true, hash: "manual" } }

  pure val ready: P::Prompt = {
    val opened = P::open(P::initial, P::exampleScope, P::examplePlans, true)
    val first = P::mount(opened, P::FirstView, 1)
    P::mount(first, P::SecondView, 1)
  }

  run walletResultsMergeAcrossSlotsAndDepartureTest = init.expect({
    val a = ready
    val b = P::reserve(a, P::FirstView, P::FirstLeg, "one", true, true, 1)
    val c = P::reserve(b, P::SecondView, P::SecondLeg, "two", true, true, 1)
    val d = P::depart(c, P::FirstView)
    val e = P::resolve(d, P::SecondView, "two", P::Returned, "two-hash", true)
    val f = P::resolve(e, P::FirstView, "one", P::Returned, "one-hash", true)
    and {
      P::canReserve(a, P::FirstView, P::FirstLeg, "one", true, true, 1),
      not(P::canReserve(b, P::SecondView, P::FirstLeg, "two", true, true, 1)),
      not(P::canReserve(d, P::FirstView, P::FirstLeg, "three", true, true, 1)),
      P::canReserve(b, P::SecondView, P::SecondLeg, "two", true, true, 1),
      P::canResolve(e, P::FirstView, "one", P::Returned, "one-hash", true),
      f.store.first.hash == "one-hash", f.store.second.hash == "two-hash",
      not(f.firstView.mounted), f.firstView.local.first.hash == ""
    }
  })

  run lateReturnAndRejectionCannotOverwriteANewerSameNonceTest = init.expect({
    val a = ready
    val b = P::reserve(a, P::FirstView, P::FirstLeg, "one", true, true, 1)
    val c = P::observeEmpty(b, P::FirstLeg, true)
    val d = P::reserve(c, P::SecondView, P::FirstLeg, "two", true, true, 1)
    val returned = P::resolve(d, P::FirstView, "one", P::Returned, "old-hash", true)
    val declined = P::resolve(d, P::FirstView, "one", P::Declined, "", true)
    and {
      not(P::canObserveEmpty(b, P::FirstLeg, false)),
      not(P::canReserve(c, P::SecondView, P::FirstLeg, "one", true, true, 1)),
      returned.store == d.store, declined.store == d.store,
      returned.firstView.warning, d.store.first.identity == "two",
      not(P::canResolve(returned, P::FirstView, "one", P::Returned, "old-hash", true))
    }
  })

  run failedMarkerOrUnknownNeverLaunchesAnotherPromptTest = init.expect({
    val a = ready
    val refused = P::reserve(a, P::FirstView, P::FirstLeg, "one", true, false, 1)
    val marked = P::reserve(a, P::FirstView, P::FirstLeg, "two", true, true, 1)
    val uncertain = P::resolve(marked, P::FirstView, "two", P::Unknown, "", true)
    val declined = P::resolve(marked, P::FirstView, "two", P::Declined, "", true)
    and {
      not(P::canResolve(refused, P::FirstView, "one", P::Returned, "hash", true)),
      refused.store == P::noEntries, refused.firstView.warning,
      uncertain.store.first == marked.store.first, uncertain.firstView.warning,
      not(P::canReserve(uncertain, P::FirstView, P::FirstLeg, "three", true, true, 1)),
      P::canReserve(declined, P::FirstView, P::FirstLeg, "four", true, true, 1),
      not(P::canReserve(declined, P::FirstView, P::FirstLeg, "two", true, true, 1))
    }
  })

  run failedHashWriteRecoversOnlyOwnedMemoryTest = init.expect({
    val a = ready
    val b = P::reserve(a, P::FirstView, P::FirstLeg, "one", true, true, 1)
    val c = P::reserve(b, P::SecondView, P::SecondLeg, "two", true, true, 1)
    val known = P::resolve(c, P::FirstView, "one", P::Returned, "local-hash", false)
    val failed = P::check(known, P::FirstView, noInput, false, true, 1)
    val verified = P::check(known, P::FirstView, noInput, true, true, 1)
    val newer = P::observeHash(known, P::FirstLeg, "newer", true)
    val verifiedNewer = P::check(newer, P::FirstView, noInput, true, true, 1)
    val emptyFirst = P::observeEmpty(known, P::FirstLeg, true)
    val resetSecond = P::resolve(emptyFirst, P::SecondView, "two", P::Declined, "", true)
    val replacement = P::reserve(resetSecond, P::SecondView, P::FirstLeg, "three", true, true, 1)
    val stale = P::check(replacement, P::FirstView, noInput, true, true, 1)
    and {
      known.store.first.hash == "", known.firstView.local.first.hash == "local-hash",
      known.store.second.identity == "two",
      failed.out.length() == 0, failed.state.firstView.local.first.hash == "local-hash", failed.state.firstView.warning,
      verified.out.length() == 1, verified.out[0].hashes.firstHash == "local-hash",
      verified.state.store.first.identity == "one", verified.state.store.second.identity == "two",
      verifiedNewer.out.length() == 1, verifiedNewer.out[0].hashes.firstHash == "newer",
      stale.out.length() == 0, stale.state.store.first.identity == "three", stale.state.store.first.hash == ""
    }
  })

  run legacyAndExplicitClearNeverRepeatOrCheckTheStoredCandidateTest = init.expect({
    val opened = P::open(P::initial, P::exampleScope, P::examplePlans, true)
    val legacy = P::restoreLegacy(opened, P::FirstLeg, "legacy", true)
    val a = P::mount(legacy, P::FirstView, 1)
    val defaults = P::check(a, P::FirstView, noInput, true, true, 1)
    val cleared = P::check(a, P::FirstView, clearedFirst, true, true, 1)
    val edited = P::check(a, P::FirstView, enteredFirst, true, true, 1)
    and {
      not(P::canReserve(a, P::FirstView, P::FirstLeg, "one", true, true, 1)),
      not(P::canCheck(a, P::FirstView, noInput, true, true, 2)),
      defaults.out.length() == 1, defaults.out[0].hashes.firstHash == "legacy",
      cleared.out.length() == 0, cleared.state.store.first.candidate == "legacy",
      edited.out.length() == 1, edited.out[0].hashes.firstHash == "manual", edited.state.store.first.candidate == "manual"
    }
  })

  run candidateCompareAndSwapRefusesTheWholeCheckTest = init.expect({
    val a = ready
    val b = P::reserve(a, P::FirstView, P::FirstLeg, "one", true, true, 1)
    val c = P::observeEmpty(b, P::FirstLeg, true)
    val d = P::reserve(c, P::SecondView, P::FirstLeg, "two", true, true, 1)
    val rejected = P::check(d, P::FirstView, enteredFirst, true, true, 1)
    and { rejected.out.length() == 0, rejected.state.store == d.store, rejected.state.firstView.warning }
  })

  run markerFreshnessHasNoModelCountLimitTest = init.expect({
    val first = P::reserve(ready, P::FirstView, P::FirstLeg, "one", true, true, 1)
    val afterFirst = P::resolve(first, P::FirstView, "one", P::Declined, "", true)
    val second = P::reserve(afterFirst, P::FirstView, P::FirstLeg, "two", true, true, 1)
    val afterSecond = P::resolve(second, P::FirstView, "two", P::Declined, "", true)
    val third = P::reserve(afterSecond, P::FirstView, P::FirstLeg, "three", true, true, 1)
    val afterThird = P::resolve(third, P::FirstView, "three", P::Declined, "", true)
    and {
      not(P::canReserve(afterThird, P::FirstView, P::FirstLeg, "one", true, true, 1)),
      P::canReserve(afterThird, P::FirstView, P::FirstLeg, "four", true, true, 1),
      not(P::canCheck(afterThird, P::FirstView, { ...noInput, firstInput: { supplied: false, hash: "hidden" } }, true, true, 1))
    }
  })
}

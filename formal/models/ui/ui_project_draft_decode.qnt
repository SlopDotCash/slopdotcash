// @source src/ProjectProposalPage.tsx
// @source src/lib/project-draft-store.ts
// @evidence tests/e2e/project-draft-storage.spec.ts
// readDraft, initialReferrer, legacyProposalDraft and the create form's initial
// decode. One saved payload and one current URL. Field classes: 0 empty string,
// 1 short string, 2 exact limit, 3 oversized string, 4 non-string. Text/enum
// limits are 4000 UTF-16 units; image limit is 16384. Date/network/enum semantic
// validity is intentionally not part of this structural filter. Unknown fields
// are discarded. Parsed JSON/properties are ordinary data, not live accessors.
// Legacy storage failure is an input outcome; slot selection/locking and later
// write acknowledgements remain in ui_draft_slots/ui_draft_save_progress.
// Step values 98/99 represent fractional/nonfinite numbers, 97 a wrapper's
// numeric-looking string. Legacy Number() and JSON.stringify coercion are
// abstracted outcomes, not parser proofs. New scenarios are unexecuted.
module ui_project_draft_decode {
  type State = { phase: str, legacy: bool, storageOk: bool, wrapperObject: bool,
    proposalObject: bool, rawText: int, rawImage: int, rawEnum: int,
    savedRef: int, linkRef: int, modernStep: bool, rawStep: int,
    candidate: bool, nestedObject: bool, intermediateStep: int,
    text: int, image: int, enumValue: int, referrer: int, stepValue: int,
    unknownRetained: bool, returned: bool }
  var s: State
  val initial: State = { phase: "input", legacy: false, storageOk: true,
    wrapperObject: true, proposalObject: true, rawText: 1, rawImage: 1, rawEnum: 1,
    savedRef: 1, linkRef: 0, modernStep: true, rawStep: 2,
    candidate: false, nestedObject: false, intermediateStep: 0,
    text: 0, image: 0, enumValue: 1, referrer: 0, stepValue: 0,
    unknownRetained: false, returned: false }
  action init = s' = initial
  action profile(kind: int): bool = {
    val selected = if (kind == 1) initial.with("wrapperObject", false)
      else if (kind == 2) initial.with("proposalObject", false)
      else if (kind == 3) initial.with("rawText", 4)
      else if (kind == 4) initial.with("rawText", 3)
      else if (kind == 5) initial.with("rawText", 2)
      else if (kind == 6) initial.with("rawImage", 2)
      else if (kind == 7) initial.with("rawImage", 3)
      else if (kind == 8) initial.with("rawEnum", 2)
      else if (kind == 9) initial.with("rawEnum", 0)
      else if (kind == 10) initial.with("linkRef", 1)
      else if (kind == 11) initial.with("linkRef", 2)
      else if (kind == 12) initial.with("savedRef", 2)
      else if (kind == 13) initial.with("linkRef", 3)
      else if (kind == 14) initial.with("linkRef", 4)
      else if (kind == 15) initial.with("rawStep", 97)
      else if (kind == 16) initial.with("legacy", true).with("modernStep", true).with("rawStep", 0)
      else if (kind == 17) initial.with("legacy", true).with("modernStep", false).with("rawStep", 3)
      else if (kind == 18) initial.with("legacy", true).with("modernStep", false).with("rawStep", -1)
      else if (kind == 19) initial.with("legacy", true).with("modernStep", false).with("rawStep", 98)
      else if (kind == 20) initial.with("legacy", true).with("rawStep", 99)
      else if (kind == 21) initial.with("legacy", true).with("proposalObject", false).with("savedRef", 0)
      else if (kind == 22) initial.with("legacy", true).with("rawText", 0).with("rawImage", 0).with("rawEnum", 1).with("savedRef", 0)
      else if (kind == 23) initial.with("legacy", true).with("proposalObject", false).with("savedRef", 2)
      else if (kind == 24) initial.with("legacy", true).with("storageOk", false)
      else if (kind == 25) initial.with("rawStep", 3)
      else initial
    all { s.phase == "input", 0.to(25).contains(kind), s' = selected }
  }
  action begin = all { s.phase == "input", s' = s.with("phase", "read") }
  action read = all { s.phase == "read", s' =
    if (s.legacy) s.with("candidate", s.storageOk and (s.proposalObject or s.savedRef != 0))
      .with("nestedObject", s.storageOk and (s.proposalObject or s.savedRef != 0))
      .with("phase", "coerce")
    else s.with("candidate", s.wrapperObject).with("nestedObject", s.wrapperObject and s.proposalObject)
      .with("intermediateStep", s.rawStep).with("phase", "fields") }
  action coerce = {
    val numeric = if (s.modernStep or s.rawStep >= 97) s.rawStep
      else if (s.rawStep > 0) s.rawStep - 1 else 0
    all { s.phase == "coerce", s' = s.with("intermediateStep", numeric).with("phase", "fields") }
  }
  action decodeFields = all { s.phase == "fields", s' = s.with("phase", "referrer")
    .with("text", if (s.nestedObject and s.proposalObject and s.rawText <= 2) s.rawText else 0)
    .with("image", if (s.nestedObject and s.proposalObject and s.rawImage <= 2) s.rawImage else 0)
    .with("enumValue", if (s.nestedObject and s.proposalObject and s.rawEnum <= 2) s.rawEnum else 1) }
  action referrer = all { s.phase == "referrer", s' = s.with("phase", "step")
    .with("referrer", if (s.linkRef == 1 or s.linkRef == 3) 2
      else if (s.linkRef != 4 and s.candidate and s.savedRef == 1) 1 else 0) }
  action restoreStep = all { s.phase == "step", s' = s.with("phase", "done").with("returned", true)
    .with("stepValue", if (s.candidate and 0.to(2).contains(s.intermediateStep)) s.intermediateStep else 0) }
  action step = { nondet kind = 0.to(25).oneOf()
    any { profile(kind), begin, read, coerce, decodeFields, referrer, restoreStep, s' = s } }
  val invariant = all { s.stepValue >= 0 and s.stepValue <= 2,
    s.text >= 0 and s.text <= 2, s.image >= 0 and s.image <= 2,
    s.enumValue >= 0 and s.enumValue <= 2, not(s.unknownRetained),
    s.returned implies s.phase == "done",
    s.referrer == 2 implies s.linkRef == 1 or s.linkRef == 3,
    s.referrer == 1 implies s.candidate and s.savedRef == 1 and s.linkRef != 4 }
  action finish = begin.then(read).then(decodeFields).then(referrer).then(restoreStep)
  action finishLegacy = begin.then(read).then(coerce).then(decodeFields).then(referrer).then(restoreStep)
  run validWrapperRetainsIndependentValuesTest = init.then(finish).expect(s.text == 1 and s.image == 1 and s.referrer == 1 and s.stepValue == 2 and invariant)
  run malformedWrapperUsesDefaultsTest = init.then(profile(1)).then(finish).expect(s.text == 0 and s.enumValue == 1 and s.stepValue == 0 and s.referrer == 0 and invariant)
  run invalidNestedProposalDoesNotDiscardStepOrReferrerTest = init.then(profile(2)).then(finish).expect(s.text == 0 and s.enumValue == 1 and s.stepValue == 2 and s.referrer == 1 and invariant)
  run nonStringTextIsIgnoredTest = init.then(profile(3)).then(finish).expect(s.text == 0 and s.image == 1 and invariant)
  run oversizedTextIsIgnoredRatherThanTruncatedTest = init.then(profile(4)).then(finish).expect(s.text == 0 and s.image == 1 and invariant)
  run textAt4000UnitsIsRetainedTest = init.then(profile(5)).then(finish).expect(s.text == 2 and invariant)
  run imageAt16384UnitsIsRetainedTest = init.then(profile(6)).then(finish).expect(s.image == 2 and invariant)
  run oversizedImageIsIndependentlyIgnoredTest = init.then(profile(7)).then(finish).expect(s.image == 0 and s.text == 1 and invariant)
  run unknownEnumStringIsPreservedForValidationTest = init.then(profile(8)).then(finish).expect(s.enumValue == 2 and invariant)
  run emptyEnumStringOverridesItsDefaultTest = init.then(profile(9)).then(finish).expect(s.enumValue == 0 and invariant)
  run unknownKeysNeverEnterDraftTest = init.then(finish).expect(not(s.unknownRetained) and invariant)
  run validLinkOverridesSavedReferrerTest = init.then(profile(10)).then(finish).expect(s.referrer == 2 and invariant)
  run invalidLinkFallsBackToSavedReferrerTest = init.then(profile(11)).then(finish).expect(s.referrer == 1 and invariant)
  run SavedReferrerIsNotTrimmedTest = init.then(profile(12)).then(finish).expect(s.referrer == 0 and invariant)
  run linkReferrerIsTrimmedTest = init.then(profile(13)).then(finish).expect(s.referrer == 2 and invariant)
  run locationFailureDoesNotUseSavedReferrerTest = init.then(profile(14)).then(finish).expect(s.referrer == 0 and invariant)
  run wrapperStringStepIsNotCoercedTest = init.then(profile(15)).then(finish).expect(s.stepValue == 0 and invariant)
  run legacyModernEmptyStepWinsTest = init.then(profile(16)).then(finishLegacy).expect(s.stepValue == 0 and invariant)
  run legacyOneBasedStepIsConvertedTest = init.then(profile(17)).then(finishLegacy).expect(s.stepValue == 2 and invariant)
  run legacyNegativeStepClampsToZeroTest = init.then(profile(18)).then(finishLegacy).expect(s.stepValue == 0 and invariant)
  run legacyFractionalStepDoesNotBecomeValidIndexTest = init.then(profile(19)).then(finishLegacy).expect(s.stepValue == 0 and invariant)
  run legacyNonfiniteStepSerializesAsNullTest = init.then(profile(20)).then(finishLegacy).expect(s.stepValue == 0 and invariant)
  run absentLegacyDraftAndReferrerSkipsImportTest = init.then(profile(21)).then(finishLegacy).expect(not(s.candidate) and s.stepValue == 0 and invariant)
  run emptyObjectIsStillALegacyDraftTest = init.then(profile(22)).then(finishLegacy).expect(s.candidate and s.text == 0 and invariant)
  run invalidButNonemptyLegacyReferrerKeepsCandidateTest = init.then(profile(23)).then(finishLegacy).expect(s.candidate and s.referrer == 0 and s.enumValue == 1 and invariant)
  run legacyStorageFailureReturnsDefaultInputTest = init.then(profile(24)).then(finishLegacy).expect(not(s.candidate) and s.text == 0 and s.stepValue == 0 and invariant)
  run wrapperOutOfRangeStepDefaultsTest = init.then(profile(25)).then(finish).expect(s.stepValue == 0 and invariant)
}

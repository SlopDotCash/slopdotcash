// @source src/lib/project-proposal.ts
// @source src/lib/project-schema.mjs
// @source src/lib/base-units.mjs
// @evidence scripts/project-proposal-rewards.test.ts
// monthlyPoolValue/formatMonthlyAmount: representative positive amounts 1..3,
// parser/formatter outcomes and three precision modes. Exact decimal grammar,
// arbitrary-size arithmetic and formatting are delegated to their helpers.
// Unknown token precision parses at 36 decimals but returns zero staged units;
// its valid result is not a verified cap. Known token formatting checks u128,
// while standalone formatMonthlyAmount checks canonical integer/precision but
// does not impose the u128 cap. Symbols are caller metadata, not validated here.
// Error text classes preserve catch precedence, not every exception's wording.
// All scenarios and regression definitions are source-only and unexecuted.
module proposal_amount_display {
  type State = { phase: str, mode: str, parsed: int, parseOk: bool,
    displayOk: bool, positiveSpelling: bool, symbolValid: bool,
    valid: bool, staged: int, display: str, error: str,
    standalone: bool, canonical: bool, precisionValid: bool,
    aboveU128: bool, formatted: bool }
  var s: State
  action init = s' = { phase: "input", mode: "usd", parsed: 1,
    parseOk: true, displayOk: true, positiveSpelling: false, symbolValid: true,
    valid: false, staged: 0, display: "none", error: "none",
    standalone: false, canonical: true, precisionValid: true,
    aboveU128: false, formatted: false }
  action configure(mode: str, parsed: int, parseOk: bool, displayOk: bool, emptyOrZero: bool): bool = all {
    s.phase == "input", Set("usd", "unknown-token", "known-token").contains(mode), 0.to(3).contains(parsed),
    emptyOrZero implies parsed == 0, parseOk and parsed == 0 implies emptyOrZero,
    s' = s.with("mode", mode).with("parsed", parsed).with("parseOk", parseOk)
      .with("displayOk", displayOk).with("positiveSpelling", emptyOrZero) }
  action unvalidatedSymbol = all { s.phase == "input", s' = s.with("symbolValid", false) }
  def refused: State = s.with("phase", "done").with("valid", false).with("staged", 0)
    .with("display", if (s.mode == "usd") "zero-dollar" else "zero-token")
    .with("error", if (s.positiveSpelling) "positive-amount"
      else if (s.mode == "usd") "usd-format" else "helper-error")
  action parse = all { s.phase == "input", not(s.standalone), s' =
    if (not(s.parseOk)) refused else s.with("phase", "positive") }
  action positive = all { s.phase == "positive", s' =
    if (s.parsed == 0) refused else s.with("phase", "display") }
  action display = all { s.phase == "display", s' =
    if (s.mode != "unknown-token" and not(s.displayOk)) refused
    else s.with("phase", "done").with("valid", true)
      .with("staged", if (s.mode == "unknown-token") 0 else s.parsed)
      .with("display", if (s.mode == "usd") "dollar" else if (s.mode == "unknown-token") "raw-token" else "normalized-token") }
  action standalone(canonical: bool, precisionValid: bool, aboveU128: bool): bool = all {
    s.phase == "input", s' = s.with("standalone", true).with("canonical", canonical)
      .with("precisionValid", precisionValid).with("aboveU128", aboveU128) }
  action formatStandalone = all { s.phase == "input", s.standalone,
    s' = s.with("phase", "done").with("formatted", s.canonical and s.precisionValid)
      .with("error", if (not(s.canonical)) "integer" else if (not(s.precisionValid)) "precision" else "none") }
  action step = {
    nondet mode = Set("usd", "unknown-token", "known-token").oneOf()
    nondet amount = 0.to(3).oneOf() nondet a = Set(false, true).oneOf()
    nondet b = Set(false, true).oneOf() nondet c = Set(false, true).oneOf()
    any { configure(mode, amount, a, b, c), unvalidatedSymbol, parse, positive,
      display, standalone(a, b, c), formatStandalone, s' = s }
  }
  val invariant = all {
    s.valid implies s.parseOk and s.parsed > 0 and (s.mode == "unknown-token" or s.displayOk),
    s.mode == "unknown-token" and s.valid implies s.staged == 0 and s.display == "raw-token",
    s.phase == "done" and not(s.valid) and not(s.standalone) implies s.staged == 0,
    s.formatted implies s.standalone and s.canonical and s.precisionValid }
  action finish = parse.then(positive).then(display)
  run usdStagesPositiveUnitsTest = init.then(finish).expect(s.valid and s.staged == 1 and s.display == "dollar" and invariant)
  run knownTokenNormalizesDisplayTest = init.then(configure("known-token", 2, true, true, false)).then(finish).expect(s.valid and s.staged == 2 and s.display == "normalized-token" and invariant)
  run unknownPrecisionKeepsRawTextAndZeroCapTest = init.then(configure("unknown-token", 3, true, false, false)).then(finish).expect(s.valid and s.staged == 0 and s.display == "raw-token" and invariant)
  run unknownPrecisionDoesNotRunKnownAmountFormatterTest = init.then(configure("unknown-token", 3, true, false, false)).then(finish).expect(s.error == "none" and invariant)
  run emptyInputGetsPositiveAmountMessageTest = init.then(configure("usd", 0, false, false, true)).then(parse).expect(s.error == "positive-amount" and s.display == "zero-dollar" and invariant)
  run zeroIsNotValidFundingTest = init.then(configure("known-token", 0, true, true, true)).then(parse).then(positive).expect(not(s.valid) and s.error == "positive-amount" and invariant)
  run excessPrecisionOnZeroKeepsPositiveMessageTest = init.then(configure("known-token", 0, false, true, true)).then(parse).expect(s.error == "positive-amount" and invariant)
  run ordinaryParseErrorUsesUsdMessageTest = init.then(configure("usd", 1, false, true, false)).then(parse).expect(s.error == "usd-format" and invariant)
  run tokenParseErrorKeepsHelperMessageTest = init.then(configure("unknown-token", 1, false, true, false)).then(parse).expect(s.error == "helper-error" and s.display == "zero-token" and invariant)
  run nonCentUsdFormatterFailureReturnsInvalidTest = init.then(configure("usd", 1, true, false, false)).then(finish).expect(not(s.valid) and s.staged == 0 and s.error == "usd-format" and invariant)
  run knownTokenOverflowReturnsInvalidTest = init.then(configure("known-token", 3, true, false, false)).then(finish).expect(not(s.valid) and s.staged == 0 and invariant)
  run symbolValidityIsNotCheckedHereTest = init.then(configure("unknown-token", 1, true, true, false)).then(unvalidatedSymbol).then(finish).expect(s.valid and not(s.symbolValid) and invariant)
  run standaloneFormattingCanExceedU128Test = init.then(standalone(true, true, true)).then(formatStandalone).expect(s.formatted and s.aboveU128 and invariant)
  run standaloneZeroAndSymbolAreNotFundingApprovalTest = init.then(unvalidatedSymbol).then(standalone(true, true, false)).then(formatStandalone).expect(s.formatted and not(s.valid) and invariant)
  run standaloneNoncanonicalIntegerRefusedTest = init.then(standalone(false, true, false)).then(formatStandalone).expect(not(s.formatted) and s.error == "integer" and invariant)
  run standaloneInvalidPrecisionRefusedTest = init.then(standalone(true, false, false)).then(formatStandalone).expect(not(s.formatted) and s.error == "precision" and invariant)
}

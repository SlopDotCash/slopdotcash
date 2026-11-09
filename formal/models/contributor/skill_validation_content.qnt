// @source scripts/skill-validation/quick_validate.py
// @evidence tests/integration/installer.e2e.ts
// One actual validator process, one SKILL.md, two explicit invocations and 37
// representative input/fault profiles. Size classes 0,1,2 are below, exactly at,
// and above 1 MiB; the read consumes at most 1 MiB+1 before rejecting class2.
// The pre-read stat and captured read are independent filesystem observations.
// This is not a stable-directory, content snapshot or ancestor-symlink proof.
//
// Python/PyYAML parser predicates represent the exact ordered checks: raw-byte
// bound, strict UTF-8, universal newlines, frontmatter delimiter, safe YAML
// mapping, permitted/required keys, trimmed name and description. Optional
// metadata/license/allowed-tools values have no further checks here. Duplicate
// YAML keys and aliases retain safe_load behavior; no invented rejection rule.
// Mixed-type unexpected keys can raise during error formatting, distinct from
// a returned false verdict, but both refuse CLI success. Full parser grammar,
// decoding and native descriptor-close guarantees are external contracts.
//
// The owned binary file context closes before decode/parse, even on read error.
// Close failure is recorded as unknown until process exit closes descriptors.
// A valid function verdict is not a successful printed CLI receipt. No action
// writes skill content or installs it. Runtime selection/publication is modeled
// separately by skill_validation_runtime.
module skill_validation_content {
  type State = { phase: str, profile: int, call: int, statSize: int, readSize: int,
    resource: str, readFailed: bool, normalized: bool, verdict: str, error: str,
    printed: bool, exitCode: int }
  var s: State
  val initial: State = { phase: "input", profile: 0, call: 1, statSize: 0, readSize: 0,
    resource: "closed", readFailed: false, normalized: false, verdict: "none", error: "none",
    printed: false, exitCode: -1 }
  action init = s' = initial
  action profile(kind: int): bool = all { s.phase == "input", 0.to(36).contains(kind),
    s' = initial.with("call", s.call).with("profile", kind) }
  def refuse(reason: str): State = s.with("phase", "print").with("verdict", "invalid").with("error", reason)
  def exception(reason: str): State = s.with("phase", "exception").with("error", reason)
  action begin = all { s.phase == "input",
    s' = if (s.profile == 1) refuse("usage") else s.with("phase", "directory") }
  action directory = all { s.phase == "directory",
    s' = if (Set(2, 3).contains(s.profile)) refuse("real-directory") else s.with("phase", "exists") }
  action fileExists = all { s.phase == "exists",
    s' = if (s.profile == 4) refuse("missing-file") else s.with("phase", "regular") }
  action regular = all { s.phase == "regular",
    s' = if (Set(5, 6).contains(s.profile)) refuse("regular-file") else s.with("phase", "stat") }
  action stat = all { s.phase == "stat",
    s' = if (s.profile == 29) exception("stat-io")
      else if (s.profile == 7) refuse("size-hint").with("statSize", 2)
      else s.with("phase", "open").with("statSize", if (s.profile == 28) 1 else 0) }
  action open = all { s.phase == "open",
    s' = if (s.profile == 30) exception("open-io") else s.with("phase", "read").with("resource", "open") }
  action read = all { s.phase == "read", s.resource == "open",
    s' = s.with("phase", "close").with("readFailed", s.profile == 31)
      .with("readSize", if (s.profile == 8) 2 else if (s.profile == 28) 1 else 0) }
  action close = all { s.phase == "close",
    s' = if (s.profile == 35) exception("close-io").with("resource", "unknown")
      else if (s.readFailed) exception("read-io").with("resource", "closed")
      else s.with("phase", "byte-bound").with("resource", "closed") }
  action byteBound = all { s.phase == "byte-bound",
    s' = if (s.readSize > 1) refuse("actual-bytes") else s.with("phase", "decode") }
  action decode = all { s.phase == "decode",
    s' = if (s.profile == 9) refuse("utf8") else s.with("phase", "prefix").with("normalized", true) }
  action prefix = all { s.phase == "prefix",
    s' = if (s.profile == 10) refuse("frontmatter-missing") else s.with("phase", "delimiter") }
  action delimiter = all { s.phase == "delimiter",
    s' = if (s.profile == 11) refuse("frontmatter-format") else s.with("phase", "yaml") }
  action yaml = all { s.phase == "yaml",
    s' = if (s.profile == 12) refuse("yaml-error")
      else if (s.profile == 13) refuse("yaml-not-mapping") else s.with("phase", "keys") }
  action validateKeys = all { s.phase == "keys",
    s' = if (s.profile == 32) exception("unexpected-key-format")
      else if (s.profile == 14) refuse("unexpected-keys") else s.with("phase", "required-name") }
  action requiredName = all { s.phase == "required-name",
    s' = if (s.profile == 15) refuse("missing-name") else s.with("phase", "required-description") }
  action requiredDescription = all { s.phase == "required-description",
    s' = if (s.profile == 16) refuse("missing-description") else s.with("phase", "name-type") }
  action nameType = all { s.phase == "name-type",
    s' = if (s.profile == 17) refuse("name-type") else s.with("phase", "name-empty") }
  action nameEmpty = all { s.phase == "name-empty",
    s' = if (s.profile == 18) refuse("name-empty") else s.with("phase", "name-chars") }
  action nameChars = all { s.phase == "name-chars",
    s' = if (s.profile == 19) refuse("name-chars") else s.with("phase", "name-hyphen") }
  action nameHyphen = all { s.phase == "name-hyphen",
    s' = if (s.profile == 20) refuse("name-hyphen") else s.with("phase", "name-length") }
  action nameLength = all { s.phase == "name-length",
    s' = if (s.profile == 21) refuse("name-length") else s.with("phase", "description-type") }
  action descriptionType = all { s.phase == "description-type",
    s' = if (s.profile == 22) refuse("description-type") else s.with("phase", "description-empty") }
  action descriptionEmpty = all { s.phase == "description-empty",
    s' = if (s.profile == 23) refuse("description-empty") else s.with("phase", "description-chars") }
  action descriptionChars = all { s.phase == "description-chars",
    s' = if (s.profile == 24) refuse("description-chars") else s.with("phase", "description-length") }
  action descriptionLength = all { s.phase == "description-length",
    s' = if (s.profile == 25) refuse("description-length") else s.with("phase", "print").with("verdict", "valid") }
  action print = all { s.phase == "print",
    s' = if (s.profile == 36) exception("stdout") else s.with("printed", true).with("phase", "done")
      .with("exitCode", if (s.verdict == "valid") 0 else 1) }
  action unhandledExit = all { s.phase == "exception",
    s' = s.with("phase", "done").with("resource", "closed").with("exitCode", 1) }
  action terminate = all { not(Set("input", "done", "dead").contains(s.phase)),
    s' = s.with("phase", "dead").with("resource", "closed").with("exitCode", 2) }
  action retry = all { s.phase == "done", s.call == 1, s' = initial.with("call", 2) }
  action step = {
    nondet kind = 0.to(36).oneOf()
    any { profile(kind), begin, directory, fileExists, regular, stat, open, read, close, byteBound, decode,
      prefix, delimiter, yaml, validateKeys, requiredName, requiredDescription, nameType, nameEmpty, nameChars,
      nameHyphen, nameLength, descriptionType, descriptionEmpty, descriptionChars, descriptionLength,
      print, unhandledExit, terminate, retry, s' = s }
  }
  val invariant = all { s.call <= 2, s.readSize <= 2,
    s.exitCode == 0 implies s.verdict == "valid" and s.printed and s.resource == "closed" and s.normalized and s.readSize <= 1,
    s.verdict == "valid" implies s.readSize <= 1 and s.resource == "closed",
    Set("done", "dead").contains(s.phase) implies s.resource == "closed",
    s.readFailed implies s.exitCode != 0 }
  action beforeRead = begin.then(directory).then(fileExists).then(regular).then(stat).then(open)
  action beforeDecode = beforeRead.then(read).then(close).then(byteBound)
  action beforeYaml = beforeDecode.then(decode).then(prefix).then(delimiter)
  action beforeName = beforeYaml.then(yaml).then(validateKeys).then(requiredName).then(requiredDescription)
  action beforeDescription = beforeName.then(nameType).then(nameEmpty).then(nameChars).then(nameHyphen).then(nameLength)
  action full = beforeDescription.then(descriptionType).then(descriptionEmpty).then(descriptionChars).then(descriptionLength).then(print)
  run validSkillPrintsSuccessTest = init.then(full).expect(s.exitCode == 0 and invariant)
  run crlfFrontmatterRetainsCompatibilityTest = init.then(profile(26)).then(full).expect(s.exitCode == 0 and invariant)
  run loneCrFrontmatterRetainsCompatibilityTest = init.then(profile(27)).then(full).expect(s.exitCode == 0 and invariant)
  run exactRawByteLimitIsAcceptedTest = init.then(profile(28)).then(full).expect(s.readSize == 1 and s.exitCode == 0 and invariant)
  run exactNameLengthIsAcceptedTest = init.then(profile(33)).then(full).expect(s.exitCode == 0 and invariant)
  run exactDescriptionLengthIsAcceptedTest = init.then(profile(34)).then(full).expect(s.exitCode == 0 and invariant)
  run growthAfterStatRefusesBeforeDecodeTest = init.then(profile(8)).then(beforeDecode).then(print)
    .expect(s.statSize == 0 and s.readSize == 2 and not(s.normalized) and s.error == "actual-bytes" and s.exitCode == 1 and invariant)
  run oversizedHintRefusesBeforeOpenTest = init.then(profile(7)).then(begin).then(directory).then(fileExists).then(regular).then(stat).then(print)
    .expect(s.resource == "closed" and s.readSize == 0 and s.error == "size-hint" and invariant)
  run argumentCountRefusesBeforeFilesystemTest = init.then(profile(1)).then(begin).then(print).expect(s.error == "usage" and invariant)
  run symlinkDirectoryRefusesTest = init.then(profile(3)).then(begin).then(directory).then(print).expect(s.error == "real-directory" and invariant)
  run missingSkillFileRefusesTest = init.then(profile(4)).then(begin).then(directory).then(fileExists).then(print).expect(s.error == "missing-file" and invariant)
  run symlinkSkillFileRefusesTest = init.then(profile(5)).then(begin).then(directory).then(fileExists).then(regular).then(print).expect(s.error == "regular-file" and invariant)
  run invalidUtf8RefusesAfterCloseTest = init.then(profile(9)).then(beforeDecode).then(decode).then(print)
    .expect(s.error == "utf8" and s.resource == "closed" and invariant)
  run missingFrontmatterRefusesTest = init.then(profile(10)).then(beforeDecode).then(decode).then(prefix).then(print).expect(s.error == "frontmatter-missing" and invariant)
  run malformedDelimiterRefusesTest = init.then(profile(11)).then(beforeDecode).then(decode).then(prefix).then(delimiter).then(print).expect(s.error == "frontmatter-format" and invariant)
  run malformedYamlRefusesTest = init.then(profile(12)).then(beforeYaml).then(yaml).then(print).expect(s.error == "yaml-error" and invariant)
  run yamlSequenceRefusesTest = init.then(profile(13)).then(beforeYaml).then(yaml).then(print).expect(s.error == "yaml-not-mapping" and invariant)
  run unexpectedKeysRefuseBeforeRequiredNamesTest = init.then(profile(14)).then(beforeYaml).then(yaml).then(validateKeys).then(print).expect(s.error == "unexpected-keys" and invariant)
  run mixedUnexpectedKeysRaiseWithoutSuccessReceiptTest = init.then(profile(32)).then(beforeYaml).then(yaml).then(validateKeys).then(unhandledExit)
    .expect(s.error == "unexpected-key-format" and not(s.printed) and s.exitCode == 1 and invariant)
  run missingNameRefusesTest = init.then(profile(15)).then(beforeYaml).then(yaml).then(validateKeys).then(requiredName).then(print).expect(s.error == "missing-name" and invariant)
  run missingDescriptionRefusesTest = init.then(profile(16)).then(beforeName).then(print).expect(s.error == "missing-description" and invariant)
  run nonStringNameRefusesTest = init.then(profile(17)).then(beforeName).then(nameType).then(print).expect(s.error == "name-type" and invariant)
  run trimmedEmptyNameRefusesTest = init.then(profile(18)).then(beforeName).then(nameType).then(nameEmpty).then(print).expect(s.error == "name-empty" and invariant)
  run invalidNameCharactersRefuseTest = init.then(profile(19)).then(beforeName).then(nameType).then(nameEmpty).then(nameChars).then(print).expect(s.error == "name-chars" and invariant)
  run invalidHyphenPlacementRefusesTest = init.then(profile(20)).then(beforeName).then(nameType).then(nameEmpty).then(nameChars).then(nameHyphen).then(print).expect(s.error == "name-hyphen" and invariant)
  run nameLengthRefusesTest = init.then(profile(21)).then(beforeDescription).then(print).expect(s.error == "name-length" and invariant)
  run descriptionTypeRefusesTest = init.then(profile(22)).then(beforeDescription).then(descriptionType).then(print).expect(s.error == "description-type" and invariant)
  run emptyDescriptionRefusesTest = init.then(profile(23)).then(beforeDescription).then(descriptionType).then(descriptionEmpty).then(print).expect(s.error == "description-empty" and invariant)
  run angleBracketsRefuseBeforeLengthTest = init.then(profile(24)).then(beforeDescription).then(descriptionType).then(descriptionEmpty).then(descriptionChars).then(print).expect(s.error == "description-chars" and invariant)
  run descriptionLengthRefusesTest = init.then(profile(25)).then(beforeDescription).then(descriptionType).then(descriptionEmpty).then(descriptionChars).then(descriptionLength).then(print).expect(s.error == "description-length" and invariant)
  run statIoRaisesWithoutPrintedVerdictTest = init.then(profile(29)).then(begin).then(directory).then(fileExists).then(regular).then(stat).then(unhandledExit).expect(s.error == "stat-io" and not(s.printed) and invariant)
  run readIoStillClosesOwnedFileTest = init.then(profile(31)).then(beforeRead).then(read).then(close).then(unhandledExit).expect(s.error == "read-io" and s.resource == "closed" and invariant)
  run closeErrorDoesNotReachParserTest = init.then(profile(35)).then(beforeRead).then(read).then(close).then(unhandledExit).expect(s.error == "close-io" and not(s.normalized) and invariant)
  run printedReceiptCanFailAfterValidVerdictTest = init.then(profile(36)).then(beforeDescription).then(descriptionType).then(descriptionEmpty).then(descriptionChars).then(descriptionLength).then(print).then(unhandledExit)
    .expect(s.verdict == "valid" and not(s.printed) and s.exitCode == 1 and invariant)
  run processDeathClosesDescriptorWithoutVerdictTest = init.then(beforeRead).then(terminate).expect(s.resource == "closed" and s.verdict == "none" and invariant)
  run correctedRetryStartsWithoutOldErrorTest = init.then(profile(9)).then(beforeDecode).then(decode).then(print).then(retry).then(full)
    .expect(s.call == 2 and s.error == "none" and s.exitCode == 0 and invariant)
}

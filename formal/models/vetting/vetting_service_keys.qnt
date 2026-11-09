// @source backend/vetting/handler.ts
// @evidence backend/vetting/service-auth.test.ts
// serviceKeys / vettingServiceAvailable. Entries are the captured comma-split
// string after base64 normalization, with decoding and WebCrypto outcomes
// represented as inputs. Empty entries are skipped, duplicates retained, and
// any invalid entry discards every key imported so far. No real secret material.
module vetting_service_keys {
  var s: { phase: str, entries: List[str], cursor: int, imported: List[str], available: bool }
  action init = s' = { phase: "new", entries: List("A"), cursor: 0, imported: List(), available: false }
  action entries(values: List[str]) = all { s.phase == "new", s' = s.with("entries", values) }
  action begin = all { s.phase == "new", s' = s.with("phase", "scan") }
  val entry = if (s.cursor < s.entries.length()) s.entries.nth(s.cursor) else ""
  action scanEntry = all {
    s.phase == "scan", s.cursor < s.entries.length(),
    s' = if (entry == "empty") s.with("cursor", s.cursor + 1)
      else if (entry == "A" or entry == "B") s.with("phase", "import")
      else s.with("phase", "done").with("imported", List()).with("available", false)
  }
  action importEntry = all {
    s.phase == "import", s.cursor < s.entries.length(),
    s' = s.with("imported", s.imported.append(entry)).with("cursor", s.cursor + 1).with("phase", "scan")
  }
  // Hash/import rejection has the same whole-configuration outcome as bad bytes.
  action importFailure = all {
    s.phase == "import", s' = s.with("phase", "done").with("imported", List()).with("available", false)
  }
  action finish = all {
    s.phase == "scan", s.cursor == s.entries.length(),
    s' = s.with("phase", "done").with("available", s.imported.length() > 0)
  }
  action step = any { begin, scanEntry, importEntry, importFailure, finish,
    entries(List()), entries(List("empty", "empty")), entries(List("A", "B")),
    entries(List("A", "A")), entries(List("A", "bad")), entries(List("bad", "A")), s' = s }
  val invariant = all {
    s.cursor >= 0 and s.cursor <= s.entries.length(),
    s.available implies (s.phase == "done" and s.imported.length() > 0),
    s.phase == "done" implies (s.available == (s.imported.length() > 0))
  }
  run oneKeyTest = init.then(begin).then(scanEntry).then(importEntry).then(finish).expect(s.available)
  run noKeysTest = init.then(entries(List())).then(begin).then(finish).expect(not(s.available))
  run ignoredEmptyTest = init.then(entries(List("empty", "empty"))).then(begin).then(scanEntry).then(scanEntry)
    .then(finish).expect(not(s.available))
  run leadingEmptyTest = init.then(entries(List("empty", "A"))).then(begin).then(scanEntry).then(scanEntry)
    .then(importEntry).then(finish).expect(s.available and s.imported == List("A"))
  run trailingEmptyTest = init.then(entries(List("A", "empty"))).then(begin).then(scanEntry).then(importEntry)
    .then(scanEntry).then(finish).expect(s.available)
  run twoKeysTest = init.then(entries(List("A", "B"))).then(begin).then(scanEntry).then(importEntry)
    .then(scanEntry).then(importEntry).then(finish).expect(s.imported == List("A", "B"))
  run duplicateKeysRetainedTest = init.then(entries(List("A", "A"))).then(begin).then(scanEntry).then(importEntry)
    .then(scanEntry).then(importEntry).then(finish).expect(s.imported == List("A", "A"))
  run badBase64Test = init.then(entries(List("bad-base64"))).then(begin).then(scanEntry).expect(not(s.available))
  run badByteLengthTest = init.then(entries(List("bad-length"))).then(begin).then(scanEntry).expect(not(s.available))
  run badFirstDiscardsLaterTest = init.then(entries(List("bad", "A"))).then(begin).then(scanEntry)
    .expect(s.phase == "done" and s.imported == List() and s.cursor == 0)
  run badLaterDiscardsEarlierTest = init.then(entries(List("A", "bad"))).then(begin).then(scanEntry).then(importEntry)
    .then(scanEntry).expect(not(s.available) and s.imported == List())
  run cryptoImportRejectionTest = init.then(begin).then(scanEntry).then(importFailure).expect(not(s.available))
  run cryptoFailureDiscardsEarlierTest = init.then(entries(List("A", "B"))).then(begin).then(scanEntry).then(importEntry)
    .then(scanEntry).then(importFailure).expect(not(s.available) and s.imported == List())
}

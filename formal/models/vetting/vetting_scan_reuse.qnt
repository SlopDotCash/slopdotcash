// @source backend/vetting/reuse.ts
// @source backend/vetting/handler.ts
// Reuse preserves the original clean scan, report and repository. It does not
// generate a fresh scan or lift a pause based only on contributor flags.
module vetting_scan_reuse {
  var s: { original: bool, clean: bool, sameIdentity: bool, sameInventory: bool,
    sameTemplate: bool, samePolicy: bool, coversFlags: bool, flagPause: bool,
    recent: bool, reused: bool }
  action init = s' = {original: true, clean: true, sameIdentity: true, sameInventory: true,
    sameTemplate: true, samePolicy: true, coversFlags: true, flagPause: false, recent: true, reused: false}
  action flags = all { not(s.reused), s' = s.with("flagPause", true) }
  action sourceChanged = all { not(s.reused), s' = s.with("sameInventory", false) }
  action reusedSource = all { not(s.reused), s' = s.with("original", false) }
  action oldInvestigation = all { not(s.reused), s' = s.with("recent", false) }
  action admit = all { s.original, s.clean, s.sameIdentity, s.sameInventory,
    s.sameTemplate, s.samePolicy, s.coversFlags, not(s.flagPause), s.recent,
    s' = s.with("reused", true) }
  action step = any { flags, sourceChanged, reusedSource, oldInvestigation, admit, s' = s }
  val invariant = s.reused implies s.original and s.clean and s.sameInventory and not(s.flagPause) and s.recent
  run flagsRequireFreshScanTest = init.then(flags).expect(not(s.reused))
  run changedSourceCannotReuseTest = init.then(sourceChanged).expect(not(s.reused))
  run originalCleanReuseTest = init.then(admit).expect(s.reused and invariant)
}

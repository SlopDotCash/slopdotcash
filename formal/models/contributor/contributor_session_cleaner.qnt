// @source skills/project-contributor-template/scripts/session-export.mjs
// A read result leaves the machine only when the repository is openly licensed
// and the file is inside the repo and tracked. An event naming a path outside
// the repo is replaced whole. Any other outcome is a redaction marker.
module contributor_session_cleaner {
  type S = { licensed: bool, tracked: bool, inside: bool, outside: bool, kept: bool, redacted: bool }
  var s: S
  action init = s' = { licensed:false,tracked:false,inside:false,outside:false,kept:false,redacted:false }
  action classify(l: bool, t: bool, i: bool, o: bool): bool = all { not(s.kept),not(s.redacted),
    s'= { licensed:l,tracked:t,inside:i,outside:o,
      kept: (not(o) and l and t and i), redacted: not(not(o) and l and t and i) } }
  action step = any { classify(true,true,true,false),classify(false,true,true,false),classify(true,false,true,false),
    classify(true,true,false,false),classify(true,true,true,true),s'=s }
  val invariant = all { s.kept implies (s.licensed and s.tracked and s.inside and not(s.outside)),not(s.kept and s.redacted) }
  run keptWhenLicensedTest = init.then(classify(true,true,true,false)).expect(s.kept and invariant)
  run unlicensedRedactedTest = init.then(classify(false,true,true,false)).expect(s.redacted and not(s.kept))
  run outsideRedactedTest = init.then(classify(true,true,true,true)).expect(s.redacted and not(s.kept))
}

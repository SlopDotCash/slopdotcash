// @source skills/project-contributor-template/scripts/session-export.mjs
// A read result leaves the machine only when the repository is openly licensed
// and the file is inside the repo and tracked. A name-only command (ls, tree,
// git status, git log without a patch, git diff names, git branch, find
// without actions) keeps its output of names when every path it names is
// inside the repo, even if the names include untracked files. An event naming
// a path outside the repo is replaced whole. Any other outcome is a redaction
// marker.
module contributor_session_cleaner {
  type S = { licensed: bool, tracked: bool, nameOnly: bool, inside: bool, outside: bool, kept: bool, redacted: bool }
  var s: S
  pure def keeps(l: bool, t: bool, n: bool, i: bool, o: bool): bool = not(o) and l and i and (t or n)
  action init = s' = { licensed:false,tracked:false,nameOnly:false,inside:false,outside:false,kept:false,redacted:false }
  action classify(l: bool, t: bool, n: bool, i: bool, o: bool): bool = all { not(s.kept),not(s.redacted),
    s'= { licensed:l,tracked:t,nameOnly:n,inside:i,outside:o,
      kept: keeps(l,t,n,i,o), redacted: not(keeps(l,t,n,i,o)) } }
  action step = any { classify(true,true,false,true,false),classify(false,true,false,true,false),
    classify(true,false,false,true,false),classify(true,false,true,true,false),classify(false,false,true,true,false),
    classify(true,true,false,false,false),classify(true,false,true,false,false),classify(true,true,false,true,true),
    classify(true,false,true,true,true),s'=s }
  val invariant = all { s.kept implies (s.licensed and s.inside and not(s.outside) and (s.tracked or s.nameOnly)),
    not(s.kept and s.redacted) }
  run keptWhenLicensedTest = init.then(classify(true,true,false,true,false)).expect(s.kept and invariant)
  run unlicensedRedactedTest = init.then(classify(false,true,false,true,false)).expect(s.redacted and not(s.kept))
  run outsideRedactedTest = init.then(classify(true,true,false,true,true)).expect(s.redacted and not(s.kept))
  run nameOnlyKeptTest = init.then(classify(true,false,true,true,false)).expect(s.kept and invariant)
  run nameOnlyUnlicensedTest = init.then(classify(false,false,true,true,false)).expect(s.redacted and not(s.kept))
  run nameOnlyOutsidePathTest = init.then(classify(true,false,true,false,false)).expect(s.redacted and not(s.kept))
}

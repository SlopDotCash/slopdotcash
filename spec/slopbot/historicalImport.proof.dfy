lemma submit_ensures(s: Imports, request: ImportRequest)
  ensures (inv(s) ==> alwaysImportedOnceEach(submit(s, request)))
  ensures (inv(s) ==> alwaysCutoffNotBeforeApiStart(submit(s, request)))
  ensures (inv(s) ==> stepImportsAreAppendOnly(s, submit(s, request)))
{
  if inv(s) && acceptable(s, request) {
    var p := (set_x: int) => !((set_x in s.keys));
    ProofLib.FilterCons(p, [request.assessmentKey]);
    ProofLib.FilterNil(p, [request.assessmentKey][1..]);
  }
}

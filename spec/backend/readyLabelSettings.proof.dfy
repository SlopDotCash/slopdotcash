// spec/backend/readyLabelSettings.md, "Ready-label settings are bounded, off when absent or disabled, and only add protected paths"

lemma lawOwnerPatternsOnlyAdd_ensures(builtIn: seq<string>, setting: ReadyLabelSetting)
  ensures (lawOwnerPatternsOnlyAdd(builtIn, setting) == true)
{
  if !setting.ReadyLabelAbsent? {
    var f := (patterns: seq<string>, path: ProtectedPath) => (patterns + Std.Collections.Seq.Filter((set_x: string) => !((set_x in patterns)), [path.pattern]));
    forall x | x in builtIn
      ensures x in Std.Collections.Seq.FoldLeft(f, builtIn, setting.protectedPaths)
    {
      FoldLeftRetainsPattern(f, builtIn, setting.protectedPaths, x);
    }
  }
}

lemma FoldLeftRetainsPattern(f: (seq<string>, ProtectedPath) -> seq<string>, acc: seq<string>, xs: seq<ProtectedPath>, x: string)
  requires forall a, p :: x in a ==> x in f(a, p)
  requires x in acc
  ensures x in Std.Collections.Seq.FoldLeft(f, acc, xs)
  decreases |xs|
{
  if |xs| > 0 {
    FoldLeftRetainsPattern(f, f(acc, xs[0]), xs[1..], x);
  }
}

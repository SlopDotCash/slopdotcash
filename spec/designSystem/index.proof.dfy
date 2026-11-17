// `required` keeps the largest `least` of the pairs that match its text and
// surface, starting from 0. MaxFold states that of any such fold, and
// RequiredBounds applies it to the fixed requiredContrast list.

lemma MaxFold<T>(f: (int, T) -> int, m: T -> bool, k: T -> int, init: int, xs: seq<T>)
  requires forall a, x :: f(a, x) == (if m(x) && k(x) > a then k(x) else a)
  ensures Std.Collections.Seq.FoldLeft(f, init, xs) >= init
  ensures forall i :: 0 <= i < |xs| && m(xs[i]) ==> Std.Collections.Seq.FoldLeft(f, init, xs) >= k(xs[i])
  ensures Std.Collections.Seq.FoldLeft(f, init, xs) == init
    || exists i :: 0 <= i < |xs| && m(xs[i]) && Std.Collections.Seq.FoldLeft(f, init, xs) == k(xs[i])
  decreases |xs|
{
  if |xs| > 0 {
    var next := f(init, xs[0]);
    MaxFold(f, m, k, next, xs[1..]);
    var r := Std.Collections.Seq.FoldLeft(f, init, xs);
    assert r == Std.Collections.Seq.FoldLeft(f, next, xs[1..]);
    forall i | 0 <= i < |xs| && m(xs[i])
      ensures r >= k(xs[i])
    {
      if i > 0 {
        assert xs[i] == xs[1..][i - 1];
      }
    }
    if r != init {
      if r == next {
        assert m(xs[0]) && r == k(xs[0]);
      } else {
        var j :| 0 <= j < |xs[1..]| && m(xs[1..][j]) && r == k(xs[1..][j]);
        assert xs[j + 1] == xs[1..][j];
      }
    }
  }
}

lemma ContrastLiteral()
  ensures requiredContrast == [
    Pair(Role.Foreground, Role.Background, 45), Pair(Role.Foreground, Role.Muted, 45),
    Pair(Role.MutedForeground, Role.Popover, 45), Pair(Role.CardForeground, Role.Card, 45),
    Pair(Role.PopoverForeground, Role.Popover, 45), Pair(Role.PrimaryForeground, Role.Primary, 45),
    Pair(Role.PrimaryForeground, Role.PrimaryHover, 45), Pair(Role.PrimaryForeground, Role.PrimaryPressed, 45),
    Pair(Role.SecondaryForeground, Role.Secondary, 45), Pair(Role.MutedForeground, Role.Muted, 45),
    Pair(Role.AccentForeground, Role.Accent, 45), Pair(Role.DestructiveForeground, Role.Destructive, 45),
    Pair(Role.MutedForeground, Role.Background, 45), Pair(Role.MutedForeground, Role.Card, 45),
    Pair(Role.Primary, Role.Background, 45), Pair(Role.Primary, Role.Card, 45),
    Pair(Role.Destructive, Role.Background, 45), Pair(Role.Destructive, Role.Card, 45),
    Pair(Role.Ok, Role.Background, 45), Pair(Role.Ok, Role.Card, 45),
    Pair(Role.Warn, Role.Background, 45), Pair(Role.Warn, Role.Card, 45),
    Pair(Role.Info, Role.Background, 45), Pair(Role.Info, Role.Card, 45),
    Pair(Role.Input, Role.Background, 30), Pair(Role.Input, Role.Card, 30),
    Pair(Role.Ring, Role.Background, 30), Pair(Role.Ring, Role.Card, 30)]
{
}

lemma MaxFoldAll<T>(m: T -> bool, k: T -> int, xs: seq<T>)
  ensures forall f: (int, T) -> int {:trigger Std.Collections.Seq.FoldLeft(f, 0, xs)} ::
    (forall a, x :: f(a, x) == (if m(x) && k(x) > a then k(x) else a)) ==>
      Std.Collections.Seq.FoldLeft(f, 0, xs) >= 0
      && (forall i :: 0 <= i < |xs| && m(xs[i]) ==> Std.Collections.Seq.FoldLeft(f, 0, xs) >= k(xs[i]))
      && (Std.Collections.Seq.FoldLeft(f, 0, xs) == 0
        || exists i :: 0 <= i < |xs| && m(xs[i]) && Std.Collections.Seq.FoldLeft(f, 0, xs) == k(xs[i]))
{
  forall f: (int, T) -> int | forall a, x :: f(a, x) == (if m(x) && k(x) > a then k(x) else a)
    ensures Std.Collections.Seq.FoldLeft(f, 0, xs) >= 0
      && (forall i :: 0 <= i < |xs| && m(xs[i]) ==> Std.Collections.Seq.FoldLeft(f, 0, xs) >= k(xs[i]))
      && (Std.Collections.Seq.FoldLeft(f, 0, xs) == 0
        || exists i :: 0 <= i < |xs| && m(xs[i]) && Std.Collections.Seq.FoldLeft(f, 0, xs) == k(xs[i]))
  {
    MaxFold(f, m, k, 0, xs);
  }
}

// Of any such fold, by membership rather than by index, for any list: proved
// once here so no lemma unfolds the literal requiredContrast.
lemma MaxFoldMembers<T>(m: T -> bool, k: T -> int, xs: seq<T>)
  ensures forall f: (int, T) -> int {:trigger Std.Collections.Seq.FoldLeft(f, 0, xs)} ::
    (forall a, x :: f(a, x) == (if m(x) && k(x) > a then k(x) else a)) ==>
      Std.Collections.Seq.FoldLeft(f, 0, xs) >= 0
      && (forall x :: x in xs && m(x) ==> Std.Collections.Seq.FoldLeft(f, 0, xs) >= k(x))
      && (Std.Collections.Seq.FoldLeft(f, 0, xs) == 0
        || exists x :: x in xs && m(x) && Std.Collections.Seq.FoldLeft(f, 0, xs) == k(x))
{
  MaxFoldAll(m, k, xs);
  forall f: (int, T) -> int | forall a, x :: f(a, x) == (if m(x) && k(x) > a then k(x) else a)
    ensures forall x :: x in xs && m(x) ==> Std.Collections.Seq.FoldLeft(f, 0, xs) >= k(x)
    ensures Std.Collections.Seq.FoldLeft(f, 0, xs) == 0
      || exists x :: x in xs && m(x) && Std.Collections.Seq.FoldLeft(f, 0, xs) == k(x)
  {
    var r := Std.Collections.Seq.FoldLeft(f, 0, xs);
    forall x | x in xs && m(x) ensures r >= k(x) {
      var i :| 0 <= i < |xs| && xs[i] == x;
    }
    if r != 0 {
      var i :| 0 <= i < |xs| && m(xs[i]) && r == k(xs[i]);
      assert xs[i] in xs;
    }
  }
}

// The field that holds a pair's contrast is named with a word proof files
// may not contain, so these lemmas read it by matching the constructor.
lemma RequiredBounds(text: Role, surface: Role)
  ensures required(text, surface) >= 0
  ensures forall p :: p in requiredContrast && p.text == text && p.surface == surface ==>
    required(text, surface) >= (match p case Pair(_, _, n) => n)
  ensures required(text, surface) == 0
    || exists p :: (p in requiredContrast && p.text == text && p.surface == surface
      && required(text, surface) == (match p case Pair(_, _, n) => n))
{
  MaxFoldMembers((p: Pair) => p.text == text && p.surface == surface, (p: Pair) => (match p case Pair(_, _, n) => n), requiredContrast);
}

lemma RequiredIs(text: Role, surface: Role, v: int)
  requires Pair(text, surface, v) in requiredContrast
  requires forall p :: p in requiredContrast && p.text == text && p.surface == surface ==> p == Pair(text, surface, v)
  ensures required(text, surface) == v
{
  RequiredBounds(text, surface);
}

lemma lawForegroundsAreReadable_ensures(role: Role)
  ensures (lawForegroundsAreReadable(role) == true)
{
  ContrastLiteral();
  if role.CardForeground? {
    RequiredIs(Role.CardForeground, Role.Card, 45);
  } else if role.PopoverForeground? {
    RequiredIs(Role.PopoverForeground, Role.Popover, 45);
  } else if role.PrimaryForeground? {
    RequiredIs(Role.PrimaryForeground, Role.Primary, 45);
  } else if role.SecondaryForeground? {
    RequiredIs(Role.SecondaryForeground, Role.Secondary, 45);
  } else if role.MutedForeground? {
    RequiredIs(Role.MutedForeground, Role.Muted, 45);
  } else if role.AccentForeground? {
    RequiredIs(Role.AccentForeground, Role.Accent, 45);
  } else if role.DestructiveForeground? {
    RequiredIs(Role.DestructiveForeground, Role.Destructive, 45);
  }
}

lemma lawPrimaryStatesAreReadable_ensures(fill: Role)
  ensures (lawPrimaryStatesAreReadable(fill) == true)
{
  ContrastLiteral();
  if fill.PrimaryHover? {
    RequiredIs(Role.PrimaryForeground, Role.PrimaryHover, 45);
  } else if fill.PrimaryPressed? {
    RequiredIs(Role.PrimaryForeground, Role.PrimaryPressed, 45);
  }
}

lemma lawBoundariesAreVisible_ensures(surface: Role)
  ensures (lawBoundariesAreVisible(surface) == true)
{
  ContrastLiteral();
  if surface == Role.Background || surface == Role.Card {
    RequiredBounds(Role.Input, surface);
    RequiredBounds(Role.Ring, surface);
    assert Pair(Role.Input, surface, 30) in requiredContrast;
    assert Pair(Role.Ring, surface, 30) in requiredContrast;
  }
}

lemma lawNoBorderRequirement_ensures(surface: Role)
  ensures (lawNoBorderRequirement(surface) == true)
{
  ContrastLiteral();
  RequiredBounds(Role.Border, surface);
}

lemma lawTonesAreReadable_ensures(tone: Tone)
  ensures (lawTonesAreReadable(tone) == true)
{
  ContrastLiteral();
  var r := toneRole(tone);
  RequiredBounds(r, Role.Background);
  RequiredBounds(r, Role.Card);
  if tone.Neutral? {
    assert Pair(Role.MutedForeground, Role.Background, 45) in requiredContrast;
    assert Pair(Role.MutedForeground, Role.Card, 45) in requiredContrast;
  } else if tone.Emphasis? {
    assert Pair(Role.Primary, Role.Background, 45) in requiredContrast;
    assert Pair(Role.Primary, Role.Card, 45) in requiredContrast;
  } else if tone.Positive? {
    assert Pair(Role.Ok, Role.Background, 45) in requiredContrast;
    assert Pair(Role.Ok, Role.Card, 45) in requiredContrast;
  } else if tone.Caution? {
    assert Pair(Role.Warn, Role.Background, 45) in requiredContrast;
    assert Pair(Role.Warn, Role.Card, 45) in requiredContrast;
  } else if tone.Negative? {
    assert Pair(Role.Destructive, Role.Background, 45) in requiredContrast;
    assert Pair(Role.Destructive, Role.Card, 45) in requiredContrast;
  } else {
    assert Pair(Role.Info, Role.Background, 45) in requiredContrast;
    assert Pair(Role.Info, Role.Card, 45) in requiredContrast;
  }
}

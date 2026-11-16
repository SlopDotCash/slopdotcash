lemma choose_ensures(s: LinkRegistry, name: NameEvidence, sameOrigin: bool, team: bool, github: GitHubEvidence, by_: string)
  ensures (inv(s) ==> canChoose(s, name, sameOrigin, team, github, by_) ==> alwaysPairedOwnership(choose(s, name, sameOrigin, team, github, by_)))
  ensures (inv(s) ==> canChoose(s, name, sameOrigin, team, github, by_) ==> alwaysLifetimeLimit(choose(s, name, sameOrigin, team, github, by_)))
  ensures (inv(s) ==> canChoose(s, name, sameOrigin, team, github, by_) ==> alwaysActiveReserved(choose(s, name, sameOrigin, team, github, by_)))
  ensures (inv(s) ==> canChoose(s, name, sameOrigin, team, github, by_) ==> stepHoldingsGrow(s, choose(s, name, sameOrigin, team, github, by_)))
{
  if inv(s) && canChoose(s, name, sameOrigin, team, github, by_) {
    var after := choose(s, name, sameOrigin, team, github, by_);
    assert alwaysPairedOwnership(s) && alwaysLifetimeLimit(s) && alwaysActiveReserved(s);
    assert by_ != "" && name.key != "" && name.text != "";
    assert recordFor(s, name.key).actor == "" || recordFor(s, name.key).actor == by_;
    assert by_ in after.actors && name.key in after.keys;
    assert recordFor(after, name.key) == CodeRecord(by_, name.text);
    assert activeKey(after, by_) == name.key;
    if recordFor(s, name.key).actor == by_ {
      assert name.key in s.keys;
      assert by_ in s.actors && name.key in namesHeld(s, by_);
      assert namesHeld(after, by_) == namesHeld(s, by_);
    } else {
      assert |namesHeld(s, by_)| < 5;
      assert namesHeld(after, by_) == namesHeld(s, by_) + [name.key];
    }
    forall key | key in s.keys
      ensures key in after.keys
      ensures recordFor(after, key).actor == recordFor(s, key).actor
    {
      if key == name.key {
        assert recordFor(s, key).actor != "";
      } else {
        DifferentEncodedKey(key, name.key);
        assert recordFor(after, key) == recordFor(s, key);
      }
    }
    forall actor | actor in after.actors
      ensures actor != "" && activeKey(after, actor) != "" && recordFor(after, activeKey(after, actor)).actor == actor
      ensures |namesHeld(after, actor)| <= 5
      ensures forall key :: key in namesHeld(after, actor) ==> key in after.keys && recordFor(after, key).actor == actor
    {
      if actor != by_ {
        assert actor in s.actors;
        DifferentEncodedKey(actor, by_);
        assert namesHeld(after, actor) == namesHeld(s, actor);
        assert activeKey(after, actor) == activeKey(s, actor);
        assert activeKey(s, actor) in s.keys;
      }
      forall key | key in namesHeld(after, actor)
        ensures key in after.keys && recordFor(after, key).actor == actor
      {
        if actor == by_ && key == name.key {
        } else {
          assert key in namesHeld(s, actor);
          assert actor in s.actors;
          assert key in s.keys && recordFor(s, key).actor == actor;
        }
      }
    }
    forall key | key in after.keys
      ensures key != "" && recordFor(after, key).actor != "" && recordFor(after, key).text != "" &&
        recordFor(after, key).actor in after.actors && key in namesHeld(after, recordFor(after, key).actor)
    {
      if key == name.key {
        assert key in namesHeld(after, by_);
      } else {
        DifferentEncodedKey(key, name.key);
        assert key in s.keys && recordFor(after, key) == recordFor(s, key);
        var holder := recordFor(s, key).actor;
        assert holder in s.actors && holder in after.actors;
        assert key in namesHeld(s, holder);
        if holder == by_ {
          assert key in namesHeld(after, by_);
        } else {
          assert namesHeld(after, holder) == namesHeld(s, holder);
        }
      }
    }
  }
}

lemma DifferentEncodedKey(a: string, b: string)
  requires a != b
  ensures "$" + a != "$" + b
{
  assert ("$" + a)[1..] == a;
  assert ("$" + b)[1..] == b;
}

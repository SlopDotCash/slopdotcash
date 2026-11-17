lemma gasWithMargin_ensures(estimate: int)
  requires (estimate >= 0)
  ensures ((gasWithMargin(estimate) * 10) <= (estimate * 12))
  ensures ((estimate * 12) < ((gasWithMargin(estimate) + 1) * 10))
{
  assert JSTruncDiv((estimate * 12), 10) == (estimate * 12) / 10;
  assert estimate * 12 == ((estimate * 12) / 10) * 10 + (estimate * 12) % 10;
}

lemma bumpEighth_ensures(value: int)
  requires (value >= 0)
  ensures ((bumpEighth(value) * 8) >= (value * 9))
  ensures (((bumpEighth(value) - 1) * 8) < (value * 9))
{
  assert JSTruncDiv(((value * 9) + 7), 8) == ((value * 9) + 7) / 8;
  assert (value * 9) + 7 == (((value * 9) + 7) / 8) * 8 + ((value * 9) + 7) % 8;
}

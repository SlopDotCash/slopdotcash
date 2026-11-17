// spec/security/terms.md, "Paid terms carry their split, funding policy, eligibility class and asset"
lemma researcherShare_ensures(gross: int, full: bool)
  requires (gross > 0)
  requires (full || (JSRem(gross, 4) == 0))
  ensures (full ==> (researcherShare(gross, full) == gross))
  ensures (!(full) ==> ((researcherShare(gross, full) * 4) == (gross * 3)))
{
  if !full {
    assert JSRem(gross, 4) == gross % 4;
    assert JSTruncDiv(gross, 4) == gross / 4;
    assert gross == (gross / 4) * 4 + gross % 4;
  }
}

lemma platformShare_ensures(gross: int, full: bool)
  requires (gross > 0)
  requires (full || (JSRem(gross, 4) == 0))
  ensures (platformShare(gross, full) >= 0)
  ensures ((researcherShare(gross, full) + platformShare(gross, full)) == gross)
{
  if !full {
    assert JSRem(gross, 4) == gross % 4;
    assert JSTruncDiv(gross, 4) == gross / 4;
    assert gross == (gross / 4) * 4 + gross % 4;
  }
}

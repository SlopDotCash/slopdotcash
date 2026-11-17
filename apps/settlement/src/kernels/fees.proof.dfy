lemma ordinaryFeeBase_ensures(gross: int)
  ensures (ordinaryFeeBase(gross) >= 0)
  ensures ((gross <= 0) ==> (ordinaryFeeBase(gross) == 0))
  ensures ((gross > 0) ==> (ordinaryFeeBase(gross) <= gross))
  ensures ((gross > 0) ==> ((((ordinaryFeeBase(gross) - 1) * 50) < gross) && (gross <= (ordinaryFeeBase(gross) * 50))))
{
  if gross > 0 {
    assert JSTruncDiv((gross + 49), 50) == (gross + 49) / 50;
    assert ordinaryFeeBase(gross) == (gross + 49) / 50;
    assert gross + 49 == ((gross + 49) / 50) * 50 + (gross + 49) % 50;
  }
}

lemma ordinaryNetBase_ensures(gross: int)
  requires (gross >= 0)
  ensures (ordinaryNetBase(gross) >= 0)
  ensures (ordinaryNetBase(gross) <= gross)
  ensures ((ordinaryNetBase(gross) + ordinaryFeeBase(gross)) == gross)
{
  ordinaryFeeBase_ensures(gross);
}

lemma bountyFeeBase_ensures(gross: int)
  requires (gross > 0)
  requires (JSRem(gross, 4) == 0)
  ensures (bountyFeeBase(gross) > 0)
  ensures ((bountyFeeBase(gross) * 4) == gross)
  ensures ((gross - bountyFeeBase(gross)) == (3 * bountyFeeBase(gross)))
{
  assert JSRem(gross, 4) == gross % 4;
  assert JSTruncDiv(gross, 4) == gross / 4;
  assert gross == (gross / 4) * 4 + gross % 4;
}

lemma bountyResearcherBase_ensures(gross: int)
  requires (gross > 0)
  requires (JSRem(gross, 4) == 0)
  ensures (bountyResearcherBase(gross) > 0)
  ensures ((bountyResearcherBase(gross) * 4) == (3 * gross))
{
  assert JSRem(gross, 4) == gross % 4;
  assert JSTruncDiv(gross, 4) == gross / 4;
  assert gross == (gross / 4) * 4 + gross % 4;
}

lemma payoutFeeAccepted_ensures(gross: int, fee: int, bounty: bool)
  requires (gross > 0)
  ensures (payoutFeeAccepted(gross, fee, bounty) <==> (if bounty then ((JSRem(gross, 4) == 0) && ((fee * 4) == gross)) else (fee == ordinaryFeeBase(gross))))
  ensures (payoutFeeAccepted(gross, fee, bounty) ==> ((0 <= fee) && (fee <= gross)))
{
  if !bounty {
    ordinaryFeeBase_ensures(gross);
  }
}

lemma payoutAmountsAccepted_ensures(gross: int, fee: int, net: int, bounty: bool, maximum: int)
  ensures (payoutAmountsAccepted(gross, fee, net, bounty, maximum) <==> ((((gross > 0) && (gross <= maximum)) && payoutFeeAccepted(gross, fee, bounty)) && (gross == (fee + net))))
  ensures (payoutAmountsAccepted(gross, fee, net, bounty, maximum) ==> ((((0 <= fee) && (fee <= gross)) && (0 <= net)) && (net <= gross)))
{
  if gross > 0 {
    payoutFeeAccepted_ensures(gross, fee, bounty);
  }
}

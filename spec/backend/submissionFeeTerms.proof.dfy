// spec/backend/submissionFeeTerms.md, "The submission fee terms are published constants that change only by a reviewed change"; spec/backend/submissionFeeTerms.md, "A SLOP rate is in force from its own hour, and the previous one still counts for 48 hours"

lemma lawPublishedContractsHaveStartBlocks_ensures(network: string)
  ensures (lawPublishedContractsHaveStartBlocks(network) == true)
{
  NetworkTermsCases(network);
}

lemma lawSlopIsBurnedAndStablecoinsGoToTheFeeWallet_ensures(network: string, tokenKey: string)
  ensures (lawSlopIsBurnedAndStablecoinsGoToTheFeeWallet(network, tokenKey) == true)
{
  NetworkTermsCases(network);
  if networkTerms(network).network == "" {
    TokenOfFilter(network, tokenKey);
    ProofLib.FilterNil((t: FeeToken) => (t.key == tokenKey), networkTerms(network).tokens);
  }
}

lemma lawRateNeverInForceBeforeItsTime_ensures(rates: seq<FeeRate>, t: int)
  ensures (lawRateNeverInForceBeforeItsTime(rates, t) == true)
{
  var cur := rateAt(rates, t);
  FoldMaxRateLe(
    (best: FeeRate, r: FeeRate) => (if (((r.effectiveAt >= 0) && (r.effectiveAt <= t)) && (r.effectiveAt > best.effectiveAt)) then r else best),
    noRate,
    rates,
    t
  );
  FoldMaxRateLt(
    (best: FeeRate, r: FeeRate) => (if (((r.effectiveAt >= 0) && (r.effectiveAt < cur.effectiveAt)) && (r.effectiveAt > best.effectiveAt)) then r else best),
    noRate,
    rates,
    cur.effectiveAt
  );
}

lemma lawLatestRateInForce_ensures(rates: seq<FeeRate>, t: int)
  ensures (lawLatestRateInForce(rates, t) == true)
{
  FoldMaxRateLe(
    (best: FeeRate, r: FeeRate) => (if (((r.effectiveAt >= 0) && (r.effectiveAt <= t)) && (r.effectiveAt > best.effectiveAt)) then r else best),
    noRate,
    rates,
    t
  );
}

lemma lawNoRateNoSlop_ensures(rates: seq<FeeRate>, t: int)
  ensures (lawNoRateNoSlop(rates, t) == true)
{
  FoldMaxRateLe(
    (best: FeeRate, r: FeeRate) => (if (((r.effectiveAt >= 0) && (r.effectiveAt <= t)) && (r.effectiveAt > best.effectiveAt)) then r else best),
    noRate,
    rates,
    t
  );
}

lemma NetworkTermsFilter(network: string)
  ensures networkTerms(network) == (if 0 < |ProofLib.Filter((n: FeeNetwork) => (n.network == network), feeNetworks)| then ProofLib.Filter((n: FeeNetwork) => (n.network == network), feeNetworks)[0] else noNetwork)
{
}

lemma TokenOfFilter(network: string, tokenKey: string)
  ensures tokenOf(network, tokenKey) == (if 0 < |ProofLib.Filter((t: FeeToken) => (t.key == tokenKey), networkTerms(network).tokens)| then ProofLib.Filter((t: FeeToken) => (t.key == tokenKey), networkTerms(network).tokens)[0] else noToken)
{
}

lemma NetworkTermsCases(network: string)
  ensures networkTerms(network) == (if network == "base-mainnet" then feeNetworks[0] else if network == "robinhood-mainnet" then feeNetworks[1] else noNetwork)
{
  NetworkTermsFilter(network);
  var p := (n: FeeNetwork) => (n.network == network);
  assert |feeNetworks| == 2;
  assert feeNetworks[1..] == [feeNetworks[1]];
  assert [feeNetworks[1]][1..] == [];
  ProofLib.FilterCons(p, feeNetworks);
  ProofLib.FilterCons(p, [feeNetworks[1]]);
  ProofLib.FilterNil(p, []);
}

lemma FoldMaxRateLe(f: (FeeRate, FeeRate) -> FeeRate, init: FeeRate, rates: seq<FeeRate>, t: int)
  requires forall b, r :: f(b, r) == (if (((r.effectiveAt >= 0) && (r.effectiveAt <= t)) && (r.effectiveAt > b.effectiveAt)) then r else b)
  requires init.effectiveAt >= 0 ==> init.effectiveAt <= t
  ensures Std.Collections.Seq.FoldLeft(f, init, rates).effectiveAt >= init.effectiveAt
  ensures Std.Collections.Seq.FoldLeft(f, init, rates).effectiveAt >= 0 ==> Std.Collections.Seq.FoldLeft(f, init, rates).effectiveAt <= t
  ensures forall r :: r in rates && r.effectiveAt >= 0 && r.effectiveAt <= t ==> r.effectiveAt <= Std.Collections.Seq.FoldLeft(f, init, rates).effectiveAt
  ensures (init == noRate && !(exists r :: r in rates && !(r.effectiveAt > t))) ==> Std.Collections.Seq.FoldLeft(f, init, rates) == noRate
  decreases |rates|
{
  if |rates| > 0 {
    var next := f(init, rates[0]);
    FoldMaxRateLe(f, next, rates[1..], t);
    assert rates == [rates[0]] + rates[1..];
  }
}

lemma FoldMaxRateLt(f: (FeeRate, FeeRate) -> FeeRate, init: FeeRate, rates: seq<FeeRate>, bound: int)
  requires forall b, r :: f(b, r) == (if (((r.effectiveAt >= 0) && (r.effectiveAt < bound)) && (r.effectiveAt > b.effectiveAt)) then r else b)
  requires init.effectiveAt >= 0 ==> init.effectiveAt < bound
  ensures Std.Collections.Seq.FoldLeft(f, init, rates).effectiveAt >= 0 ==> Std.Collections.Seq.FoldLeft(f, init, rates).effectiveAt < bound
  decreases |rates|
{
  if |rates| > 0 {
    FoldMaxRateLt(f, f(init, rates[0]), rates[1..], bound);
  }
}

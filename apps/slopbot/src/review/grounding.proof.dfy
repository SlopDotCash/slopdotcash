// spec/slopbot/closure.md, "Grounding and the duplicate relation are checked by the service, never taken from the model"

lemma evidenceFound_ensures(evidence: seq<string>, itemText: string)
  ensures (evidenceFound(evidence, itemText) ==> (|evidence| > 0))
  ensures (evidenceFound(evidence, itemText) ==> forall k: int :: ((0 <= k) ==> (k < |evidence|) ==> (StringIndexOf(itemText, evidence[k]) >= 0)))
{
  if evidenceFound(evidence, itemText) {
    var quote :| quote in evidence && substantive(quote);
    assert |evidence| > 0;
    forall k: int | 0 <= k < |evidence|
      ensures StringIndexOf(itemText, evidence[k]) >= 0
    {
      assert evidence[k] in evidence;
    }
  }
}

lemma rulesFound_ensures(rules: seq<RuleRef>, policy: seq<PolicyText>)
  ensures (rulesFound(rules, policy) ==> (|rules| > 0))
  ensures (rulesFound(rules, policy) ==> forall k: int :: ((0 <= k) ==> (k < |rules|) ==> ruleQuoted(rules[k], policy)))
{
  if rulesFound(rules, policy) {
    forall k: int | 0 <= k < |rules|
      ensures ruleQuoted(rules[k], policy)
    {
      assert rules[k] in rules;
    }
  }
}

//@ backend dafny
// spec/slopbot/closure.md, "Grounding and the duplicate relation are checked by the service, never taken from the model"

export const minimumQuoteChars = 8;

export interface RuleRef { source: string; quote: string }
export interface PolicyText { path: string; text: string }

/** @throws {never} */
//@ pure
export function substantive(quote: string): boolean {
  return quote.trim().length >= minimumQuoteChars;
}

/** @throws {never} */
//@ pure
export function evidenceFound(evidence: string[], itemText: string): boolean {
  //@ ensures \result ==> evidence.length > 0
  //@ ensures \result ==> forall(k, 0 <= k && k < evidence.length ==> itemText.includes(evidence[k]))
  return evidence.some((quote) => substantive(quote)) && evidence.every((quote) => itemText.includes(quote));
}

/** @throws {never} */
//@ pure
export function ruleQuoted(rule: RuleRef, policy: PolicyText[]): boolean {
  return substantive(rule.quote) && policy.some((file) => file.path === rule.source && file.text.includes(rule.quote));
}

/** @throws {never} */
//@ pure
export function rulesFound(rules: RuleRef[], policy: PolicyText[]): boolean {
  //@ ensures \result ==> rules.length > 0
  //@ ensures \result ==> forall(k, 0 <= k && k < rules.length ==> ruleQuoted(rules[k], policy))
  return rules.length > 0 && rules.every((rule) => ruleQuoted(rule, policy));
}

//@ backend dafny
// spec/backend/bindingConsent.md, "EVM consent names one registered deployment, the authorized claim and an expected version"; spec/backend/bindingConsent.md, "Authorization stores a consent the attester can still submit and never edits an earlier one"

//@ pure
export function isDigitCode(code: number): boolean {
  return 48 <= code && code <= 57;
}

export function isUint64Decimal(value: string): boolean {
  //@ ensures \result <==> 1 <= value.length && value.length <= 19 && (value.length == 1 || value.charCodeAt(0) != 48) && forall(i, 0 <= i && i < value.length ==> isDigitCode(value.charCodeAt(i)))
  if (value.length < 1 || value.length > 19) return false;
  if (value.length > 1 && value.charCodeAt(0) === 48) return false;
  let i = 0;
  while (i < value.length) {
    //@ invariant 0 <= i && i <= value.length
    //@ invariant forall(k, 0 <= k && k < i ==> isDigitCode(value.charCodeAt(k)))
    //@ decreases value.length - i
    if (!isDigitCode(value.charCodeAt(i))) return false;
    i += 1;
  }
  return true;
}

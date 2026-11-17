//@ backend dafny
// spec/fees/conversion.md, "Only finalized fee receipts and claims are fee income; gas top-ups never are"

//@ pure
export function hexDigit(code: number): number {
  //@ ensures -1 <= \result && \result < 16
  //@ ensures \result >= 0 <==> ((48 <= code && code <= 57) || (97 <= code && code <= 102) || (65 <= code && code <= 70))
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 102) return code - 87;
  if (code >= 65 && code <= 70) return code - 55;
  return -1;
}

//@ pure
export function hexFrom(data: string, at: number): boolean {
  //@ requires 0 <= at && at <= data.length
  //@ decreases data.length - at
  return at === data.length || (hexDigit(data.charCodeAt(at)) >= 0 && hexFrom(data, at + 1));
}

//@ pure
export function isAmountWord(data: string): boolean {
  return data.length === 66 && data.charCodeAt(0) === 48 && data.charCodeAt(1) === 120 && hexFrom(data, 2);
}

//@ pure
export function wordValue(data: string, at: number, value: bigint): bigint {
  //@ requires 0 <= at && at <= data.length && hexFrom(data, at)
  //@ decreases data.length - at
  if (at === data.length) return value;
  return wordValue(data, at + 1, value * 16n + BigInt(hexDigit(data.charCodeAt(at))));
}

/** Canonical integer base-unit text accepted by the vault accounting. */

/**
 * Canonical unsigned decimal base units no larger than the uint128 vault
 * limit: one to 39 ASCII digits without a leading zero. Digits and Decimal
 * are the proof's ASCII-digit predicate and decimal value.
 */
//@ verify
//@ ensures \result <==> text.length >= 1 && text.length <= 39 && (text.length == 1 || text.charCodeAt(0) != 48) && Digits(text) && Decimal(text) <= 340282366920938463463374607431768211455n
export function isCanonicalBaseUnits(text: string): boolean {
  if (text.length < 1 || text.length > 39) return false;
  if (text.length > 1 && text.charCodeAt(0) === 48) return false;
  let value = 0n;
  let i = 0;
  while (i < text.length) {
    //@ invariant 0 <= i && i <= text.length
    //@ invariant forall(k, 0 <= k && k < i ==> 48 <= text.charCodeAt(k) && text.charCodeAt(k) <= 57)
    //@ invariant value == Decimal(text.slice(0, i))
    const code = text.charCodeAt(i);
    if (code < 48 || code > 57) return false;
    value = value * 10n + BigInt(code - 48);
    i += 1;
  }
  return value <= 340282366920938463463374607431768211455n;
}

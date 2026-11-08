/** Exact decimal arithmetic. Callers validate unsigned digits and precision first. */
//@ verify
//@ requires exponent >= 0 && exponent <= 36
//@ ensures \result == Pow10(exponent)
//@ ensures \result > 0
function decimalPower(exponent: number): bigint {
  let result = 1n;
  let i = 0;
  while (i < exponent) {
    //@ invariant 0 <= i && i <= exponent
    //@ invariant result == Pow10(i)
    //@ invariant result > 0
    result *= 10n;
    i += 1;
  }
  return result;
}

//@ verify
//@ requires Digits(text)
//@ ensures \result == Decimal(text)
//@ ensures \result >= 0 && \result < Pow10(text.length)
function decimalDigits(text: string): bigint {
  let result = 0n;
  let i = 0;
  while (i < text.length) {
    //@ invariant 0 <= i && i <= text.length
    //@ invariant result == Decimal(text.slice(0, i))
    //@ invariant result >= 0 && result < Pow10(i)
    const digit = text.charCodeAt(i) - 48;
    result = result * 10n + BigInt(digit);
    i += 1;
  }
  return result;
}

//@ verify
//@ requires Digits(whole) && Digits(fraction)
//@ requires 0 <= decimals && decimals <= 36 && fraction.length <= decimals
//@ ensures \result == Decimal(whole) * Pow10(decimals) + Decimal(fraction) * Pow10(decimals - fraction.length)
//@ ensures \result >= 0
//@ ensures Decimal(whole) * Pow10(decimals) <= \result && \result < (Decimal(whole) + 1) * Pow10(decimals)
export function decimalBaseValue(
  whole: string,
  fraction: string,
  decimals: number,
): bigint {
  const wholeValue = decimalDigits(whole);
  const fractionValue = decimalDigits(fraction);
  const scale = decimalPower(decimals);
  const fractionScale = decimalPower(decimals - fraction.length);
  return wholeValue * scale + fractionValue * fractionScale;
}

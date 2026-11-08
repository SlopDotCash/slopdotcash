export const BASE58_ALPHABET =
  "123456789" +
  "ABCDEFGH" +
  "JKLMN" +
  "PQRSTUVWXYZ" +
  "abcdefghijk" +
  "mnopqrstuvwxyz";

/** Exact alphabet lookup, including refusal of every other string. */
//@ verify
//@ ensures -1 <= \result && \result < BASE58_ALPHABET.length
//@ ensures (\result == -1) <==> forall(i, 0 <= i && i < BASE58_ALPHABET.length ==> AlphabetCharacter(i) != character)
//@ ensures \result >= 0 ==> AlphabetCharacter(\result) == character
//@ ensures forall(k, 0 <= k && k < BASE58_ALPHABET.length && AlphabetCharacter(k) == character ==> \result == k)
export function base58Digit(character: string): number {
  let i = 0;
  while (i < BASE58_ALPHABET.length) {
    //@ invariant 0 <= i && i <= BASE58_ALPHABET.length
    //@ invariant forall(k, 0 <= k && k < i ==> AlphabetCharacter(k) != character)
    if (BASE58_ALPHABET.slice(i, i + 1) === character) return i;
    i += 1;
  }
  return -1;
}

/** Exact radix conversion with one output zero for each leading input zero. */
//@ verify
//@ requires 2 <= fromBase && fromBase <= 256 && 2 <= toBase && toBase <= 256
//@ requires forall(i, 0 <= i && i < source.length ==> 0 <= source[i] && source[i] < fromBase)
//@ ensures forall(i, 0 <= i && i < \result.length ==> 0 <= \result[i] && \result[i] < toBase)
//@ ensures BeValue(\result, toBase) == BeValue(source, fromBase)
//@ ensures LeadingZeros(\result) == LeadingZeros(source)
export function convertRadixDigits(
  source: readonly number[],
  fromBase: bigint,
  toBase: bigint,
): number[] {
  let value = 0n;
  let i = 0;
  while (i < source.length) {
    //@ invariant 0 <= i && i <= source.length
    //@ invariant value == BeValue(source.slice(0, i), fromBase)
    //@ invariant value >= 0
    value = value * fromBase + BigInt(source[i]);
    i += 1;
  }
  //@ ghost let original = value
  const least: number[] = [];
  while (value > 0n) {
    //@ invariant value >= 0
    //@ invariant original == value * RadixPower(toBase, least.length) + LeValue(least, toBase)
    //@ invariant forall(k, 0 <= k && k < least.length ==> 0 <= least[k] && least[k] < toBase)
    //@ invariant value > 0 || least.length == 0 || least[least.length - 1] > 0
    //@ decreases value
    least.push(Number(value % toBase));
    value /= toBase;
  }
  const result: number[] = [];
  let leading = 0;
  while (leading < source.length && source[leading] === 0) {
    //@ invariant 0 <= leading && leading <= source.length
    //@ invariant result.length == leading
    //@ invariant forall(k, 0 <= k && k < leading ==> source[k] == 0 && result[k] == 0)
    //@ invariant BeValue(result, toBase) == 0
    //@ invariant leading <= LeadingZeros(source)
    result.push(0);
    leading += 1;
  }
  let j = least.length;
  while (j > 0) {
    //@ invariant 0 <= j && j <= least.length
    //@ invariant result.length == leading + least.length - j
    //@ invariant forall(k, 0 <= k && k < result.length ==> 0 <= result[k] && result[k] < toBase)
    //@ invariant forall(k, 0 <= k && k < leading ==> result[k] == 0)
    //@ invariant result.length > leading ==> result[leading] > 0
    //@ invariant BeValue(result, toBase) * RadixPower(toBase, j) + LeValue(least.slice(0, j), toBase) == original
    result.push(least[j - 1]);
    j -= 1;
  }
  return result;
}

/** The existing byte-carry decoder, with bounded integer division. */
//@ verify
//@ requires forall(i, 0 <= i && i < source.length ==> 0 <= source[i] && source[i] < 58)
//@ ensures forall(i, 0 <= i && i < \result.length ==> 0 <= \result[i] && \result[i] < 256)
//@ ensures BeValue(\result, 256) == BeValue(source, 58)
//@ ensures LeadingZeros(\result) == LeadingZeros(source)
export function decodeBase58Digits(source: readonly number[]): number[] {
  const bytes: number[] = [0];
  let i = 0;
  while (i < source.length) {
    //@ invariant 0 <= i && i <= source.length
    //@ invariant bytes.length >= 1
    //@ invariant forall(k, 0 <= k && k < bytes.length ==> 0 <= bytes[k] && bytes[k] < 256)
    //@ invariant bytes.length == 1 || bytes[bytes.length - 1] > 0
    //@ invariant LeValue(bytes, 256) == BeValue(source.slice(0, i), 58)
    const digit = source[i];
    let carry = digit;
    //@ ghost let originalBytes = bytes.slice()
    let index = 0;
    while (index < bytes.length) {
      //@ invariant 0 <= index && index <= bytes.length
      //@ invariant bytes.length == originalBytes.length && bytes.length >= 1
      //@ invariant 0 <= carry && carry < 58
      //@ invariant forall(k, 0 <= k && k < bytes.length ==> 0 <= bytes[k] && bytes[k] < 256)
      //@ invariant forall(k, index <= k && k < bytes.length ==> bytes[k] == originalBytes[k])
      //@ invariant originalBytes.length == 1 || originalBytes[originalBytes.length - 1] > 0
      //@ invariant index < bytes.length || carry > 0 || bytes.length == 1 || bytes[bytes.length - 1] > 0
      //@ invariant LeValue(bytes.slice(0, index), 256) + carry * RadixPower(256, index) + 58 * (LeValue(originalBytes, 256) - LeValue(originalBytes.slice(0, index), 256)) == BeValue(source.slice(0, i), 58) * 58 + digit
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
      index += 1;
    }
    while (carry > 0) {
      //@ invariant 0 <= carry && carry < 58
      //@ invariant bytes.length >= 1
      //@ invariant forall(k, 0 <= k && k < bytes.length ==> 0 <= bytes[k] && bytes[k] < 256)
      //@ invariant carry > 0 || bytes.length == 1 || bytes[bytes.length - 1] > 0
      //@ invariant LeValue(bytes, 256) + carry * RadixPower(256, bytes.length) == BeValue(source.slice(0, i), 58) * 58 + digit
      //@ decreases carry
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
    i += 1;
  }
  const significant = bytes.length === 1 && bytes[0] === 0 ? [] : bytes;
  const result: number[] = [];
  let leading = 0;
  while (leading < source.length && source[leading] === 0) {
    //@ invariant 0 <= leading && leading <= source.length
    //@ invariant result.length == leading
    //@ invariant forall(k, 0 <= k && k < leading ==> source[k] == 0 && result[k] == 0)
    //@ invariant BeValue(result, 256) == 0
    //@ invariant leading <= LeadingZeros(source)
    result.push(0);
    leading += 1;
  }
  let j = significant.length;
  while (j > 0) {
    //@ invariant 0 <= j && j <= significant.length
    //@ invariant result.length == leading + significant.length - j
    //@ invariant forall(k, 0 <= k && k < result.length ==> 0 <= result[k] && result[k] < 256)
    //@ invariant forall(k, 0 <= k && k < leading ==> result[k] == 0)
    //@ invariant result.length > leading ==> result[leading] > 0
    //@ invariant BeValue(result, 256) * RadixPower(256, j) + LeValue(significant.slice(0, j), 256) == BeValue(source, 58)
    result.push(significant[j - 1]);
    j -= 1;
  }
  return result;
}

/** Exact identifier kernels: EVM account text and GitHub user node payloads. */

/** Lowercase 0x-prefixed 20-byte hex that is not the zero address. */
//@ verify
//@ ensures \result <==> value.length == 42 && value.charCodeAt(0) == 48 && value.charCodeAt(1) == 120 && forall(i, 2 <= i && i < 42 ==> (48 <= value.charCodeAt(i) && value.charCodeAt(i) <= 57) || (97 <= value.charCodeAt(i) && value.charCodeAt(i) <= 102)) && exists(i, 2 <= i && i < 42 && value.charCodeAt(i) != 48)
export function isEvmAccount(value: string): boolean {
  if (
    value.length !== 42 ||
    value.charCodeAt(0) !== 48 ||
    value.charCodeAt(1) !== 120
  )
    return false;
  let nonzero = false;
  let i = 2;
  while (i < 42) {
    //@ invariant 2 <= i && i <= 42
    //@ invariant forall(k, 2 <= k && k < i ==> (48 <= value.charCodeAt(k) && value.charCodeAt(k) <= 57) || (97 <= value.charCodeAt(k) && value.charCodeAt(k) <= 102))
    //@ invariant nonzero <==> exists(k, 2 <= k && k < i && value.charCodeAt(k) != 48)
    const c = value.charCodeAt(i);
    if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 102))) return false;
    if (c !== 48) nonzero = true;
    i += 1;
  }
  return nonzero;
}

/**
 * MessagePack payload of a current GitHub user node ID: fixarray(2), the
 * fixint 0, then the ID as a uint32, or as a uint64 only above the uint32
 * range. Any other spelling, and the ID zero, yields 0. BigEndianTail is
 * the proof's big-endian value of bytes[3..end).
 */
//@ verify
//@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
//@ ensures \result >= 0
//@ ensures \result > 0 ==> bytes.length >= 7 && bytes[0] == 146 && bytes[1] == 0 && \result == BigEndianTail(bytes, bytes.length)
//@ ensures \result > 0 && \result <= 4294967295 ==> bytes.length == 7 && bytes[2] == 206
//@ ensures \result > 4294967295 ==> bytes.length == 11 && bytes[2] == 207
//@ ensures bytes.length == 7 && bytes[0] == 146 && bytes[1] == 0 && bytes[2] == 206 ==> \result == BigEndianTail(bytes, 7)
//@ ensures bytes.length == 11 && bytes[0] == 146 && bytes[1] == 0 && bytes[2] == 207 && BigEndianTail(bytes, 11) > 4294967295 ==> \result == BigEndianTail(bytes, 11)
export function githubUserIdFromPack(bytes: number[]): bigint {
  if (bytes.length < 3 || bytes[0] !== 146 || bytes[1] !== 0) return 0n;
  const width = bytes[2] === 206 ? 4 : bytes[2] === 207 ? 8 : 0;
  if (width === 0 || bytes.length !== 3 + width) return 0n;
  let id = 0n;
  let i = 0;
  while (i < width) {
    //@ invariant 0 <= i && i <= width
    //@ invariant id == BigEndianTail(bytes, 3 + i)
    //@ invariant id >= 0
    id = id * 256n + BigInt(bytes[3 + i]);
    i += 1;
  }
  if (width === 8 && id <= 4294967295n) return 0n;
  return id;
}

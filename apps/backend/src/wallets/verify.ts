//@ backend dafny
// spec/backend/wallets.md, "Registration appends an immutable successor or returns the current registry row"; spec/backend/wallets.md, "The legacy possession verifier issues single-use challenges and keeps one attestation per claim"

//@ pure
export function isLowerHexCode(code: number): boolean {
  return (48 <= code && code <= 57) || (97 <= code && code <= 102);
}

//@ pure
export function isBase58Code(code: number): boolean {
  return (49 <= code && code <= 57) || (65 <= code && code <= 72) || (74 <= code && code <= 78) || (80 <= code && code <= 90) || (97 <= code && code <= 107) || (109 <= code && code <= 122);
}

//@ pure
export function isBase64Code(code: number): boolean {
  return (65 <= code && code <= 90) || (97 <= code && code <= 122) || (48 <= code && code <= 57) || code === 43 || code === 47;
}

//@ pure
export function endsWithoutSpareBits(code: number): boolean {
  return code === 65 || code === 81 || code === 103 || code === 119;
}

export function isEvmAccount(value: string): boolean {
  //@ ensures \result <==> value.length == 42 && value.charCodeAt(0) == 48 && value.charCodeAt(1) == 120 && forall(i, 2 <= i && i < 42 ==> isLowerHexCode(value.charCodeAt(i))) && exists(i, 2 <= i && i < 42 && value.charCodeAt(i) != 48)
  if (value.length !== 42 || value.charCodeAt(0) !== 48 || value.charCodeAt(1) !== 120) return false;
  let nonzero = false;
  let i = 2;
  while (i < 42) {
    //@ invariant 2 <= i && i <= 42
    //@ invariant forall(k, 2 <= k && k < i ==> isLowerHexCode(value.charCodeAt(k)))
    //@ invariant nonzero <==> exists(k, 2 <= k && k < i && value.charCodeAt(k) != 48)
    //@ decreases 42 - i
    const code = value.charCodeAt(i);
    if (!isLowerHexCode(code)) return false;
    if (code !== 48) nonzero = true;
    i += 1;
  }
  return nonzero;
}

export function isSolanaAddressText(value: string): boolean {
  //@ ensures \result <==> 32 <= value.length && value.length <= 44 && forall(i, 0 <= i && i < value.length ==> isBase58Code(value.charCodeAt(i)))
  if (value.length < 32 || value.length > 44) return false;
  let i = 0;
  while (i < value.length) {
    //@ invariant 0 <= i && i <= value.length
    //@ invariant forall(k, 0 <= k && k < i ==> isBase58Code(value.charCodeAt(k)))
    //@ decreases value.length - i
    if (!isBase58Code(value.charCodeAt(i))) return false;
    i += 1;
  }
  return true;
}

export function isCanonicalSignatureText(value: string): boolean {
  //@ ensures \result <==> value.length == 88 && value.charCodeAt(86) == 61 && value.charCodeAt(87) == 61 && endsWithoutSpareBits(value.charCodeAt(85)) && forall(i, 0 <= i && i < 86 ==> isBase64Code(value.charCodeAt(i)))
  if (value.length !== 88 || value.charCodeAt(86) !== 61 || value.charCodeAt(87) !== 61 || !endsWithoutSpareBits(value.charCodeAt(85))) return false;
  let i = 0;
  while (i < 86) {
    //@ invariant 0 <= i && i <= 86
    //@ invariant forall(k, 0 <= k && k < i ==> isBase64Code(value.charCodeAt(k)))
    //@ decreases 86 - i
    if (!isBase64Code(value.charCodeAt(i))) return false;
    i += 1;
  }
  return true;
}

//@ pure
export function sameBytes(bytes: Uint8Array, from: number, to: number, value: number): boolean {
  //@ type bytes number[]
  //@ requires 0 <= from && from <= to && to <= bytes.length
  //@ decreases to - from
  if (from === to) return true;
  return bytes[from] === value && sameBytes(bytes, from + 1, to, value);
}

//@ pure
export function reducedAtLeastPrime(bytes: Uint8Array): boolean {
  //@ type bytes number[]
  //@ requires bytes.length == 32
  return bytes[31] % 128 === 127 && sameBytes(bytes, 1, 31, 255) && bytes[0] >= 237;
}

//@ pure
export function signedZeroX(bytes: Uint8Array): boolean {
  //@ type bytes number[]
  //@ requires bytes.length == 32
  const one = bytes[31] % 128 === 0 && sameBytes(bytes, 1, 31, 0) && bytes[0] === 1;
  const primeLessOne = bytes[31] % 128 === 127 && sameBytes(bytes, 1, 31, 255) && bytes[0] === 236;
  return bytes[31] >= 128 && (one || primeLessOne);
}

//@ pure
export function isStrictPointEncoding(bytes: Uint8Array): boolean {
  //@ type bytes number[]
  return bytes.length === 32 && !reducedAtLeastPrime(bytes) && !signedZeroX(bytes);
}

//@ pure
export function wordAt(bytes: Uint8Array, at: number): number {
  //@ type bytes number[]
  //@ requires 0 <= at && at + 4 <= bytes.length
  return bytes[at] + 256 * bytes[at + 1] + 65536 * bytes[at + 2] + 16777216 * bytes[at + 3];
}

//@ pure
export function encodesY(bytes: Uint8Array, w0: number, w1: number, w2: number, w3: number, w4: number, w5: number, w6: number, w7: number): boolean {
  //@ type bytes number[]
  //@ requires bytes.length == 32
  return wordAt(bytes, 0) === w0 && wordAt(bytes, 4) === w1 && wordAt(bytes, 8) === w2 && wordAt(bytes, 12) === w3 && wordAt(bytes, 16) === w4 && wordAt(bytes, 20) === w5 && wordAt(bytes, 24) === w6 && wordAt(bytes, 28) % 2147483648 === w7;
}

//@ pure
export function isSmallOrderEncoding(bytes: Uint8Array): boolean {
  //@ type bytes number[]
  return bytes.length === 32 && (
    encodesY(bytes, 0, 0, 0, 0, 0, 0, 0, 0) ||
    encodesY(bytes, 1, 0, 0, 0, 0, 0, 0, 0) ||
    encodesY(bytes, 4294967276, 4294967295, 4294967295, 4294967295, 4294967295, 4294967295, 4294967295, 2147483647) ||
    encodesY(bytes, 2408966182, 2955391682, 2314519365, 4036554738, 95215573, 959694547, 2281846961, 100422509) ||
    encodesY(bytes, 1886001095, 1339575613, 1980447930, 258412557, 4199751722, 3335272748, 2013120334, 2047061138)
  );
}

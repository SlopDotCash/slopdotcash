const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map(
  [...BASE58_ALPHABET].map((character, index) => [character, index]),
);

export function encodeBase58Bytes(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let text = "";
  while (value > 0n) {
    text = BASE58_ALPHABET[Number(value % 58n)] + text;
    value /= 58n;
  }
  let leading = 0;
  while (leading < bytes.length && bytes[leading] === 0) leading += 1;
  return "1".repeat(leading) + text;
}

/** Decodes base58 of any length, such as Solana instruction data. */
export function decodeBase58Bytes(value: string): Uint8Array {
  const bytes: number[] = [0];
  for (const character of value) {
    const digit = BASE58_INDEX.get(character);
    if (digit === undefined) throw new TypeError("invalid base58 value");
    let carry = digit;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const leadingZeroes = value.match(/^1*/u)?.[0].length ?? 0;
  const significant = bytes.length === 1 && bytes[0] === 0 ? [] : bytes;
  const decoded = new Uint8Array(leadingZeroes + significant.length);
  for (let index = 0; index < significant.length; index += 1)
    decoded[decoded.length - 1 - index] = significant[index];
  return decoded;
}

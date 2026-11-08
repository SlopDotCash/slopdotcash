import {
  BASE58_ALPHABET,
  base58Digit,
  convertRadixDigits,
  decodeBase58Digits,
} from "./verified-base58.ts";

export function encodeBase58Bytes(bytes: Uint8Array): string {
  return convertRadixDigits(Array.from(bytes), 256n, 58n)
    .map((digit) => BASE58_ALPHABET[digit])
    .join("");
}

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
  const digits: number[] = [];
  for (const character of value) {
    const digit = base58Digit(character);
    if (digit < 0) throw new TypeError("invalid base58 value");
    digits.push(digit);
  }
  return Uint8Array.from(decodeBase58Digits(digits));
}

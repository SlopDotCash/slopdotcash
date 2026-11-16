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

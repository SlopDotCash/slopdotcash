// spec/frontend/feePages.md, "Story: Pay a refundable deposit for a pull request or a private report from any wallet"
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** @throws {never} */
export function randomUint64String(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return new DataView(bytes.buffer).getBigUint64(0, true).toString();
}

/** @throws {never} */
export function decodeBase64Bytes(value: string): Uint8Array {
  try {
    const raw = atob(value);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

/** @throws {never} */
export function encodeBase58Bytes(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i] ?? 0;
    for (let j = 0; j < digits.length; j++) {
      carry += (digits[j] ?? 0) << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += BASE58_ALPHABET[digits[i] ?? 0] ?? "";
  return out;
}

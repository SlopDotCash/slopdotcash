//@ backend dafny
// spec/backend/projectRegistry.md, "Each permanent repository id and each path key belongs to at most one project"; spec/backend/projects.md, "Authority is one read bound to the acting account and the stored repository"

//@ pure
export function sextetOf(code: number, urlSafe: boolean): number {
  //@ ensures -1 <= \result && \result < 64
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (code === (urlSafe ? 45 : 43)) return 62;
  if (code === (urlSafe ? 95 : 47)) return 63;
  return -1;
}

//@ pure
export function unusedBitsScale(bits: number): number {
  //@ ensures \result >= 1
  if (bits === 2) return 4;
  if (bits === 4) return 16;
  if (bits === 6) return 64;
  return 1;
}

export function canonicalBytes(text: string, start: number, end: number, urlSafe: boolean): number[] {
  //@ requires 0 <= start && start <= end && end <= text.length
  if ((end - start) % 4 === 1) return [];
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  let i = start;
  while (i < end) {
    //@ invariant start <= i && i <= end
    const value = sextetOf(text.charCodeAt(i), urlSafe);
    if (value < 0) return [];
    buffer = buffer * 64 + value;
    bits = bits + 6;
    if (bits >= 8) {
      bits = bits - 8;
      const scale = unusedBitsScale(bits);
      const byte = Math.floor(buffer / scale);
      bytes.push(byte);
      buffer = buffer - byte * scale;
    }
    i = i + 1;
  }
  if (buffer !== 0) return [];
  return bytes;
}

export function githubUserIdFromPack(bytes: number[]): bigint {
  //@ ensures \result >= 0
  if (bytes.length < 3 || bytes[0] !== 146 || bytes[1] !== 0) return 0n;
  const width = bytes[2] === 206 ? 4 : bytes[2] === 207 ? 8 : 0;
  if (width === 0 || bytes.length !== 3 + width) return 0n;
  let id = 0n;
  let i = 0;
  while (i < width) {
    //@ invariant 0 <= i && i <= width
    //@ invariant id >= 0
    const byte = bytes[3 + i];
    if (byte < 0 || byte > 255) return 0n;
    id = id * 256n + BigInt(byte);
    i = i + 1;
  }
  if (width === 8 && id <= 4294967295n) return 0n;
  return id;
}

export function legacyUserId(bytes: number[]): bigint {
  //@ ensures \result >= 0
  if (bytes.length < 8 || bytes.length > 23) return 0n;
  if (bytes[0] !== 48 || bytes[1] !== 52 || bytes[2] !== 58 || bytes[3] !== 85 || bytes[4] !== 115 || bytes[5] !== 101 || bytes[6] !== 114) return 0n;
  if (bytes[7] < 49 || bytes[7] > 57) return 0n;
  let id = 0n;
  let i = 7;
  while (i < bytes.length) {
    //@ invariant 7 <= i && i <= bytes.length
    //@ invariant id >= 0
    const byte = bytes[i];
    if (byte < 48 || byte > 57) return 0n;
    id = id * 10n + BigInt(byte - 48);
    i = i + 1;
  }
  return id;
}

export function githubUserIdFromNodeId(node: string): bigint {
  //@ ensures \result >= 0
  if (node.length >= 2 && node.charCodeAt(0) === 85 && node.charCodeAt(1) === 95) {
    const length = node.length - 2;
    if (length < 4 || length > 64) return 0n;
    const bytes = canonicalBytes(node, 2, node.length, true);
    if (bytes.length === 0) return 0n;
    return githubUserIdFromPack(bytes);
  }
  let padding = 0;
  while (padding < 2 && padding < node.length && node.charCodeAt(node.length - 1 - padding) === 61) {
    //@ invariant 0 <= padding && padding <= 2 && padding <= node.length
    padding = padding + 1;
  }
  const end = node.length - padding;
  if (end < 4 || end > 64) return 0n;
  const remainder = end % 4;
  if ((remainder === 0 && padding !== 0) || (remainder === 2 && padding !== 2) || (remainder === 3 && padding !== 1)) return 0n;
  const bytes = canonicalBytes(node, 0, end, false);
  if (bytes.length === 0) return 0n;
  return legacyUserId(bytes);
}

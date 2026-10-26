/**
 * Token-program admission for vault accounting.
 *
 * Classic SPL Token stays exactly as before. The approved metadata-only Token-2022
 * subset (PRD section 6, policy PR #1359) is admitted only when the mint is a
 * Token-2022 mint with disabled mint and freeze authorities whose mint extensions are
 * limited to MetadataPointer and TokenMetadata, and its token accounts carry only
 * ImmutableOwner or no extension. Every other or unknown extension is refused.
 *
 * Offsets mirror `unpackMint` in `@solana/spl-token`: a mint is 82 bytes, a token
 * account is 165 bytes, and any longer Token-2022 account carries the account-type
 * byte at offset 165 with extension records from offset 166 as
 * `type:u16 length:u16 payload`, packed without padding. Both were verified against
 * the live approved mint and one of its token accounts on Solana mainnet.
 */

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** Classic SPL Token mint size. */
export const MINT_SIZE = 82;
/** Classic SPL Token account size. Also the Token-2022 base account size. */
export const ACCOUNT_SIZE = 165;
/** Account-type byte of any Token-2022 account longer than the base. */
const ACCOUNT_TYPE_OFFSET = ACCOUNT_SIZE;
/** First extension record of a Token-2022 account. */
const TLV_OFFSET = ACCOUNT_TYPE_OFFSET + 1;
const TYPE_AND_LENGTH = 4;
const MINT_ACCOUNT_TYPE = 1;
const TOKEN_ACCOUNT_TYPE = 2;
/** Admitted Token-2022 mint extensions. */
const METADATA_POINTER = 18;
const TOKEN_METADATA = 19;
/** Admitted Token-2022 token-account extension. */
const IMMUTABLE_OWNER = 7;
const METADATA_POINTER_LENGTH = 64;
const TOKEN_METADATA_MIN_LENGTH = 72;

interface Obj {
  [key: string]: unknown;
}

const object = (value: unknown): Obj => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid RPC object");
  return value as Obj;
};
const string = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("Invalid RPC string");
  return value;
};
const list = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error("Invalid RPC list");
  return value;
};
const decode = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

export interface TokenAccountReading {
  /** The owning token program: classic SPL Token or Token-2022. */
  program: string;
  raw: Uint8Array;
  /** Admitted extension types, in account order. */
  extensions: readonly number[];
}

export interface TokenMintReading extends TokenAccountReading {
  decimals: number;
}

/** Reads the account data of a supported token program account. */
function tokenProgramData(value: unknown): {
  program: string;
  bytes: Uint8Array;
} {
  const info = object(value);
  const program = string(info.owner);
  if (program !== TOKEN_PROGRAM && program !== TOKEN_2022_PROGRAM)
    throw new Error("Not a supported token program account");
  const data = list(info.data);
  if (data[1] !== "base64") throw new Error("Wrong account encoding");
  return { program, bytes: decode(string(data[0])) };
}

/**
 * Walks the Token-2022 extension records from offset 166. Trailing zero bytes are
 * admitted padding; an unknown, duplicated or truncated record is refused.
 */
function extensionRecords(
  bytes: Uint8Array,
  accountType: number,
  expected: readonly number[],
): number[] {
  if (bytes.length <= ACCOUNT_SIZE)
    throw new Error("Truncated Token-2022 account");
  if (bytes[ACCOUNT_TYPE_OFFSET] !== accountType)
    throw new Error("Token-2022 account type mismatch");
  const found: number[] = [];
  let at = TLV_OFFSET;
  while (at < bytes.length) {
    const rest = bytes.subarray(at);
    if (rest.every((byte) => byte === 0)) break;
    if (rest.length < TYPE_AND_LENGTH)
      throw new Error("Truncated Token-2022 extension");
    const type = rest[0] | (rest[1] << 8);
    const length = rest[2] | (rest[3] << 8);
    if (!expected.includes(type))
      throw new Error(`Unsupported Token-2022 extension ${type}`);
    if (found.includes(type))
      throw new Error(`Duplicate Token-2022 extension ${type}`);
    if (TYPE_AND_LENGTH + length > rest.length)
      throw new Error("Truncated Token-2022 extension");
    found.push(type);
    at += TYPE_AND_LENGTH + length;
  }
  return found;
}

/**
 * Reads a mint account. `expectedMint` is the base58-decoded mint address the caller
 * already depends on; a Token-2022 metadata pointer or embedded metadata address that
 * does not name it is refused.
 */
export function readTokenMint(
  value: unknown,
  expectedMint?: Uint8Array,
): TokenMintReading {
  const { program, bytes } = tokenProgramData(value);
  if (bytes.length < MINT_SIZE) throw new Error("Truncated mint account");
  // Byte 45 is `is_initialized` in both layouts; byte 44 is the decimals.
  if (bytes[45] !== 1) throw new Error("Mint is not initialized");
  if (program === TOKEN_PROGRAM) {
    if (bytes.length !== MINT_SIZE)
      throw new Error("Classic mint layout mismatch");
    return { program, raw: bytes, decimals: bytes[44], extensions: [] };
  }
  // COption tags at 0 (mint authority) and 46 (freeze authority) must be absent.
  for (const [offset, message] of [
    [0, "Token-2022 mint authority is not disabled"],
    [46, "Token-2022 freeze authority is not disabled"],
  ] as const)
    if (
      bytes[offset] !== 0 ||
      bytes[offset + 1] !== 0 ||
      bytes[offset + 2] !== 0 ||
      bytes[offset + 3] !== 0 ||
      bytes.subarray(offset + 4, offset + 36).some((byte) => byte !== 0)
    )
      throw new Error(message);
  // The base is padded to the account size before the account-type byte.
  if (bytes.subarray(MINT_SIZE, ACCOUNT_TYPE_OFFSET).some((byte) => byte !== 0))
    throw new Error("Unexpected Token-2022 base padding");
  const extensions = extensionRecords(bytes, MINT_ACCOUNT_TYPE, [
    METADATA_POINTER,
    TOKEN_METADATA,
  ]);
  for (const type of extensions) {
    const record = extensionPayload(bytes, type);
    const payload = bytes.subarray(record.start, record.start + record.length);
    if (type === METADATA_POINTER) {
      if (payload.length !== METADATA_POINTER_LENGTH)
        throw new Error("Malformed metadata pointer");
      if (expectedMint && !equal(payload.subarray(32, 64), expectedMint))
        throw new Error("Metadata pointer does not name the mint");
      continue;
    }
    if (payload.length < TOKEN_METADATA_MIN_LENGTH)
      throw new Error("Malformed token metadata");
    if (expectedMint && !equal(payload.subarray(32, 64), expectedMint))
      throw new Error("Token metadata does not embed the mint");
    let at = 64;
    for (let i = 0; i < 3; i++) {
      const length = uint32(payload, at);
      at += 4 + length;
      if (at > payload.length) throw new Error("Malformed token metadata");
    }
    // The additional-metadata vector: a u32 entry count, then two u32-length strings
    // per entry. Each entry needs at least eight bytes, so the count is bounded.
    const count = uint32(payload, at);
    at += 4;
    if (count > payload.length / 8) throw new Error("Malformed token metadata");
    for (let i = 0; i < count; i++)
      for (let field = 0; field < 2; field++) {
        const length = uint32(payload, at);
        at += 4 + length;
        if (at > payload.length) throw new Error("Malformed token metadata");
      }
    if (payload.subarray(at).some((byte) => byte !== 0))
      throw new Error("Malformed token metadata");
  }
  return { program, raw: bytes, decimals: bytes[44], extensions };
}

/** Reads a token account, admitting ImmutableOwner or no extension on Token-2022. */
export function readTokenAccount(value: unknown): TokenAccountReading {
  const { program, bytes } = tokenProgramData(value);
  if (program === TOKEN_PROGRAM) {
    if (bytes.length !== ACCOUNT_SIZE)
      throw new Error("Classic token account layout mismatch");
    return { program, raw: bytes, extensions: [] };
  }
  const extensions = extensionRecords(bytes, TOKEN_ACCOUNT_TYPE, [
    IMMUTABLE_OWNER,
  ]);
  if (extensions.includes(IMMUTABLE_OWNER)) {
    const record = extensionPayload(bytes, IMMUTABLE_OWNER);
    if (record.length !== 0) throw new Error("Malformed ImmutableOwner");
  }
  return { program, raw: bytes, extensions };
}

/** Position of one extension record in the account data. */
function extensionPayload(
  bytes: Uint8Array,
  wanted: number,
): { start: number; length: number } {
  let at = TLV_OFFSET;
  while (at + TYPE_AND_LENGTH <= bytes.length) {
    const type = bytes[at] | (bytes[at + 1] << 8);
    const length = bytes[at + 2] | (bytes[at + 3] << 8);
    if (type === wanted) return { start: at + TYPE_AND_LENGTH, length };
    at += TYPE_AND_LENGTH + length;
  }
  throw new Error(`Missing Token-2022 extension ${wanted}`);
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

/** Reads a little-endian u32 that must be fully present. */
function uint32(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) throw new Error("Malformed token metadata");
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

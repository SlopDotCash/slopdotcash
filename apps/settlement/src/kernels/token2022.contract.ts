// spec/settlement/money.md, "Token-2022 admission permits only immutable metadata and immutable token ownership"
import { Arbitrary, Schema } from "effect";
import { contract } from "vibestack/testing";
import {
  ACCOUNT_SIZE,
  type Mint,
  MINT_SIZE,
  readMint,
  type ReadRefusal,
  readRefusalMessage,
  readTokenAccount,
  type Refused,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  type TokenAccount,
} from "./token2022.ts";

const FIXTURE_MINT = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABCl1OgAAAAGAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARIAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqEwB8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioEAAAAVEVTVAQAAABURVNUJAAAAGh0dHBzOi8vZXhhbXBsZS5pbnZhbGlkL2ZpeHR1cmUvbWludAAAAAA=";
const FIXTURE_ACCOUNT = "KioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHB0BCDwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgcAAAA=";

const base64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

const MINT = new Uint8Array(32).fill(0x2a);
const OTHER = new Uint8Array(32).fill(9);
const NO_MINT = new Uint8Array(32);
const FIXTURE = base64(FIXTURE_MINT);

const ADMITTED = "Token2022 6 MetadataPointer,TokenMetadata";
const TOO_LARGE = "Token-2022 mint exceeds the 1024-byte limit";
const MALFORMED_METADATA = "Malformed token metadata";
const TRUNCATED_EXTENSION = "Truncated Token-2022 extension";

const describeResult = (result: Mint | TokenAccount | Refused): string => {
  switch (result.kind) {
    case "Refused":
      return readRefusalMessage(result.refusal);
    case "Classic":
      return `Classic ${result.decimals}`;
    case "Token2022":
      return `Token2022 ${result.decimals} ${result.facts.extensions.map((e) => e.kind).join(",") || "none"}`;
    case "TokenAccount":
      return `TokenAccount ${result.program === TOKEN_PROGRAM ? "Classic" : "Token2022"} ${result.extensions.map((e) => e.kind).join(",") || "none"}`;
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
};

const changed = (bytes: Uint8Array, at: number, values: readonly number[]) => {
  const copy = bytes.slice();
  copy.set(values, at);
  return copy;
};

const filled = (bytes: Uint8Array, value: number, from: number, to: number) => bytes.slice().fill(value, from, to);

const padded = (bytes: Uint8Array, length: number) => {
  const copy = new Uint8Array(length);
  copy.set(bytes.subarray(0, length));
  return copy;
};

const appended = (bytes: Uint8Array, values: readonly number[]) => Uint8Array.from([...bytes, ...values]);

const classicMint = (decimals: number, size = MINT_SIZE) => {
  const bytes = new Uint8Array(size);
  bytes[44] = decimals;
  bytes[45] = 1;
  return bytes;
};

const word = (value: number) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, value >>> 24];

const field = (bytes: readonly number[]) => [...word(bytes.length), ...bytes];

const metadataOnlyMint = (payload: readonly number[], decimals = 0) =>
  Uint8Array.from([...classicMint(decimals), ...new Array<number>(ACCOUNT_SIZE - MINT_SIZE).fill(0), 1, 19, 0, payload.length & 255, payload.length >> 8, ...payload]);

const EMPTY_PAIR = changed(new Uint8Array(88), 76, word(1));

const WALKED = [...new Array<number>(64).fill(0), ...field([255, 254]), ...field([128]), ...field([]), ...word(2), ...field([255]), ...field([0]), ...field([]), ...field([254]), 0, 0, 0, 0, 0];

type MintInput = { readonly program: string; readonly bytes: Uint8Array; readonly mint: Uint8Array };

const token2022 = (bytes: Uint8Array, mint = MINT): MintInput => ({ program: TOKEN_2022_PROGRAM, bytes, mint });

const classic = (bytes: Uint8Array): MintInput => ({ program: TOKEN_PROGRAM, bytes, mint: MINT });

const mintVectors: ReadonlyArray<readonly [MintInput, string]> = [
  [token2022(FIXTURE), ADMITTED],
  [token2022(padded(FIXTURE, FIXTURE.length + 8)), ADMITTED],
  [token2022(padded(FIXTURE, 1024)), ADMITTED],
  [token2022(padded(FIXTURE, 1025)), TOO_LARGE],
  [token2022(changed(FIXTURE, 0, [1])), "Token-2022 mint authority is not disabled"],
  [token2022(changed(FIXTURE, 46, [1])), "Token-2022 freeze authority is not disabled"],
  [token2022(changed(FIXTURE, 47, [1])), "Token-2022 freeze authority is not disabled"],
  [token2022(filled(changed(classicMint(6), 0, [1]), 9, 4, 36)), "Token-2022 mint authority is not disabled"],
  [classic(filled(changed(classicMint(6), 0, [1]), 9, 4, 36)), "Classic 6"],
  [token2022(filled(changed(classicMint(6), 46, [1]), 9, 50, 82)), "Token-2022 freeze authority is not disabled"],
  [classic(filled(changed(classicMint(6), 46, [1]), 9, 50, 82)), "Classic 6"],
  [token2022(filled(filled(classicMint(6), 9, 4, 36), 7, 50, 82)), "Token2022 6 none"],
  [token2022(filled(filled(FIXTURE, 9, 4, 36), 7, 50, 82)), ADMITTED],
  [token2022(changed(FIXTURE, 166, [1, 0])), "Unsupported Token-2022 extension 1"],
  [token2022(changed(FIXTURE, 166, [14, 0])), "Unsupported Token-2022 extension 14"],
  [token2022(changed(FIXTURE, 166, [0x60, 0xea])), "Unsupported Token-2022 extension 60000"],
  [token2022(changed(FIXTURE, 234, [1, 0])), "Unsupported Token-2022 extension 1"],
  [token2022(appended(FIXTURE, [7, 0, 0, 0])), "Unsupported Token-2022 extension 7"],
  [token2022(appended(FIXTURE, [18, 0, 0, 0])), "Duplicate Token-2022 extension 18"],
  [token2022(appended(FIXTURE, [...FIXTURE.subarray(166, 234)])), "Duplicate Token-2022 extension 18"],
  [token2022(FIXTURE.slice(0, 360)), TRUNCATED_EXTENSION],
  [token2022(FIXTURE.slice(0, 361)), TRUNCATED_EXTENSION],
  [token2022(changed(FIXTURE, 165, [2])), "Token-2022 account type mismatch"],
  [token2022(FIXTURE.slice(0, ACCOUNT_SIZE)), "Truncated Token-2022 account"],
  [token2022(changed(FIXTURE, 100, [7])), "Unexpected Token-2022 base padding"],
  [token2022(FIXTURE, OTHER), "Metadata pointer does not name the mint"],
  [token2022(changed(FIXTURE, 270, [5])), "Token metadata does not embed the mint"],
  [token2022(changed(FIXTURE, 270, [0x2b])), "Token metadata does not embed the mint"],
  [token2022(filled(FIXTURE, 9, 170, 202)), "Metadata pointer authority is not disabled"],
  [token2022(filled(FIXTURE, 9, 238, 270)), "Token metadata update authority is not disabled"],
  [token2022(changed(FIXTURE, 318, [0xff, 0xff])), MALFORMED_METADATA],
  [token2022(changed(FIXTURE, 358, [0xff, 0xff, 0xff, 0xff])), MALFORMED_METADATA],
  [token2022(appended(FIXTURE.subarray(0, ACCOUNT_SIZE + 1), [18, 0, 63, 0, ...new Array<number>(63).fill(0)])), "Malformed metadata pointer"],
  [classic(classicMint(9)), "Classic 9"],
  [token2022(classicMint(6)), "Token2022 6 none"],
  [token2022(classicMint(6, 40)), "Truncated mint account"],
  [classic(classicMint(6, 40)), "Truncated mint account"],
  [classic(changed(classicMint(6), 45, [0])), "Mint is not initialized"],
  [classic(classicMint(6, 83)), "Classic mint layout mismatch"],
  [{ program: "11111111111111111111111111111111", bytes: classicMint(6), mint: MINT }, "Not a supported token program account"],
  [token2022(metadataOnlyMint(WALKED, 6), NO_MINT), "Token2022 6 TokenMetadata"],
  [token2022(metadataOnlyMint([...EMPTY_PAIR]), NO_MINT), "Token2022 0 TokenMetadata"],
  ...[64, 68, 72, 76, 80, 84].map((at) => [token2022(metadataOnlyMint([...changed(EMPTY_PAIR, at, word(0xffffffff))]), NO_MINT), MALFORMED_METADATA] as const),
  ...[72, 75, 79, 83, 87].map((length) => [token2022(metadataOnlyMint([...EMPTY_PAIR.subarray(0, length)]), NO_MINT), MALFORMED_METADATA] as const),
  [token2022(metadataOnlyMint([...EMPTY_PAIR, 1]), NO_MINT), MALFORMED_METADATA],
];

export const oldMintVectorsKeepTheirOutcome = contract({
  input: Arbitrary.Constant(mintVectors),
  run: (vectors) => vectors.map(([input]) => describeResult(readMint(input))),
  invariant: (vectors, outcomes) => vectors.every(([, expected], index) => outcomes[index] === expected),
});

const tokenAccount = (records: readonly number[], accountType = 2) => {
  const bytes = new Uint8Array(ACCOUNT_SIZE + 1 + records.length);
  bytes.set(MINT, 0);
  bytes.fill(3, 32, 64);
  bytes[108] = 1;
  bytes[ACCOUNT_SIZE] = accountType;
  bytes.set(records, ACCOUNT_SIZE + 1);
  return bytes;
};

const baseAccount = (state: number) => changed(new Uint8Array(ACCOUNT_SIZE), 108, [state]);

const FIXTURE_MINT_READING = readMint(token2022(FIXTURE));
const CLASSIC_MINT_READING = readMint(classic(classicMint(6)));

type AccountInput = { readonly mint: Mint | Refused; readonly program: string; readonly bytes: Uint8Array };

const onToken2022 = (bytes: Uint8Array): AccountInput => ({ mint: FIXTURE_MINT_READING, program: TOKEN_2022_PROGRAM, bytes });

const accountVectors: ReadonlyArray<readonly [AccountInput, string]> = [
  [onToken2022(base64(FIXTURE_ACCOUNT)), "TokenAccount Token2022 ImmutableOwner"],
  [onToken2022(baseAccount(1)), "TokenAccount Token2022 none"],
  [onToken2022(baseAccount(0)), "Token-2022 account is not initialized"],
  [{ mint: CLASSIC_MINT_READING, program: TOKEN_PROGRAM, bytes: baseAccount(0) }, "TokenAccount Classic none"],
  [{ mint: CLASSIC_MINT_READING, program: TOKEN_PROGRAM, bytes: new Uint8Array(169) }, "Classic token account layout mismatch"],
  [{ mint: FIXTURE_MINT_READING, program: TOKEN_PROGRAM, bytes: base64(FIXTURE_ACCOUNT) }, "Classic token account layout mismatch"],
  [{ mint: FIXTURE_MINT_READING, program: TOKEN_PROGRAM, bytes: baseAccount(1) }, "Token account program differs from its admitted mint"],
  [{ mint: CLASSIC_MINT_READING, program: TOKEN_2022_PROGRAM, bytes: baseAccount(1) }, "Token account program differs from its admitted mint"],
  [{ mint: FIXTURE_MINT_READING, program: "11111111111111111111111111111111", bytes: baseAccount(1) }, "Not a supported token program account"],
  [onToken2022(new Uint8Array(169)), "Token-2022 account type mismatch"],
  [onToken2022(tokenAccount([7, 0, 0, 0, 0, 0, 0, 0, 0])), "TokenAccount Token2022 ImmutableOwner"],
  [onToken2022(tokenAccount([7, 0, 4, 0, 1, 2, 3, 4])), "Malformed ImmutableOwner"],
  [onToken2022(tokenAccount([2, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0])), "Unsupported Token-2022 extension 2"],
  [onToken2022(tokenAccount([7, 0, 0, 0, 8, 0, 1, 0])), TRUNCATED_EXTENSION],
  [onToken2022(tokenAccount([7, 0, 0, 0, 8, 0, 1, 0, 0])), "Unsupported Token-2022 extension 8"],
  [onToken2022(tokenAccount([7, 0, 0, 0, 7, 0, 0, 0])), "Duplicate Token-2022 extension 7"],
  [onToken2022(tokenAccount([7, 0, 0, 0, 7, 0, 255, 0])), "Duplicate Token-2022 extension 7"],
  [onToken2022(tokenAccount([7, 0, 3, 0, 1])), TRUNCATED_EXTENSION],
  [onToken2022(tokenAccount([8, 0, 255, 255])), TRUNCATED_EXTENSION],
  [onToken2022(tokenAccount([7, 0, 0, 0], 1)), "Token-2022 account type mismatch"],
  [onToken2022(changed(tokenAccount([7, 0, 0, 0]), 108, [0])), "Token-2022 account is not initialized"],
];

const readAccount = ({ mint, program, bytes }: AccountInput) => (mint.kind === "Refused" ? mint : readTokenAccount({ mint, program, bytes }));

export const oldAccountVectorsKeepTheirOutcome = contract({
  input: Arbitrary.Constant(accountVectors),
  run: (vectors) => vectors.map(([input]) => describeResult(readAccount(input))),
  invariant: (vectors, outcomes) => vectors.every(([, expected], index) => outcomes[index] === expected),
});

const byte = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }));

const suffix = Schema.Struct({
  tail: Schema.Array(byte).check(Schema.isMaxLength(600)),
  padding: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 900 })),
});

type Suffix = typeof suffix.Type;

const afterHead = (head: Uint8Array, { tail, padding }: Suffix) => Uint8Array.from([...head.subarray(0, ACCOUNT_SIZE + 1), ...tail, ...new Array<number>(padding).fill(0)]);

const decided = (result: Mint | TokenAccount | Refused) => result.kind !== "Refused" || readRefusalMessage(result.refusal).length > 0;

const mintDecided = (input: Suffix, result: Mint | Refused) => {
  const length = ACCOUNT_SIZE + 1 + input.tail.length + input.padding;
  if (length > 1024) return describeResult(result) === TOO_LARGE;
  if (input.tail.every((b) => b === 0)) return describeResult(result) === "Token2022 6 none";
  if (result.kind === "Token2022") return result.facts.extensions.every((e) => e.kind !== "Unknown" && !e.authority && e.namesMint);
  return decided(result);
};

export const anyMintSuffixIsDecided = contract({
  input: suffix,
  run: (input: Suffix) => readMint(token2022(afterHead(FIXTURE, input))),
  invariant: mintDecided,
});

const accountDecided = (input: Suffix, result: TokenAccount | Refused) => {
  if (input.tail.every((b) => b === 0)) return describeResult(result) === "TokenAccount Token2022 none";
  if (result.kind === "TokenAccount") return result.extensions.every((e) => e.kind === "ImmutableOwner");
  return decided(result);
};

export const anyAccountSuffixIsDecided = contract({
  input: suffix,
  run: (input: Suffix) => readAccount(onToken2022(afterHead(base64(FIXTURE_ACCOUNT), input))),
  invariant: accountDecided,
});

export const fixtureMintAdmitsZeroPaddingUpToTheLimit = contract({
  input: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 800 })),
  run: (extra: number) => describeResult(readMint(token2022(padded(FIXTURE, FIXTURE.length + extra)))),
  invariant: (extra, outcome) => outcome === (FIXTURE.length + extra <= 1024 ? ADMITTED : TOO_LARGE),
});

const shape = Schema.Struct({
  mintAuthority: Schema.Boolean,
  freezeAuthority: Schema.Boolean,
  pointer: Schema.Boolean,
  pointerAuthority: Schema.Boolean,
  pointerSelf: Schema.Boolean,
  metadata: Schema.Boolean,
  updateAuthority: Schema.Boolean,
  metadataSelf: Schema.Boolean,
  unknown: Schema.Boolean,
});

type Shape = typeof shape.Type;

const record = (type: number, payload: readonly number[]) => [type, 0, payload.length & 255, payload.length >> 8, ...payload];

const owner = (present: boolean) => new Array<number>(32).fill(present ? 1 : 0);

const shapedMint = (s: Shape) => {
  const base = changed(classicMint(6), 0, [s.mintAuthority ? 1 : 0]);
  base[46] = s.freezeAuthority ? 1 : 0;
  const records = [
    ...(s.pointer ? record(18, [...owner(s.pointerAuthority), ...(s.pointerSelf ? MINT : OTHER)]) : []),
    ...(s.metadata ? record(19, [...owner(s.updateAuthority), ...(s.metadataSelf ? MINT : OTHER), ...new Array<number>(16).fill(0)]) : []),
    ...(s.unknown ? record(9, []) : []),
  ];
  return records.length === 0 ? base : Uint8Array.from([...base, ...new Array<number>(ACCOUNT_SIZE - MINT_SIZE).fill(0), 1, ...records]);
};

const expectedRefusal = (s: Shape): ReadRefusal | undefined => {
  if (s.mintAuthority) return { reason: "MintAuthority" };
  if (s.freezeAuthority) return { reason: "FreezeAuthority" };
  if (s.unknown) return { reason: "UnsupportedExtension", type: 9 };
  if (s.pointer && s.pointerAuthority) return { reason: "PointerAuthority" };
  if (s.pointer && !s.pointerSelf) return { reason: "PointerMint" };
  if (s.metadata && s.updateAuthority) return { reason: "UpdateAuthority" };
  if (s.metadata && !s.metadataSelf) return { reason: "MetadataMint" };
  return undefined;
};

const shapeDecided = (s: Shape, result: Mint | Refused) => {
  const refusal = expectedRefusal(s);
  if (refusal === undefined) return result.kind === "Token2022" && result.decimals === 6;
  return result.kind === "Refused" && readRefusalMessage(result.refusal) === readRefusalMessage(refusal);
};

export const onlyImmutableSelfHostedMetadataIsAdmitted = contract({
  input: shape,
  run: (s: Shape) => readMint(token2022(shapedMint(s))),
  invariant: shapeDecided,
});

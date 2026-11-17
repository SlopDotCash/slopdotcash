// spec/settlement/money.md, "Token-2022 admission permits only immutable metadata and immutable token ownership"
import { token2022Admissible } from "../../gen/settlement__money.ts";
import { decodeTokenExtensions, type ExtensionRecord, metadataPayloadValid } from "./tokenExtensions.ts";

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const MINT_SIZE = 82;
export const ACCOUNT_SIZE = 165;
export const MAX_TOKEN_2022_MINT_SIZE = 1024;

export type TokenProgram = typeof TOKEN_PROGRAM | typeof TOKEN_2022_PROGRAM;

const MINT_ACCOUNT_TYPE = 1;
const TOKEN_ACCOUNT_TYPE = 2;
const IMMUTABLE_OWNER = 7;
const METADATA_POINTER = 18;
const TOKEN_METADATA = 19;
const METADATA_POINTER_LENGTH = 64;
const ACCOUNT_STATE_OFFSET = 108;

const fixedMessages = {
  UnsupportedProgram: "Not a supported token program account",
  ProgramMismatch: "Token account program differs from its admitted mint",
  MintTooLarge: "Token-2022 mint exceeds the 1024-byte limit",
  TruncatedMint: "Truncated mint account",
  MintNotInitialized: "Mint is not initialized",
  ClassicMintLayout: "Classic mint layout mismatch",
  ClassicAccountLayout: "Classic token account layout mismatch",
  BasePadding: "Unexpected Token-2022 base padding",
  TruncatedAccount: "Truncated Token-2022 account",
  AccountType: "Token-2022 account type mismatch",
  TruncatedExtension: "Truncated Token-2022 extension",
  MalformedMetadataPointer: "Malformed metadata pointer",
  MalformedTokenMetadata: "Malformed token metadata",
  MalformedImmutableOwner: "Malformed ImmutableOwner",
  AccountNotInitialized: "Token-2022 account is not initialized",
  MintAuthority: "Token-2022 mint authority is not disabled",
  FreezeAuthority: "Token-2022 freeze authority is not disabled",
  PointerAuthority: "Metadata pointer authority is not disabled",
  PointerMint: "Metadata pointer does not name the mint",
  UpdateAuthority: "Token metadata update authority is not disabled",
  MetadataMint: "Token metadata does not embed the mint",
  NotAdmissible: "Token-2022 mint or account is outside the admitted immutable-metadata subset",
} as const;

type FixedRefusal = keyof typeof fixedMessages;

export type ReadRefusal =
  | { readonly reason: FixedRefusal }
  | { readonly reason: "DuplicateExtension" | "UnsupportedExtension"; readonly type: number };

export interface Refused {
  readonly kind: "Refused";
  readonly refusal: ReadRefusal;
}

/** @throws {never} */
export function readRefusalMessage(refusal: ReadRefusal): string {
  switch (refusal.reason) {
    case "DuplicateExtension":
      return `Duplicate Token-2022 extension ${refusal.type}`;
    case "UnsupportedExtension":
      return `Unsupported Token-2022 extension ${refusal.type}`;
    default:
      return fixedMessages[refusal.reason];
  }
}

interface MetadataReference {
  readonly kind: "MetadataPointer" | "TokenMetadata";
  readonly authority: boolean;
  readonly namesMint: boolean;
}

interface UnknownExtension {
  readonly kind: "Unknown";
  readonly type: number;
}

type MintExtension = MetadataReference | UnknownExtension;

type AccountExtension = { readonly kind: "ImmutableOwner" } | UnknownExtension;

interface Token2022MintFacts {
  readonly mintBytes: number;
  readonly mintAuthority: boolean;
  readonly freezeAuthority: boolean;
  readonly extensions: readonly MintExtension[];
}

export type Mint =
  | { readonly kind: "Classic"; readonly program: typeof TOKEN_PROGRAM; readonly decimals: number }
  | { readonly kind: "Token2022"; readonly program: typeof TOKEN_2022_PROGRAM; readonly decimals: number; readonly facts: Token2022MintFacts };

export interface TokenAccount {
  readonly kind: "TokenAccount";
  readonly program: TokenProgram;
  readonly extensions: readonly AccountExtension[];
}

const referenceRefusals = {
  MetadataPointer: { authority: "PointerAuthority", mint: "PointerMint" },
  TokenMetadata: { authority: "UpdateAuthority", mint: "MetadataMint" },
} as const satisfies Record<MetadataReference["kind"], { authority: FixedRefusal; mint: FixedRefusal }>;

const refused = (refusal: ReadRefusal): Refused => ({ kind: "Refused", refusal });

const fixed = (reason: FixedRefusal) => refused({ reason });

const nonzero = (bytes: Uint8Array) => bytes.some((byte) => byte !== 0);

const sameBytes = (left: Uint8Array, right: Uint8Array) => left.length === right.length && left.every((byte, index) => byte === right[index]);

const isUnknown = (extension: MintExtension | AccountExtension): extension is UnknownExtension => extension.kind === "Unknown";

const isReference = (extension: MintExtension): extension is MetadataReference => extension.kind !== "Unknown";

const extensionName = (extension: MintExtension | AccountExtension) => (isUnknown(extension) ? `Extension${extension.type}` : extension.kind);

function extensionRecords(bytes: Uint8Array, accountType: number): readonly ExtensionRecord[] | Refused {
  const scan = decodeTokenExtensions(bytes, accountType);
  switch (scan.error) {
    case 0:
      return scan.records;
    case 1:
      return fixed("TruncatedAccount");
    case 2:
      return fixed("AccountType");
    case 4:
      return refused({ reason: "DuplicateExtension", type: scan.type });
    default:
      return fixed("TruncatedExtension");
  }
}

const reference = (kind: MetadataReference["kind"], payload: Uint8Array, mint: Uint8Array): MetadataReference => ({
  kind,
  authority: nonzero(payload.subarray(0, 32)),
  namesMint: sameBytes(payload.subarray(32, 64), mint),
});

function mintExtension(type: number, payload: Uint8Array, mint: Uint8Array): MintExtension | Refused {
  switch (type) {
    case METADATA_POINTER:
      return payload.length === METADATA_POINTER_LENGTH ? reference("MetadataPointer", payload, mint) : fixed("MalformedMetadataPointer");
    case TOKEN_METADATA:
      return metadataPayloadValid(payload) ? reference("TokenMetadata", payload, mint) : fixed("MalformedTokenMetadata");
    default:
      return { kind: "Unknown", type };
  }
}

function accountExtension(type: number, length: number): AccountExtension | Refused {
  if (type !== IMMUTABLE_OWNER) return { kind: "Unknown", type };
  return length === 0 ? { kind: "ImmutableOwner" } : fixed("MalformedImmutableOwner");
}

function token2022MintFacts(bytes: Uint8Array, mint: Uint8Array): Token2022MintFacts | Refused {
  const authorities = { mintBytes: bytes.length, mintAuthority: nonzero(bytes.subarray(0, 4)), freezeAuthority: nonzero(bytes.subarray(46, 50)) };
  if (bytes.length === MINT_SIZE) return { ...authorities, extensions: [] };
  if (nonzero(bytes.subarray(MINT_SIZE, ACCOUNT_SIZE))) return fixed("BasePadding");
  const records = extensionRecords(bytes, MINT_ACCOUNT_TYPE);
  if ("kind" in records) return records;
  const extensions: MintExtension[] = [];
  for (const record of records) {
    const extension = mintExtension(record.type, bytes.subarray(record.start, record.start + record.length), mint);
    if (extension.kind === "Refused") return extension;
    extensions.push(extension);
  }
  return { ...authorities, extensions };
}

function accountExtensions(bytes: Uint8Array): readonly AccountExtension[] | Refused {
  const records = extensionRecords(bytes, TOKEN_ACCOUNT_TYPE);
  if ("kind" in records) return records;
  const extensions: AccountExtension[] = [];
  for (const record of records) {
    const extension = accountExtension(record.type, record.length);
    if (extension.kind === "Refused") return extension;
    extensions.push(extension);
  }
  return extensions;
}

function admissible(facts: Token2022MintFacts, account: readonly AccountExtension[]): boolean {
  const references = facts.extensions.filter(isReference);
  return token2022Admissible(
    facts.mintBytes,
    facts.mintAuthority,
    facts.freezeAuthority,
    references.some((r) => r.kind === "MetadataPointer" && r.authority),
    references.some((r) => r.kind === "TokenMetadata" && r.authority),
    references.every((r) => r.namesMint),
    facts.extensions.map(extensionName),
    account.map(extensionName),
  );
}

function mintRefusal(facts: Token2022MintFacts): ReadRefusal {
  if (facts.mintAuthority) return { reason: "MintAuthority" };
  if (facts.freezeAuthority) return { reason: "FreezeAuthority" };
  const unknown = facts.extensions.find(isUnknown);
  if (unknown) return { reason: "UnsupportedExtension", type: unknown.type };
  for (const extension of facts.extensions.filter(isReference)) {
    if (extension.authority) return { reason: referenceRefusals[extension.kind].authority };
    if (!extension.namesMint) return { reason: referenceRefusals[extension.kind].mint };
  }
  return { reason: "NotAdmissible" };
}

function accountRefusal(extensions: readonly AccountExtension[]): ReadRefusal {
  const unknown = extensions.find(isUnknown);
  return unknown ? { reason: "UnsupportedExtension", type: unknown.type } : { reason: "NotAdmissible" };
}

/** @throws {never} */
export function readMint({ program, bytes, mint }: { program: string; bytes: Uint8Array; mint: Uint8Array }): Mint | Refused {
  if (program !== TOKEN_PROGRAM && program !== TOKEN_2022_PROGRAM) return fixed("UnsupportedProgram");
  if (program === TOKEN_2022_PROGRAM && bytes.length > MAX_TOKEN_2022_MINT_SIZE) return fixed("MintTooLarge");
  if (bytes.length < MINT_SIZE) return fixed("TruncatedMint");
  if (bytes[45] !== 1) return fixed("MintNotInitialized");
  const decimals = bytes[44];
  if (program === TOKEN_PROGRAM) return bytes.length === MINT_SIZE ? { kind: "Classic", program, decimals } : fixed("ClassicMintLayout");
  const facts = token2022MintFacts(bytes, mint);
  if ("kind" in facts) return facts;
  return admissible(facts, []) ? { kind: "Token2022", program, decimals, facts } : refused(mintRefusal(facts));
}

/** @throws {never} */
export function readTokenAccount({ mint, program, bytes }: { mint: Mint; program: string; bytes: Uint8Array }): TokenAccount | Refused {
  if (program !== TOKEN_PROGRAM && program !== TOKEN_2022_PROGRAM) return fixed("UnsupportedProgram");
  const extensions = bytes.length === ACCOUNT_SIZE ? [] : program === TOKEN_PROGRAM ? fixed("ClassicAccountLayout") : accountExtensions(bytes);
  if ("kind" in extensions) return extensions;
  if (program !== mint.program) return fixed("ProgramMismatch");
  if (mint.kind === "Classic") return { kind: "TokenAccount", program, extensions };
  if (bytes[ACCOUNT_STATE_OFFSET] !== 1) return fixed("AccountNotInitialized");
  return admissible(mint.facts, extensions) ? { kind: "TokenAccount", program, extensions } : refused(accountRefusal(extensions));
}

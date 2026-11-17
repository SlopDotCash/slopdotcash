// spec/settlement/bindingAuthority.md, "Only the current authority binds, for the current version and before expiry, with the wallet's own signature"
import { encodeFunctionData, keccak256, stringToHex } from "viem";
import { type Bytes32, type EvmAddress, type Hex, U64_MAX, addressWord, checked, escrowAbi, isZero, keccakWords, uintWord } from "./abi.ts";

export const ESCROW_DOMAIN_NAME = "SlopProjectEscrow";
export const ESCROW_DOMAIN_VERSION = "5";

export interface EscrowDomain {
  readonly chainId: bigint;
  readonly vault: EvmAddress;
}

export type FieldType = "uint32" | "uint64" | "uint128" | "uint256" | "address" | "bytes32";

export interface Field<N extends string = string> {
  readonly name: N;
  readonly type: FieldType;
}

export interface TypedStruct<P extends string, N extends string> {
  readonly primaryType: P;
  readonly fields: ReadonlyArray<Field<N>>;
  readonly values: Readonly<Record<N, bigint | Hex>>;
}

export interface WalletTypedData<P extends string, N extends string> {
  readonly types: {
    readonly EIP712Domain: ReadonlyArray<Field<"name" | "version" | "chainId" | "verifyingContract"> | { readonly name: "name" | "version"; readonly type: "string" }>;
  } & Readonly<Record<P, ReadonlyArray<Field<N>>>>;
  readonly primaryType: P;
  readonly domain: { readonly name: string; readonly version: string; readonly chainId: string; readonly verifyingContract: EvmAddress };
  readonly message: Readonly<Record<N, string>>;
}

const DOMAIN_FIELDS = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;

const DOMAIN_TYPEHASH = keccak256(stringToHex(`EIP712Domain(${DOMAIN_FIELDS.map((field) => `${field.type} ${field.name}`).join(",")})`));

/** @throws {RangeError} */
function domainChecked(domain: EscrowDomain): EscrowDomain {
  if (domain.chainId === 0n) throw new RangeError("Invalid escrow domain");
  checked(domain.chainId, U64_MAX, "Invalid escrow domain");
  return domain;
}

/** @throws {RangeError} */
export function domainSeparator(domain: EscrowDomain): Bytes32 {
  const { chainId, vault } = domainChecked(domain);
  return keccakWords(DOMAIN_TYPEHASH, keccak256(stringToHex(ESCROW_DOMAIN_NAME)), keccak256(stringToHex(ESCROW_DOMAIN_VERSION)), uintWord(chainId), addressWord(vault));
}

const encodedValue = (type: FieldType, value: bigint | Hex): Hex => (typeof value === "bigint" ? uintWord(value) : type === "address" ? addressWord(value as EvmAddress) : value);

/** @throws {never} */
function typeHash<P extends string, N extends string>(struct: TypedStruct<P, N>): Bytes32 {
  return keccak256(stringToHex(`${struct.primaryType}(${struct.fields.map((field) => `${field.type} ${field.name}`).join(",")})`)) as Bytes32;
}

/** @throws {RangeError} */
export function escrowDigest<P extends string, N extends string>(domain: EscrowDomain, struct: TypedStruct<P, N>): Bytes32 {
  const hashed = keccakWords(typeHash(struct), ...struct.fields.map((field) => encodedValue(field.type, struct.values[field.name])));
  return keccakWords("0x1901", domainSeparator(domain), hashed);
}

/** @throws {RangeError} */
export function walletTypedData<P extends string, N extends string>(domain: EscrowDomain, struct: TypedStruct<P, N>): WalletTypedData<P, N> {
  const { chainId, vault } = domainChecked(domain);
  const message = Object.fromEntries(struct.fields.map((field) => [field.name, String(struct.values[field.name])])) as Record<N, string>;
  return {
    types: { EIP712Domain: DOMAIN_FIELDS, [struct.primaryType]: struct.fields } as WalletTypedData<P, N>["types"],
    primaryType: struct.primaryType,
    domain: { name: ESCROW_DOMAIN_NAME, version: ESCROW_DOMAIN_VERSION, chainId: chainId.toString(), verifyingContract: vault },
    message,
  };
}

export interface BindingInput {
  readonly actor: bigint;
  readonly destination: EvmAddress;
  readonly expectedVersion: bigint;
  readonly claimDigest: Bytes32;
  readonly expiresAt: bigint;
}

type BindingField = "actorId" | "destination" | "expectedVersion" | "claimDigest" | "expiresAt";

const BINDING_FIELDS: ReadonlyArray<Field<BindingField>> = [
  { name: "actorId", type: "uint64" },
  { name: "destination", type: "address" },
  { name: "expectedVersion", type: "uint64" },
  { name: "claimDigest", type: "bytes32" },
  { name: "expiresAt", type: "uint64" },
];

/** @throws {RangeError} */
export function bindingStruct(input: BindingInput): TypedStruct<"DestinationBinding", BindingField> {
  if (input.actor === 0n || isZero(input.destination) || isZero(input.claimDigest)) throw new RangeError("Invalid binding input");
  for (const value of [input.actor, input.expectedVersion, input.expiresAt]) checked(value, U64_MAX, "Invalid uint64 input");
  return {
    primaryType: "DestinationBinding",
    fields: BINDING_FIELDS,
    values: { actorId: input.actor, destination: input.destination, expectedVersion: input.expectedVersion, claimDigest: input.claimDigest, expiresAt: input.expiresAt },
  };
}

/** @throws {RangeError} */
export function bindingTypedData(domain: EscrowDomain, input: BindingInput): WalletTypedData<"DestinationBinding", BindingField> {
  return walletTypedData(domain, bindingStruct(input));
}

/** @throws {RangeError} */
export function bindingDigest(domain: EscrowDomain, input: BindingInput): Bytes32 {
  return escrowDigest(domain, bindingStruct(input));
}

const SIGNATURE = /^0x[0-9a-fA-F]{130}$/u;

/** @throws {RangeError} */
export function bindCalldata(input: BindingInput & { readonly walletSignature: Hex }): Hex {
  bindingStruct(input);
  if (!SIGNATURE.test(input.walletSignature)) throw new RangeError("Invalid wallet signature encoding");
  return encodeFunctionData({
    abi: escrowAbi,
    functionName: "bindDestination",
    args: [input.actor, input.destination, input.expectedVersion, input.claimDigest, input.expiresAt, input.walletSignature.toLowerCase() as Hex],
  });
}

/** @throws {RangeError} */
export function cancelBindingCalldata(actor: bigint, version: bigint): Hex {
  if (actor === 0n || version === 0n) throw new RangeError("Invalid binding cancellation");
  checked(actor, U64_MAX, "Invalid uint64 input");
  checked(version, U64_MAX, "Invalid uint64 input");
  return encodeFunctionData({ abi: escrowAbi, functionName: "cancelBinding", args: [actor, version] });
}

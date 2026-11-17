// spec/settlement/escrow.md, "Events apply once, in canonical block and event order"; spec/settlement/vaultSnapshots.md, "Only a reviewed registry binding can obtain totals"
import { type Address, type Hex, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi } from "viem";
import type { VaultPurpose } from "../../../gen/settlement__escrow.ts";

export type { Address, Hex, VaultPurpose };

export type Bytes32 = Hex & { readonly __brand: "Bytes32" };
export type EvmAddress = Address & { readonly __brand: "EvmAddress" };

export const U8_MAX = 0xffn;
export const U32_MAX = 0xffff_ffffn;
export const U64_MAX = (1n << 64n) - 1n;
export const U128_MAX = (1n << 128n) - 1n;
export const U256_MAX = (1n << 256n) - 1n;

export const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Bytes32;

const BYTES32 = /^0x[0-9a-fA-F]{64}$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const ADDRESS_WORD = /^0{24}[0-9a-f]{40}$/u;

/** @throws {never} */
export function bytes32(value: string): Bytes32 | undefined {
  return BYTES32.test(value) ? (value.toLowerCase() as Bytes32) : undefined;
}

/** @throws {never} */
export function evmAddress(value: string): EvmAddress | undefined {
  return ADDRESS.test(value) ? (value.toLowerCase() as EvmAddress) : undefined;
}

/** @throws {never} */
export function isZero(value: Bytes32 | EvmAddress): boolean {
  return BigInt(value) === 0n;
}

/** @throws {never} */
export function purposeNumber(purpose: VaultPurpose): 0 | 1 {
  return purpose === "BountyPurpose" ? 1 : 0;
}

/** @throws {never} */
export function inRange(value: bigint, maximum: bigint): boolean {
  return value >= 0n && value <= maximum;
}

/** @throws {RangeError} */
export function checked(value: bigint, maximum: bigint, message: string): bigint {
  if (!inRange(value, maximum)) throw new RangeError(message);
  return value;
}

/** @throws {never} */
export function keccakWords(...words: ReadonlyArray<Hex>): Bytes32 {
  return keccak256(`0x${words.map((word) => word.slice(2)).join("")}`) as Bytes32;
}

/** @throws {never} */
export function addressWord(address: EvmAddress): Hex {
  return `0x${address.slice(2).padStart(64, "0")}`;
}

/** @throws {never} */
export function uintWord(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

/** @throws {never} */
export function answerWords(data: string, count: number): ReadonlyArray<string> | undefined {
  if (!new RegExp(`^0x[0-9a-fA-F]{${count * 64}}$`, "u").test(data)) return undefined;
  return Array.from({ length: count }, (_, index) => data.slice(2 + index * 64, 66 + index * 64).toLowerCase());
}

/** @throws {never} */
export function wordUint(word: string, maximum: bigint): bigint | undefined {
  const value = BigInt(`0x${word}`);
  return value <= maximum ? value : undefined;
}

/** @throws {never} */
export function wordAddress(word: string): EvmAddress | undefined {
  return ADDRESS_WORD.test(word) ? (`0x${word.slice(24)}` as EvmAddress) : undefined;
}

/** @throws {never} */
export function wordBool(word: string): boolean | undefined {
  const value = BigInt(`0x${word}`);
  return value === 0n ? false : value === 1n ? true : undefined;
}

/** @throws {never} */
export function wordBytes32(word: string): Bytes32 {
  return `0x${word}` as Bytes32;
}

export const escrowAbi = parseAbi([
  "struct MonthlyAward { uint64 actorId; uint128 gross; bytes32 sourceDigest; }",
  "struct MonthlyReservation { bytes32 allocationDigest; bytes32 allocationRoot; uint128 wholeGross; uint128 remainingGross; uint32 count; uint256 sourceSequence; }",
  "struct AllocationNode { bytes32 hash; uint128 total; }",
  "function token() view returns (address)",
  "function decimals() view returns (uint8)",
  "function projectId() view returns (bytes32)",
  "function owner() view returns (address)",
  "function purpose() view returns (uint8)",
  "function feeRecipient() view returns (address)",
  "function factory() view returns (address)",
  "function bindingDelay() view returns (uint64)",
  "function monthlyCap() view returns (uint128)",
  "function monthlyEnabled() view returns (bool)",
  "function pendingMonthlyGross() view returns (uint128)",
  "function ordinarySourceSequence() view returns (uint256)",
  "function monthlyReserveVersion() pure returns (uint8)",
  "function identityAuthority() view returns (address)",
  "function domainSeparator() view returns (bytes32)",
  "function totals() view returns (uint128 deposited, uint128 paid, uint128 payoutFees, uint128 grossWithdrawn, uint128 withdrawalFees, uint128 free, uint128 principalReserved, uint128 feesReserved, uint128 feesAccrued, uint256 balance)",
  "function awards(bytes32 id) view returns (uint64 actorId, uint128 gross, uint128 fee, bytes32 sourceDigest, uint64 committedAt, bool paid)",
  "function bindings(uint64 actorId) view returns (address destination, uint64 version, bytes32 claimDigest, uint64 activatesAt, bool cancelled)",
  "function payableBinding(uint64 actorId) view returns (address destination, uint64 version)",
  "function monthlyRoots(uint32 period) view returns (bytes32)",
  "function monthlyReserves(uint32 period) view returns (bytes32 allocationDigest, uint128 total, uint128 remaining, uint32 count, uint64 admittedAt)",
  "function monthlyReleased(uint32 period) view returns (uint128)",
  "function awardId(bytes32 sourceDigest) view returns (bytes32)",
  "function bindingDigest(uint64 actorId, address destination, uint64 expectedVersion, bytes32 claimDigest, uint64 expiresAt) view returns (bytes32)",
  "function monthlyDigest(uint32 period, bytes32 allocationRoot) view returns (bytes32)",
  "function monthlyReserveDigest(uint32 period, MonthlyReservation reservation) view returns (bytes32)",
  "function monthlyReleaseDigest(uint32 period, uint128 remainingGross, uint128 releasedGross) view returns (bytes32)",
  "function allocationRoot(MonthlyAward[] entries) pure returns (bytes32)",
  "function deposit(uint128 amount) payable",
  "function commitAward(bytes32 id, uint64 actorId, uint128 gross, bytes32 sourceDigest)",
  "function commitBountyAward(bytes32 id, uint64 actorId, uint128 gross, bytes32 sourceDigest)",
  "function setMonthlyCommitment(uint128 cap, bool enabled)",
  "function commitMonthly(uint32 period, MonthlyAward[] entries, bytes attestation)",
  "function reserveMonthly(uint32 period, MonthlyReservation reservation, bytes attestation)",
  "function commitMonthlyLeaf(uint32 period, MonthlyAward entry, uint32 index, AllocationNode[] proof)",
  "function releaseMonthlyReserve(uint32 period, uint128 expectedRemaining, uint128 releasedGross, bytes attestation)",
  "function bindDestination(uint64 actorId, address destination, uint64 expectedVersion, bytes32 claimDigest, uint64 expiresAt, bytes walletSignature)",
  "function cancelBinding(uint64 actorId, uint64 expectedVersion)",
  "function pay(bytes32 id, uint64 expectedBindingVersion)",
  "function withdrawUnused(uint128 gross)",
  "function claimFees()",
]);

export const factoryAbi = parseAbi([
  "function initialize(address registrar, address feeRecipient, address identityAuthority, uint64 bindingDelay, address upgradeAuthority, address vaultImplementation)",
  "function registrar() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function bindingDelay() view returns (uint64)",
  "function AUTHORITY_ROTATION_DELAY() view returns (uint64)",
  "function upgradeAuthority() view returns (address)",
  "function vaultImplementation() view returns (address)",
  "function identityAuthority() view returns (address)",
  "function pendingIdentityAuthority() view returns (address)",
  "function identityAuthorityEffectiveAt() view returns (uint64)",
  "function vaults(bytes32 key) view returns (address)",
  "function vaultKey(address owner, bytes32 projectId, address token, uint8 purpose) pure returns (bytes32)",
  "function create(bytes32 projectId, address token, uint8 purpose) returns (address)",
  "function createWithMonthlyCommitment(bytes32 projectId, address token, uint128 cap, bool enabled) returns (address)",
  "function proposeIdentityAuthority(address next)",
  "function cancelIdentityAuthorityRotation()",
  "function executeIdentityAuthorityRotation()",
]);

export type EscrowGetter = "token" | "decimals" | "projectId" | "owner" | "purpose" | "feeRecipient" | "factory" | "bindingDelay" | "monthlyCap" | "monthlyEnabled" | "pendingMonthlyGross" | "ordinarySourceSequence" | "monthlyReserveVersion" | "identityAuthority" | "domainSeparator" | "totals";
export type FactoryGetter = "registrar" | "feeRecipient" | "bindingDelay" | "AUTHORITY_ROTATION_DELAY" | "upgradeAuthority" | "vaultImplementation" | "identityAuthority" | "pendingIdentityAuthority" | "identityAuthorityEffectiveAt";

/** @throws {never} */
export function escrowGetter(name: EscrowGetter): Hex {
  return encodeFunctionData({ abi: escrowAbi, functionName: name });
}

/** @throws {never} */
export function factoryGetter(name: FactoryGetter): Hex {
  return encodeFunctionData({ abi: factoryAbi, functionName: name });
}

/** @throws {RangeError} */
export function awardId(chainId: bigint, vault: EvmAddress, sourceDigest: Bytes32): Bytes32 {
  checked(chainId, U64_MAX, "Invalid award domain");
  if (chainId === 0n) throw new RangeError("Invalid award domain");
  return keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "bytes32" }], [chainId, vault, sourceDigest])) as Bytes32;
}

/** @throws {never} */
export function awardCall(id: Bytes32): Hex {
  return encodeFunctionData({ abi: escrowAbi, functionName: "awards", args: [id] });
}

export interface AwardState {
  readonly actor: bigint;
  readonly gross: bigint;
  readonly fee: bigint;
  readonly sourceDigest: Bytes32;
  readonly committedAt: bigint;
  readonly paid: boolean;
}

/** @throws {never} */
export function decodeAward(data: string): AwardState | undefined {
  const words = answerWords(data, 6);
  if (words === undefined) return undefined;
  const [actor, gross, fee, committedAt, paid] = [wordUint(words[0], U64_MAX), wordUint(words[1], U128_MAX), wordUint(words[2], U128_MAX), wordUint(words[4], U64_MAX), wordBool(words[5])];
  if (actor === undefined || gross === undefined || fee === undefined || committedAt === undefined || paid === undefined) return undefined;
  return { actor, gross, fee, sourceDigest: wordBytes32(words[3]), committedAt, paid };
}

/** @throws {never} */
export function bindingCall(actor: bigint): Hex {
  return encodeFunctionData({ abi: escrowAbi, functionName: "bindings", args: [actor] });
}

export interface BindingState {
  readonly destination: EvmAddress;
  readonly version: bigint;
  readonly claimDigest: Bytes32;
  readonly activatesAt: bigint;
  readonly cancelled: boolean;
}

/** @throws {never} */
export function decodeBinding(data: string): BindingState | undefined {
  const words = answerWords(data, 5);
  if (words === undefined) return undefined;
  const [destination, version, activatesAt, cancelled] = [wordAddress(words[0]), wordUint(words[1], U64_MAX), wordUint(words[3], U64_MAX), wordBool(words[4])];
  if (destination === undefined || version === undefined || activatesAt === undefined || cancelled === undefined) return undefined;
  return { destination, version, claimDigest: wordBytes32(words[2]), activatesAt, cancelled };
}

/** @throws {never} */
export function decodeAddress(data: string): EvmAddress | undefined {
  const words = answerWords(data, 1);
  return words === undefined ? undefined : wordAddress(words[0]);
}

/** @throws {never} */
export function decodeUint(data: string, maximum: bigint): bigint | undefined {
  const words = answerWords(data, 1);
  return words === undefined ? undefined : wordUint(words[0], maximum);
}

/** @throws {never} */
export function decodeBool(data: string): boolean | undefined {
  const words = answerWords(data, 1);
  return words === undefined ? undefined : wordBool(words[0]);
}

/** @throws {never} */
export function decodeBytes32(data: string): Bytes32 | undefined {
  const words = answerWords(data, 1);
  return words === undefined ? undefined : wordBytes32(words[0]);
}

export interface AuthorityRotation {
  readonly identityAuthority: EvmAddress;
  readonly pending: { readonly authority: EvmAddress; readonly effectiveAt: bigint } | undefined;
}

/** @throws {never} */
export function decodeAuthorityRotation(answers: { readonly identityAuthority: string; readonly pendingIdentityAuthority: string; readonly identityAuthorityEffectiveAt: string }): AuthorityRotation | undefined {
  const current = decodeAddress(answers.identityAuthority);
  const pending = decodeAddress(answers.pendingIdentityAuthority);
  const effectiveAt = decodeUint(answers.identityAuthorityEffectiveAt, U64_MAX);
  if (current === undefined || pending === undefined || effectiveAt === undefined) return undefined;
  return { identityAuthority: current, pending: isZero(pending) ? undefined : { authority: pending, effectiveAt } };
}

// spec/settlement/escrow.md, "Events apply once, in canonical block and event order"; spec/settlement/escrow.md, "On Solana an uncommittable leaf returns to free funds and a later hand commit strands it"; spec/contracts/solanaEscrow.md, "Anyone records a signed, fully funded allocation once per period inside its window"; spec/contracts/solanaEscrow.md, "The identity authority and the destination both sign a binding for the project's network"; spec/contracts/solanaEscrow.md, "Anyone pays a matured obligation to its actor's latest unvetoed binding"
import { sha256 } from "@noble/hashes/sha2.js";
import { type Address, type Decoded, type FetchedTransaction, ASSOCIATED_TOKEN_PROGRAM, SYSTEM_PROGRAM } from "@repo/platform/chain/solana";
import type { Period } from "../../kernels/calendar.ts";
import { type AllocationNode, encodeProof } from "./allocationRoot.ts";
import { type Digest, type I64, type U64, concat, digestBytes, digestOf, hex, i64le, isZeroDigest, readI64, readU32, readU64, sameBytes, u32le, u64le, utf8 } from "./bytes.ts";
import { type Purpose, type TokenProgram, awardAddress, awardId, bindingAddress, keyBytes, monthAddress, monthlySourceAddress, originAddress, settledAddress, tokenAccountAddress, vaultAddress, vetoAddress } from "./pda.ts";
import { type AccountMeta, type Instruction, type ResolvedInstruction, resolveInstruction, resolvedKeys } from "./transactions.ts";

export const ED25519_PROGRAM = "Ed25519SigVerify111111111111111111111111111" as Address;
export const INSTRUCTIONS_SYSVAR = "Sysvar1nstructions1111111111111111111111111" as Address;

const NO_INSTRUCTION = 0xffff;
const ED25519_HEADER = 16;
const ED25519_KEY_AT = ED25519_HEADER;
const ED25519_SIGNATURE_AT = ED25519_KEY_AT + 32;
const ED25519_MESSAGE_AT = ED25519_SIGNATURE_AT + 64;

/** @throws {never} */
export function anchorDiscriminator(name: string): Uint8Array {
  return sha256(utf8(`global:${name}`)).slice(0, 8);
}

/** @throws {never} */
export function anchorData(name: string, ...args: ReadonlyArray<Uint8Array>): Uint8Array {
  return concat(anchorDiscriminator(name), ...args);
}

/** @throws {never} */
export function meta(key: Address, writable: boolean, signer = false): AccountMeta {
  return { key, signer, writable };
}

export interface LeafArguments {
  readonly period: Period;
  readonly source: Digest;
  readonly actor: U64;
  readonly gross: U64;
  readonly index: number;
  readonly count: number;
  readonly proof: ReadonlyArray<AllocationNode>;
}

export type InstructionIssue = "invalidIdentity" | "zeroMonthlyCap" | "invalidLeafPosition";

export type Built<A> = { readonly kind: "built"; readonly value: A } | { readonly kind: "refused"; readonly issue: InstructionIssue };

function built<A>(value: A): Built<A> {
  return { kind: "built", value };
}

function refused<A>(issue: InstructionIssue): Built<A> {
  return { kind: "refused", issue };
}

/** @throws {never} */
export function ed25519Verification(authority: Address, signature: Uint8Array, message: Uint8Array): Instruction {
  const offsets = concat(
    Uint8Array.of(1, 0),
    ...[ED25519_SIGNATURE_AT, NO_INSTRUCTION, ED25519_KEY_AT, NO_INSTRUCTION, ED25519_MESSAGE_AT, message.length, NO_INSTRUCTION].map((value) => u32le(value).slice(0, 2)),
  );
  return { program: ED25519_PROGRAM, accounts: [], data: concat(offsets, keyBytes(authority), signature, message) };
}

/** @throws {never} */
export function commitMonthly(input: { readonly program: Address; readonly project: Address; readonly payer: Address; readonly period: Period; readonly root: Digest; readonly total: U64; readonly frozenAt: I64; readonly monthPledge?: Address }): Instruction {
  const { program, project, monthPledge } = input;
  return {
    program,
    accounts: [
      meta(input.payer, true, true),
      meta(project, true),
      meta(vaultAddress(program, project), false),
      meta(monthAddress(program, project, input.period), true),
      meta(INSTRUCTIONS_SYSVAR, false),
      meta(SYSTEM_PROGRAM, false),
      ...(monthPledge === undefined ? [] : [meta(monthPledge, true)]),
    ],
    data: anchorData("commit_monthly", u32le(input.period), digestBytes(input.root), u64le(input.total), i64le(input.frozenAt)),
  };
}

function leafArguments(leaf: LeafArguments): Uint8Array {
  return concat(digestBytes(leaf.source), u64le(leaf.actor), u64le(leaf.gross), u32le(leaf.index), u32le(leaf.count), encodeProof(leaf.proof));
}

function positioned(leaf: LeafArguments): boolean {
  return Number.isSafeInteger(leaf.index) && Number.isSafeInteger(leaf.count) && leaf.index >= 0 && leaf.index < leaf.count && leaf.count <= 0xffffffff;
}

/** @throws {never} */
export function commitMonthlyAward(input: { readonly program: Address; readonly project: Address; readonly payer: Address; readonly leaf: LeafArguments }): Built<Instruction> {
  const { program, project, leaf } = input;
  if (!positioned(leaf)) return refused("invalidLeafPosition");
  const month = monthAddress(program, project, leaf.period);
  const award = awardId(project, leaf.source);
  return built({
    program,
    accounts: [
      meta(input.payer, true, true),
      meta(project, true),
      meta(vaultAddress(program, project), false),
      meta(month, true),
      meta(originAddress(program, project, leaf.source), true),
      meta(awardAddress(program, project, award), true),
      meta(settledAddress(program, month, leaf.source), true),
      meta(monthlySourceAddress(program, project, leaf.source), true),
      meta(SYSTEM_PROGRAM, false),
    ],
    data: anchorData("commit_monthly_award", u32le(leaf.period), digestBytes(award), leafArguments(leaf)),
  });
}

/** @throws {never} */
export function releaseMonthlyAward(input: { readonly program: Address; readonly project: Address; readonly payer: Address; readonly leaf: LeafArguments; readonly obligation: Address | undefined }): Built<Instruction> {
  const { program, project, leaf } = input;
  if (!positioned(leaf)) return refused("invalidLeafPosition");
  const month = monthAddress(program, project, leaf.period);
  return built({
    program,
    accounts: [
      meta(input.payer, true, true),
      meta(project, true),
      meta(month, true),
      meta(originAddress(program, project, leaf.source), false),
      meta(monthlySourceAddress(program, project, leaf.source), false),
      meta(input.obligation ?? program, false),
      meta(settledAddress(program, month, leaf.source), true),
      meta(SYSTEM_PROGRAM, false),
    ],
    data: anchorData("release_monthly_award", u32le(leaf.period), leafArguments(leaf)),
  });
}

/** @throws {never} */
export function releaseReserve(input: { readonly program: Address; readonly project: Address; readonly owner: Address; readonly period: Period; readonly unsettled: U64; readonly released: U64 }): Instruction {
  const { program, project } = input;
  return {
    program,
    accounts: [meta(input.owner, false, true), meta(project, true), meta(monthAddress(program, project, input.period), true), meta(INSTRUCTIONS_SYSVAR, false)],
    data: anchorData("release_monthly_reserve", u32le(input.period), u64le(input.unsettled), u64le(input.released)),
  };
}

/** @throws {never} */
export function commitAward(input: { readonly program: Address; readonly project: Address; readonly owner: Address; readonly purpose: Purpose; readonly source: Digest; readonly actor: U64; readonly gross: U64 }): Instruction {
  const { program, project, source } = input;
  const award = awardId(project, source);
  return {
    program,
    accounts: [
      meta(input.owner, true, true),
      meta(project, true),
      meta(vaultAddress(program, project), false),
      meta(originAddress(program, project, source), true),
      meta(awardAddress(program, project, award), true),
      meta(SYSTEM_PROGRAM, false),
    ],
    data: anchorData(input.purpose === "Bounty" ? "commit_bounty" : "commit", digestBytes(award), digestBytes(source), u64le(input.actor), u64le(input.gross)),
  };
}

/** @throws {never} */
export function setMonthlyCommitment(input: { readonly program: Address; readonly project: Address; readonly owner: Address; readonly cap: U64; readonly enabled: boolean }): Built<Instruction> {
  if (input.enabled && input.cap === 0n) return refused("zeroMonthlyCap");
  return built({
    program: input.program,
    accounts: [meta(input.owner, false, true), meta(input.project, true)],
    data: anchorData("set_monthly_commitment", u64le(input.cap), Uint8Array.of(input.enabled ? 1 : 0)),
  });
}

export interface WalletBindingTerms {
  readonly program: Address;
  readonly project: Address;
  readonly payer: Address;
  readonly identityAuthority: Address;
  readonly destination: Address;
  readonly actor: U64;
  readonly network: Digest;
  readonly expectedVersion: U64;
  readonly claimDigest: Digest;
  readonly expiresAt: I64;
}

/** @throws {never} */
export function bindWallet(terms: WalletBindingTerms): Built<Instruction> {
  const { program, project, destination } = terms;
  if (terms.actor === 0n || isZeroDigest(terms.claimDigest) || destination === terms.identityAuthority || destination === project || destination === vaultAddress(program, project))
    return refused("invalidIdentity");
  return built({
    program,
    accounts: [
      meta(terms.payer, true, true),
      meta(terms.identityAuthority, false, true),
      meta(destination, false, true),
      meta(project, false),
      meta(bindingAddress(program, project, terms.actor), true),
      meta(SYSTEM_PROGRAM, false),
    ],
    data: anchorData("bind_wallet", u64le(terms.actor), digestBytes(terms.network), u64le(terms.expectedVersion), digestBytes(terms.claimDigest), i64le(terms.expiresAt)),
  });
}

/** @throws {never} */
export function createTokenAccount(input: { readonly payer: Address; readonly owner: Address; readonly mint: Address; readonly tokenProgram: TokenProgram }): Instruction {
  return {
    program: ASSOCIATED_TOKEN_PROGRAM,
    accounts: [
      meta(input.payer, true, true),
      meta(tokenAccountAddress(input.owner, input.mint, input.tokenProgram), true),
      meta(input.owner, false),
      meta(input.mint, false),
      meta(SYSTEM_PROGRAM, false),
      meta(input.tokenProgram, false),
    ],
    data: Uint8Array.of(1),
  };
}

export type PayAsset = { readonly kind: "Native" } | { readonly kind: "Token"; readonly mint: Address; readonly tokenProgram: TokenProgram };

/** @throws {never} */
export function payAward(input: { readonly program: Address; readonly project: Address; readonly payer: Address; readonly asset: PayAsset; readonly actor: U64; readonly award: Digest; readonly destination: Address; readonly version: U64 }): ReadonlyArray<Instruction> {
  const { program, project, asset } = input;
  const common = [meta(project, true), meta(awardAddress(program, project, input.award), true), meta(bindingAddress(program, project, input.actor), true)];
  const veto = meta(vetoAddress(program, project, input.actor, input.version), false);
  const vault = meta(vaultAddress(program, project), true);
  if (asset.kind === "Native")
    return [{ program, accounts: [...common, vault, meta(input.destination, true), veto], data: anchorData("pay_native", u64le(input.version)) }];
  return [
    createTokenAccount({ payer: input.payer, owner: input.destination, mint: asset.mint, tokenProgram: asset.tokenProgram }),
    {
      program,
      accounts: [...common, meta(asset.mint, false), vault, meta(tokenAccountAddress(input.destination, asset.mint, asset.tokenProgram), true), meta(asset.tokenProgram, false), veto],
      data: anchorData("pay", u64le(input.version)),
    },
  ];
}

export type EscrowCall =
  | { readonly name: "pay" | "pay_native"; readonly version: U64 }
  | { readonly name: "commit" | "commit_bounty"; readonly awardId: Digest; readonly source: Digest; readonly actor: U64; readonly gross: U64 }
  | { readonly name: "set_monthly_commitment"; readonly cap: U64; readonly enabled: boolean }
  | { readonly name: "commit_monthly"; readonly period: number; readonly root: Digest; readonly total: U64; readonly frozenAt: I64 }
  | ({ readonly name: "commit_monthly_award"; readonly awardId: Digest } & DecodedLeaf)
  | ({ readonly name: "release_monthly_award" } & DecodedLeaf)
  | { readonly name: "release_monthly_reserve"; readonly period: number; readonly unsettled: U64; readonly released: U64 }
  | { readonly name: "bind_wallet"; readonly actor: U64; readonly network: Digest; readonly expectedVersion: U64; readonly claimDigest: Digest; readonly expiresAt: I64 };

export interface DecodedLeaf {
  readonly period: number;
  readonly source: Digest;
  readonly actor: U64;
  readonly gross: U64;
  readonly index: number;
  readonly count: number;
  readonly proof: ReadonlyArray<AllocationNode>;
}

const callNames = ["pay", "pay_native", "commit", "commit_bounty", "set_monthly_commitment", "commit_monthly", "commit_monthly_award", "release_monthly_award", "release_monthly_reserve", "bind_wallet"] as const;

type CallName = (typeof callNames)[number];

const byDiscriminator = new Map<string, CallName>(callNames.map((name) => [hex(anchorDiscriminator(name)), name]));

const digestAt = (data: Uint8Array, at: number) => digestOf(data.slice(at, at + 32)) as Digest;

function leafAt(data: Uint8Array, period: number, at: number): DecodedLeaf | undefined {
  if (data.length < at + 60) return undefined;
  const length = readU32(data, at + 56);
  if (data.length !== at + 60 + length * 40) return undefined;
  const proof = Array.from({ length }, (_, node) => ({ hash: digestAt(data, at + 60 + node * 40), total: readU64(data, at + 92 + node * 40) }));
  return { period, source: digestAt(data, at), actor: readU64(data, at + 32), gross: readU64(data, at + 40), index: readU32(data, at + 48), count: readU32(data, at + 52), proof };
}

function flagAt(data: Uint8Array, at: number): boolean | undefined {
  return data[at] === 0 ? false : data[at] === 1 ? true : undefined;
}

/** @throws {never} */
export function decodeEscrowCall(data: Uint8Array): EscrowCall | undefined {
  const name = byDiscriminator.get(hex(data.slice(0, 8)));
  const sized = (length: number) => data.length === 8 + length;
  switch (name) {
    case undefined:
      return undefined;
    case "pay":
    case "pay_native":
      return sized(8) ? { name, version: readU64(data, 8) } : undefined;
    case "commit":
    case "commit_bounty":
      return sized(80) ? { name, awardId: digestAt(data, 8), source: digestAt(data, 40), actor: readU64(data, 72), gross: readU64(data, 80) } : undefined;
    case "set_monthly_commitment": {
      const enabled = flagAt(data, 16);
      return sized(9) && enabled !== undefined ? { name, cap: readU64(data, 8), enabled } : undefined;
    }
    case "commit_monthly":
      return sized(52) ? { name, period: readU32(data, 8), root: digestAt(data, 12), total: readU64(data, 44), frozenAt: readI64(data, 52) } : undefined;
    case "commit_monthly_award": {
      const leaf = data.length >= 44 ? leafAt(data, readU32(data, 8), 44) : undefined;
      return leaf ? { name, awardId: digestAt(data, 12), ...leaf } : undefined;
    }
    case "release_monthly_award": {
      const leaf = data.length >= 12 ? leafAt(data, readU32(data, 8), 12) : undefined;
      return leaf ? { name, ...leaf } : undefined;
    }
    case "release_monthly_reserve":
      return sized(20) ? { name, period: readU32(data, 8), unsettled: readU64(data, 12), released: readU64(data, 20) } : undefined;
    case "bind_wallet":
      return sized(88) ? { name, actor: readU64(data, 8), network: digestAt(data, 16), expectedVersion: readU64(data, 48), claimDigest: digestAt(data, 56), expiresAt: readI64(data, 88) } : undefined;
    default: {
      const _exhaustive: never = name;
      return _exhaustive;
    }
  }
}

export interface EscrowInvocation {
  readonly position: number;
  readonly call: EscrowCall | undefined;
  readonly accounts: ReadonlyArray<Address>;
  readonly data: Uint8Array;
  readonly children: ReadonlyArray<ResolvedInstruction>;
}

export type InvocationIssue = "unresolvedAccount" | "missingStackHeight" | "innerOutsideTransaction";

interface Flat {
  readonly instruction: ResolvedInstruction;
  readonly height: number;
  readonly top: number;
}

/** @throws {never} */
export function escrowInvocations(fetched: FetchedTransaction, program: Address): Decoded<ReadonlyArray<EscrowInvocation>, InvocationIssue> {
  const message = fetched.transaction.message;
  const keys = resolvedKeys(message, { writable: fetched.meta.loadedWritable, readonly: fetched.meta.loadedReadonly });
  const flat: Flat[] = [];
  for (const [top, compiled] of message.instructions.entries()) {
    const instruction = resolveInstruction(compiled, keys);
    if (instruction === undefined) return { kind: "malformed", issue: "unresolvedAccount" };
    flat.push({ instruction, height: 1, top });
    for (const group of fetched.meta.innerInstructions.filter((inner) => inner.index === top)) {
      for (const child of group.instructions) {
        if (child.stackHeight === undefined || child.stackHeight < 2) return { kind: "malformed", issue: "missingStackHeight" };
        const resolved = resolveInstruction(child, keys);
        if (resolved === undefined) return { kind: "malformed", issue: "unresolvedAccount" };
        flat.push({ instruction: resolved, height: child.stackHeight, top });
      }
    }
  }
  if (fetched.meta.innerInstructions.some((inner) => inner.index >= message.instructions.length)) return { kind: "malformed", issue: "innerOutsideTransaction" };
  const found: EscrowInvocation[] = [];
  for (const [position, entry] of flat.entries()) {
    if (entry.instruction.program !== program || !byDiscriminator.has(hex(entry.instruction.data.slice(0, 8)))) continue;
    const children: ResolvedInstruction[] = [];
    for (const next of flat.slice(position + 1)) {
      if (next.top !== entry.top || next.height <= entry.height) break;
      if (next.height === entry.height + 1) children.push(next.instruction);
    }
    found.push({ position, call: decodeEscrowCall(entry.instruction.data), accounts: entry.instruction.accounts, data: entry.instruction.data, children });
  }
  return { kind: "decoded", value: found };
}

/** @throws {never} */
export function sameInstruction(resolved: ResolvedInstruction, instruction: Instruction): boolean {
  return resolved.program === instruction.program
    && resolved.accounts.length === instruction.accounts.length
    && resolved.accounts.every((key, at) => key === instruction.accounts[at]?.key)
    && sameBytes(resolved.data, instruction.data);
}

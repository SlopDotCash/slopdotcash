// spec/contracts/solanaEscrow.md, "The owner creates a token or native project with the Config's identity authority and fee recipient"; spec/settlement/escrow.md, "On Solana an uncommittable leaf returns to free funds and a later hand commit strands it"; spec/contracts/solanaEscrow.md, "The owner pledges free funds to one period from the current one to eleven months ahead, raising and never lowering"
import { sha256 } from "@noble/hashes/sha2.js";
import { type Address, type ProgramAddress, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, associatedTokenAddress, findPda, publicKey } from "@repo/platform/chain/solana";
import type { Period } from "../../kernels/calendar.ts";
import { type Digest, type U64, concat, digestBytes, digestOf, u32le, u64le, utf8 } from "./bytes.ts";

export const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111" as Address;

export type Purpose = "Ordinary" | "Bounty";
export type TokenProgram = typeof TOKEN_PROGRAM | typeof TOKEN_2022_PROGRAM;

export const PURPOSE_BYTE: Readonly<Record<Purpose, number>> = { Ordinary: 0, Bounty: 1 };

/** @throws {never} */
export function isTokenProgram(program: Address): program is TokenProgram {
  return program === TOKEN_PROGRAM || program === TOKEN_2022_PROGRAM;
}

/** @throws {never} */
export function keyBytes(key: Address): Uint8Array {
  return publicKey(key) as Uint8Array;
}

function derive(seeds: ReadonlyArray<Uint8Array>, program: Address): Address {
  return (findPda(seeds, program) as ProgramAddress).address;
}

/** @throws {never} */
export function configAddress(program: Address): Address {
  return derive([utf8("config")], program);
}

/** @throws {never} */
export function programDataAddress(program: Address): Address {
  return derive([keyBytes(program)], UPGRADEABLE_LOADER);
}

/** @throws {never} */
export function projectAddress(program: Address, owner: Address, projectId: Digest, purpose: Purpose): Address {
  return derive([utf8("project"), keyBytes(owner), digestBytes(projectId), Uint8Array.of(PURPOSE_BYTE[purpose])], program);
}

/** @throws {never} */
export function vaultAddress(program: Address, project: Address): Address {
  return derive([utf8("vault"), keyBytes(project)], program);
}

/** @throws {never} */
export function awardId(project: Address, source: Digest): Digest {
  return digestOf(sha256(concat(utf8("slop-escrow-award"), keyBytes(project), digestBytes(source)))) as Digest;
}

/** @throws {never} */
export function awardAddress(program: Address, project: Address, award: Digest): Address {
  return derive([utf8("award"), keyBytes(project), digestBytes(award)], program);
}

/** @throws {never} */
export function originAddress(program: Address, project: Address, source: Digest): Address {
  return derive([utf8("origin"), keyBytes(project), digestBytes(source)], program);
}

/** @throws {never} */
export function monthlySourceAddress(program: Address, project: Address, source: Digest): Address {
  return derive([utf8("monthly-source"), keyBytes(project), digestBytes(source)], program);
}

/** @throws {never} */
export function monthAddress(program: Address, project: Address, period: Period): Address {
  return derive([utf8("month"), keyBytes(project), u32le(period)], program);
}

/** @throws {never} */
export function monthPledgeAddress(program: Address, project: Address, period: Period): Address {
  return derive([utf8("pledge"), keyBytes(project), u32le(period)], program);
}

/** @throws {never} */
export function settledAddress(program: Address, month: Address, source: Digest): Address {
  return derive([utf8("settled"), keyBytes(month), digestBytes(source)], program);
}

/** @throws {never} */
export function bindingAddress(program: Address, project: Address, actor: U64): Address {
  return derive([utf8("wallet"), keyBytes(project), u64le(actor)], program);
}

/** @throws {never} */
export function vetoAddress(program: Address, project: Address, actor: U64, version: U64): Address {
  return derive([utf8("veto"), keyBytes(project), u64le(actor), u64le(version)], program);
}

/** @throws {never} */
export function tokenAccountAddress(owner: Address, mint: Address, program: TokenProgram): Address {
  return associatedTokenAddress(owner, mint, program) as Address;
}

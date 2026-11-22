// spec/contracts/solanaEscrow.md, "A Token-2022 mint has at most metadata extensions and no active authority, and its token accounts at most ImmutableOwner"; spec/contracts/solanaEscrow.md, "The earlier build's project grows to the current layout with new counters at zero"; spec/contracts/solanaEscrow.md, "The pre-pledge build's 332-byte project grows to the current layout with no open pledges"
// The program's addresses and instruction bytes, and the bytes of accounts that no instruction can create on demand:
// a mint or token account with exactly the facts an event names, and an earlier build's project.
import type { AccountFacts, MintFacts } from "../../gen/contracts__solanaEscrow.ts";
import type { Purpose } from "../../gen/contracts__ledger.ts";
import { findPda } from "@repo/platform/chain/solanaWire";
import {
  type Address,
  type GenesisAccount,
  type Instruction,
  CONFIG,
  DEFAULT_KEY,
  ED25519_PROGRAM,
  OTHER_PROGRAM,
  PROGRAM,
  PROGRAM_DATA,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  Unrepresentable,
  concat,
  i64le,
  keyBytes,
  keypair,
  meta,
  pda,
  rentFor,
  sha256,
  u16le,
  u32le,
  u64le,
  utf8,
} from "./solanaChain.ts";

export const DECIMALS = 6;
/** What every funded fixture token account starts with: more than any walk moves. */
export const FUNDED = 1n << 60n;

export function uint(value: number, bits: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0 || BigInt(value) >= 1n << BigInt(bits)) throw new Unrepresentable(`${value} is not a u${bits}`);
  return BigInt(value);
}
export function int64(value: number): bigint {
  if (!Number.isSafeInteger(value)) throw new Unrepresentable(`${value} is not an i64`);
  return BigInt(value);
}

/** A name as 32 bytes: its UTF-8 padded with zeros, the empty name being the all-zero word. */
export function word(name: string): Uint8Array {
  const bytes = utf8(name);
  if (bytes.length > 32) throw new Unrepresentable(`"${name}" does not fit in 32 bytes`);
  const padded = new Uint8Array(32);
  padded.set(bytes);
  return padded;
}
export function wordName(bytes: Uint8Array): string {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end));
}

/** A number as a 32-byte big-endian word, so 0 is the all-zero digest. */
export function numberWord(value: number): Uint8Array {
  const bytes = new Uint8Array(32);
  let rest = uint(value, 53);
  for (let at = 31; rest > 0n; at--) {
    bytes[at] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return bytes;
}
export function wordNumber(bytes: Uint8Array): number | undefined {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
}

export const purposeByte: Readonly<Record<Purpose, number>> = { Ordinary: 0, Bounty: 1 };

export const projectAddress = (owner: Address, project: string, purpose: Purpose) => pda([utf8("project"), keyBytes(owner), word(project), Uint8Array.of(purposeByte[purpose])]);
export const vaultAddress = (project: Address) => pda([utf8("vault"), keyBytes(project)]);
export const awardId = (project: Address, source: number) => sha256(utf8("slop-escrow-award"), keyBytes(project), numberWord(source));
export const awardAddress = (project: Address, source: number) => pda([utf8("award"), keyBytes(project), awardId(project, source)]);
export const originAddress = (project: Address, source: number) => pda([utf8("origin"), keyBytes(project), numberWord(source)]);
export const monthlySourceAddress = (project: Address, source: number) => pda([utf8("monthly-source"), keyBytes(project), numberWord(source)]);
export const monthAddress = (project: Address, period: number) => pda([utf8("month"), keyBytes(project), u32le(Number(uint(period, 32)))]);
export const pledgeAddress = (project: Address, period: number) => pda([utf8("pledge"), keyBytes(project), u32le(Number(uint(period, 32)))]);
export const settledAddress = (month: Address, source: number) => pda([utf8("settled"), keyBytes(month), numberWord(source)]);
export const bindingAddress = (project: Address, actor: number) => pda([utf8("wallet"), keyBytes(project), u64le(uint(actor, 64))]);
export const vetoAddress = (project: Address, actor: number, version: number) => pda([utf8("veto"), keyBytes(project), u64le(uint(actor, 64)), u64le(uint(version, 64))]);

export const instructionData = (name: string, ...args: ReadonlyArray<Uint8Array>) => concat(sha256(utf8(`global:${name}`)).slice(0, 8), ...args);
export const accountDiscriminator = (name: string) => sha256(utf8(`account:${name}`)).slice(0, 8);

export const escrow = (name: string, accounts: Instruction["accounts"], ...args: ReadonlyArray<Uint8Array>): Instruction => ({ program: PROGRAM, accounts, data: instructionData(name, ...args) });

export const configAccounts = (authority: Address) => [meta(authority, true, true), meta(CONFIG, true), meta(PROGRAM, false), meta(PROGRAM_DATA, false), meta(SYSTEM_PROGRAM, false)];

/** The Ed25519 program's check of one signature, every offset inside its own data, as the program requires. */
export function ed25519Check(signer: Uint8Array, signature: Uint8Array, message: Uint8Array): Instruction {
  const offsets = concat(Uint8Array.of(1, 0), ...[48, 0xffff, 16, 0xffff, 112, message.length, 0xffff].map(u16le));
  return { program: ED25519_PROGRAM, accounts: [], data: concat(offsets, signer, signature, message) };
}

export const monthlyMessage = (project: Address, period: number, root: Uint8Array, total: bigint, frozenAt: bigint, network: Uint8Array) =>
  concat(utf8("slop-monthly-allocation-v3"), keyBytes(PROGRAM), keyBytes(project), u32le(period), root, u64le(total), i64le(frozenAt), network);

export const releaseMessage = (project: Address, period: number, root: Uint8Array, total: bigint, unsettled: bigint, released: bigint, network: Uint8Array) =>
  concat(utf8("slop-monthly-release-v1"), keyBytes(PROGRAM), keyBytes(project), u32le(period), root, u64le(total), u64le(unsettled), u64le(released), network);

export interface Leaf {
  readonly actor: number;
  readonly gross: number;
  readonly source: number;
}
interface Node {
  readonly hash: Uint8Array;
  readonly total: bigint;
}

// The leaf and node hashes of apps/settlement/src/chain/solana/allocationRoot.ts, which this package cannot import.
const node = (leaf: Leaf): Node => {
  const gross = uint(leaf.gross, 64);
  return { hash: sha256(Uint8Array.of(0), u64le(uint(leaf.actor, 64)), u64le(gross), numberWord(leaf.source)), total: gross };
};
const sumNode = (left: Node, right: Node): Node | undefined => {
  const total = left.total + right.total;
  if (total >= 1n << 64n) return undefined;
  return { hash: sha256(Uint8Array.of(1), left.hash, u64le(left.total), right.hash, u64le(right.total)), total };
};

/** The Merkle-sum tree the program proves leaves against. */
export function allocationTree(leaves: ReadonlyArray<Leaf>): { readonly root: Uint8Array; readonly proof: (index: number) => ReadonlyArray<Node> } | undefined {
  if (leaves.length === 0) return undefined;
  const levels: Node[][] = [leaves.map(node)];
  for (let level = levels[0]; level.length > 1; level = levels[levels.length - 1]) {
    const next: Node[] = [];
    for (let at = 0; at < level.length; at += 2) {
      const right = level[at + 1];
      const joined = right === undefined ? level[at] : sumNode(level[at], right);
      if (joined === undefined) throw new Unrepresentable("the allocation total overflows u64");
      next.push(joined);
    }
    levels.push(next);
  }
  const top = (levels[levels.length - 1])[0];
  return {
    root: top.hash,
    proof: (index) => {
      const siblings: Node[] = [];
      let at = index;
      for (const level of levels.slice(0, -1)) {
        const sibling = level[at % 2 === 1 ? at - 1 : at + 1];
        if (sibling !== undefined) siblings.push(sibling);
        at = Math.floor(at / 2);
      }
      return siblings;
    },
  };
}

export const encodeProof = (proof: ReadonlyArray<Node>) => concat(u32le(proof.length), ...proof.map((step) => concat(step.hash, u64le(step.total))));

export const transferChecked = (program: Address, source: Address, mint: Address, destination: Address, owner: Address, amount: bigint): Instruction => ({
  program,
  accounts: [meta(source, true), meta(mint, false), meta(destination, true), meta(owner, false, true)],
  data: concat(Uint8Array.of(12), u64le(amount), Uint8Array.of(DECIMALS)),
});
export const freeze = (program: Address, account: Address, mint: Address, authority: Address, thaw: boolean): Instruction => ({
  program,
  accounts: [meta(account, true), meta(mint, false), meta(authority, false, true)],
  data: Uint8Array.of(thaw ? 11 : 10),
});
export const lamportTransfer = (from: Address, to: Address, lamports: bigint): Instruction => ({
  program: SYSTEM_PROGRAM,
  accounts: [meta(from, true, true), meta(to, true)],
  data: concat(u32le(2), u64le(lamports)),
});

/** The token program a mint or account of this kind belongs to. */
export const programOf = (kind: MintFacts["kind"]): Address => (kind === "ClassicSpl" ? TOKEN_PROGRAM : kind === "Token2022" ? TOKEN_2022_PROGRAM : OTHER_PROGRAM);

export const factsKey = (facts: unknown) => JSON.stringify(facts);
export const mintAddress = (facts: MintFacts) => keypair(`mint:${factsKey(facts)}`).address;

const option = (key: Address | undefined) => (key === undefined ? new Uint8Array(36) : concat(u32le(1), keyBytes(key)));
const optionalKey = (key: Address | undefined) => (key === undefined ? new Uint8Array(32) : keyBytes(key));
const borshString = (text: string) => concat(u32le(utf8(text).length), utf8(text));
const tlv = (type: number, value: Uint8Array) => concat(u16le(type), u16le(value.length), value);

/** A mint with exactly these facts; the deployer holds any authority the facts give it. */
export function mintAccount(facts: MintFacts, authority: Address): GenesisAccount {
  const address = mintAddress(facts);
  const base = concat(option(facts.mintAuthority ? authority : undefined), u64le(FUNDED * 64n), Uint8Array.of(DECIMALS, 1), option(facts.freezeAuthority ? authority : undefined));
  let data = base;
  if (facts.kind === "Token2022") {
    const named = facts.selfHosted ? address : keypair("elsewhere").address;
    const extension = (name: string): Uint8Array => {
      switch (name) {
        case "MetadataPointer":
          return tlv(18, concat(optionalKey(facts.pointerAuthority ? authority : undefined), keyBytes(named)));
        case "TokenMetadata":
          return tlv(19, concat(optionalKey(facts.updateAuthority ? authority : undefined), keyBytes(named), borshString("Slop Test"), borshString("SLT"), borshString(""), u32le(0)));
        case "TransferHook":
          return tlv(14, new Uint8Array(64));
        case "MintCloseAuthority":
          return tlv(3, keyBytes(authority));
        case "PermanentDelegate":
          return tlv(12, keyBytes(authority));
        case "NonTransferable":
          return tlv(9, new Uint8Array());
        case "DefaultAccountState":
          return tlv(6, Uint8Array.of(1));
        default:
          throw new Unrepresentable(`no Token-2022 mint extension is named ${name}`);
      }
    };
    const extensions = facts.extensions.map(extension);
    const natural = extensions.length === 0 && facts.bytes <= 165 ? base : concat(base, new Uint8Array(165 - base.length), Uint8Array.of(1), ...extensions);
    // The program reads the size only against its 1,024-byte bound; a size below the extensions' own is theirs.
    data = facts.bytes > natural.length && natural.length > base.length ? concat(natural, new Uint8Array(facts.bytes - natural.length)) : natural;
  } else if (facts.extensions.length > 0) throw new Unrepresentable("a classic mint has no extensions");
  return { address, lamports: rentFor(data.length), owner: programOf(facts.kind), data, executable: false };
}

/** A token account with exactly these facts for `mint`, held by `holder`. */
export function tokenAccount(address: Address, facts: AccountFacts, mint: Address, holder: Address, amount: bigint, frozen = false): GenesisAccount {
  const state = facts.initialized ? (frozen ? 2 : 1) : 0;
  const base = facts.initialized
    ? concat(keyBytes(mint), keyBytes(holder), u64le(amount), new Uint8Array(36), Uint8Array.of(state), new Uint8Array(12), u64le(0n), new Uint8Array(36))
    : new Uint8Array(165);
  let data = base;
  if (facts.kind === "Token2022" && facts.extensions.length > 0) {
    const extension = (name: string): Uint8Array => {
      switch (name) {
        case "ImmutableOwner":
          return tlv(7, new Uint8Array());
        case "MemoTransfer":
          return tlv(8, Uint8Array.of(1));
        case "CpiGuard":
          return tlv(11, Uint8Array.of(1));
        case "NonTransferableAccount":
          return tlv(13, new Uint8Array());
        case "TransferHookAccount":
          return tlv(15, Uint8Array.of(0));
        default:
          throw new Unrepresentable(`no Token-2022 account extension is named ${name}`);
      }
    };
    data = concat(base, Uint8Array.of(2), ...facts.extensions.map(extension));
  } else if (facts.extensions.length > 0) throw new Unrepresentable(`a ${facts.kind} token account has no extensions`);
  return { address, lamports: rentFor(data.length), owner: programOf(facts.kind), data, executable: false };
}

/** The facts of the account the associated token account program creates for a mint of this kind. */
export const associatedFacts = (kind: MintFacts["kind"]): AccountFacts | undefined =>
  kind === "ClassicSpl" ? { kind: "ClassicSpl", initialized: true, extensions: [] } : kind === "Token2022" ? { kind: "Token2022", initialized: true, extensions: ["ImmutableOwner"] } : undefined;

/** The Project an earlier build's `initialize` and deposits left: 316 bytes, or 332 with accrued fees and the monthly gate. */
export function earlierProject(size: 316 | 332, owner: Address, project: string, network: string, identity: Address, feeRecipient: Address, mint: Address, deposited: bigint): GenesisAccount {
  const address = projectAddress(owner, project, "Ordinary");
  const bump = pdaBump(owner, project);
  const data = new Uint8Array(size);
  data.set(accountDiscriminator("Project"), 0);
  data.set(keyBytes(owner), 8);
  data.set(word(project), 40);
  data.set(word(network), 72);
  data.set(keyBytes(identity), 104);
  data.set(keyBytes(feeRecipient), 136);
  data.set(keyBytes(mint), 168);
  data.set(u64le(deposited), 208);
  data[248] = bump;
  return { address, lamports: rentFor(size), owner: PROGRAM, data, executable: false };
}

function pdaBump(owner: Address, project: string): number {
  const found = findPda([utf8("project"), keyBytes(owner), word(project), Uint8Array.of(0)], PROGRAM);
  if (found === undefined) throw new Error("no bump derives the project address");
  return found.bump;
}

export const isDefault = (address: Address) => address === DEFAULT_KEY;

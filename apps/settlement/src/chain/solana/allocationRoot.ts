// spec/settlement/monthlyCommitment.md, "Solana signs one freeze time and refuses a month whose source is already consumed"; spec/settlement/escrow.md, "On Solana an uncommittable leaf returns to free funds and a later hand commit strands it"
import { sha256 } from "@noble/hashes/sha2.js";
import { type Digest, type U64, concat, digestBytes, digestOf, u32le, u64, u64le } from "./bytes.ts";

export interface MonthlyEntry {
  readonly actor: U64;
  readonly gross: U64;
  readonly source: Digest;
}

export interface AllocationNode {
  readonly hash: Digest;
  readonly total: U64;
}

export type AllocationIssue = "empty" | "tooManyLeaves" | "invalidAward" | "repeatedSource" | "totalOverflow";

export interface AllocationTree {
  readonly root: Digest;
  readonly total: U64;
  readonly count: number;
  readonly proofs: ReadonlyArray<ReadonlyArray<AllocationNode>>;
}

export type Allocation = { readonly kind: "built"; readonly tree: AllocationTree } | { readonly kind: "refused"; readonly issue: AllocationIssue };

const MAX_LEAVES = 0xffffffff;

/** @throws {never} */
export function leafNode(entry: MonthlyEntry): AllocationNode {
  return { hash: digestOf(sha256(concat(Uint8Array.of(0), u64le(entry.actor), u64le(entry.gross), digestBytes(entry.source)))) as Digest, total: entry.gross };
}

/** @throws {never} */
export function sumNode(left: AllocationNode, right: AllocationNode): AllocationNode | undefined {
  const total = u64(left.total + right.total);
  if (total === undefined) return undefined;
  const hash = sha256(concat(Uint8Array.of(1), digestBytes(left.hash), u64le(left.total), digestBytes(right.hash), u64le(right.total)));
  return { hash: digestOf(hash) as Digest, total };
}

/** @throws {never} */
export function solanaAllocationRoot(entries: ReadonlyArray<MonthlyEntry>): Allocation {
  if (entries.length === 0) return { kind: "refused", issue: "empty" };
  if (entries.length > MAX_LEAVES) return { kind: "refused", issue: "tooManyLeaves" };
  if (entries.some((entry) => entry.actor === 0n || entry.gross === 0n)) return { kind: "refused", issue: "invalidAward" };
  if (new Set(entries.map((entry) => entry.source)).size !== entries.length) return { kind: "refused", issue: "repeatedSource" };
  const levels: AllocationNode[][] = [entries.map(leafNode)];
  for (let level = levels[0]; level.length > 1; level = levels[levels.length - 1]) {
    const next: AllocationNode[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const right = level[index + 1];
      const node = right === undefined ? level[index] : sumNode(level[index], right);
      if (node === undefined) return { kind: "refused", issue: "totalOverflow" };
      next.push(node);
    }
    levels.push(next);
  }
  const top = levels[levels.length - 1][0];
  const proof = (index: number) => {
    const siblings: AllocationNode[] = [];
    let at = index;
    for (const level of levels.slice(0, -1)) {
      const sibling = level[at % 2 === 1 ? at - 1 : at + 1];
      if (sibling !== undefined) siblings.push(sibling);
      at = Math.floor(at / 2);
    }
    return siblings;
  };
  return { kind: "built", tree: { root: top.hash, total: top.total, count: entries.length, proofs: entries.map((_, index) => proof(index)) } };
}

/** @throws {never} */
export function provenRoot(entry: MonthlyEntry, index: number, count: number, proof: ReadonlyArray<AllocationNode>): AllocationNode | undefined {
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index < 0 || index >= count || count > MAX_LEAVES) return undefined;
  let node: AllocationNode | undefined = leafNode(entry);
  let [at, width, used] = [index, count, 0];
  while (width > 1 && node !== undefined) {
    if (at % 2 === 1 || at + 1 < width) {
      const sibling: AllocationNode | undefined = proof[used++];
      if (sibling === undefined) return undefined;
      node = at % 2 === 1 ? sumNode(sibling, node) : sumNode(node, sibling);
    }
    at = Math.floor(at / 2);
    width = Math.ceil(width / 2);
  }
  return used === proof.length ? node : undefined;
}

/** @throws {never} */
export function encodeProof(proof: ReadonlyArray<AllocationNode>): Uint8Array {
  return concat(u32le(proof.length), ...proof.map((node) => concat(digestBytes(node.hash), u64le(node.total))));
}


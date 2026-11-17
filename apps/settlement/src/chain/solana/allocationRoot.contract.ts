// spec/settlement/monthlyCommitment.md, "Solana signs one freeze time and refuses a month whose source is already consumed"; spec/settlement/escrow.md, "On Solana an uncommittable leaf returns to free funds and a later hand commit strands it"
import { sha256 } from "@noble/hashes/sha2.js";
import { Arbitrary, Schema } from "effect";
import { contract } from "vibestack/testing";
import { type Allocation, type MonthlyEntry, provenRoot, solanaAllocationRoot } from "./allocationRoot.ts";
import { type Digest, type U64, U64_MAX, digestOf, u32le } from "./bytes.ts";

const positive = (maximum: bigint) => Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 1n, maximum }));

const months = (largestGross: bigint) =>
  Arbitrary.schema(Schema.Array(Schema.Struct({ actor: positive(U64_MAX), gross: positive(largestGross) })).check(Schema.isMinLength(1), Schema.isMaxLength(11))).pipe(
    Arbitrary.map((leaves): ReadonlyArray<MonthlyEntry> => leaves.map((leaf, index) => ({ actor: leaf.actor as U64, gross: leaf.gross as U64, source: digestOf(sha256(u32le(index))) as Digest }))),
  );

const sum = (entries: ReadonlyArray<MonthlyEntry>) => entries.reduce((total, entry) => total + entry.gross, 0n);

const everyLeafProves = (entries: ReadonlyArray<MonthlyEntry>, allocation: Allocation) => {
  if (sum(entries) > U64_MAX) return allocation.kind === "refused" && allocation.issue === "totalOverflow";
  if (allocation.kind === "refused") return false;
  const { tree } = allocation;
  return tree.total === sum(entries) && tree.count === entries.length && entries.every((entry, index) => {
    const proof = tree.proof(index);
    const node = proof && provenRoot(entry, index, entries.length, proof);
    return node?.hash === tree.root && node.total === tree.total;
  });
};

const anotherPositionFails = (entries: ReadonlyArray<MonthlyEntry>, allocation: Allocation) =>
  allocation.kind === "refused" || entries.length === 1 || entries.every((entry, index) => {
    const proof = allocation.tree.proof(index) ?? [];
    const moved = provenRoot(entry, (index + 1) % entries.length, entries.length, proof);
    return moved?.hash !== allocation.tree.root;
  });

export const everyLeafProvesTheSignedRoot = contract({ input: months(1n << 60n), run: solanaAllocationRoot, deterministic: true, invariant: everyLeafProves });

export const anOverflowingMonthIsRefused = contract({ input: months(U64_MAX), run: solanaAllocationRoot, invariant: everyLeafProves });

export const aProofAuthenticatesOnlyItsPosition = contract({ input: months(1n << 60n), run: solanaAllocationRoot, invariant: anotherPositionFails });

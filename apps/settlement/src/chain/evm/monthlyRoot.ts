// spec/settlement/escrow.md, "On EVM a legacy V1 root commits every leaf at once and counts an identical existing award once"; spec/settlement/escrow.md, "A proven leaf reclassifies pool gross into one award without debiting free funds"
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, encodeFunctionData, keccak256 } from "viem";
import type { Period } from "../../kernels/calendar.ts";
import { type AwardState, type Bytes32, type Hex, U32_MAX, U64_MAX, U128_MAX, U256_MAX, answerWords, checked, decodeBytes32, escrowAbi, escrowGetter, isZero, wordBytes32, wordUint } from "./abi.ts";
import { type EscrowDomain, type Field, type TypedStruct, escrowDigest } from "./typedData.ts";

export interface MonthlyEntry {
  readonly actor: bigint;
  readonly gross: bigint;
  readonly sourceDigest: Bytes32;
}

export interface AllocationNode {
  readonly hash: Bytes32;
  readonly total: bigint;
}

export interface SumTree {
  readonly root: AllocationNode;
  readonly proofs: ReadonlyArray<ReadonlyArray<AllocationNode>>;
}

export interface MonthlyReservation {
  readonly allocationDigest: Bytes32;
  readonly allocationRoot: Bytes32;
  readonly wholeGross: bigint;
  readonly remainingGross: bigint;
  readonly count: number;
  readonly sourceSequence: bigint;
}

export interface MonthlyReserveState {
  readonly root: Bytes32;
  readonly allocationDigest: Bytes32;
  readonly total: bigint;
  readonly remaining: bigint;
  readonly count: number;
  readonly admittedAt: bigint;
}

export const MONTHLY_RESERVE_VERSION = 2n;
export const MONTHLY_RESERVE_VERSION_CALL: Hex = escrowGetter("monthlyReserveVersion");
export const SOURCE_SEQUENCE_CALL: Hex = escrowGetter("ordinarySourceSequence");
export const EMPTY_SUM_ROOT: AllocationNode = { hash: keccak256("0x02") as Bytes32, total: 0n };

const SIGNATURE = /^0x[0-9a-fA-F]{130}$/u;

/** @throws {RangeError} */
function attestation(signature: Hex, message: string): Hex {
  if (!SIGNATURE.test(signature)) throw new RangeError(message);
  return signature.toLowerCase() as Hex;
}

/** @throws {RangeError} */
export function checkedEntry(entry: MonthlyEntry): MonthlyEntry {
  checked(entry.actor, U64_MAX, "Invalid monthly amount");
  checked(entry.gross, U128_MAX, "Monthly amount exceeds chain range");
  if (entry.actor === 0n || entry.gross === 0n || isZero(entry.sourceDigest)) throw new RangeError("Invalid monthly award");
  return entry;
}

/** @throws {RangeError} */
export function monthlyLeaf(entry: MonthlyEntry): Bytes32 {
  const { actor, gross, sourceDigest } = checkedEntry(entry);
  return keccak256(`0x00${actor.toString(16).padStart(16, "0")}${gross.toString(16).padStart(32, "0")}${sourceDigest.slice(2)}`) as Bytes32;
}

const pairHash = (left: Bytes32, right: Bytes32) => keccak256(`0x01${left.slice(2)}${right.slice(2)}`) as Bytes32;

/** @throws {RangeError} */
export function allocationRoot(entries: ReadonlyArray<MonthlyEntry>): Bytes32 {
  if (entries.length === 0) throw new RangeError("Empty monthly allocation");
  let level = entries.map(monthlyLeaf);
  while (level.length > 1) level = Array.from({ length: Math.ceil(level.length / 2) }, (_, i) => (2 * i + 1 < level.length ? pairHash(level[2 * i], level[2 * i + 1]) : level[2 * i]));
  return level[0];
}

/** @throws {RangeError} */
function periodWord(period: Period): bigint {
  return checked(BigInt(period), U32_MAX, "Invalid monthly period");
}

const MONTHLY_FIELDS: ReadonlyArray<Field<"period" | "allocationRoot">> = [
  { name: "period", type: "uint32" },
  { name: "allocationRoot", type: "bytes32" },
];

/** @throws {RangeError} */
export function monthlyStruct(period: Period, root: Bytes32): TypedStruct<"MonthlyAllocation", "period" | "allocationRoot"> {
  return { primaryType: "MonthlyAllocation", fields: MONTHLY_FIELDS, values: { period: periodWord(period), allocationRoot: root } };
}

/** @throws {RangeError} */
export function monthlyDigest(domain: EscrowDomain, period: Period, root: Bytes32): Bytes32 {
  return escrowDigest(domain, monthlyStruct(period, root));
}

const tuple = (entry: MonthlyEntry) => ({ actorId: entry.actor, gross: entry.gross, sourceDigest: entry.sourceDigest });

/** @throws {RangeError} */
export function commitMonthlyCalldata(period: Period, entries: ReadonlyArray<MonthlyEntry>, signature: Hex): Hex {
  const signed = attestation(signature, "Invalid attestation");
  allocationRoot(entries);
  return encodeFunctionData({ abi: escrowAbi, functionName: "commitMonthly", args: [Number(periodWord(period)), entries.map(tuple), signed] });
}

/** @throws {RangeError} */
export function sumNode(left: AllocationNode, right: AllocationNode): AllocationNode {
  const total = checked(left.total + right.total, U128_MAX, "Monthly amount exceeds chain range");
  return { hash: keccak256(`0x01${left.hash.slice(2)}${left.total.toString(16).padStart(32, "0")}${right.hash.slice(2)}${right.total.toString(16).padStart(32, "0")}`) as Bytes32, total };
}

/** @throws {RangeError} */
export function sumTree(entries: ReadonlyArray<MonthlyEntry>): SumTree {
  const sources = new Set<Bytes32>();
  const leaves = entries.map((entry): AllocationNode => {
    if (sources.has(entry.sourceDigest)) throw new RangeError("Repeated monthly source");
    sources.add(entry.sourceDigest);
    return { hash: monthlyLeaf(entry), total: entry.gross };
  });
  const levels = [leaves];
  for (let level = leaves; level.length > 1; levels.push(level)) {
    const below = level;
    level = Array.from({ length: Math.ceil(below.length / 2) }, (_, i) => (2 * i + 1 < below.length ? sumNode(below[2 * i], below[2 * i + 1]) : below[2 * i]));
  }
  const top = levels[levels.length - 1];
  const proofs = entries.map((_, initial) =>
    levels.slice(0, -1).flatMap((level, depth) => {
      const index = initial >> depth;
      const sibling = level[index % 2 === 1 ? index - 1 : index + 1];
      return sibling === undefined ? [] : [sibling];
    }),
  );
  return { root: top.length === 1 ? top[0] : EMPTY_SUM_ROOT, proofs };
}

/** @throws {never} */
export function provenRoot(entry: MonthlyEntry, index: number, count: number, proof: ReadonlyArray<AllocationNode>): AllocationNode | undefined {
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index < 0 || index >= count) return undefined;
  try {
    let node: AllocationNode = { hash: monthlyLeaf(entry), total: entry.gross };
    let [position, width, cursor] = [index, count, 0];
    while (width > 1) {
      if (position % 2 === 1 || position + 1 < width) {
        const sibling = proof[cursor++];
        if (sibling === undefined) return undefined;
        node = position % 2 === 1 ? sumNode(sibling, node) : sumNode(node, sibling);
      }
      position = Math.floor(position / 2);
      width = Math.ceil(width / 2);
    }
    return cursor === proof.length ? node : undefined;
  } catch {
    return undefined;
  }
}

/** @throws {RangeError} */
export function commitMonthlyLeafCalldata(period: Period, entry: MonthlyEntry, index: number, proof: ReadonlyArray<AllocationNode>): Hex {
  if (!Number.isSafeInteger(index) || index < 0 || BigInt(index) > U32_MAX) throw new RangeError("Invalid monthly index");
  checkedEntry(entry);
  return encodeFunctionData({
    abi: escrowAbi,
    functionName: "commitMonthlyLeaf",
    args: [Number(periodWord(period)), tuple(entry), index, proof.map((node) => ({ hash: node.hash, total: checked(node.total, U128_MAX, "Monthly amount exceeds chain range") }))],
  });
}

/** @throws {RangeError} */
export function checkedReservation(reservation: MonthlyReservation): MonthlyReservation {
  const { count, wholeGross, remainingGross, sourceSequence } = reservation;
  if (!Number.isSafeInteger(count) || count < 0 || BigInt(count) > U32_MAX) throw new RangeError("Invalid monthly version or count");
  checked(wholeGross, U128_MAX, "Monthly amount exceeds chain range");
  checked(remainingGross, U128_MAX, "Monthly amount exceeds chain range");
  checked(sourceSequence, U256_MAX, "Monthly amount exceeds chain range");
  if (isZero(reservation.allocationDigest) || isZero(reservation.allocationRoot) || wholeGross === 0n || remainingGross > wholeGross || (count === 0) !== (remainingGross === 0n)) throw new RangeError("Invalid monthly reservation");
  return reservation;
}

/** @throws {RangeError} */
export function monthlyReservation(input: { readonly allocationDigest: Bytes32; readonly entries: ReadonlyArray<MonthlyEntry>; readonly awards: ReadonlyArray<AwardState>; readonly sourceSequence: bigint }): { readonly reservation: MonthlyReservation; readonly remaining: ReadonlyArray<MonthlyEntry>; readonly tree: SumTree } {
  const { entries, awards } = input;
  if (awards.length !== entries.length) throw new RangeError("Every monthly source needs its award state");
  sumTree(entries);
  const wholeGross = entries.reduce((sum, entry) => checked(sum + entry.gross, U128_MAX, "Monthly amount exceeds chain range"), 0n);
  const remaining = entries.filter((_, index) => awards[index]?.actor === 0n);
  const tree = sumTree(remaining);
  const reservation = checkedReservation({ allocationDigest: input.allocationDigest, allocationRoot: tree.root.hash, wholeGross, remainingGross: tree.root.total, count: remaining.length, sourceSequence: input.sourceSequence });
  return { reservation, remaining, tree };
}

type ReserveField = "period" | "allocationDigest" | "allocationRoot" | "wholeGross" | "remainingGross" | "count" | "sourceSequence";

const RESERVE_FIELDS: ReadonlyArray<Field<ReserveField>> = [
  { name: "period", type: "uint32" },
  { name: "allocationDigest", type: "bytes32" },
  { name: "allocationRoot", type: "bytes32" },
  { name: "wholeGross", type: "uint128" },
  { name: "remainingGross", type: "uint128" },
  { name: "count", type: "uint32" },
  { name: "sourceSequence", type: "uint256" },
];

/** @throws {RangeError} */
export function reserveStruct(period: Period, reservation: MonthlyReservation): TypedStruct<"MonthlyReserveV2", ReserveField> {
  const r = checkedReservation(reservation);
  return {
    primaryType: "MonthlyReserveV2",
    fields: RESERVE_FIELDS,
    values: { period: periodWord(period), allocationDigest: r.allocationDigest, allocationRoot: r.allocationRoot, wholeGross: r.wholeGross, remainingGross: r.remainingGross, count: BigInt(r.count), sourceSequence: r.sourceSequence },
  };
}

/** @throws {RangeError} */
export function monthlyReserveDigest(domain: EscrowDomain, period: Period, reservation: MonthlyReservation): Bytes32 {
  return escrowDigest(domain, reserveStruct(period, reservation));
}

/** @throws {RangeError} */
export function reserveMonthlyCalldata(period: Period, reservation: MonthlyReservation, signature: Hex): Hex {
  const signed = attestation(signature, "Invalid monthly attestation");
  const r = checkedReservation(reservation);
  return encodeFunctionData({
    abi: escrowAbi,
    functionName: "reserveMonthly",
    args: [Number(periodWord(period)), { allocationDigest: r.allocationDigest, allocationRoot: r.allocationRoot, wholeGross: r.wholeGross, remainingGross: r.remainingGross, count: r.count, sourceSequence: r.sourceSequence }, signed],
  });
}

/** @throws {RangeError} */
export function monthlyRootCall(period: Period): Hex {
  return encodeFunctionData({ abi: escrowAbi, functionName: "monthlyRoots", args: [Number(periodWord(period))] });
}

/** @throws {RangeError} */
export function monthlyReserveCall(period: Period): Hex {
  return encodeFunctionData({ abi: escrowAbi, functionName: "monthlyReserves", args: [Number(periodWord(period))] });
}

/** @throws {never} */
export function decodeMonthlyReserve(answers: { readonly root: string; readonly reserve: string }): MonthlyReserveState | undefined {
  const root = decodeBytes32(answers.root);
  const words = answerWords(answers.reserve, 5);
  if (root === undefined || words === undefined) return undefined;
  const [total, remaining, count, admittedAt] = [wordUint(words[1], U128_MAX), wordUint(words[2], U128_MAX), wordUint(words[3], U32_MAX), wordUint(words[4], U64_MAX)];
  if (total === undefined || remaining === undefined || count === undefined || admittedAt === undefined) return undefined;
  return { root, allocationDigest: wordBytes32(words[0]), total, remaining, count: Number(count), admittedAt };
}

export interface ReleaseCapture {
  readonly allocationDigest: Bytes32;
  readonly entries: ReadonlyArray<MonthlyEntry>;
}

export type WrongSumHeld = "allocation-unavailable" | "allocation-mismatch" | "no-wrong-sum-fault" | "prior-reserve-transition";

export interface WrongSumEvidence {
  readonly status: "provably-unsettleable";
  readonly fault: "authenticated-sum-mismatch";
  readonly allocationDigest: Bytes32;
  readonly allocationRoot: Bytes32;
  readonly entriesSha256: string;
  readonly count: number;
  readonly computedTotal: bigint;
  readonly storedTotal: bigint;
  readonly expectedRemaining: bigint;
  readonly releasedGross: bigint;
}

export type WrongSumInspection = { readonly status: "held"; readonly reason: WrongSumHeld } | WrongSumEvidence;

/** @throws {never} */
export function entriesSha256(entries: ReadonlyArray<MonthlyEntry>): string {
  const canonical = JSON.stringify(entries.map((entry) => ({ githubUserId: entry.actor.toString(), grossMicro: entry.gross.toString(), sourceDigest: entry.sourceDigest })));
  return bytesToHex(sha256(new TextEncoder().encode(canonical))).slice(2);
}

/** @throws {RangeError} */
export function inspectWrongSum(capture: ReleaseCapture | undefined, month: MonthlyReserveState): WrongSumInspection {
  if (capture === undefined) return { status: "held", reason: "allocation-unavailable" };
  const tree = sumTree(capture.entries);
  if (month.allocationDigest !== capture.allocationDigest || month.root !== tree.root.hash || month.count !== capture.entries.length || month.count === 0) return { status: "held", reason: "allocation-mismatch" };
  if (month.total === tree.root.total) return { status: "held", reason: "no-wrong-sum-fault" };
  if (month.remaining !== month.total || month.remaining === 0n) return { status: "held", reason: "prior-reserve-transition" };
  return {
    status: "provably-unsettleable",
    fault: "authenticated-sum-mismatch",
    allocationDigest: capture.allocationDigest,
    allocationRoot: tree.root.hash,
    entriesSha256: entriesSha256(capture.entries),
    count: month.count,
    computedTotal: tree.root.total,
    storedTotal: month.total,
    expectedRemaining: month.remaining,
    releasedGross: month.remaining,
  };
}

type ReleaseField = "period" | "allocationDigest" | "allocationRoot" | "remainingGross" | "releasedGross";

const RELEASE_FIELDS: ReadonlyArray<Field<ReleaseField>> = [
  { name: "period", type: "uint32" },
  { name: "allocationDigest", type: "bytes32" },
  { name: "allocationRoot", type: "bytes32" },
  { name: "remainingGross", type: "uint128" },
  { name: "releasedGross", type: "uint128" },
];

export interface ReleaseTerms {
  readonly allocationDigest: Bytes32;
  readonly allocationRoot: Bytes32;
  readonly expectedRemaining: bigint;
  readonly releasedGross: bigint;
}

/** @throws {RangeError} */
export function monthlyReleaseDigest(domain: EscrowDomain, period: Period, terms: ReleaseTerms): Bytes32 {
  return escrowDigest(domain, releaseStruct(period, terms));
}

/** @throws {RangeError} */
export function releaseStruct(period: Period, terms: ReleaseTerms): TypedStruct<"MonthlyRelease", ReleaseField> {
  return {
    primaryType: "MonthlyRelease",
    fields: RELEASE_FIELDS,
    values: {
      period: periodWord(period),
      allocationDigest: terms.allocationDigest,
      allocationRoot: terms.allocationRoot,
      remainingGross: checked(terms.expectedRemaining, U128_MAX, "Monthly amount exceeds chain range"),
      releasedGross: checked(terms.releasedGross, U128_MAX, "Monthly amount exceeds chain range"),
    },
  };
}

/** @throws {RangeError} */
export function releaseMonthlyReserveCalldata(period: Period, terms: Pick<ReleaseTerms, "expectedRemaining" | "releasedGross">, signature: Hex): Hex {
  const signed = attestation(signature, "Invalid monthly release attestation");
  return encodeFunctionData({
    abi: escrowAbi,
    functionName: "releaseMonthlyReserve",
    args: [Number(periodWord(period)), checked(terms.expectedRemaining, U128_MAX, "Monthly amount exceeds chain range"), checked(terms.releasedGross, U128_MAX, "Monthly amount exceeds chain range"), signed],
  });
}


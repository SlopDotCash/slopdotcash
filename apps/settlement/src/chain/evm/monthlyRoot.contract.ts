// spec/settlement/escrow.md, "On EVM a legacy V1 root commits every leaf at once and counts an identical existing award once"; spec/settlement/escrow.md, "A proven leaf reclassifies pool gross into one award without debiting free funds"
import { Arbitrary, Schema } from "effect";
import { hashTypedData } from "viem";
import { contract } from "vibestack/testing";
import { type Period, isPeriod } from "../../kernels/calendar.ts";
import { type Bytes32, type EvmAddress, type Hex, U64_MAX, U128_MAX, U256_MAX } from "./abi.ts";
import { adapterVectors } from "../../../test/fixtures/adapterVectors.ts";
import { type MonthlyEntry, type MonthlyReservation, EMPTY_SUM_ROOT, allocationRoot, commitMonthlyCalldata, commitMonthlyLeafCalldata, monthlyDigest, monthlyReleaseDigest, monthlyReserveDigest, provenRoot, reserveMonthlyCalldata, reserveStruct, sumTree } from "./monthlyRoot.ts";
import { ESCROW_DOMAIN_NAME, ESCROW_DOMAIN_VERSION } from "./typedData.ts";

const vault = adapterVectors.vault as EvmAddress;
const signature = adapterVectors.signature as Hex;
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}` as Bytes32;
const between = (minimum: bigint, maximum: bigint) => Schema.BigInt.check(Schema.isBetweenBigInt({ minimum, maximum }));

const period = (value: number): Period => {
  if (!isPeriod(value)) throw new RangeError(`${value} is not a period`);
  return value;
};

const entriesOf = (entries: ReadonlyArray<{ readonly actor: string; readonly gross: string; readonly sourceDigest: string }>): ReadonlyArray<MonthlyEntry> =>
  entries.map((entry) => ({ actor: BigInt(entry.actor), gross: BigInt(entry.gross), sourceDigest: entry.sourceDigest as Bytes32 }));

const reservationOf = (recorded: (typeof adapterVectors.reservations)[number]["reservation"]): MonthlyReservation => ({
  allocationDigest: recorded.allocationDigest as Bytes32,
  allocationRoot: recorded.allocationRoot as Bytes32,
  wholeGross: BigInt(recorded.wholeGross),
  remainingGross: BigInt(recorded.remainingGross),
  count: recorded.count,
  sourceSequence: BigInt(recorded.sourceSequence),
});

const november = period(202611);
const base = { chainId: 8453n, vault };

const monthBytes = (month: (typeof adapterVectors.months)[number]) => {
  const entries = entriesOf(month.entries);
  const tree = sumTree(entries);
  const root = allocationRoot(entries);
  return {
    v1Root: root,
    v1Digest: monthlyDigest(base, november, root),
    v1Calldata: commitMonthlyCalldata(november, entries, signature),
    sumRoot: tree.root.hash,
    sumTotal: tree.root.total.toString(),
    proofs: tree.proofs.map((proof) => proof.map((node) => ({ hash: node.hash, total: node.total.toString() }))),
    leafCalldata: entries.map((entry, index) => commitMonthlyLeafCalldata(november, entry, index, tree.proofs[index] ?? [])),
  };
};

export const monthlyBytesMatchTheDeployedAdapter = contract({
  input: Arbitrary.Constant(adapterVectors),
  run: (vectors) => ({
    months: vectors.months.map(monthBytes),
    reservations: vectors.reservations.map((recorded) => ({
      digest: monthlyReserveDigest({ chainId: BigInt(recorded.chainId), vault }, period(recorded.period), reservationOf(recorded.reservation)),
      calldata: recorded.calldata === null ? null : reserveMonthlyCalldata(period(recorded.period), reservationOf(recorded.reservation), signature),
    })),
    release: monthlyReleaseDigest({ chainId: BigInt(vectors.release.chainId), vault }, period(vectors.release.period), {
      allocationDigest: vectors.release.allocationDigest as Bytes32,
      allocationRoot: vectors.release.allocationRoot as Bytes32,
      expectedRemaining: BigInt(vectors.release.expectedRemaining),
      releasedGross: BigInt(vectors.release.releasedGross),
    }),
    empty: sumTree([]).root,
  }),
  invariant: (vectors, bytes) =>
    JSON.stringify(bytes.months) === JSON.stringify(vectors.months.map(({ entries: _entries, ...recorded }) => recorded))
    && JSON.stringify(bytes.reservations) === JSON.stringify(vectors.reservations.map(({ digest, calldata }) => ({ digest, calldata })))
    && bytes.release === vectors.release.digest
    && bytes.empty.hash === vectors.emptySumRoot && bytes.empty.total === 0n && EMPTY_SUM_ROOT.hash === vectors.emptySumRoot,
});

const allocation = Schema.Struct({
  seed: between(1n, U256_MAX - 64n),
  awards: Schema.Array(Schema.Struct({ actor: between(1n, U64_MAX), gross: between(1n, 1n << 100n) })).check(Schema.isMinLength(1), Schema.isMaxLength(17)),
});

const entriesFrom = (value: typeof allocation.Type): ReadonlyArray<MonthlyEntry> => value.awards.map((award, index) => ({ actor: award.actor, gross: award.gross, sourceDigest: word(value.seed + BigInt(index)) }));

export const everySumProofRebuildsItsRoot = contract({
  input: allocation,
  run: (value) => {
    const entries = entriesFrom(value);
    return { entries, tree: sumTree(entries) };
  },
  invariant: (_value, { entries, tree }) =>
    tree.root.total === entries.reduce((sum, entry) => sum + entry.gross, 0n)
    && entries.every((entry, index) => {
      const proof = tree.proofs[index] ?? [];
      const proven = provenRoot(entry, index, entries.length, proof);
      const shortened = proof.length === 0 ? undefined : provenRoot(entry, index, entries.length, proof.slice(1));
      const inflated = provenRoot({ ...entry, gross: entry.gross + 1n }, index, entries.length, proof);
      return proven?.hash === tree.root.hash && proven.total === tree.root.total && shortened?.hash !== tree.root.hash && inflated?.hash !== tree.root.hash;
    }),
});

const reserveCase = Schema.Struct({
  chainId: between(1n, U64_MAX),
  period: Schema.Int.check(Schema.isBetween({ minimum: 2000, maximum: 9999 })),
  month: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
  digest: between(1n, U256_MAX),
  root: between(1n, U256_MAX),
  wholeGross: between(1n, U128_MAX),
  remaining: between(0n, U128_MAX),
  count: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 0xffff_ffff })),
  sourceSequence: between(0n, U256_MAX),
});

export const monthlyDigestsAreTheEip712Hashes = contract({
  input: reserveCase,
  run: (value) => {
    const domain = { chainId: value.chainId, vault };
    const month = period(value.period * 100 + value.month);
    const remainingGross = value.remaining % value.wholeGross + 1n;
    const reservation: MonthlyReservation = { allocationDigest: word(value.digest), allocationRoot: word(value.root), wholeGross: value.wholeGross, remainingGross, count: value.count, sourceSequence: value.sourceSequence };
    const terms = { allocationDigest: reservation.allocationDigest, allocationRoot: reservation.allocationRoot, expectedRemaining: remainingGross, releasedGross: remainingGross };
    return { domain, month, reservation, terms, reserve: monthlyReserveDigest(domain, month, reservation), release: monthlyReleaseDigest(domain, month, terms), v1: monthlyDigest(domain, month, reservation.allocationRoot) };
  },
  invariant: (_value, { domain, month, reservation, terms, reserve, release, v1 }) => {
    const eip712 = { name: ESCROW_DOMAIN_NAME, version: ESCROW_DOMAIN_VERSION, chainId: domain.chainId, verifyingContract: domain.vault };
    const struct = reserveStruct(month, reservation);
    return reserve === hashTypedData({ domain: eip712, types: { MonthlyReserveV2: struct.fields.map((field) => ({ ...field })) }, primaryType: "MonthlyReserveV2", message: struct.values })
      && release === hashTypedData({
        domain: eip712,
        types: { MonthlyRelease: [{ name: "period", type: "uint32" }, { name: "allocationDigest", type: "bytes32" }, { name: "allocationRoot", type: "bytes32" }, { name: "remainingGross", type: "uint128" }, { name: "releasedGross", type: "uint128" }] },
        primaryType: "MonthlyRelease",
        message: { period: month, allocationDigest: terms.allocationDigest, allocationRoot: terms.allocationRoot, remainingGross: terms.expectedRemaining, releasedGross: terms.releasedGross },
      })
      && v1 === hashTypedData({ domain: eip712, types: { MonthlyAllocation: [{ name: "period", type: "uint32" }, { name: "allocationRoot", type: "bytes32" }] }, primaryType: "MonthlyAllocation", message: { period: month, allocationRoot: reservation.allocationRoot } });
  },
});

/** Bounded ordinary monthly admission and leaves. All amounts are token base units. */
import {
  encodeFunctionData,
  encodePacked,
  hashTypedData,
  keccak256,
  parseAbi,
  recoverAddress,
} from "viem";
import { sha256Hex } from "../../src/lib/sha256";
import {
  EVM_ESCROW_DOMAIN_VERSION,
  type EvmEscrowConfig,
  EvmRpcError,
  evmAwardId,
  evmRpc,
  type MonthlyAllocationEntry,
  verifyEvmDeployment,
} from "./adapter";

type Hex = `0x${string}`;
const MAX = (1n << 128n) - 1n;
const ZERO = `0x${"0".repeat(64)}`;
const ABI = parseAbi([
  "function identityAuthority() view returns (address)",
  "function monthlyReserveVersion() view returns (uint8)",
  "function ordinarySourceSequence() view returns (uint256)",
  "function awards(bytes32) view returns (uint64,uint128,uint128,bytes32,uint64,bool)",
  "function monthlyRoots(uint32) view returns (bytes32)",
  "function monthlyReserves(uint32) view returns (bytes32,uint128,uint128,uint32,uint64)",
  "function reserveMonthly(uint32,(bytes32 allocationDigest,bytes32 allocationRoot,uint128 wholeGross,uint128 remainingGross,uint32 count,uint256 sourceSequence),bytes)",
  "function commitMonthlyLeaf(uint32,(uint64 actorId,uint128 gross,bytes32 sourceDigest),uint32,(bytes32 hash,uint128 total)[])",
  "function releaseMonthlyReserve(uint32,uint128,uint128,bytes)",
]);
const TYPES = {
  MonthlyReserveV2: [
    { name: "period", type: "uint32" },
    { name: "allocationDigest", type: "bytes32" },
    { name: "allocationRoot", type: "bytes32" },
    { name: "wholeGross", type: "uint128" },
    { name: "remainingGross", type: "uint128" },
    { name: "count", type: "uint32" },
    { name: "sourceSequence", type: "uint256" },
  ],
} as const;

export interface EvmMonthlyReservation {
  version: 2;
  /** The unchanged frozen economic allocation, including previously funded awards. */
  allocationDigest: string;
  /** Only the currently unfunded entries, in order. */
  allocationRoot: string;
  wholeGross: string;
  remainingGross: string;
  count: number;
  sourceSequence: string;
}
export interface EvmAllocationNode {
  hash: Hex;
  total: bigint;
}
/** An admitted period never receives a successor execution authorization. */
export class EvmMonthlyAlreadyAdmitted extends Error {
  constructor() {
    super("The monthly root is already admitted");
  }
}
function periodNumber(period: string) {
  if (!/^[2-9][0-9]{3}-(0[1-9]|1[0-2])$/.test(period))
    throw new Error("Invalid monthly period");
  return Number(period.replace("-", ""));
}
function bytes32(value: string): Hex {
  if (!/^0x[0-9a-f]{64}$/i.test(value))
    throw new Error("Invalid monthly digest");
  return value.toLowerCase() as Hex;
}
function uint(value: string | bigint, max = MAX) {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value)))
    throw new Error("Invalid monthly amount");
  const n = BigInt(value);
  if (n > max) throw new Error("Monthly amount exceeds chain range");
  return n;
}
function entryTuple(entry: MonthlyAllocationEntry) {
  const actorId = uint(entry.githubUserId, (1n << 64n) - 1n);
  const gross = uint(entry.grossMicro);
  const sourceDigest = bytes32(entry.sourceDigest);
  if (!actorId || !gross || sourceDigest === ZERO)
    throw new Error("Invalid monthly award");
  return { actorId, gross, sourceDigest };
}
function parent(
  left: EvmAllocationNode,
  right: EvmAllocationNode,
): EvmAllocationNode {
  const total = uint(left.total + right.total);
  return {
    hash: keccak256(
      encodePacked(
        ["uint8", "bytes32", "uint128", "bytes32", "uint128"],
        [1, left.hash, left.total, right.hash, right.total],
      ),
    ),
    total,
  };
}
/** Uses the existing ordered/odd-node promotion rules, with authenticated subtree sums. */
export function evmMonthlySumTree(entries: readonly MonthlyAllocationEntry[]) {
  const sources = new Set<string>();
  let nodes = entries.map((entry) => {
    const { actorId, gross, sourceDigest } = entryTuple(entry);
    if (sources.has(sourceDigest)) throw new Error("Repeated monthly source");
    sources.add(sourceDigest);
    return {
      hash: keccak256(
        encodePacked(
          ["uint8", "uint64", "uint128", "bytes32"],
          [0, actorId, gross, sourceDigest],
        ),
      ),
      total: gross,
    };
  });
  const levels = [nodes];
  while (nodes.length > 1) {
    const next: EvmAllocationNode[] = [];
    for (let i = 0; i < nodes.length; i += 2)
      next.push(
        i + 1 < nodes.length ? parent(nodes[i], nodes[i + 1]) : nodes[i],
      );
    levels.push(next);
    nodes = next;
  }
  // An all-funded month still seals its period once, without taking another reserve.
  const root = nodes[0] ?? { hash: keccak256("0x02"), total: 0n };
  return {
    ...root,
    proofs: entries.map((_, initial) => {
      let index = initial;
      const proof: EvmAllocationNode[] = [];
      for (const level of levels.slice(0, -1)) {
        const sibling = index % 2 ? index - 1 : index + 1;
        if (sibling < level.length) proof.push(level[sibling]);
        index = Math.floor(index / 2);
      }
      return proof;
    }),
  };
}
function reservationTuple(reservation: EvmMonthlyReservation) {
  if (
    reservation.version !== 2 ||
    !Number.isSafeInteger(reservation.count) ||
    reservation.count < 0 ||
    reservation.count > 0xffffffff
  )
    throw new Error("Invalid monthly version or count");
  const r = {
    allocationDigest: bytes32(reservation.allocationDigest),
    allocationRoot: bytes32(reservation.allocationRoot),
    wholeGross: uint(reservation.wholeGross),
    remainingGross: uint(reservation.remainingGross),
    count: reservation.count,
    sourceSequence: uint(reservation.sourceSequence, (1n << 256n) - 1n),
  };
  if (
    r.allocationDigest === ZERO ||
    r.allocationRoot === ZERO ||
    !r.wholeGross ||
    r.remainingGross > r.wholeGross ||
    (r.count === 0) !== (r.remainingGross === 0n)
  )
    throw new Error("Invalid monthly reservation");
  return r;
}
export function evmMonthlyReserveDigest(
  chainId: bigint,
  vault: string,
  period: string,
  reservation: EvmMonthlyReservation,
) {
  return hashTypedData({
    domain: {
      name: "SlopProjectEscrow",
      version: EVM_ESCROW_DOMAIN_VERSION,
      chainId,
      verifyingContract: vault as Hex,
    },
    types: TYPES,
    primaryType: "MonthlyReserveV2",
    message: { period: periodNumber(period), ...reservationTuple(reservation) },
  });
}
export function buildReserveMonthlyCalldata(
  period: string,
  reservation: EvmMonthlyReservation,
  attestation: string,
) {
  if (!/^0x[0-9a-f]{130}$/i.test(attestation))
    throw new Error("Invalid monthly attestation");
  return encodeFunctionData({
    abi: ABI,
    functionName: "reserveMonthly",
    args: [
      periodNumber(period),
      reservationTuple(reservation),
      attestation as Hex,
    ],
  });
}
export function buildCommitMonthlyLeafCalldata(
  period: string,
  entry: MonthlyAllocationEntry,
  index: number,
  proof: readonly EvmAllocationNode[],
) {
  if (!Number.isSafeInteger(index) || index < 0 || index > 0xffffffff)
    throw new Error("Invalid monthly index");
  return encodeFunctionData({
    abi: ABI,
    functionName: "commitMonthlyLeaf",
    args: [
      periodNumber(period),
      entryTuple(entry),
      index,
      proof.map((node) => ({
        hash: bytes32(node.hash),
        total: uint(node.total),
      })),
    ],
  });
}
async function words(
  config: EvmEscrowConfig,
  data: Hex,
  count: number,
  block: string,
) {
  const result = await evmRpc(config, "eth_call", [
    { to: config.vault, data },
    block,
  ]);
  if (
    typeof result !== "string" ||
    !new RegExp(`^0x[0-9a-f]{${64 * count}}$`, "i").test(result)
  )
    throw new Error("Malformed monthly chain state");
  return Array.from(
    { length: count },
    (_, i) => `0x${result.slice(2 + 64 * i, 66 + 64 * i).toLowerCase()}`,
  );
}
export async function readEvmMonthlyReserve(
  config: EvmEscrowConfig,
  period: string,
  block = "finalized",
) {
  const [root] = await words(
    config,
    encodeFunctionData({
      abi: ABI,
      functionName: "monthlyRoots",
      args: [periodNumber(period)],
    }),
    1,
    block,
  );
  const [allocationDigest, total, remaining, count, admittedAt] = await words(
    config,
    encodeFunctionData({
      abi: ABI,
      functionName: "monthlyReserves",
      args: [periodNumber(period)],
    }),
    5,
    block,
  );
  return {
    root,
    allocationDigest,
    total: BigInt(total),
    remaining: BigInt(remaining),
    count: Number(BigInt(count)),
    admittedAt: BigInt(admittedAt),
  };
}

/** A retained admission's complete ordered tree, not a collection of failed proofs. */
export interface EvmMonthlyReleaseCapture {
  allocationDigest: string;
  entries: readonly MonthlyAllocationEntry[];
}

/** Read-only evidence for one positively provable fault. This neither signs nor builds a release.
 * Missing data and all other fault classes stay held. In particular, a lost local tree says nothing
 * about a contributor's retained proof. The caller must use the reviewed deployment configuration. */
export async function inspectEvmMonthlyWrongSum(
  config: EvmEscrowConfig,
  period: string,
  capture: EvmMonthlyReleaseCapture | null,
) {
  periodNumber(period);
  if (!capture)
    return { status: "held", reason: "allocation-unavailable" } as const;
  const allocationDigest = bytes32(capture.allocationDigest);
  const entries = capture.entries.map(
    ({ githubUserId, grossMicro, sourceDigest }) => ({
      githubUserId,
      grossMicro,
      sourceDigest,
    }),
  );
  // Reuse settlement's canonical ordering, odd-node promotion, range and source checks. Invalid
  // captures throw: they cannot supply positive evidence for an authority signature.
  const tree = evmMonthlySumTree(entries);
  const finalized = (await evmRpc(config, "eth_getBlockByNumber", [
    "finalized",
    false,
  ])) as { number?: string; hash?: string } | null;
  if (
    !finalized?.number ||
    !/^0x[0-9a-f]+$/i.test(finalized.number) ||
    !finalized.hash ||
    !/^0x[0-9a-f]{64}$/i.test(finalized.hash)
  )
    throw new Error("Finalized block unavailable");
  const block = finalized.number;
  await verifyEvmDeployment(config, block);
  const [version] = await words(
    config,
    encodeFunctionData({ abi: ABI, functionName: "monthlyReserveVersion" }),
    1,
    block,
  );
  if (BigInt(version) !== 2n)
    throw new Error("Unreviewed monthly reserve version");
  const month = await readEvmMonthlyReserve(config, period, block);
  if (
    month.allocationDigest !== allocationDigest ||
    month.root !== tree.hash ||
    month.count !== entries.length ||
    month.count === 0
  )
    return { status: "held", reason: "allocation-mismatch" } as const;
  if (month.total === tree.total)
    return { status: "held", reason: "no-wrong-sum-fault" } as const;
  if (month.remaining !== month.total || month.remaining === 0n)
    return { status: "held", reason: "prior-reserve-transition" } as const;
  uint(month.total);
  const authority = await evmRpc(config, "eth_call", [
    {
      to: config.factory,
      data: encodeFunctionData({ abi: ABI, functionName: "identityAuthority" }),
    },
    block,
  ]);
  if (
    typeof authority !== "string" ||
    !/^0x0{24}[0-9a-f]{40}$/i.test(authority)
  )
    throw new Error("Malformed current identity authority");
  const canonical = (await evmRpc(config, "eth_getBlockByNumber", [
    block,
    false,
  ])) as { number?: string; hash?: string } | null;
  if (canonical?.number !== block || canonical.hash !== finalized.hash)
    throw new Error("Finalized monthly evidence changed");
  return {
    status: "provably-unsettleable" as const,
    fault: "authenticated-sum-mismatch" as const,
    chainId: config.chainId.toString(),
    vault: config.vault.toLowerCase(),
    factory: config.factory.toLowerCase(),
    owner: config.owner.toLowerCase(),
    asset: config.asset.toLowerCase(),
    identityAuthority: `0x${authority.slice(-40).toLowerCase()}`,
    codeSha256: config.codeSha256,
    factoryCodeSha256: config.factoryCodeSha256,
    implementationReview: config.evmUpgrade ?? null,
    period,
    blockNumber: BigInt(block).toString(),
    blockHash: finalized.hash.toLowerCase(),
    allocationDigest,
    allocationRoot: tree.hash,
    entriesSha256: sha256Hex(JSON.stringify(entries)),
    count: month.count,
    computedTotal: tree.total.toString(),
    storedTotal: month.total.toString(),
    expectedRemaining: month.remaining.toString(),
    releasedGross: month.remaining.toString(),
  };
}

export type EvmWrongSumEvidence = Extract<
  Awaited<ReturnType<typeof inspectEvmMonthlyWrongSum>>,
  { status: "provably-unsettleable" }
>;
/** One contract domain for the attester, owner review and unsigned builder. */
export function evmMonthlyReleaseDigest(evidence: EvmWrongSumEvidence) {
  return hashTypedData({
    domain: {
      name: "SlopProjectEscrow",
      version: EVM_ESCROW_DOMAIN_VERSION,
      chainId: BigInt(evidence.chainId),
      verifyingContract: evidence.vault as Hex,
    },
    types: {
      MonthlyRelease: [
        { name: "period", type: "uint32" },
        { name: "allocationDigest", type: "bytes32" },
        { name: "allocationRoot", type: "bytes32" },
        { name: "remainingGross", type: "uint128" },
        { name: "releasedGross", type: "uint128" },
      ],
    },
    primaryType: "MonthlyRelease",
    message: {
      period: periodNumber(evidence.period),
      allocationDigest: bytes32(evidence.allocationDigest),
      allocationRoot: bytes32(evidence.allocationRoot),
      remainingGross: BigInt(evidence.expectedRemaining),
      releasedGross: BigInt(evidence.releasedGross),
    },
  });
}

/** Owner-only unsigned plan. Reinspect the complete tree; never accept a caller's claimed
 * fault or release amount. The caller supplies an attestation, not a signing key. */
export async function prepareEvmMonthlyWrongSumRelease(
  config: EvmEscrowConfig,
  period: string,
  capture: EvmMonthlyReleaseCapture | null,
  attestation: string,
) {
  const evidence = await inspectEvmMonthlyWrongSum(config, period, capture);
  if (evidence.status !== "provably-unsettleable")
    throw new Error(`Monthly release held: ${evidence.reason}`);
  if (!/^0x[0-9a-f]{130}$/i.test(attestation))
    throw new Error("Invalid monthly release attestation");
  const digest = evmMonthlyReleaseDigest(evidence);
  if (
    (
      await recoverAddress({ hash: digest, signature: attestation as Hex })
    ).toLowerCase() !== evidence.identityAuthority
  )
    throw new Error("Monthly release authority mismatch");
  const transaction = {
    from: evidence.owner,
    to: evidence.vault,
    value: "0x0",
    data: encodeFunctionData({
      abi: ABI,
      functionName: "releaseMonthlyReserve",
      args: [
        periodNumber(period),
        BigInt(evidence.expectedRemaining),
        BigInt(evidence.releasedGross),
        attestation as Hex,
      ],
    }),
  };
  // A later upgrade, rotation or reserve transition must not yield a stale owner request.
  // The transaction repeats the authority and remaining-reserve checks when mined.
  await verifyEvmDeployment(config, "latest");
  if ((await evmRpc(config, "eth_call", [transaction, "latest"])) !== "0x")
    throw new Error("Monthly release simulation returned unexpected data");
  return { evidence, chainId: config.chainId.toString(), transaction };
}
/** Current-code verification and every source read use the same finalized block. A missing legacy
 * method is the sole fallback; an unavailable provider or mismatched review cannot authorize anything. */
export async function prepareEvmMonthlyReservation(
  config: EvmEscrowConfig,
  period: string,
  allocationDigest: string,
  entries: readonly MonthlyAllocationEntry[],
) {
  periodNumber(period);
  const finalized = (await evmRpc(config, "eth_getBlockByNumber", [
    "finalized",
    false,
  ])) as { number?: string } | null;
  if (!finalized?.number || !/^0x[0-9a-f]+$/i.test(finalized.number))
    throw new Error("Finalized block unavailable");
  const block = finalized.number;
  await verifyEvmDeployment(config, block);
  try {
    const [version] = await words(
      config,
      encodeFunctionData({ abi: ABI, functionName: "monthlyReserveVersion" }),
      1,
      block,
    );
    if (BigInt(version) !== 2n)
      throw new Error("Unreviewed monthly reserve version");
  } catch (error) {
    if (error instanceof EvmRpcError && error.emptyRevert) return null;
    throw error;
  }
  const [admitted] = await words(
    config,
    encodeFunctionData({
      abi: ABI,
      functionName: "monthlyRoots",
      args: [periodNumber(period)],
    }),
    1,
    block,
  );
  if (admitted !== ZERO) throw new EvmMonthlyAlreadyAdmitted();
  const [sequence] = await words(
    config,
    encodeFunctionData({ abi: ABI, functionName: "ordinarySourceSequence" }),
    1,
    block,
  );
  const remaining: MonthlyAllocationEntry[] = [];
  let wholeGross = 0n;
  evmMonthlySumTree(entries); // Includes unique source and chain-range checks, before any signature.
  for (const entry of entries) {
    wholeGross = uint(wholeGross + uint(entry.grossMicro));
    const id = evmAwardId(
      config.chainId,
      config.vault,
      entry.sourceDigest,
    ) as Hex;
    const state = await words(
      config,
      encodeFunctionData({ abi: ABI, functionName: "awards", args: [id] }),
      6,
      block,
    );
    // Exact funded awards stay untouched. A conflicting source cannot create this award; the existing
    // monthly owner view keeps its conflict. Neither case consumes another reserve (#1193).
    if (BigInt(state[0]) === 0n) remaining.push(entry);
  }
  const tree = evmMonthlySumTree(remaining);
  const reservation: EvmMonthlyReservation = {
    version: 2,
    allocationDigest: bytes32(allocationDigest),
    allocationRoot: tree.hash,
    wholeGross: wholeGross.toString(),
    remainingGross: tree.total.toString(),
    count: remaining.length,
    sourceSequence: BigInt(sequence).toString(),
  };
  reservationTuple(reservation);
  return { reservation, entries: remaining };
}

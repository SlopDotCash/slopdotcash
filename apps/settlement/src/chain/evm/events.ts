// spec/settlement/escrow.md, "Events apply once, in canonical block and event order"; spec/settlement/escrow.md, "On EVM a legacy V1 root commits every leaf at once and counts an identical existing award once"; spec/settlement/escrow.md, "A proven leaf reclassifies pool gross into one award without debiting free funds"; spec/settlement/bindingAuthority.md, "Only the current authority binds, for the current version and before expiry, with the wallet's own signature"
import { toEventSelector } from "viem";
import { type Bytes32, type EvmAddress, type Hex, U8_MAX, U32_MAX, U64_MAX, U128_MAX, U256_MAX, bytes32, evmAddress, isZero, wordAddress, wordBool, wordBytes32, wordUint } from "./abi.ts";

export interface EscrowLog {
  readonly address: string;
  readonly topics: ReadonlyArray<Hex>;
  readonly data: Hex;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly transactionHash: Hex;
  readonly logIndex: number;
  readonly removed: boolean;
}

export interface LogPosition {
  readonly block: bigint;
  readonly blockHash: Bytes32;
  readonly transaction: Bytes32;
  readonly index: number;
}

export type EscrowEvent =
  | { readonly name: "Deposited"; readonly depositor: EvmAddress; readonly amount: bigint }
  | { readonly name: "AwardCommitted"; readonly id: Bytes32; readonly actor: bigint; readonly gross: bigint; readonly fee: bigint; readonly sourceDigest: Bytes32 }
  | { readonly name: "DestinationBound"; readonly actor: bigint; readonly destination: EvmAddress; readonly version: bigint; readonly claimDigest: Bytes32; readonly activatesAt: bigint }
  | { readonly name: "BindingCancelled"; readonly actor: bigint; readonly version: bigint }
  | { readonly name: "FeesClaimed"; readonly recipient: EvmAddress; readonly amount: bigint }
  | { readonly name: "Paid"; readonly id: Bytes32; readonly actor: bigint; readonly destination: EvmAddress; readonly version: bigint; readonly gross: bigint; readonly net: bigint; readonly fee: bigint }
  | { readonly name: "UnusedWithdrawn"; readonly destination: EvmAddress; readonly gross: bigint; readonly net: bigint; readonly fee: bigint }
  | { readonly name: "MonthlyCommitmentSet"; readonly cap: bigint; readonly enabled: boolean }
  | { readonly name: "MonthlyCommitted"; readonly period: number; readonly allocationRoot: Bytes32; readonly gross: bigint; readonly awards: bigint }
  | { readonly name: "MonthlyReserved"; readonly period: number; readonly allocationDigest: Bytes32; readonly allocationRoot: Bytes32; readonly wholeGross: bigint; readonly remainingGross: bigint; readonly count: number; readonly sourceSequence: bigint }
  | { readonly name: "MonthlyReserveReleased"; readonly period: number; readonly allocationDigest: Bytes32; readonly remainingGross: bigint; readonly releasedGross: bigint }
  | { readonly name: "Upgraded"; readonly implementation: EvmAddress }
  | { readonly name: "VaultCreated"; readonly projectId: Bytes32; readonly token: EvmAddress; readonly vault: EvmAddress; readonly owner: EvmAddress; readonly purpose: 0 | 1; readonly decimals: number }
  | { readonly name: "IdentityAuthorityRotationProposed"; readonly current: EvmAddress; readonly proposed: EvmAddress; readonly effectiveAt: bigint }
  | { readonly name: "IdentityAuthorityRotationCancelled"; readonly proposed: EvmAddress }
  | { readonly name: "IdentityAuthorityRotated"; readonly previous: EvmAddress; readonly current: EvmAddress };

export type EventName = EscrowEvent["name"];

export type Malformation = "Removed" | "ForeignAddress" | "BadPosition" | "RepeatedPosition" | "WrongShape" | "OutOfRange" | "InvalidValues";

export type DecodedLog =
  | { readonly kind: "event"; readonly at: LogPosition; readonly event: EscrowEvent }
  | { readonly kind: "unrecognized"; readonly at: LogPosition; readonly topic: Hex | undefined }
  | { readonly kind: "malformed"; readonly at: LogPosition; readonly topic: Hex | undefined; readonly reason: Malformation };

class Rejected {
  constructor(readonly reason: Malformation) {}
}

interface Words {
  address(): EvmAddress;
  uint(maximum: bigint): bigint;
  small(maximum: bigint): number;
  bytes32(): Bytes32;
  bool(): boolean;
}

function words(list: ReadonlyArray<string>): Words {
  let next = 0;
  const take = () => list[next++] ?? "";
  const present = <A>(value: A | undefined): A => {
    if (value === undefined) throw new Rejected("OutOfRange");
    return value;
  };
  return {
    address: () => present(wordAddress(take())),
    uint: (maximum) => present(wordUint(take(), maximum)),
    small: (maximum) => Number(present(wordUint(take(), maximum))),
    bytes32: () => wordBytes32(take()),
    bool: () => present(wordBool(take())),
  };
}

interface Layout {
  readonly signature: string;
  readonly indexed: number;
  readonly data: number;
  readonly read: (topics: Words, data: Words) => EscrowEvent;
  readonly valid: (event: EscrowEvent) => boolean;
}

const always = () => true;
const positive = (...values: ReadonlyArray<bigint>) => values.every((value) => value > 0n);
const purposeOf = (value: number): 0 | 1 => {
  if (value !== 0 && value !== 1) throw new Rejected("OutOfRange");
  return value;
};

const layouts: ReadonlyArray<Layout> = [
  { signature: "Deposited(address,uint128)", indexed: 1, data: 1, read: (t, d) => ({ name: "Deposited", depositor: t.address(), amount: d.uint(U128_MAX) }), valid: (e) => e.name === "Deposited" && positive(e.amount) },
  {
    signature: "AwardCommitted(bytes32,uint64,uint128,uint128,bytes32)", indexed: 2, data: 3,
    read: (t, d) => ({ name: "AwardCommitted", id: t.bytes32(), actor: t.uint(U64_MAX), gross: d.uint(U128_MAX), fee: d.uint(U128_MAX), sourceDigest: d.bytes32() }),
    valid: (e) => e.name === "AwardCommitted" && positive(e.actor, e.gross) && e.fee <= e.gross && !isZero(e.sourceDigest),
  },
  {
    signature: "DestinationBound(uint64,address,uint64,bytes32,uint64)", indexed: 2, data: 3,
    read: (t, d) => ({ name: "DestinationBound", actor: t.uint(U64_MAX), destination: t.address(), version: d.uint(U64_MAX), claimDigest: d.bytes32(), activatesAt: d.uint(U64_MAX) }),
    valid: (e) => e.name === "DestinationBound" && positive(e.actor, e.version) && !isZero(e.destination) && !isZero(e.claimDigest),
  },
  { signature: "BindingCancelled(uint64,uint64)", indexed: 1, data: 1, read: (t, d) => ({ name: "BindingCancelled", actor: t.uint(U64_MAX), version: d.uint(U64_MAX) }), valid: (e) => e.name === "BindingCancelled" && positive(e.actor, e.version) },
  { signature: "FeesClaimed(address,uint128)", indexed: 1, data: 1, read: (t, d) => ({ name: "FeesClaimed", recipient: t.address(), amount: d.uint(U128_MAX) }), valid: always },
  {
    signature: "Paid(bytes32,uint64,address,uint64,uint128,uint128,uint128)", indexed: 3, data: 4,
    read: (t, d) => ({ name: "Paid", id: t.bytes32(), actor: t.uint(U64_MAX), destination: t.address(), version: d.uint(U64_MAX), gross: d.uint(U128_MAX), net: d.uint(U128_MAX), fee: d.uint(U128_MAX) }),
    valid: (e) => e.name === "Paid" && positive(e.actor, e.gross, e.version) && !isZero(e.destination) && e.net + e.fee === e.gross,
  },
  {
    signature: "UnusedWithdrawn(address,uint128,uint128,uint128)", indexed: 1, data: 3,
    read: (t, d) => ({ name: "UnusedWithdrawn", destination: t.address(), gross: d.uint(U128_MAX), net: d.uint(U128_MAX), fee: d.uint(U128_MAX) }),
    valid: (e) => e.name === "UnusedWithdrawn" && positive(e.gross) && e.net + e.fee === e.gross,
  },
  {
    signature: "MonthlyCommitmentSet(uint128,bool)", indexed: 0, data: 2,
    read: (_t, d) => ({ name: "MonthlyCommitmentSet", cap: d.uint(U128_MAX), enabled: d.bool() }),
    valid: (e) => e.name === "MonthlyCommitmentSet" && (!e.enabled || e.cap > 0n),
  },
  {
    signature: "MonthlyCommitted(uint32,bytes32,uint128,uint256)", indexed: 1, data: 3,
    read: (t, d) => ({ name: "MonthlyCommitted", period: t.small(U32_MAX), allocationRoot: d.bytes32(), gross: d.uint(U128_MAX), awards: d.uint(U256_MAX) }),
    valid: (e) => e.name === "MonthlyCommitted" && positive(e.awards) && !isZero(e.allocationRoot),
  },
  {
    signature: "MonthlyReserved(uint32,bytes32,bytes32,uint128,uint128,uint32,uint256)", indexed: 1, data: 6,
    read: (t, d) => ({ name: "MonthlyReserved", period: t.small(U32_MAX), allocationDigest: d.bytes32(), allocationRoot: d.bytes32(), wholeGross: d.uint(U128_MAX), remainingGross: d.uint(U128_MAX), count: d.small(U32_MAX), sourceSequence: d.uint(U256_MAX) }),
    valid: (e) => e.name === "MonthlyReserved" && !isZero(e.allocationDigest) && !isZero(e.allocationRoot) && positive(e.wholeGross) && e.remainingGross <= e.wholeGross && (e.count === 0) === (e.remainingGross === 0n),
  },
  {
    signature: "MonthlyReserveReleased(uint32,bytes32,uint128,uint128)", indexed: 1, data: 3,
    read: (t, d) => ({ name: "MonthlyReserveReleased", period: t.small(U32_MAX), allocationDigest: d.bytes32(), remainingGross: d.uint(U128_MAX), releasedGross: d.uint(U128_MAX) }),
    valid: (e) => e.name === "MonthlyReserveReleased" && positive(e.releasedGross) && e.releasedGross <= e.remainingGross,
  },
  { signature: "Upgraded(address)", indexed: 1, data: 0, read: (t) => ({ name: "Upgraded", implementation: t.address() }), valid: (e) => e.name === "Upgraded" && !isZero(e.implementation) },
  {
    signature: "VaultCreated(bytes32,address,address,address,uint8,uint8)", indexed: 3, data: 3,
    read: (t, d) => ({ name: "VaultCreated", projectId: t.bytes32(), token: t.address(), vault: t.address(), owner: d.address(), purpose: purposeOf(d.small(U8_MAX)), decimals: d.small(U8_MAX) }),
    valid: (e) => e.name === "VaultCreated" && !isZero(e.vault) && !isZero(e.owner),
  },
  {
    signature: "IdentityAuthorityRotationProposed(address,address,uint64)", indexed: 2, data: 1,
    read: (t, d) => ({ name: "IdentityAuthorityRotationProposed", current: t.address(), proposed: t.address(), effectiveAt: d.uint(U64_MAX) }),
    valid: (e) => e.name === "IdentityAuthorityRotationProposed" && !isZero(e.proposed),
  },
  { signature: "IdentityAuthorityRotationCancelled(address)", indexed: 1, data: 0, read: (t) => ({ name: "IdentityAuthorityRotationCancelled", proposed: t.address() }), valid: always },
  {
    signature: "IdentityAuthorityRotated(address,address)", indexed: 2, data: 0,
    read: (t) => ({ name: "IdentityAuthorityRotated", previous: t.address(), current: t.address() }),
    valid: (e) => e.name === "IdentityAuthorityRotated" && !isZero(e.current),
  },
];

const byTopic = new Map(layouts.map((layout) => [toEventSelector(layout.signature).toLowerCase(), layout] as const));

const nameOf = (signature: string) => signature.slice(0, signature.indexOf("(")) as EventName;

export const EVENT_TOPICS = Object.fromEntries(layouts.map((layout) => [nameOf(layout.signature), toEventSelector(layout.signature).toLowerCase() as Bytes32])) as Readonly<Record<EventName, Bytes32>>;

const DATA = /^0x(?:[0-9a-fA-F]{64})*$/u;

function positionOf(log: EscrowLog): LogPosition | undefined {
  const blockHash = bytes32(log.blockHash);
  const transaction = bytes32(log.transactionHash);
  if (blockHash === undefined || transaction === undefined || log.blockNumber < 0n || !Number.isSafeInteger(log.logIndex) || log.logIndex < 0) return undefined;
  return { block: log.blockNumber, blockHash, transaction, index: log.logIndex };
}

function decodeOne(source: EvmAddress, log: EscrowLog, at: LogPosition): DecodedLog {
  const topic = log.topics[0]?.toLowerCase() as Hex | undefined;
  const refuse = (reason: Malformation): DecodedLog => ({ kind: "malformed", at, topic, reason });
  if (log.removed) return refuse("Removed");
  if (evmAddress(log.address) !== source) return refuse("ForeignAddress");
  const layout = topic === undefined ? undefined : byTopic.get(topic);
  if (layout === undefined) return { kind: "unrecognized", at, topic };
  const topicWords = log.topics.slice(1).map((word) => bytes32(word)?.slice(2));
  if (topicWords.length !== layout.indexed || topicWords.some((word) => word === undefined) || !DATA.test(log.data) || log.data.length !== 2 + layout.data * 64) return refuse("WrongShape");
  const dataWords = Array.from({ length: layout.data }, (_, index) => log.data.slice(2 + index * 64, 66 + index * 64).toLowerCase());
  try {
    const event = layout.read(words(topicWords.map((word) => word ?? "")), words(dataWords));
    return layout.valid(event) ? { kind: "event", at, event } : refuse("InvalidValues");
  } catch (error) {
    if (error instanceof Rejected) return refuse(error.reason);
    throw error;
  }
}

const unpositioned: LogPosition = { block: -1n, blockHash: `0x${"0".repeat(64)}` as Bytes32, transaction: `0x${"0".repeat(64)}` as Bytes32, index: -1 };

const earlier = (left: LogPosition, right: LogPosition) => (left.block === right.block ? left.index - right.index : left.block < right.block ? -1 : 1);

/** @throws {never} */
export function decodeEscrowLogs(source: EvmAddress, logs: ReadonlyArray<EscrowLog>): ReadonlyArray<DecodedLog> {
  const positioned = logs.map((log) => ({ log, at: positionOf(log) }));
  const ordered = positioned.filter((entry) => entry.at !== undefined).sort((left, right) => earlier(left.at ?? unpositioned, right.at ?? unpositioned));
  const decoded = ordered.map(({ log, at }, index): DecodedLog => {
    const position = at ?? unpositioned;
    const previous = ordered[index - 1]?.at;
    if (previous !== undefined && earlier(previous, position) === 0) return { kind: "malformed", at: position, topic: log.topics[0], reason: "RepeatedPosition" };
    return decodeOne(source, log, position);
  });
  const unplaced = positioned.filter((entry) => entry.at === undefined).map(({ log }): DecodedLog => ({ kind: "malformed", at: unpositioned, topic: log.topics[0], reason: "BadPosition" }));
  return [...unplaced, ...decoded];
}

/** @throws {never} */
export function eventAt(decoded: ReadonlyArray<DecodedLog>, transaction: Bytes32, index: number): DecodedLog | undefined {
  const matches = decoded.filter((entry) => entry.at.transaction === transaction && entry.at.index === index);
  return matches.length === 1 ? matches[0] : undefined;
}

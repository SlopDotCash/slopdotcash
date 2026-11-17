// spec/settlement/escrow.md, "Events apply once, in canonical block and event order"
import { Arbitrary, Schema } from "effect";
import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";
import { contract } from "vibestack/testing";
import { type Bytes32, type EvmAddress, type Hex, U64_MAX, U128_MAX, U256_MAX } from "./abi.ts";
import { adapterVectors } from "./adapterVectors.ts";
import { type DecodedLog, EVENT_TOPICS, type EscrowLog, decodeEscrowLogs } from "./events.ts";

export const eventTopicsMatchTheDeployedAdapter = contract({
  input: Arbitrary.Constant(adapterVectors.topics),
  run: (recorded) => Object.entries(recorded).map(([name, topic]) => [topic, EVENT_TOPICS[name as keyof typeof EVENT_TOPICS]] as const),
  invariant: (_recorded, pairs) => pairs.length === 12 && pairs.every(([recorded, computed]) => recorded === computed),
});

const independent = parseAbi([
  "event AwardCommitted(bytes32 indexed id, uint64 indexed actorId, uint128 gross, uint128 fee, bytes32 sourceDigest)",
  "event Paid(bytes32 indexed id, uint64 indexed actorId, address indexed destination, uint64 version, uint128 gross, uint128 net, uint128 fee)",
  "event MonthlyReserved(uint32 indexed period, bytes32 allocationDigest, bytes32 allocationRoot, uint128 wholeGross, uint128 remainingGross, uint32 count, uint256 sourceSequence)",
]);

const between = (minimum: bigint, maximum: bigint) => Schema.BigInt.check(Schema.isBetweenBigInt({ minimum, maximum }));
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}` as Bytes32;
const address = (value: bigint) => `0x${value.toString(16).padStart(40, "0")}` as EvmAddress;
const vault = adapterVectors.vault as EvmAddress;

const emitted = Schema.Struct({
  block: between(0n, 1n << 40n),
  index: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 500 })),
  id: between(1n, U256_MAX),
  actor: between(1n, U64_MAX),
  gross: between(1n, U128_MAX),
  feeSeed: between(0n, U128_MAX),
  destination: between(1n, (1n << 160n) - 1n),
  version: between(1n, U64_MAX),
  kind: Schema.Literals(["AwardCommitted", "Paid", "MonthlyReserved"]),
});

type Emitted = typeof emitted.Type;

const logOf = (value: Emitted): { readonly log: EscrowLog; readonly expected: unknown } => {
  const fee = value.feeSeed % (value.gross + 1n);
  const position = { address: vault, blockNumber: value.block, blockHash: word(value.block + 1n), transactionHash: word(value.id), logIndex: value.index, removed: false };
  if (value.kind === "AwardCommitted") {
    const topics = encodeEventTopics({ abi: independent, eventName: "AwardCommitted", args: { id: word(value.id), actorId: value.actor } });
    const data = encodeAbiParameters([{ type: "uint128" }, { type: "uint128" }, { type: "bytes32" }], [value.gross, fee, word(value.version)]);
    return { log: { ...position, topics: topics as ReadonlyArray<Hex>, data }, expected: { name: "AwardCommitted", id: word(value.id), actor: value.actor, gross: value.gross, fee, sourceDigest: word(value.version) } };
  }
  if (value.kind === "Paid") {
    const topics = encodeEventTopics({ abi: independent, eventName: "Paid", args: { id: word(value.id), actorId: value.actor, destination: address(value.destination) } });
    const data = encodeAbiParameters([{ type: "uint64" }, { type: "uint128" }, { type: "uint128" }, { type: "uint128" }], [value.version, value.gross, value.gross - fee, fee]);
    return { log: { ...position, topics: topics as ReadonlyArray<Hex>, data }, expected: { name: "Paid", id: word(value.id), actor: value.actor, destination: address(value.destination), version: value.version, gross: value.gross, net: value.gross - fee, fee } };
  }
  const period = 200001 + Number(value.version % 799_900n);
  const remaining = fee === 0n ? 0n : fee;
  const count = remaining === 0n ? 0 : Number(value.actor % 0xffff_fffen) + 1;
  const topics = encodeEventTopics({ abi: independent, eventName: "MonthlyReserved", args: { period } });
  const data = encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint128" }, { type: "uint128" }, { type: "uint32" }, { type: "uint256" }], [word(value.id), word(value.destination), value.gross, remaining, count, value.feeSeed]);
  return { log: { ...position, topics: topics as ReadonlyArray<Hex>, data }, expected: { name: "MonthlyReserved", period, allocationDigest: word(value.id), allocationRoot: word(value.destination), wholeGross: value.gross, remainingGross: remaining, count, sourceSequence: value.feeSeed } };
};

const stringify = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);

const describe = (decoded: DecodedLog) => (decoded.kind === "event" ? { at: [decoded.at.block, decoded.at.index], event: decoded.event } : { at: [decoded.at.block, decoded.at.index], kind: decoded.kind });

export const encodedEventsDecodeInCanonicalOrder = contract({
  input: Schema.Array(emitted).check(Schema.isMaxLength(12)),
  run: (values) => decodeEscrowLogs(vault, [...values].reverse().map((value) => logOf(value).log)).map(describe),
  invariant: (values, decoded) => {
    const ordered = [...values].reverse().map((value, order) => ({ value, order })).sort((left, right) => (left.value.block === right.value.block ? left.value.index - right.value.index || left.order - right.order : left.value.block < right.value.block ? -1 : 1));
    const expected = ordered.map(({ value }, position) => {
      const previous = ordered[position - 1]?.value;
      const at = [value.block, value.index];
      return previous !== undefined && previous.block === value.block && previous.index === value.index ? { at, kind: "malformed" } : { at, event: logOf(value).expected };
    });
    return JSON.stringify(decoded, stringify) === JSON.stringify(expected, stringify);
  },
});


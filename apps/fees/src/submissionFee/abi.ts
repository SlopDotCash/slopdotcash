// spec/fees/submissionFeeSends.md, "The resolver signs only resolveMany for due deposits on the published contract, inside its native ceilings"; spec/fees/submissionFeeSends.md, "A deposit whose payout the token refuses is parked and never holds up the rest"
import {
  type Address,
  decodeErrorResult,
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  keccak256,
  parseAbi,
  stringToBytes,
} from "viem";

export const submissionDepositsAbi = parseAbi([
  "event Deposited(uint256 indexed id, bytes32 indexed item, address indexed payer, address token, uint128 amount, address keptTo)",
  "event Resolved(uint256 indexed id, bool refunded)",
  "event Reclaimed(uint256 indexed id)",
  "function deposits(uint256 id) view returns ((address payer,address token,uint128 amount,address keptTo,bytes32 item,uint64 depositedAt,uint8 state))",
  "function resolveMany(uint256[] ids, bool[] refunds)",
  "error PayoutFailed(uint256 id)",
  "error NotOpen(uint256 id)",
  "error NotResolver()",
]);

export const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
]);

const knownTopics: ReadonlyArray<Hex> = [
  "Deposited(uint256,bytes32,address,address,uint128,address)",
  "Resolved(uint256,bool)",
  "Reclaimed(uint256)",
].map((signature) => keccak256(stringToBytes(signature)));

const maxId = BigInt(Number.MAX_SAFE_INTEGER);

export interface SendEntry {
  readonly id: number;
  readonly refund: boolean;
}

export interface ChainDeposit {
  readonly payer: string;
  readonly token: string;
  readonly amount: string;
  readonly keptTo: string;
  readonly item: string;
  readonly state: number;
}

export type DecodedFeeLog =
  | { readonly kind: "deposited"; readonly id: bigint; readonly item: string; readonly payer: string; readonly token: string; readonly amount: bigint; readonly keptTo: string }
  | { readonly kind: "resolved"; readonly id: bigint; readonly refunded: boolean }
  | { readonly kind: "reclaimed"; readonly id: bigint }
  | { readonly kind: "other" }
  | { readonly kind: "malformed" };

export interface ResolveTransaction {
  readonly chainId: number;
  readonly to: Address;
  readonly data: Hex;
  readonly nonce: number;
  readonly gas: bigint;
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
}

export interface LogLike {
  readonly address: string;
  readonly topics: ReadonlyArray<Hex>;
  readonly data: Hex;
}

/** @throws {never} */
export function depositId(value: bigint): number | undefined {
  return value <= 0n || value > maxId ? undefined : Number(value);
}

/** @throws {never} */
export function decodeFeeLog(log: LogLike): DecodedFeeLog {
  const [topic, ...rest] = log.topics;
  if (topic === undefined) return { kind: "other" };
  try {
    const decoded = decodeEventLog({ abi: submissionDepositsAbi, data: log.data, topics: [topic, ...rest], strict: true });
    switch (decoded.eventName) {
      case "Deposited":
        return {
          kind: "deposited",
          id: decoded.args.id,
          item: decoded.args.item.toLowerCase(),
          payer: decoded.args.payer.toLowerCase(),
          token: decoded.args.token.toLowerCase(),
          amount: decoded.args.amount,
          keptTo: decoded.args.keptTo.toLowerCase(),
        };
      case "Resolved":
        return { kind: "resolved", id: decoded.args.id, refunded: decoded.args.refunded };
      case "Reclaimed":
        return { kind: "reclaimed", id: decoded.args.id };
    }
  } catch {
    return knownTopics.includes(topic.toLowerCase() as Hex) ? { kind: "malformed" } : { kind: "other" };
  }
}

/** @throws {never} */
export function depositsCalldata(id: number): Hex {
  return encodeFunctionData({ abi: submissionDepositsAbi, functionName: "deposits", args: [BigInt(id)] });
}

/** @throws {never} */
export function decodeDeposit(data: Hex): ChainDeposit | undefined {
  try {
    const record = decodeFunctionResult({ abi: submissionDepositsAbi, functionName: "deposits", data });
    return {
      payer: record.payer.toLowerCase(),
      token: record.token.toLowerCase(),
      amount: record.amount.toString(),
      keptTo: record.keptTo.toLowerCase(),
      item: record.item.toLowerCase(),
      state: record.state,
    };
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function resolveCalldata(entries: ReadonlyArray<SendEntry>): Hex {
  return encodeFunctionData({
    abi: submissionDepositsAbi,
    functionName: "resolveMany",
    args: [entries.map((entry) => BigInt(entry.id)), entries.map((entry) => entry.refund)],
  });
}

/** @throws {never} */
export function payoutFailedId(data: string | undefined): bigint | undefined {
  if (data === undefined || !/^0x(?:[0-9a-fA-F]{2})+$/u.test(data)) return undefined;
  try {
    const decoded = decodeErrorResult({ abi: submissionDepositsAbi, data: data as Hex });
    return decoded.errorName === "PayoutFailed" ? decoded.args[0] : undefined;
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function provesTransfer(log: LogLike, transfer: { readonly token: string; readonly from: string; readonly to: string; readonly amount: bigint }): boolean {
  if (log.address.toLowerCase() !== transfer.token.toLowerCase()) return false;
  const [topic, ...rest] = log.topics;
  if (topic === undefined) return false;
  try {
    const decoded = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: log.data, topics: [topic, ...rest], strict: true });
    return (
      decoded.args.from.toLowerCase() === transfer.from.toLowerCase() &&
      decoded.args.to.toLowerCase() === transfer.to.toLowerCase() &&
      decoded.args.value === transfer.amount
    );
  } catch {
    return false;
  }
}

/** @throws {never} */
export function slot0Calldata(poolId: Hex): Hex {
  return encodeFunctionData({ abi: stateViewAbi, functionName: "getSlot0", args: [poolId] });
}

/** @throws {never} */
export function decodeSqrtPrice(data: Hex): bigint | undefined {
  try {
    const [sqrtPriceX96] = decodeFunctionResult({ abi: stateViewAbi, functionName: "getSlot0", data });
    return sqrtPriceX96;
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function transactionId(raw: Hex): Hex {
  return keccak256(raw);
}

/** @throws {never} */
export function blockIso(seconds: number): string | undefined {
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 8_640_000_000_000) return undefined;
  return new Date(seconds * 1000).toISOString();
}

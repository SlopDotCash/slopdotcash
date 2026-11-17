// spec/fees/buyback.md, "An EVM order first approves exactly its amount to the pinned bridge"; spec/fees/buyback.md, "An unfilled order stays in transit until fulfillment or refund is proven"
import { type Address, decodeEventLog, decodeFunctionData, decodeFunctionResult, encodeFunctionData, erc20Abi, type Hex, isHex, parseAbi } from "viem";
import { dlnSourceAbi } from "../evm/abi.ts";

const dlnSourceReads = parseAbi([
  "struct Order { uint64 makerOrderNonce; bytes makerSrc; uint256 giveChainId; bytes giveTokenAddress; uint256 giveAmount; uint256 takeChainId; bytes takeTokenAddress; uint256 takeAmount; bytes receiverDst; bytes givePatchAuthoritySrc; bytes orderAuthorityAddressDst; bytes allowedTakerDst; bytes allowedCancelBeneficiarySrc; bytes externalCall; }",
  "function giveOrders(bytes32) view returns (uint8 status, uint160 giveTokenAddress, uint88 nativeFixFee, uint48 takeChainId, uint208 percentFee, uint256 giveAmount, address affiliateBeneficiary, uint256 affiliateAmount)",
  "event CreatedOrder(Order order, bytes32 orderId, bytes affiliateFee, uint256 nativeFixFee, uint256 percentFee, uint32 referralCode, bytes metadata)",
]);

const dlnDestinationAbi = parseAbi([
  "function takeOrders(bytes32) view returns (uint8 status, address takerAddress, uint32 giveChainId, uint256 bigGiveChainId)",
]);

export const giveStatus = { created: 1, claimedUnlock: 2, claimedCancel: 3 } as const;
export const takeStatus = { fulfilled: 1, sentUnlock: 2, sentCancel: 3 } as const;

const metadataLimitHex = 2 + 2 * 512;

export interface DlnEvmIntent {
  readonly wallet: string;
  readonly giveToken: string;
  readonly giveAmount: bigint;
  readonly takeToken: string;
  readonly takeChainId: bigint;
  readonly receiver: string;
  readonly allowedTakers: readonly string[];
}

export interface CheckedDlnOrder {
  readonly takeAmount: bigint;
  readonly salt: bigint;
  readonly allowedTaker: Address | undefined;
  readonly metadata: Hex;
}

export type DlnOrderCheck = { readonly kind: "Checked"; readonly order: CheckedDlnOrder } | { readonly kind: "Refused"; readonly issue: string };

export interface GiveOrder {
  readonly status: number;
  readonly refundable: bigint;
}

export interface CreatedOrderTerms {
  readonly orderId: Hex;
  readonly takeToken: string;
  readonly takeAmount: bigint;
  readonly takeChainId: bigint;
  readonly receiver: string;
}

export interface DlnLog {
  readonly address: string;
  readonly topics: readonly Hex[];
  readonly data: Hex;
}

const lower = (value: string) => value.toLowerCase();

function refused(issue: string): DlnOrderCheck {
  return { kind: "Refused", issue };
}

function saltedOrder(data: Hex) {
  try {
    const decoded = decodeFunctionData({ abi: dlnSourceAbi, data });
    return decoded.functionName === "createSaltedOrder" ? decoded.args : undefined;
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function checkedDlnOrder(data: Hex, intent: DlnEvmIntent): DlnOrderCheck {
  const args = saltedOrder(data);
  if (args === undefined) return refused("Bridge calldata is not a salted DLN order");
  const [order, salt, affiliateFee, referralCode, permit, metadata] = args;
  if (
    lower(order.giveTokenAddress) !== lower(intent.giveToken) ||
    order.giveAmount !== intent.giveAmount ||
    lower(order.takeTokenAddress) !== lower(intent.takeToken) ||
    order.takeChainId !== intent.takeChainId ||
    lower(order.receiverDst) !== lower(intent.receiver) ||
    lower(order.givePatchAuthoritySrc) !== lower(intent.wallet) ||
    lower(order.orderAuthorityAddressDst) !== lower(intent.receiver) ||
    lower(order.allowedCancelBeneficiarySrc) !== lower(intent.wallet) ||
    order.externalCall !== "0x" ||
    affiliateFee !== "0x" ||
    referralCode !== 0 ||
    permit !== "0x"
  )
    return refused("Bridge order differs from the fee-wallet intent");
  const taker = lower(order.allowedTakerDst);
  if (taker !== "0x" && !intent.allowedTakers.includes(taker)) return refused("Bridge order reserves its fill for an unknown taker");
  if (order.takeAmount <= 0n || salt <= 0n) return refused("Bridge order has no arrival amount or salt");
  if (metadata.length > metadataLimitHex) return refused("Bridge order metadata is too large");
  const encoded = encodeFunctionData({ abi: dlnSourceAbi, functionName: "createSaltedOrder", args });
  if (lower(encoded) !== lower(data)) return refused("Bridge calldata has bytes outside the checked order");
  return {
    kind: "Checked",
    order: { takeAmount: order.takeAmount, salt, allowedTaker: taker === "0x" ? undefined : (taker as Address), metadata: lower(metadata) as Hex },
  };
}

/** @throws {never} */
export function takeOrdersCalldata(orderId: Hex): Hex {
  return encodeFunctionData({ abi: dlnDestinationAbi, functionName: "takeOrders", args: [orderId] });
}

/** @throws {never} */
export function giveOrdersCalldata(orderId: Hex): Hex {
  return encodeFunctionData({ abi: dlnSourceReads, functionName: "giveOrders", args: [orderId] });
}

/** @throws {never} */
export function takeStatusOf(data: Hex): number | undefined {
  if (!/^0x[0-9a-fA-F]{256}$/u.test(data)) return undefined;
  try {
    const [status] = decodeFunctionResult({ abi: dlnDestinationAbi, functionName: "takeOrders", data });
    return status;
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function giveOrderOf(data: Hex): GiveOrder | undefined {
  if (!/^0x[0-9a-fA-F]{512}$/u.test(data)) return undefined;
  try {
    const [status, , , , percentFee, giveAmount, , affiliateAmount] = decodeFunctionResult({ abi: dlnSourceReads, functionName: "giveOrders", data });
    return { status, refundable: giveAmount + percentFee + affiliateAmount };
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function createdOrderMatches(logs: readonly DlnLog[], source: string, terms: CreatedOrderTerms): boolean {
  let created = 0;
  let matching = false;
  for (const log of logs) {
    if (lower(log.address) !== lower(source)) continue;
    try {
      const { args } = decodeEventLog({ abi: dlnSourceReads, eventName: "CreatedOrder", topics: log.topics as [Hex, ...Hex[]], data: log.data });
      created += 1;
      matching =
        lower(args.orderId) === lower(terms.orderId) &&
        args.order.takeAmount === terms.takeAmount &&
        args.order.takeChainId === terms.takeChainId &&
        lower(args.order.takeTokenAddress) === lower(terms.takeToken) &&
        lower(args.order.receiverDst) === lower(terms.receiver);
    } catch {
      continue;
    }
  }
  return created === 1 && matching;
}

/** @throws {never} */
export function walletDebit(logs: readonly DlnLog[], token: string, wallet: string): bigint {
  let paid = 0n;
  for (const log of logs) {
    if (lower(log.address) !== lower(token)) continue;
    try {
      const { args } = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics: log.topics as [Hex, ...Hex[]], data: log.data });
      if (lower(args.from) === lower(wallet)) paid += args.value;
      if (lower(args.to) === lower(wallet)) paid -= args.value;
    } catch {
      continue;
    }
  }
  return paid;
}

/** @throws {never} */
export function hexBytes(text: string): Uint8Array | undefined {
  if (!isHex(text) || text.length % 2 !== 0) return undefined;
  return Uint8Array.from(text.slice(2).match(/../gu) ?? [], (byte) => Number.parseInt(byte, 16));
}

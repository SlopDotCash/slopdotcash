/**
 * deBridge DLN order checks for the SLOP buyback bridge (PRD section 6).
 * The ABI fragments and status values follow the published contracts
 * (github.com/debridge-finance/dln-contracts: DlnSource, DlnDestination,
 * DlnOrderLib); the fork test runs them against the deployed bytecode.
 * The API only proposes an order. Every field of its calldata is decoded and
 * compared with the Worker's own decision before anything is signed, and the
 * calldata must re-encode to the same bytes, so it can carry nothing that was
 * not checked. The order names its receiver, asset, amount and chain.
 */

import {
  decodeFunctionData,
  encodeFunctionData,
  type Hex,
  parseAbi,
} from "viem";
import { DLN } from "./buyback-config";

export const DLN_SOURCE_ABI = parseAbi([
  "struct OrderCreation { address giveTokenAddress; uint256 giveAmount; bytes takeTokenAddress; uint256 takeAmount; uint256 takeChainId; bytes receiverDst; address givePatchAuthoritySrc; bytes orderAuthorityAddressDst; bytes allowedTakerDst; bytes externalCall; bytes allowedCancelBeneficiarySrc; }",
  "struct Order { uint64 makerOrderNonce; bytes makerSrc; uint256 giveChainId; bytes giveTokenAddress; uint256 giveAmount; uint256 takeChainId; bytes takeTokenAddress; uint256 takeAmount; bytes receiverDst; bytes givePatchAuthoritySrc; bytes orderAuthorityAddressDst; bytes allowedTakerDst; bytes allowedCancelBeneficiarySrc; bytes externalCall; }",
  "function createSaltedOrder(OrderCreation _orderCreation, uint64 _salt, bytes _affiliateFee, uint32 _referralCode, bytes _permitEnvelope, bytes _metadata) payable returns (bytes32)",
  "function globalFixedNativeFee() view returns (uint88)",
  "function giveOrders(bytes32) view returns (uint8 status, uint160 giveTokenAddress, uint88 nativeFixFee, uint48 takeChainId, uint208 percentFee, uint256 giveAmount, address affiliateBeneficiary, uint256 affiliateAmount)",
  "event CreatedOrder(Order order, bytes32 orderId, bytes affiliateFee, uint256 nativeFixFee, uint256 percentFee, uint32 referralCode, bytes metadata)",
]);

export const DLN_DESTINATION_ABI = parseAbi([
  "function takeOrders(bytes32) view returns (uint8 status, address takerAddress, uint32 giveChainId, uint256 bigGiveChainId)",
]);

/** DlnSource.OrderGiveStatus. */
export const GIVE_STATUS = { created: 1, claimedUnlock: 2, claimedCancel: 3 };
/** DlnDestination.OrderTakeStatus. */
export const TAKE_STATUS = { fulfilled: 1, sentUnlock: 2, sentCancel: 3 };

/** The order this Worker decided; every calldata field must equal it. */
export interface DlnIntent {
  /** The source fee wallet: order maker and patch authority. */
  wallet: string;
  giveToken: string;
  giveAmount: bigint;
  takeToken: string;
  takeChainId: bigint;
  /** The Robinhood Chain fee wallet: receiver and order authority. */
  receiver: string;
}

export interface CheckedDlnOrder {
  takeAmount: bigint;
  salt: bigint;
}

const METADATA_LIMIT = 2 + 2 * 512;
const lower = (value: string) => value.toLowerCase();

/**
 * Decodes `createSaltedOrder` calldata and refuses anything but the intended
 * order: the exact give asset and amount, the pinned arrival asset and chain,
 * the fee wallet as receiver and as every authority, a cancellation refund
 * bound to the source fee wallet, an empty or pinned reserved taker, and no
 * external call, affiliate fee, referral or permit.
 */
export function checkedDlnOrder(data: Hex, intent: DlnIntent): CheckedDlnOrder {
  const decoded = decodeFunctionData({ abi: DLN_SOURCE_ABI, data });
  if (decoded.functionName !== "createSaltedOrder")
    throw new Error("Bridge calldata is not a salted DLN order");
  const [order, salt, affiliateFee, referralCode, permit, metadata] =
    decoded.args;
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
    throw new Error("Bridge order differs from the fee-wallet intent");
  if (
    order.allowedTakerDst !== "0x" &&
    !DLN.allowedTakers.includes(lower(order.allowedTakerDst))
  )
    throw new Error("Bridge order reserves its fill for an unknown taker");
  if (order.takeAmount <= 0n || salt <= 0n)
    throw new Error("Bridge order has no arrival amount or salt");
  if (metadata.length > METADATA_LIMIT)
    throw new Error("Bridge order metadata is too large");
  // Nothing outside the decoded and checked fields may ride along.
  const encoded = encodeFunctionData({
    abi: DLN_SOURCE_ABI,
    functionName: "createSaltedOrder",
    args: decoded.args,
  });
  if (lower(encoded) !== lower(data))
    throw new Error("Bridge calldata has bytes outside the checked order");
  return { takeAmount: order.takeAmount, salt };
}

export interface DlnProposal {
  to: string;
  data: Hex;
  value: bigint;
  orderId: string;
  /** The API's own estimate of the arrival; the calldata is authoritative. */
  estimatedTakeAmount: bigint;
}

const DECIMAL = /^(0|[1-9][0-9]{0,77})$/u;

/**
 * Asks the DLN API for one order. `null` means it has no route; any other
 * malformed or failed answer throws, so the leg retries on a later scan.
 */
export async function proposeDlnOrder(
  doFetch: typeof fetch,
  request: {
    srcChainId: string;
    giveToken: string;
    giveAmount: bigint;
    takeChainId: string;
    takeToken: string;
    wallet: string;
    receiver: string;
  },
): Promise<DlnProposal | { noRoute: string }> {
  const query = new URLSearchParams({
    srcChainId: request.srcChainId,
    srcChainTokenIn: request.giveToken,
    srcChainTokenInAmount: request.giveAmount.toString(),
    dstChainId: request.takeChainId,
    dstChainTokenOut: request.takeToken,
    dstChainTokenOutAmount: "auto",
    dstChainTokenOutRecipient: request.receiver,
    srcChainOrderAuthorityAddress: request.wallet,
    dstChainOrderAuthorityAddress: request.receiver,
    srcAllowedCancelBeneficiary: request.wallet,
    prependOperatingExpenses: "false",
    referralCode: "0",
  });
  const response = await doFetch(`${DLN.api}/dln/order/create-tx?${query}`, {
    headers: { accept: "application/json" },
  });
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error("DLN response too large");
  let body: {
    errorId?: string;
    errorMessage?: string;
    orderId?: unknown;
    tx?: { to?: unknown; data?: unknown; value?: unknown };
    estimation?: { dstChainTokenOut?: { amount?: unknown } };
  };
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`DLN returned HTTP ${response.status}`);
  }
  if (!response.ok || body.errorId !== undefined) {
    const reason = `DLN ${String(body.errorId ?? response.status).slice(0, 80)}: ${String(body.errorMessage ?? "").slice(0, 160)}`;
    // 4xx: no route, an unsupported token or an amount too small to fill.
    if (response.status >= 400 && response.status < 500)
      return { noRoute: reason.trim() };
    throw new Error(reason);
  }
  const amount = body.estimation?.dstChainTokenOut?.amount;
  // Solana proposals carry no `to` or `value`; the caller checks the fields it uses.
  const value = body.tx?.value ?? "0";
  if (
    typeof body.orderId !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/u.test(body.orderId) ||
    typeof body.tx?.data !== "string" ||
    !/^0x([0-9a-fA-F]{2})+$/u.test(body.tx.data) ||
    (body.tx.to !== undefined && typeof body.tx.to !== "string") ||
    typeof value !== "string" ||
    !DECIMAL.test(value) ||
    typeof amount !== "string" ||
    !DECIMAL.test(amount)
  )
    throw new Error("DLN order response is malformed");
  return {
    to: (body.tx.to as string | undefined) ?? "",
    data: body.tx.data as Hex,
    value: BigInt(value),
    orderId: body.orderId.toLowerCase(),
    estimatedTakeAmount: BigInt(amount),
  };
}

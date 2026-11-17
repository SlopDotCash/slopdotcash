// spec/fees/buyback.md, "Story: Bridge the available share through one exact order at a time"
import { Response } from "miniflare";
import { type Hex, decodeFunctionResult, encodeFunctionData, isAddress, isHex, parseAbi } from "viem";
import { type LatestBlockhash, latestBlockhash } from "./solanaHistory.ts";

export const dlnOrigin = "https://dln.debridge.finance/v1.0";
export const dlnSolanaChainId = "7565164";

export const dlnSourceAbi = parseAbi([
  "struct OrderCreation { address giveTokenAddress; uint256 giveAmount; bytes takeTokenAddress; uint256 takeAmount; uint256 takeChainId; bytes receiverDst; address givePatchAuthoritySrc; bytes orderAuthorityAddressDst; bytes allowedTakerDst; bytes externalCall; bytes allowedCancelBeneficiarySrc; }",
  "function createSaltedOrder(OrderCreation _orderCreation, uint64 _salt, bytes _affiliateFee, uint32 _referralCode, bytes _permitEnvelope, bytes _metadata) payable returns (bytes32)",
  "function globalFixedNativeFee() view returns (uint88)",
]);

interface DlnOrderTerms {
  readonly giveToken: string;
  readonly giveAmount?: bigint;
  readonly takeChainId: bigint;
  readonly takeToken: Hex;
  readonly takeAmount: bigint;
  readonly orderId: Hex;
}

export interface DlnEvmOrder extends DlnOrderTerms {
  readonly family: "evm";
  readonly srcChainId: bigint;
  readonly source: Hex;
  readonly salt: bigint;
  readonly nativeFee?: bigint;
  readonly allowedTaker?: Hex;
  readonly metadata?: Hex;
}

export interface DlnSolanaRequest extends LatestBlockhash {
  readonly query: Readonly<Record<string, string>>;
  readonly takeAmount: bigint;
  readonly orderId: Hex;
}

export interface DlnSolanaOrder extends DlnOrderTerms {
  readonly family: "solana";
  readonly build: (request: DlnSolanaRequest) => Uint8Array | Promise<Uint8Array>;
}

export type DlnOrderScript = DlnEvmOrder | DlnSolanaOrder;

export interface DlnScript {
  /** @throws {Error} */
  order(script: DlnOrderScript): void;
}

const required = [
  "srcChainId",
  "srcChainTokenIn",
  "srcChainTokenInAmount",
  "dstChainId",
  "dstChainTokenOut",
  "dstChainTokenOutAmount",
  "dstChainTokenOutRecipient",
  "srcChainOrderAuthorityAddress",
  "dstChainOrderAuthorityAddress",
  "srcAllowedCancelBeneficiary",
] as const;

type Query = Readonly<Record<(typeof required)[number], string>> & Readonly<Record<string, string>>;

const decimal = /^(0|[1-9][0-9]{0,77})$/u;

function failure(status: number, errorCode: number, errorId: string, errorMessage: string) {
  return Response.json({ errorCode, errorId, errorMessage, requestId: `dln-${errorId.toLowerCase()}` }, { status });
}

export function dlnRefusal(mode: "noRoute" | "unavailable"): Response {
  return mode === "noRoute"
    ? failure(400, 8, "ERROR_LOW_GIVE_AMOUNT", "Order amount is too small to be filled")
    : failure(503, 0, "INTERNAL_SERVER_ERROR", "Service unavailable");
}

function hasRequired(query: Readonly<Record<string, string>>): query is Query {
  return required.every((name) => typeof query[name] === "string" && query[name] !== "");
}

/** @throws {Error} */
async function chainFee(rpcUrl: string, source: Hex): Promise<bigint> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: source, data: encodeFunctionData({ abi: dlnSourceAbi, functionName: "globalFixedNativeFee" }) }, "latest"] }),
  });
  const reply: unknown = await response.json();
  const result = typeof reply === "object" && reply !== null && "result" in reply ? reply.result : undefined;
  if (typeof result !== "string" || !isHex(result)) throw new Error(`DlnSource ${source} at ${rpcUrl} answered no globalFixedNativeFee`);
  return decodeFunctionResult({ abi: dlnSourceAbi, functionName: "globalFixedNativeFee", data: result });
}

export function dln(chains: { readonly evm?: Readonly<Record<string, string>>; readonly solana?: string }) {
  const orders: DlnOrderScript[] = [];

  const script: DlnScript = {
    order: (order) => {
      if (order.family === "evm" && order.nativeFee === undefined && chains.evm?.[order.srcChainId.toString()] === undefined)
        throw new Error(`dln.order reads the fixed fee from DlnSource on chain ${order.srcChainId}: give a nativeFee or quotesFake chains.evm[${order.srcChainId}]`);
      if (order.family === "solana" && chains.solana === undefined)
        throw new Error("dln.order builds Solana orders against the local validator: give quotesFake chains.solana");
      orders.push(order);
    },
  };

  function matches(order: DlnOrderScript, query: Query) {
    const sameToken = order.family === "evm"
      ? order.giveToken.toLowerCase() === query.srcChainTokenIn.toLowerCase()
      : order.giveToken === query.srcChainTokenIn;
    return sameToken &&
      (order.family === "evm" ? order.srcChainId.toString() === query.srcChainId : query.srcChainId === dlnSolanaChainId) &&
      order.takeChainId.toString() === query.dstChainId &&
      order.takeToken.toLowerCase() === query.dstChainTokenOut.toLowerCase() &&
      (order.giveAmount === undefined || order.giveAmount.toString() === query.srcChainTokenInAmount);
  }

  /** @throws {Error} */
  async function evmOrder(order: DlnEvmOrder, query: Query) {
    const { srcChainTokenIn: giveToken, srcChainOrderAuthorityAddress: patchAuthority, dstChainTokenOut: takeToken, dstChainTokenOutRecipient: receiver, dstChainOrderAuthorityAddress: orderAuthority, srcAllowedCancelBeneficiary: cancelBeneficiary } = query;
    if (!isAddress(giveToken, { strict: false }) || !isAddress(patchAuthority, { strict: false }) || !isHex(takeToken) || !isHex(receiver) || !isHex(orderAuthority) || !isHex(cancelBeneficiary))
      return failure(400, 2, "INVALID_QUERY_PARAMETERS", "Order addresses must be hex");
    const nativeFee = order.nativeFee ?? await chainFee(chains.evm?.[order.srcChainId.toString()] ?? "", order.source);
    const data = encodeFunctionData({
      abi: dlnSourceAbi,
      functionName: "createSaltedOrder",
      args: [
        {
          giveTokenAddress: giveToken,
          giveAmount: BigInt(query.srcChainTokenInAmount),
          takeTokenAddress: takeToken,
          takeAmount: order.takeAmount,
          takeChainId: BigInt(query.dstChainId),
          receiverDst: receiver,
          givePatchAuthoritySrc: patchAuthority,
          orderAuthorityAddressDst: orderAuthority,
          allowedTakerDst: order.allowedTaker ?? "0x",
          externalCall: "0x",
          allowedCancelBeneficiarySrc: cancelBeneficiary,
        },
        order.salt,
        "0x",
        Number(query.referralCode ?? "0"),
        "0x",
        order.metadata ?? "0x",
      ],
    });
    return Response.json({
      estimation: estimation(order, query),
      tx: { to: order.source, data, value: nativeFee.toString() },
      orderId: order.orderId,
      fixFee: nativeFee.toString(),
    });
  }

  /** @throws {Error} */
  async function solanaOrder(order: DlnSolanaOrder, query: Query) {
    if (chains.solana === undefined) throw new Error("dln Solana orders need quotesFake chains.solana");
    const latest = await latestBlockhash(chains.solana);
    const transaction = await order.build({ ...latest, query, takeAmount: order.takeAmount, orderId: order.orderId });
    return Response.json({
      estimation: estimation(order, query),
      tx: { data: `0x${Buffer.from(transaction).toString("hex")}` },
      orderId: order.orderId,
    });
  }

  function estimation(order: DlnOrderScript, query: Query) {
    return {
      srcChainTokenIn: { address: query.srcChainTokenIn, chainId: Number(query.srcChainId), amount: query.srcChainTokenInAmount },
      dstChainTokenOut: { address: query.dstChainTokenOut, chainId: Number(query.dstChainId), amount: order.takeAmount.toString(), recommendedAmount: order.takeAmount.toString() },
    };
  }

  /** @throws {Error} */
  async function answer(method: string, path: string, url: URL) {
    if (path !== "/dln/order/create-tx" || method !== "GET")
      return { response: failure(404, 1, "NOT_FOUND", "Not found"), scripted: false };
    const query = Object.fromEntries(url.searchParams);
    if (!hasRequired(query) || !decimal.test(query.srcChainTokenInAmount) || !decimal.test(query.dstChainId) || query.dstChainTokenOutAmount !== "auto" || !/^[0-9]{1,9}$/u.test(query.referralCode ?? "0"))
      return { response: failure(400, 2, "INVALID_QUERY_PARAMETERS", "Query parameters are invalid"), scripted: false };
    const found = orders.findLast((order) => matches(order, query));
    if (found === undefined) return { response: dlnRefusal("noRoute"), scripted: false };
    return { response: found.family === "evm" ? await evmOrder(found, query) : await solanaOrder(found, query), scripted: true };
  }

  return { script, answer };
}

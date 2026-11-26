// spec/fees/conversion.md, "Native gas is reserved before signing and committed atomically with the signed row"
import {
  type Address,
  decodeEventLog,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  isHex,
  keccak256,
  parseAbi,
  parseTransaction,
  recoverTransactionAddress,
  serializeTransaction,
  type TransactionSerializableEIP1559,
  type TransactionSerialized,
} from "viem";
import type { Network } from "../../gen/fees__runtime.ts";

export type EvmNetwork = Exclude<Network, "Solana">;

export const dlnSourceAbi = parseAbi([
  "struct OrderCreation { address giveTokenAddress; uint256 giveAmount; bytes takeTokenAddress; uint256 takeAmount; uint256 takeChainId; bytes receiverDst; address givePatchAuthoritySrc; bytes orderAuthorityAddressDst; bytes allowedTakerDst; bytes externalCall; bytes allowedCancelBeneficiarySrc; }",
  "function createSaltedOrder(OrderCreation _orderCreation, uint64 _salt, bytes _affiliateFee, uint32 _referralCode, bytes _permitEnvelope, bytes _metadata) payable returns (bytes32)",
  "function globalFixedNativeFee() view returns (uint88)",
]);

const vaultFeeAbi = parseAbi(["function claimFees()", "function accruedFees() view returns (uint128)"]);
const pausedAbi = parseAbi(["function paused() view returns (bool)"]);

const lower = (value: string) => value.toLowerCase();

export interface Type2 {
  readonly chainId: number;
  readonly nonce: number;
  readonly to: Address;
  readonly data: Hex;
  readonly value: bigint;
  readonly gas: bigint;
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
}

export interface Unsigned {
  readonly transaction: Type2;
  readonly serialized: Hex;
  readonly intentHash: Hex;
}

export type Approval = { readonly spender: Address; readonly amount: bigint };

export interface DlnOrderCall {
  readonly giveToken: Address;
  readonly giveAmount: bigint;
  readonly takeToken: Address;
  readonly takeAmount: bigint;
  readonly takeChainId: bigint;
  readonly receiver: Address;
  readonly sourceWallet: Address;
  readonly allowedTaker: Address | undefined;
  readonly salt: bigint;
  readonly metadata: Hex;
}

/** @throws {never} */
export function approveCalldata(spender: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] });
}

/** @throws {never} */
export function transferCalldata(to: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] });
}

/** @throws {never} */
export function allowanceCalldata(owner: Address, spender: Address): Hex {
  return encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
}

/** @throws {never} */
export function balanceCalldata(owner: Address): Hex {
  return encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

export const claimFeesCalldata: Hex = encodeFunctionData({ abi: vaultFeeAbi, functionName: "claimFees" });
export const accruedFeesCalldata: Hex = encodeFunctionData({ abi: vaultFeeAbi, functionName: "accruedFees" });
export const pausedCalldata: Hex = encodeFunctionData({ abi: pausedAbi, functionName: "paused" });
export const fixedNativeFeeCalldata: Hex = encodeFunctionData({ abi: dlnSourceAbi, functionName: "globalFixedNativeFee" });

/** @throws {never} */
export function dlnOrderCalldata(order: DlnOrderCall): Hex | undefined {
  if (order.salt <= 0n || order.salt >= 2n ** 64n || order.takeAmount <= 0n || order.giveAmount <= 0n) return undefined;
  if (!isHex(order.metadata) || order.metadata.length > 2 + 2 * 512) return undefined;
  return encodeFunctionData({
    abi: dlnSourceAbi,
    functionName: "createSaltedOrder",
    args: [
      {
        giveTokenAddress: order.giveToken,
        giveAmount: order.giveAmount,
        takeTokenAddress: order.takeToken,
        takeAmount: order.takeAmount,
        takeChainId: order.takeChainId,
        receiverDst: order.receiver,
        givePatchAuthoritySrc: order.sourceWallet,
        orderAuthorityAddressDst: order.receiver,
        allowedTakerDst: order.allowedTaker ?? "0x",
        externalCall: "0x",
        allowedCancelBeneficiarySrc: order.sourceWallet,
      },
      order.salt,
      "0x",
      0,
      "0x",
      order.metadata,
    ],
  });
}

/** @throws {never} */
export function decodedApproval(data: Hex): Approval | undefined {
  try {
    const decoded = decodeFunctionData({ abi: erc20Abi, data });
    if (decoded.functionName !== "approve") return undefined;
    const [spender, amount] = decoded.args;
    return approveCalldata(spender, amount) === lower(data) ? { spender: lower(spender) as Address, amount } : undefined;
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function word(data: Hex): bigint | undefined {
  return /^0x[0-9a-fA-F]{64}$/u.test(data) ? BigInt(data) : undefined;
}

/** @throws {never} */
export function oracleCalldata(selector: Hex, amount: bigint): Hex {
  return `${selector}${amount.toString(16).padStart(64, "0")}` as Hex;
}

/** @throws {never} */
export function unsignedType2(transaction: Type2): Unsigned {
  const serialized = serializeTransaction({ type: "eip1559", ...transaction } satisfies TransactionSerializableEIP1559);
  return { transaction, serialized, intentHash: keccak256(serialized) };
}

/** @throws {never} */
export function parsedType2(raw: Hex): Type2 | undefined {
  try {
    const parsed = parseTransaction(raw);
    if (parsed.type !== "eip1559" || parsed.chainId === undefined || parsed.nonce === undefined || parsed.to === undefined || parsed.to === null) return undefined;
    if (parsed.gas === undefined || parsed.maxFeePerGas === undefined || parsed.maxPriorityFeePerGas === undefined) return undefined;
    if (parsed.accessList !== undefined && parsed.accessList.length > 0) return undefined;
    return {
      chainId: parsed.chainId,
      nonce: parsed.nonce,
      to: lower(parsed.to) as Address,
      data: parsed.data ?? "0x",
      value: parsed.value ?? 0n,
      gas: parsed.gas,
      maxFeePerGas: parsed.maxFeePerGas,
      maxPriorityFeePerGas: parsed.maxPriorityFeePerGas,
    };
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export async function signerOf(raw: Hex): Promise<Address | undefined> {
  try {
    return lower(await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized })) as Address;
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function transactionId(raw: Hex): Hex {
  return keccak256(raw);
}

/** @throws {never} */
export function sameFields(left: Type2, right: Type2): boolean {
  return left.chainId === right.chainId && left.nonce === right.nonce && lower(left.to) === lower(right.to) && lower(left.data) === lower(right.data)
    && left.value === right.value && left.gas === right.gas;
}

export interface TransferLog {
  readonly address: string;
  readonly topics: readonly Hex[];
  readonly data: Hex;
}

export interface Transfer {
  readonly from: string;
  readonly to: string;
  readonly value: bigint;
}

/** @throws {never} */
export function tokenTransfers(logs: readonly TransferLog[], token: string): Transfer[] {
  const transfers: Transfer[] = [];
  for (const log of logs) {
    if (lower(log.address) !== lower(token)) continue;
    try {
      transfers.push(decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics: log.topics as [Hex, ...Hex[]], data: log.data }).args);
    } catch {
      continue;
    }
  }
  return transfers;
}

/** @throws {never} */
export function creditedTo(logs: readonly TransferLog[], token: string, wallet: string): bigint {
  let total = 0n;
  for (const transfer of tokenTransfers(logs, token)) if (lower(transfer.to) === lower(wallet)) total += transfer.value;
  return total;
}

/** @throws {never} */
export function quantity(text: unknown): bigint | undefined {
  if (typeof text !== "string" || !/^0x[0-9a-fA-F]{1,64}$/u.test(text)) return undefined;
  return BigInt(text);
}

/** @throws {never} */
export function decimal(text: unknown): bigint | undefined {
  if (typeof text !== "string" || !/^(0|[1-9][0-9]{0,77})$/u.test(text)) return undefined;
  return BigInt(text);
}

/** @throws {never} */
export function exactNumber(value: bigint): number | undefined {
  return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
}

/** @throws {never} */
export function wholeBig(value: number): bigint | undefined {
  return Number.isSafeInteger(value) ? BigInt(value) : undefined;
}

// spec/fees/submissionFeeSends.md, "The resolver signs only resolveMany for due deposits on the published contract, inside its native ceilings"
import { type Address, decodeFunctionData, type Hex } from "viem";
import { type ResolveTransaction, resolveCalldata, submissionDepositsAbi } from "../submissionFee/abi.ts";
import { evmKey } from "./evmKey.ts";

export interface ResolveMany {
  readonly kind: "ResolveMany";
  readonly network: string;
  readonly chainId: number;
  readonly contract: Address;
  readonly ids: readonly number[];
  readonly refunds: readonly boolean[];
  readonly nonce: number;
  readonly gas: bigint;
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
}

export interface ResolverKey {
  readonly address: Address;
  /** @throws {never} */
  sign(intent: ResolveMany): Promise<Hex>;
}

const maxId = BigInt(Number.MAX_SAFE_INTEGER);

/** @throws {never} */
export function resolverKey(secret: string): ResolverKey | undefined {
  const key = evmKey(secret);
  if (key === undefined) return undefined;
  return {
    address: key.address,
    sign: (intent) =>
      key.sign({
        chainId: intent.chainId,
        nonce: intent.nonce,
        to: intent.contract,
        data: resolveCalldata(intent.ids.map((id, index) => ({ id, refund: intent.refunds[index] === true }))),
        value: 0n,
        gas: intent.gas,
        maxFeePerGas: intent.maxFeePerGas,
        maxPriorityFeePerGas: intent.maxPriorityFeePerGas,
      }),
  };
}

/** @throws {never} */
export function resolveManyOf(network: string, transaction: ResolveTransaction): ResolveMany | undefined {
  try {
    const call = decodeFunctionData({ abi: submissionDepositsAbi, data: transaction.data });
    if (call.functionName !== "resolveMany") return undefined;
    const [ids, refunds] = call.args;
    if (ids.some((id) => id <= 0n || id > maxId)) return undefined;
    return {
      kind: "ResolveMany",
      network,
      chainId: transaction.chainId,
      contract: transaction.to.toLowerCase() as Address,
      ids: ids.map(Number),
      refunds: [...refunds],
      nonce: transaction.nonce,
      gas: transaction.gas,
      maxFeePerGas: transaction.maxFeePerGas,
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
    };
  } catch {
    return undefined;
  }
}

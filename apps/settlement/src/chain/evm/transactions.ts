// spec/settlement/bindingAuthority.md, "Only the current authority binds, for the current version and before expiry, with the wallet's own signature"
import { recoverDigest } from "@repo/platform/chain/evm";
import { type TransactionSerializableEIP1559, keccak256, parseTransaction, serializeTransaction } from "viem";
import { type Bytes32, type EvmAddress, type Hex, bytes32, evmAddress } from "./abi.ts";

export interface Type2Request {
  readonly chainId: number;
  readonly nonce: number;
  readonly gas: bigint;
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
  readonly to: EvmAddress;
  readonly value: bigint;
  readonly data: Hex;
}

export interface Type2Signature {
  readonly r: Bytes32;
  readonly s: Bytes32;
  readonly yParity: 0 | 1;
}

export interface SignedType2 {
  readonly id: Bytes32;
  readonly request: Type2Request;
  readonly signature: Type2Signature;
  readonly sender: EvmAddress;
}

const HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
const CONTRACT_SIGNATURE = /^0x[0-9a-f]{128}(1b|1c)$/u;

const serializable = (request: Type2Request): TransactionSerializableEIP1559 => ({ type: "eip1559", accessList: [], ...request });

/** @throws {never} */
export function lowS(s: bigint): boolean {
  return s > 0n && s <= HALF_ORDER;
}

/** @throws {never} */
export function contractSignature(signature: string): Hex | undefined {
  const lower = signature.toLowerCase();
  return CONTRACT_SIGNATURE.test(lower) && lowS(BigInt(`0x${lower.slice(66, 130)}`)) ? (lower as Hex) : undefined;
}

/** @throws {Error} */
export function unsignedType2(request: Type2Request): Hex {
  return serializeTransaction(serializable(request));
}

/** @throws {Error} */
export function signingHash(request: Type2Request): Bytes32 {
  return keccak256(unsignedType2(request)) as Bytes32;
}

/** @throws {Error} */
export function signedType2(request: Type2Request, signature: Type2Signature): Hex {
  return serializeTransaction(serializable(request), { r: signature.r, s: signature.s, yParity: signature.yParity });
}

/** @throws {never} */
export function transactionId(raw: Hex): Bytes32 {
  return keccak256(raw) as Bytes32;
}

function requestOf(parsed: TransactionSerializableEIP1559): Type2Request | undefined {
  const { chainId, nonce, gas, maxFeePerGas, maxPriorityFeePerGas, to, value = 0n, data = "0x", accessList = [] } = parsed;
  const target = to === undefined || to === null ? undefined : evmAddress(to);
  if (chainId === undefined || nonce === undefined || !Number.isSafeInteger(nonce) || gas === undefined || maxFeePerGas === undefined || maxPriorityFeePerGas === undefined || target === undefined || accessList.length !== 0) return undefined;
  return { chainId, nonce, gas, maxFeePerGas, maxPriorityFeePerGas, to: target, value, data: data.toLowerCase() as Hex };
}

function signatureOf(parsed: TransactionSerializableEIP1559): Type2Signature | undefined {
  const r = parsed.r === undefined ? undefined : bytes32(parsed.r.length === 66 ? parsed.r : `0x${parsed.r.slice(2).padStart(64, "0")}`);
  const s = parsed.s === undefined ? undefined : bytes32(parsed.s.length === 66 ? parsed.s : `0x${parsed.s.slice(2).padStart(64, "0")}`);
  const yParity = parsed.yParity;
  if (r === undefined || s === undefined || (yParity !== 0 && yParity !== 1) || !lowS(BigInt(s))) return undefined;
  return { r, s, yParity };
}

/** @throws {never} */
export function readSignedType2(raw: Hex): SignedType2 | undefined {
  if (!raw.toLowerCase().startsWith("0x02")) return undefined;
  try {
    const parsed = parseTransaction(raw);
    if (parsed.type !== "eip1559") return undefined;
    const request = requestOf(parsed);
    const signature = signatureOf(parsed);
    if (request === undefined || signature === undefined || signedType2(request, signature).toLowerCase() !== raw.toLowerCase()) return undefined;
    const recovered = recoverDigest(signingHash(request), `${signature.r}${signature.s.slice(2)}${signature.yParity === 0 ? "1b" : "1c"}`);
    const sender = recovered === undefined ? undefined : evmAddress(recovered);
    return sender === undefined ? undefined : { id: transactionId(raw), request, signature, sender };
  } catch {
    return undefined;
  }
}

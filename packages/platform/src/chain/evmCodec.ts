// spec/settlement/signer.md, "A bind transaction retires only after its revert is finalized at the canonical block"; spec/backend/wallets.md, "The legacy possession verifier issues single-use challenges and keeps one attestation per claim"
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  type Abi,
  AbiEventSignatureNotFoundError,
  type Address,
  type Hex,
  type TypedDataDefinition,
  bytesToHex,
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  hashTypedData,
  hexToBytes,
  keccak256,
} from "viem";

export type { Abi, Address, Hex, TypedDataDefinition };

const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u;
const HASH = /^0x[0-9a-fA-F]{64}$/u;
const DATA = /^0x(?:[0-9a-fA-F]{2})*$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/u;
const HALF_ORDER = BigInt("0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0");

/** @throws {never} */
export function quantity(value: unknown): bigint | undefined {
  return typeof value === "string" && QUANTITY.test(value) ? BigInt(value) : undefined;
}

/** @throws {never} */
export function toQuantity(value: bigint): Hex {
  return `0x${value.toString(16)}`;
}

/** @throws {never} */
export function hash32(value: unknown): Hex | undefined {
  return typeof value === "string" && HASH.test(value) ? (value.toLowerCase() as Hex) : undefined;
}

/** @throws {never} */
export function hexData(value: unknown): Hex | undefined {
  return typeof value === "string" && DATA.test(value) ? (value.toLowerCase() as Hex) : undefined;
}

/** @throws {never} */
export function checksum(address: unknown): Address | undefined {
  if (typeof address !== "string" || !ADDRESS.test(address)) return undefined;
  try {
    return getAddress(address);
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function keccak(bytes: Uint8Array | Hex): Hex {
  return keccak256(bytes);
}

/** @throws {Error} */
export function encodeCall(abi: Abi, functionName: string, args: ReadonlyArray<unknown>): Hex {
  return encodeFunctionData({ abi, functionName, args });
}

/** @throws {Error} */
export function decodeResult(abi: Abi, functionName: string, data: Hex): unknown {
  return decodeFunctionResult({ abi, functionName, data });
}

export interface EventLog {
  readonly topics: ReadonlyArray<Hex>;
  readonly data: Hex;
}

export type DecodedEvent<L extends EventLog> =
  | { readonly kind: "event"; readonly name: string; readonly args: unknown; readonly log: L }
  | { readonly kind: "unknown"; readonly topic: Hex | undefined; readonly log: L }
  | { readonly kind: "malformed"; readonly topic: Hex; readonly log: L };

/** @throws {never} */
export function decodeEvents<L extends EventLog>(abi: Abi, logs: ReadonlyArray<L>): ReadonlyArray<DecodedEvent<L>> {
  return logs.map((log): DecodedEvent<L> => {
    const [topic, ...rest] = log.topics;
    if (topic === undefined) return { kind: "unknown", topic, log };
    try {
      const decoded = decodeEventLog({ abi, topics: [topic, ...rest], data: log.data, strict: true });
      return { kind: "event", name: decoded.eventName ?? "", args: decoded.args, log };
    } catch (error) {
      return error instanceof AbiEventSignatureNotFoundError ? { kind: "unknown", topic, log } : { kind: "malformed", topic, log };
    }
  });
}

/** @throws {Error} */
export function typedDataDigest(typedData: TypedDataDefinition): Hex {
  return hashTypedData(typedData);
}

/** @throws {never} */
export function personalMessageDigest(message: string): Hex {
  const bytes = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${bytes.length}`);
  const data = new Uint8Array(prefix.length + bytes.length);
  data.set(prefix);
  data.set(bytes, prefix.length);
  return keccak256(data);
}

/** @throws {never} */
export function recoverDigest(digest: Hex, signature: string): Address | undefined {
  if (!SIGNATURE.test(signature) || !HASH.test(digest)) return undefined;
  const bytes = hexToBytes(signature as Hex);
  const v = bytes[64] ?? 0;
  const recovery = v >= 27 ? v - 27 : v;
  if (recovery !== 0 && recovery !== 1) return undefined;
  const recovered = new Uint8Array(65);
  recovered[0] = recovery;
  recovered.set(bytes.slice(0, 64), 1);
  try {
    const publicKey = secp256k1.Point.fromBytes(secp256k1.recoverPublicKey(recovered, hexToBytes(digest), { prehash: false })).toBytes(false);
    return getAddress(bytesToHex(hexToBytes(keccak256(publicKey.slice(1))).slice(-20)));
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function recoverPersonalSign(message: string, signature: string): Address | undefined {
  return recoverDigest(personalMessageDigest(message), signature);
}

/** @throws {never} */
export function recoverTypedData(typedData: TypedDataDefinition, signature: string): Address | undefined {
  try {
    return recoverDigest(hashTypedData(typedData), signature);
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function canonicalSignature(signature: string): Hex | undefined {
  if (!SIGNATURE.test(signature)) return undefined;
  const body = signature.slice(2).toLowerCase();
  const v = Number.parseInt(body.slice(128), 16);
  const recovery = v === 0 || v === 1 ? v + 27 : v;
  if ((recovery !== 27 && recovery !== 28) || BigInt(`0x${body.slice(64, 128)}`) > HALF_ORDER) return undefined;
  return `0x${body.slice(0, 128)}${recovery.toString(16)}`;
}

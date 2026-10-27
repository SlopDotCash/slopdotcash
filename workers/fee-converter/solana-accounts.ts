import { sha256 } from "@noble/hashes/sha2.js";
import { solanaBase58 } from "../../contracts/solana/adapter";
import { decodeBase58Bytes } from "../../src/lib/base58";
import type { ParsedTransaction } from "./solana";
export const LOOKUP_TABLE_PROGRAM =
  "AddressLookupTab1e1111111111111111111111111";
type Rpc = <T>(method: string, params: unknown[]) => Promise<T>;
export interface SolanaAccountProof {
  messageHash: string;
  keys: string[];
  loadedWritable: string[];
  loadedReadonly: string[];
  tables: {
    address: string;
    contextSlot: number;
    dataSha256: string;
    lastExtendedSlot: string;
    writableIndexes: number[];
    readonlyIndexes: number[];
    writableAddresses: string[];
    readonlyAddresses: string[];
  }[];
}
const hex = (data: Uint8Array) =>
  Array.from(sha256(data), (x) => x.toString(16).padStart(2, "0")).join("");
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
function publicKey(value: string) {
  const decoded = decodeBase58Bytes(value);
  if (decoded.length !== 32 || solanaBase58(decoded) !== value)
    throw new Error("Invalid resolved Solana public key");
}
/** A retained mapping is tied to all lookup descriptors in the signed message. */
export function verifySolanaAccountProof(
  raw: Uint8Array,
  parsed: ParsedTransaction,
  proof: SolanaAccountProof,
) {
  if (
    !proof ||
    proof.messageHash !==
      solanaBase58(sha256(raw.slice(parsed.messageOffset))) ||
    proof.tables.length !== parsed.lookups.length
  )
    throw new Error("Solana account proof differs from its signed message");
  for (let i = 0; i < parsed.lookups.length; i++) {
    const expected = parsed.lookups[i],
      table = proof.tables[i];
    if (
      table.address !== expected.address ||
      !same(table.writableIndexes, expected.writable) ||
      !same(table.readonlyIndexes, expected.readonly) ||
      table.writableAddresses.length !== expected.writable.length ||
      table.readonlyAddresses.length !== expected.readonly.length ||
      !Number.isSafeInteger(table.contextSlot) ||
      table.contextSlot < 0 ||
      !/^[0-9a-f]{64}$/u.test(table.dataSha256) ||
      !/^(0|[1-9][0-9]*)$/u.test(table.lastExtendedSlot) ||
      BigInt(table.lastExtendedSlot) >= BigInt(table.contextSlot)
    )
      throw new Error("Solana retained lookup evidence is incomplete or stale");
  }
  const writable = proof.tables.flatMap((t) => t.writableAddresses),
    readonly = proof.tables.flatMap((t) => t.readonlyAddresses);
  const keys = [...parsed.staticKeys, ...writable, ...readonly];
  if (
    !same(writable, proof.loadedWritable) ||
    !same(readonly, proof.loadedReadonly) ||
    !same(keys, proof.keys) ||
    new Set(keys).size !== keys.length ||
    keys.length > 256
  )
    throw new Error("Solana resolved account order or identity differs");
  for (const key of keys) publicKey(key);
  return keys;
}

/** Finalized active tables have append-only indexes; never trust a quote's address map. */
export async function resolveSolanaAccounts(
  raw: Uint8Array,
  parsed: ParsedTransaction,
  rpc: Rpc,
): Promise<SolanaAccountProof> {
  const tables: SolanaAccountProof["tables"] = [];
  if (
    new Set(parsed.lookups.map((t) => t.address)).size !== parsed.lookups.length
  )
    throw new Error("Duplicate Solana lookup table");
  for (const lookup of parsed.lookups) {
    const result = await rpc<{
      context: { slot: number };
      value: {
        owner: string;
        executable: boolean;
        data: [string, string];
      } | null;
    }>("getAccountInfo", [
      lookup.address,
      { encoding: "base64", commitment: "finalized" },
    ]);
    if (
      !Number.isSafeInteger(result?.context?.slot) ||
      result.context.slot < 0 ||
      !result.value ||
      result.value.owner !== LOOKUP_TABLE_PROGRAM ||
      result.value.executable ||
      result.value.data?.[1] !== "base64"
    )
      throw new Error("Finalized Solana lookup table is unavailable");
    const bytes = Uint8Array.from(atob(result.value.data[0]), (c) =>
      c.charCodeAt(0),
    );
    if (
      bytes.length < 56 ||
      (bytes.length - 56) % 32 !== 0 ||
      bytes.length > 56 + 256 * 32
    )
      throw new Error("Invalid Solana lookup table layout");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const extended = view.getBigUint64(12, true),
      count = (bytes.length - 56) / 32;
    if (
      view.getUint32(0, true) !== 1 ||
      view.getBigUint64(4, true) !== (1n << 64n) - 1n ||
      extended >= BigInt(result.context.slot) ||
      bytes[20] > count ||
      bytes[21] > 1
    )
      throw new Error("Solana lookup table is inactive or not warmed up");
    const address = (index: number) => {
      if (!Number.isInteger(index) || index < 0 || index >= count)
        throw new Error("Solana lookup index exceeds retained table");
      return solanaBase58(bytes.slice(56 + index * 32, 88 + index * 32));
    };
    tables.push({
      address: lookup.address,
      contextSlot: result.context.slot,
      dataSha256: hex(bytes),
      lastExtendedSlot: extended.toString(),
      writableIndexes: lookup.writable,
      readonlyIndexes: lookup.readonly,
      writableAddresses: lookup.writable.map(address),
      readonlyAddresses: lookup.readonly.map(address),
    });
  }
  const loadedWritable = tables.flatMap((t) => t.writableAddresses),
    loadedReadonly = tables.flatMap((t) => t.readonlyAddresses);
  const proof = {
    messageHash: solanaBase58(sha256(raw.slice(parsed.messageOffset))),
    keys: [...parsed.staticKeys, ...loadedWritable, ...loadedReadonly],
    loadedWritable,
    loadedReadonly,
    tables,
  };
  verifySolanaAccountProof(raw, parsed, proof);
  return proof;
}

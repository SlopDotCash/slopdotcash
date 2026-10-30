import { sha256 } from "@noble/hashes/sha2.js";
import { solanaBase58 } from "../../contracts/solana/adapter";
import {
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from "../../contracts/solana/token-extensions";
import { ata } from "../../contracts/solana/transactions";
import { decodeBase58Bytes } from "../../src/lib/base58";
import type { JupiterRouteExpectation } from "./jupiter-route";
import type { ParsedTransaction } from "./solana";
import type { RouteAccountObservation } from "./solana-route-accounts";
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
  route?: {
    expectation: Omit<
      JupiterRouteExpectation,
      "amountIn" | "quotedOut" | "minimumOut"
    > & {
      amountIn: string;
      quotedOut: string;
      minimumOut: string;
    };
    accounts: RouteAccountObservation[];
  };
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
  if (proof.route) {
    const { expectation, accounts } = proof.route;
    for (const key of [
      expectation.program,
      expectation.wallet,
      expectation.inputMint,
      expectation.outputMint,
      expectation.inputProgram,
      expectation.outputProgram,
    ])
      publicKey(key);
    if (
      expectation.wallet !== keys[0] ||
      (expectation.nativeInput !== undefined &&
        expectation.nativeInput !== true) ||
      !Number.isInteger(expectation.slippageBps) ||
      expectation.slippageBps < 0 ||
      expectation.slippageBps > 10000 ||
      [
        expectation.amountIn,
        expectation.quotedOut,
        expectation.minimumOut,
      ].some((amount) => !/^[1-9][0-9]*$/u.test(amount)) ||
      !Array.isArray(accounts) ||
      accounts.length < keys.length ||
      accounts.length > 512 ||
      new Set(accounts.map((account) => account.address)).size !==
        accounts.length
    )
      throw new Error("Retained route account review is incomplete");
    accounts.forEach((account, index) => {
      publicKey(account.address);
      if (index < keys.length && account.address !== keys[index])
        throw new Error(
          "Retained route account review differs from resolved keys",
        );
      if (
        !Number.isSafeInteger(account.slot) ||
        account.slot < 0 ||
        !Number.isSafeInteger(account.dataLength) ||
        account.dataLength < 0 ||
        (account.owner === null
          ? account.executable !== null ||
            account.lamports !== null ||
            account.dataSha256 !== null ||
            account.dataLength !== 0
          : typeof account.executable !== "boolean" ||
            typeof account.lamports !== "string" ||
            !/^(0|[1-9][0-9]*)$/u.test(account.lamports) ||
            typeof account.dataSha256 !== "string" ||
            !/^[0-9a-f]{64}$/u.test(account.dataSha256))
      )
        throw new Error("Retained route account observation is malformed");
      if (account.owner !== null) publicKey(account.owner);
    });
  }
  return keys;
}

export function retainedRouteExpectation(
  route: NonNullable<SolanaAccountProof["route"]>,
): JupiterRouteExpectation {
  return {
    ...route.expectation,
    amountIn: BigInt(route.expectation.amountIn),
    quotedOut: BigInt(route.expectation.quotedOut),
    minimumOut: BigInt(route.expectation.minimumOut),
  };
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

const ASSOCIATED_TOKEN = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
/** Only the signer's canonical ATA can receive a native rent deposit. */
export function associatedAccountCreations(
  parsed: ParsedTransaction,
  resolved: string[],
  wallet: string,
) {
  if (
    parsed.signatureCount !== 1 ||
    parsed.requiredSignatures !== 1 ||
    parsed.readonlySigned !== 0 ||
    resolved[0] !== wallet
  )
    throw new Error("Native fee payer must be the sole reviewed signer");
  const accounts = new Map<
    number,
    { index: number; mint: string; tokenProgram: string; size: number }
  >();
  for (const ix of parsed.instructions) {
    if (ix.program !== ASSOCIATED_TOKEN) continue;
    const keys = ix.accounts.map((i) => resolved[i]);
    if (
      keys.length < 6 ||
      keys.length > 7 ||
      keys[0] !== wallet ||
      keys[2] !== wallet ||
      keys[4] !== "11111111111111111111111111111111" ||
      (keys[5] !== TOKEN_PROGRAM && keys[5] !== TOKEN_2022_PROGRAM) ||
      (keys.length === 7 &&
        keys[6] !== "SysvarRent111111111111111111111111111111111") ||
      !(ix.data.length === 0 || (ix.data.length === 1 && ix.data[0] <= 1)) ||
      keys[1] !== ata(keys[3], wallet, keys[5])
    )
      throw new Error("Unbounded or unsupported associated-account creation");
    accounts.set(ix.accounts[1], {
      index: ix.accounts[1],
      mint: keys[3],
      tokenProgram: keys[5],
      size: keys[5] === TOKEN_2022_PROGRAM ? 170 : 165,
    });
  }
  return [...accounts.values()];
}

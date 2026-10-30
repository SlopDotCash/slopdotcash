import { sha256 } from "@noble/hashes/sha2.js";
import {
  solanaBase58,
  solanaBase64,
  solanaBase64Bytes,
} from "../../contracts/solana/adapter";
import {
  inspectMintAccount,
  inspectTokenAccount,
} from "../../contracts/solana/token";
import {
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from "../../contracts/solana/token-extensions";
import { decodeBase58Bytes } from "../../src/lib/base58";
import {
  assertJupiterRoute,
  type JupiterRouteExpectation,
} from "./jupiter-route";
import type { ParsedTransaction } from "./solana";
import {
  associatedAccountCreations,
  type SolanaAccountProof,
} from "./solana-accounts";

const SYSTEM = "11111111111111111111111111111111";
const MAX_ACCOUNT_BYTES = 1024 * 1024;
const MAX_ROUTE_BYTES = 4 * 1024 * 1024;
type Rpc = <T>(method: string, params: unknown[]) => Promise<T>;

interface AccountState {
  address: string;
  owner: string;
  executable: boolean;
  lamports: number;
  data: Uint8Array;
  slot: number;
}
export interface RouteAccountObservation {
  address: string;
  owner: string | null;
  executable: boolean | null;
  lamports: string | null;
  dataSha256: string | null;
  dataLength: number;
  slot: number;
}
interface Holding {
  state: AccountState;
  bytes: Uint8Array;
  mint: string;
  wallet: string;
  amount: bigint;
}
export interface ReviewedRouteAccounts {
  source: Holding | null;
  sourceAddress: string;
  destination: Holding | null;
  destinationAddress: string;
  observations: RouteAccountObservation[];
  minimumSlot: number;
  expected: JupiterRouteExpectation;
}

function publicKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const bytes = decodeBase58Bytes(value);
  return bytes.length === 32 && solanaBase58(bytes) === value;
}
function accountState(
  value: unknown,
  address: string,
  slot: number,
): AccountState | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Route account is not an RPC account");
  const account = value as Record<string, unknown>;
  if (
    !publicKey(account.owner) ||
    typeof account.executable !== "boolean" ||
    !Number.isSafeInteger(account.lamports) ||
    (account.lamports as number) < 0 ||
    !Array.isArray(account.data) ||
    account.data.length !== 2 ||
    typeof account.data[0] !== "string" ||
    account.data[1] !== "base64" ||
    account.data[0].length > Math.ceil(MAX_ACCOUNT_BYTES / 3) * 4
  )
    throw new Error("Route account evidence is malformed or too large");
  const data = solanaBase64Bytes(account.data[0]);
  if (data.length > MAX_ACCOUNT_BYTES)
    throw new Error("Route account data exceeds the read bound");
  return {
    address,
    owner: account.owner,
    executable: account.executable,
    lamports: account.lamports as number,
    data,
    slot,
  };
}
const rpcAccount = (state: AccountState) => ({
  owner: state.owner,
  data: [solanaBase64(state.data), "base64"],
});

function holding(state: AccountState): Holding {
  if (state.executable) throw new Error("A route holding cannot be executable");
  const { bytes } = inspectTokenAccount(rpcAccount(state), state.owner);
  return {
    state,
    bytes,
    mint: solanaBase58(bytes.subarray(0, 32)),
    wallet: solanaBase58(bytes.subarray(32, 64)),
    amount: new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(64, true),
  };
}
function isWritable(
  parsed: ParsedTransaction,
  proof: SolanaAccountProof,
  index: number,
) {
  if (index < parsed.requiredSignatures)
    return index < parsed.requiredSignatures - parsed.readonlySigned;
  if (index < parsed.staticKeys.length)
    return index < parsed.staticKeys.length - parsed.readonlyUnsigned;
  return index < parsed.staticKeys.length + proof.loadedWritable.length;
}

/** Inspect every resolved account and every mint backing a token account before signing. */
export async function reviewSolanaRouteAccounts(
  rpc: Rpc,
  raw: Uint8Array,
  parsed: ParsedTransaction,
  proof: SolanaAccountProof,
  expected: JupiterRouteExpectation,
): Promise<ReviewedRouteAccounts> {
  const route = assertJupiterRoute(raw, parsed, proof, expected);
  const minimumSlot = Math.max(
    0,
    ...proof.tables.map((table) => table.contextSlot),
  );
  const states = new Map<string, AccountState | null>();
  const observations: RouteAccountObservation[] = [];
  let totalBytes = 0;
  const read = async (addresses: string[]) => {
    for (let offset = 0; offset < addresses.length; offset += 100) {
      const batch = addresses.slice(offset, offset + 100);
      const response = await rpc<{
        context: { slot: number };
        value: unknown[];
      }>("getMultipleAccounts", [
        batch,
        {
          encoding: "base64",
          commitment: "finalized",
          ...(minimumSlot ? { minContextSlot: minimumSlot } : {}),
        },
      ]);
      if (
        !Number.isSafeInteger(response?.context?.slot) ||
        response.context.slot < minimumSlot ||
        !Array.isArray(response.value) ||
        response.value.length !== batch.length
      )
        throw new Error(
          "Complete finalized route account evidence is unavailable",
        );
      batch.forEach((address, index) => {
        const state = accountState(
          response.value[index],
          address,
          response.context.slot,
        );
        totalBytes += state?.data.length ?? 0;
        if (totalBytes > MAX_ROUTE_BYTES)
          throw new Error("Route account evidence exceeds the read bound");
        states.set(address, state);
        observations.push({
          address,
          owner: state?.owner ?? null,
          executable: state?.executable ?? null,
          lamports: state ? String(state.lamports) : null,
          dataLength: state?.data.length ?? 0,
          dataSha256: state
            ? [...sha256(state.data)]
                .map((byte) => byte.toString(16).padStart(2, "0"))
                .join("")
            : null,
          slot: response.context.slot,
        });
      });
    }
  };
  await read(proof.keys);
  const creations = associatedAccountCreations(
    parsed,
    proof.keys,
    expected.wallet,
  );
  for (const entry of creations) {
    if (
      !(
        (proof.keys[entry.index] === route.destination &&
          entry.mint === expected.outputMint &&
          entry.tokenProgram === expected.outputProgram) ||
        (expected.nativeInput &&
          proof.keys[entry.index] === route.source &&
          entry.mint === expected.inputMint &&
          entry.tokenProgram === expected.inputProgram)
      )
    )
      throw new Error("Route creates an unrelated associated token account");
  }
  const created = new Set(creations.map((entry) => proof.keys[entry.index]));
  const holdings = new Map<string, Holding>();
  const mints = new Map<string, string>([
    [expected.inputMint, expected.inputProgram],
    [expected.outputMint, expected.outputProgram],
  ]);
  proof.keys.forEach((address, index) => {
    const state = states.get(address);
    if (!state) {
      if (isWritable(parsed, proof, index) && !created.has(address))
        throw new Error("Route creates an unreviewed writable account");
      return;
    }
    if (state.owner !== TOKEN_PROGRAM && state.owner !== TOKEN_2022_PROGRAM)
      return;
    if (
      state.data.length === 82 ||
      (state.owner === TOKEN_2022_PROGRAM && state.data[165] === 1)
    ) {
      if (state.executable)
        throw new Error("Route mint account cannot be executable");
      inspectMintAccount(rpcAccount(state), address);
      if (mints.has(address) && mints.get(address) !== state.owner)
        throw new Error("Route mints have inconsistent token programs");
      mints.set(address, state.owner);
      return;
    }
    const token = holding(state);
    holdings.set(address, token);
    if (mints.has(token.mint) && mints.get(token.mint) !== state.owner)
      throw new Error("Route mints have inconsistent token programs");
    mints.set(token.mint, state.owner);
    if (
      token.wallet === expected.wallet &&
      isWritable(parsed, proof, index) &&
      address !== route.source &&
      address !== route.destination
    )
      throw new Error("Route can write an unrelated fee-wallet token account");
  });
  await read([...mints.keys()].filter((address) => !states.has(address)));
  for (const [mint, program] of mints) {
    const state = states.get(mint);
    if (
      !state ||
      state.executable ||
      inspectMintAccount(rpcAccount(state), mint).tokenProgram !== program
    )
      throw new Error(
        "Route token holding has an unverified mint or token program",
      );
  }
  for (const program of parsed.programs)
    if (!states.get(program)?.executable)
      throw new Error("Route invokes an unverified program account");
  const wallet = states.get(expected.wallet);
  if (
    !wallet ||
    wallet.owner !== SYSTEM ||
    wallet.executable ||
    wallet.data.length !== 0
  )
    throw new Error("Route fee payer is not a system wallet");
  const source = holdings.get(route.source) ?? null;
  const destination = holdings.get(route.destination) ?? null;
  if (
    source
      ? source.wallet !== expected.wallet ||
        source.mint !== expected.inputMint ||
        source.state.owner !== expected.inputProgram ||
        (!expected.nativeInput && source.amount < expected.amountIn) ||
        source.bytes[108] !== 1
      : !expected.nativeInput || !created.has(route.source)
  )
    throw new Error("Route input holding does not cover the reviewed swap");
  if (
    destination
      ? destination.wallet !== expected.wallet ||
        destination.mint !== expected.outputMint ||
        destination.state.owner !== expected.outputProgram ||
        destination.bytes[108] !== 1
      : !created.has(route.destination)
  )
    throw new Error(
      "Route output is not the fee wallet's admitted token account",
    );
  return {
    source,
    sourceAddress: route.source,
    destination,
    destinationAddress: route.destination,
    observations,
    minimumSlot: Math.max(
      minimumSlot,
      ...observations.map((entry) => entry.slot),
    ),
    expected,
  };
}

/** Prove exact input loss, minimum output gain, and unchanged account authorities in simulation. */
export function assertSolanaRouteSimulation(
  review: ReviewedRouteAccounts,
  slot: number,
  accounts: unknown[],
) {
  if (
    !Number.isSafeInteger(slot) ||
    slot < review.minimumSlot ||
    accounts.length !== 2
  )
    throw new Error("Route simulation account evidence is incomplete or stale");
  const sourceState = accountState(accounts[0], review.sourceAddress, slot);
  const destinationState = accountState(
    accounts[1],
    review.destinationAddress,
    slot,
  );
  if (!sourceState || !destinationState)
    throw new Error("Route simulation removed a wallet token account");
  const source = holding(sourceState),
    destination = holding(destinationState);
  const unchanged = (before: Holding, after: Holding) =>
    before.state.owner === after.state.owner &&
    before.bytes.length === after.bytes.length &&
    before.bytes.every(
      (byte, index) =>
        (index >= 64 && index < 72) || byte === after.bytes[index],
    );
  if (
    (review.source && !unchanged(review.source, source)) ||
    (review.destination && !unchanged(review.destination, destination))
  )
    throw new Error(
      "Route simulation changes a wallet token account's authority or layout",
    );
  if (
    destination.state.owner !== review.expected.outputProgram ||
    destination.wallet !== review.expected.wallet ||
    destination.mint !== review.expected.outputMint ||
    destination.bytes[108] !== 1
  )
    throw new Error("Route simulation redirected the output");
  for (const created of [
    review.source ? null : source,
    review.destination ? null : destination,
  ]) {
    if (!created) continue;
    const view = new DataView(created.bytes.buffer, created.bytes.byteOffset);
    if (view.getUint32(72, true) !== 0 || view.getUint32(129, true) !== 0)
      throw new Error("Route simulation delegated a new token account");
  }
  if (
    source.state.owner !== review.expected.inputProgram ||
    source.wallet !== review.expected.wallet ||
    source.mint !== review.expected.inputMint ||
    source.bytes[108] !== 1
  )
    throw new Error("Route simulation redirected the input");
  if (
    (review.source?.amount ?? 0n) - source.amount !==
      (review.expected.nativeInput ? 0n : review.expected.amountIn) ||
    destination.amount - (review.destination?.amount ?? 0n) <
      review.expected.minimumOut
  )
    throw new Error(
      "Route simulation does not match the exact input and minimum output",
    );
}

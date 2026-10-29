/** Exact unsigned wallet transactions shared by funding and award commitment. */
import { ed25519 } from "@noble/curves/ed25519.js";
import { decodeBase58Bytes } from "../../src/lib/base58";
import {
  type SolanaEscrowConfig,
  type SolanaProgramConfig,
  solanaBase58,
  solanaRpc,
  verifySolanaDeployment,
  verifySolanaProgram,
} from "./adapter";
import { bytes, concat, type Instruction, message } from "./transactions";

export class SolanaWalletActionError extends Error {}
const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const decode = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SolanaWalletActionError("Invalid chain response");
  return value as Record<string, unknown>;
}
/** Plans and simulates only. This module never signs or broadcasts. */
export async function prepareSolanaWalletTransaction(
  config: { rpcUrl: string },
  wallet: string,
  instructions: Instruction[],
) {
  const latest = object(
    object(
      await solanaRpc(config, "getLatestBlockhash", [
        { commitment: "finalized" },
      ]),
    ).value,
  );
  if (
    typeof latest.blockhash !== "string" ||
    !Number.isSafeInteger(latest.lastValidBlockHeight)
  )
    throw new SolanaWalletActionError(
      "The chain did not return a valid transaction lifetime.",
    );
  const msg = message(wallet, latest.blockhash, instructions);
  const wire = encode(concat(Uint8Array.of(1), new Uint8Array(64), msg));
  const feeResult = object(
    await solanaRpc(config, "getFeeForMessage", [
      encode(msg),
      { commitment: "finalized" },
    ]),
  );
  if (!Number.isSafeInteger(feeResult.value) || Number(feeResult.value) < 0)
    throw new SolanaWalletActionError(
      "The network fee could not be calculated. Review again.",
    );
  const native = object(
    await solanaRpc(config, "getBalance", [
      wallet,
      { commitment: "finalized" },
    ]),
  );
  if (
    !Number.isSafeInteger(native.value) ||
    Number(native.value) < Number(feeResult.value)
  )
    throw new SolanaWalletActionError(
      "Your wallet needs SOL for the network fee.",
    );
  const simulation = object(
    object(
      await solanaRpc(config, "simulateTransaction", [
        wire,
        { encoding: "base64", sigVerify: false, commitment: "finalized" },
      ]),
    ).value,
  );
  if (simulation.err !== null)
    throw new SolanaWalletActionError(
      "This action could not be simulated. Check the token balance and SOL for network fees and account rent, then review again.",
    );
  return {
    blockhash: latest.blockhash,
    lastValidBlockHeight: Number(latest.lastValidBlockHeight),
    transaction: wire,
    networkFeeLamports: String(feeResult.value),
  };
}
/** Require the submitted signature and finalized bytes to match the reviewed message. */
export async function checkSolanaWalletTransaction(
  config: SolanaEscrowConfig,
  wallet: string,
  msg: Uint8Array,
  transactionId: string,
  allowWalletGuards = false,
) {
  await verifySolanaDeployment(config);
  return checkTransaction(
    config,
    wallet,
    msg,
    transactionId,
    allowWalletGuards,
  );
}
/** Creation has no project yet; verify infrastructure and the exact finalized message. */
export async function checkSolanaCreationTransaction(
  config: SolanaProgramConfig,
  wallet: string,
  msg: Uint8Array,
  transactionId: string,
) {
  await verifySolanaProgram(config);
  return checkTransaction(config, wallet, msg, transactionId, true);
}

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const LIGHTHOUSE = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";
const SYSTEM = "11111111111111111111111111111111";
const mismatch = () =>
  new SolanaWalletActionError(
    "This transaction does not match the pending wallet action. Check its signature in your wallet.",
  );

/** Decode only the single-signer legacy format emitted by our transaction builder. */
function walletMessage(data: Uint8Array) {
  let offset = 0;
  const take = (length: number) => {
    if (offset + length > data.length) throw mismatch();
    const value = data.slice(offset, offset + length);
    offset += length;
    return value;
  };
  const short = () => {
    let value = 0;
    for (let shift = 0; shift <= 14; shift += 7) {
      const byte = take(1)[0];
      value |= (byte & 127) << shift;
      if (byte < 128) {
        if (shift > 0 && byte === 0) throw mismatch();
        return value;
      }
    }
    throw mismatch();
  };
  const header = take(3);
  if (header[0] !== 1 || header[1] !== 0) throw mismatch();
  const count = short();
  if (count < 1 || count > 256 || header[2] >= count) throw mismatch();
  const keys = Array.from({ length: count }, () => solanaBase58(take(32)));
  if (new Set(keys).size !== count) throw mismatch();
  const blockhash = solanaBase58(take(32));
  const writable = (index: number) => index < count - header[2];
  const instructionCount = short();
  if (instructionCount > data.length - offset) throw mismatch();
  const instructions = Array.from({ length: instructionCount }, () => {
    const programIndex = take(1)[0];
    const accountIndices = Array.from(take(short()));
    if (programIndex >= count || accountIndices.some((index) => index >= count))
      throw mismatch();
    return {
      program: keys[programIndex],
      accounts: accountIndices.map((index) => keys[index]),
      data: take(short()),
    };
  });
  if (offset !== data.length) throw mismatch();
  return { keys, blockhash, writable, instructions };
}

/**
 * Wallets may prepend compute fees and append their payer safety assertion.
 * Every application instruction, privilege and signer remains exact. The
 * Lighthouse exception is the observed AssertAccountInfoMulti encoding only:
 * payer lamports >= floor, System owner, and empty data. No CPI or other
 * account is admitted, so it cannot change the application's funds or state.
 * Source: Jac0xb/lighthouse, instruction.rs and types/assert/account_info.rs.
 */
async function checkedWalletGuards(
  config: { rpcUrl: string },
  wallet: string,
  expectedBytes: Uint8Array,
  actualBytes: Uint8Array,
  meta: Record<string, unknown>,
) {
  const expected = walletMessage(expectedBytes);
  const actual = walletMessage(actualBytes);
  if (
    actual.keys[0] !== wallet ||
    expected.keys[0] !== wallet ||
    actual.blockhash !== expected.blockhash
  )
    throw mismatch();
  const additionalPrograms = new Set<string>();
  const computeTypes = new Set<number>();
  let start = 0;
  while (actual.instructions[start]?.program === COMPUTE_BUDGET) {
    const instruction = actual.instructions[start++];
    const kind = instruction.data[0];
    if (
      instruction.accounts.length !== 0 ||
      !(
        (kind === 2 && instruction.data.length === 5) ||
        (kind === 3 && instruction.data.length === 9)
      ) ||
      computeTypes.has(kind)
    )
      throw mismatch();
    computeTypes.add(kind);
    additionalPrograms.add(COMPUTE_BUDGET);
  }
  const end = start + expected.instructions.length;
  for (let index = 0; index < expected.instructions.length; index++) {
    const wanted = expected.instructions[index];
    const observed = actual.instructions[start + index];
    if (
      !observed ||
      observed.program !== wanted.program ||
      observed.accounts.join("\0") !== wanted.accounts.join("\0") ||
      observed.data.length !== wanted.data.length ||
      observed.data.some((byte, position) => byte !== wanted.data[position])
    )
      throw mismatch();
  }
  if (actual.instructions.length === end + 1) {
    const assertion = actual.instructions[end];
    const data = assertion.data;
    if (
      assertion.program !== LIGHTHOUSE ||
      assertion.accounts.length !== 1 ||
      assertion.accounts[0] !== wallet ||
      data.length !== 26 ||
      data[0] !== 6 ||
      data[1] !== 4 ||
      data[2] !== 3 ||
      data[3] !== 0 ||
      data[12] !== 4 ||
      data[13] !== 3 ||
      data[14] !== 0 ||
      data[15] !== 0 ||
      data[16] !== 1 ||
      data.slice(17).some((byte) => byte !== 0) ||
      !Array.isArray(meta.innerInstructions) ||
      meta.innerInstructions.some((entry) => {
        const inner = object(entry);
        if (
          !Number.isSafeInteger(inner.index) ||
          Number(inner.index) < 0 ||
          Number(inner.index) >= actual.instructions.length ||
          !Array.isArray(inner.instructions)
        )
          throw mismatch();
        return inner.index === end && inner.instructions.length > 0;
      }) ||
      !Array.isArray(meta.postBalances) ||
      !Number.isSafeInteger(meta.postBalances[0]) ||
      BigInt(meta.postBalances[0]) <
        new DataView(data.buffer).getBigUint64(4, true)
    )
      throw mismatch();
    const payer = object(
      object(
        await solanaRpc(config, "getAccountInfo", [
          wallet,
          { commitment: "finalized", encoding: "base64" },
        ]),
      ).value,
    );
    if (
      payer.owner !== SYSTEM ||
      payer.executable !== false ||
      !Array.isArray(payer.data) ||
      payer.data[0] !== "" ||
      payer.data[1] !== "base64"
    )
      throw mismatch();
    additionalPrograms.add(LIGHTHOUSE);
  } else if (actual.instructions.length !== end) throw mismatch();
  const expectedKeys = new Map(expected.keys.map((key, index) => [key, index]));
  for (const [index, key] of actual.keys.entries()) {
    const previous = expectedKeys.get(key);
    if (previous === undefined) {
      if (!additionalPrograms.has(key) || actual.writable(index))
        throw mismatch();
    } else if (actual.writable(index) !== expected.writable(previous))
      throw mismatch();
  }
  if (expected.keys.some((key) => !actual.keys.includes(key))) throw mismatch();
  return actual.keys;
}

async function checkTransaction(
  config: { rpcUrl: string },
  wallet: string,
  msg: Uint8Array,
  transactionId: string,
  allowWalletGuards = false,
) {
  const signature = decodeBase58Bytes(transactionId);
  if (signature.length !== 64)
    throw new SolanaWalletActionError(
      "Enter a Solana transaction signature from your wallet.",
    );
  const exactSignature = ed25519.verify(signature, msg, bytes(wallet), {
    zip215: false,
  });
  if (!exactSignature && !allowWalletGuards)
    throw new SolanaWalletActionError(
      "This transaction does not match the pending wallet action. Check its signature in your wallet.",
    );
  const response = object(
    await solanaRpc(config, "getSignatureStatuses", [
      [transactionId],
      { searchTransactionHistory: true },
    ]),
  );
  if (!Array.isArray(response.value) || response.value.length !== 1)
    throw new SolanaWalletActionError("Invalid transaction status response.");
  if (response.value[0] === null)
    return { status: "pending" as const, meta: null };
  const status = object(response.value[0]);
  if (status.confirmationStatus !== "finalized")
    return { status: "pending" as const, meta: null };
  const raw = await solanaRpc(config, "getTransaction", [
    transactionId,
    {
      encoding: "base64",
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    },
  ]);
  if (!raw) return { status: "pending" as const, meta: null };
  const tx = object(raw);
  if (
    !Number.isSafeInteger(tx.slot) ||
    tx.slot !== status.slot ||
    !Array.isArray(tx.transaction) ||
    tx.transaction[1] !== "base64" ||
    typeof tx.transaction[0] !== "string"
  )
    throw new SolanaWalletActionError(
      "The finalized transaction could not be verified.",
    );
  const wire = decode(tx.transaction[0]);
  const expected = concat(Uint8Array.of(1), signature, msg);
  const meta = object(tx.meta);
  let accountKeys: string[];
  if (
    wire.length !== expected.length ||
    wire.some((byte, index) => byte !== expected[index])
  ) {
    if (!allowWalletGuards)
      throw new SolanaWalletActionError(
        "The finalized transaction differs from the reviewed action.",
      );
    if (
      wire[0] !== 1 ||
      wire.length <= 65 ||
      signature.some((byte, index) => wire[index + 1] !== byte) ||
      !ed25519.verify(signature, wire.slice(65), bytes(wallet), {
        zip215: false,
      })
    )
      throw mismatch();
    accountKeys = await checkedWalletGuards(
      config,
      wallet,
      msg,
      wire.slice(65),
      meta,
    );
  } else accountKeys = walletMessage(msg).keys;
  if (meta.err !== null) return { status: "failed" as const, meta: null };
  if (status.err !== null)
    throw new SolanaWalletActionError(
      "Finalized transaction status disagrees with its receipt.",
    );
  return { status: "finalized" as const, meta, accountKeys };
}

/** Exact unsigned wallet transactions shared by funding and award commitment. */
import { ed25519 } from "@noble/curves/ed25519.js";
import { decodeBase58Bytes } from "../../src/lib/base58";
import {
  type SolanaEscrowConfig,
  type SolanaProgramConfig,
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
) {
  await verifySolanaDeployment(config);
  return checkTransaction(config, wallet, msg, transactionId);
}
/** Creation has no project yet; verify infrastructure and the exact finalized message. */
export async function checkSolanaCreationTransaction(
  config: SolanaProgramConfig,
  wallet: string,
  msg: Uint8Array,
  transactionId: string,
) {
  await verifySolanaProgram(config);
  return checkTransaction(config, wallet, msg, transactionId);
}
async function checkTransaction(
  config: { rpcUrl: string },
  wallet: string,
  msg: Uint8Array,
  transactionId: string,
) {
  const signature = decodeBase58Bytes(transactionId);
  if (signature.length !== 64)
    throw new SolanaWalletActionError(
      "Enter a Solana transaction signature from your wallet.",
    );
  if (!ed25519.verify(signature, msg, bytes(wallet), { zip215: false }))
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
  if (
    wire.length !== expected.length ||
    wire.some((byte, index) => byte !== expected[index])
  )
    throw new SolanaWalletActionError(
      "The finalized transaction differs from the reviewed action.",
    );
  const meta = object(tx.meta);
  if (meta.err !== null) return { status: "failed" as const, meta: null };
  if (status.err !== null)
    throw new SolanaWalletActionError(
      "Finalized transaction status disagrees with its receipt.",
    );
  return { status: "finalized" as const, meta };
}

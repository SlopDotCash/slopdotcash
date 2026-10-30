import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  solanaBase58,
  solanaBase64,
  solanaBase64Bytes,
  solanaPublicKeyBytes,
  solanaRpc,
} from "../../contracts/solana/adapter";
import { decodeBase58Bytes } from "../../src/lib/base58";
import {
  type ExpiryCoverageStore,
  proveSolanaExpiry,
  type RecoveryRpc,
  recoveryOperator,
} from "../../workers/fee-converter/solana-expiry";

const MAINNET = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
type Plan = {
  messageId: string;
  transaction: string;
  blockhash: string;
  blockhashSlot: number;
  lastValidBlockHeight: number;
};
type Input = {
  rpcUrl: string;
  recoveryRpcUrl?: string;
  genesisHash: string;
  payer: string;
  plans: Plan[];
  signatures: { messageId: string; signature: string }[];
  store: ExpiryCoverageStore;
};
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Inspect the retained unsigned legacy message, never a replacement from the client. */
function message(plan: Plan, payer: string) {
  const wire = solanaBase64Bytes(plan.transaction);
  if (
    wire.length > 1232 ||
    wire.length < 134 ||
    wire[0] !== 1 ||
    wire.slice(1, 65).some((value) => value !== 0)
  )
    throw new Error("Invalid retained Solana payment");
  const bytes = wire.slice(65);
  // A legacy message with one signer; its first account is the fee payer.
  if (bytes[0] !== 1 || bytes[1] !== 0 || bytes[3] < 1 || bytes[3] >= 128)
    throw new Error("Invalid retained Solana payment");
  const blockhashOffset = 4 + bytes[3] * 32;
  if (
    bytes.length <= blockhashOffset + 32 ||
    solanaBase58(bytes.slice(4, 36)) !== payer ||
    solanaBase58(bytes.slice(blockhashOffset, blockhashOffset + 32)) !==
      plan.blockhash ||
    solanaBase58(sha256(bytes)) !== plan.messageId ||
    !integer(plan.blockhashSlot) ||
    !integer(plan.lastValidBlockHeight)
  )
    throw new Error("Invalid retained Solana payment");
  return bytes;
}

function provider(endpoint: string, genesis: string) {
  let operator = recoveryOperator(endpoint);
  // A validator fixture is not independent mainnet evidence. Keep this exception
  // restricted to a non-mainnet genesis and two distinct loopback endpoints.
  if (!operator && genesis !== MAINNET) {
    const url = new URL(endpoint);
    if (
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    )
      operator = `local-validator:${url.host}`;
  }
  if (!operator) return null;
  return {
    operator,
    rpc: (<T>(method: string, params: unknown[]) =>
      solanaRpc(
        { rpcUrl: endpoint },
        method,
        params,
      ) as Promise<T>) as RecoveryRpc,
  };
}

/** A replacement requires every issued message to expire and two independent
 * retained histories to prove absence or a finalized failed transaction. */
export async function retireSolanaPlans(input: Input): Promise<
  | { state: "expiry-required" | "history-check" }
  | {
      state: "signature-required";
      challenges: { messageId: string; message: string }[];
    }
  | { state: "payment-found"; transactionIds: string[] }
  | { state: "retired"; proof: unknown }
> {
  if (
    !input.plans.length ||
    input.plans.length > 64 ||
    input.signatures.length > 64
  )
    throw new Error("Invalid Solana recovery request");
  const payer = solanaPublicKeyBytes(input.payer);
  if (solanaBase58(payer) !== input.payer)
    throw new Error("Invalid Solana recovery payer");
  const messages = new Map<string, Uint8Array>();
  for (const plan of input.plans) {
    if (messages.has(plan.messageId))
      throw new Error("Duplicate retained Solana payment");
    messages.set(plan.messageId, message(plan, input.payer));
  }
  const first = provider(input.rpcUrl, input.genesisHash);
  const second =
    input.recoveryRpcUrl && provider(input.recoveryRpcUrl, input.genesisHash);
  if (!first || !second || first.operator === second.operator)
    return { state: "history-check" };
  const providers = [first, second];
  try {
    // Do not expose a raw-sign challenge while any payment is executable.
    for (const p of providers) {
      if ((await p.rpc("getGenesisHash", [])) !== input.genesisHash)
        return { state: "history-check" };
      for (const plan of input.plans) {
        const anchor = await p.rpc<{ blockhash: string } | null>("getBlock", [
          plan.blockhashSlot,
          {
            commitment: "finalized",
            transactionDetails: "none",
            rewards: false,
            maxSupportedTransactionVersion: 0,
          },
        ]);
        if (anchor?.blockhash !== plan.blockhash)
          return { state: "history-check" };
        const valid = await p.rpc<{
          context: { slot: number };
          value: boolean;
        }>("isBlockhashValid", [
          plan.blockhash,
          { commitment: "finalized", minContextSlot: plan.blockhashSlot },
        ]);
        const height = await p.rpc<number>("getBlockHeight", [
          { commitment: "finalized" },
        ]);
        if (
          !integer(valid?.context?.slot) ||
          valid.context.slot < plan.blockhashSlot ||
          !integer(height)
        )
          return { state: "history-check" };
        if (valid.value !== false || height <= plan.lastValidBlockHeight)
          return { state: "expiry-required" };
      }
    }
  } catch {
    return { state: "history-check" };
  }
  const signed = new Map<string, string>();
  for (const entry of input.signatures) {
    const bytes = messages.get(entry.messageId);
    if (!bytes || signed.has(entry.messageId) || entry.signature.length > 88)
      throw new Error("Invalid Solana recovery signature");
    const signature = decodeBase58Bytes(entry.signature);
    if (
      signature.length !== 64 ||
      solanaBase58(signature) !== entry.signature ||
      !ed25519.verify(signature, bytes, payer, { zip215: false })
    )
      throw new Error("Invalid Solana recovery signature");
    signed.set(entry.messageId, entry.signature);
  }
  const missing = input.plans.filter((plan) => !signed.has(plan.messageId));
  if (missing.length)
    return {
      state: "signature-required",
      challenges: missing.map((plan) => ({
        messageId: plan.messageId,
        message: solanaBase64(messages.get(plan.messageId)!),
      })),
    };
  const found = new Set<string>();
  const proofs: unknown[] = [];
  let incomplete = false;
  try {
    for (const plan of input.plans) {
      const signature = signed.get(plan.messageId)!;
      const failures: {
        operator: string;
        slot: number;
        blockhash: string;
        error: string;
      }[] = [];
      for (const p of providers) {
        const statuses = await p.rpc<{
          context: { slot: number };
          value: ({
            slot: number;
            err: unknown;
            confirmationStatus: string;
          } | null)[];
        }>("getSignatureStatuses", [
          [signature],
          { searchTransactionHistory: true },
        ]);
        if (
          !integer(statuses?.context?.slot) ||
          statuses.context.slot < plan.blockhashSlot ||
          statuses.value?.length !== 1
        )
          return { state: "history-check" };
        const status = statuses.value[0];
        const receipt = await p.rpc<{
          slot: number;
          meta: { err: unknown };
          transaction: [string, string];
        } | null>("getTransaction", [
          signature,
          {
            commitment: "finalized",
            encoding: "base64",
            maxSupportedTransactionVersion: 0,
          },
        ]);
        if (status === null && receipt === null) continue;
        if (
          status?.confirmationStatus === "finalized" &&
          status.err != null &&
          receipt?.meta?.err != null &&
          integer(status.slot) &&
          receipt.slot === status.slot &&
          JSON.stringify(receipt.meta.err) === JSON.stringify(status.err) &&
          Array.isArray(receipt.transaction) &&
          receipt.transaction[1] === "base64"
        ) {
          const wire = solanaBase64Bytes(receipt.transaction[0]);
          const expected = messages.get(plan.messageId)!;
          const block = await p.rpc<{
            blockhash: string;
            signatures: string[];
          } | null>("getBlock", [
            status.slot,
            {
              commitment: "finalized",
              transactionDetails: "signatures",
              rewards: false,
              maxSupportedTransactionVersion: 0,
            },
          ]);
          if (
            wire[0] !== 1 ||
            solanaBase58(wire.slice(1, 65)) !== signature ||
            wire.length !== expected.length + 65 ||
            !expected.every((byte, i) => wire[i + 65] === byte) ||
            !block?.signatures?.includes(signature) ||
            typeof block.blockhash !== "string"
          )
            return { state: "history-check" };
          failures.push({
            operator: p.operator,
            slot: status.slot,
            blockhash: block.blockhash,
            error: JSON.stringify(status.err),
          });
        } else found.add(signature);
      }
      if (found.size) continue;
      if (failures.length) {
        if (
          failures.length !== 2 ||
          failures[0].slot !== failures[1].slot ||
          failures[0].blockhash !== failures[1].blockhash ||
          failures[0].error !== failures[1].error
        ) {
          incomplete = true;
        } else
          proofs.push({
            messageId: plan.messageId,
            txId: signature,
            failed: failures,
          });
        continue;
      }
      const proof = await proveSolanaExpiry(
        signature,
        plan.blockhash,
        plan.blockhashSlot,
        providers,
        input.store,
        input.genesisHash,
      );
      if (!proof) incomplete = true;
      else proofs.push({ messageId: plan.messageId, ...proof });
    }
  } catch {
    return { state: "history-check" };
  }
  return found.size
    ? { state: "payment-found", transactionIds: [...found] }
    : incomplete
      ? { state: "history-check" }
      : {
          state: "retired",
          proof: { genesisHash: input.genesisHash, messages: proofs },
        };
}

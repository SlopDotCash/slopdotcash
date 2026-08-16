/** Queries finalized Solana data and emits reviewed direct-funding evidence. */

import { isSolanaTransactionId } from "../src/lib/funding-address.mjs";
import {
  assertFinalizedUsdcFundingTransfer,
  SOLANA_FUNDING_VERIFIER_VERSION,
} from "../src/lib/solana-settlement";
import { isSolanaAddress } from "../src/lib/wallets";

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";
const MAX_RPC_BYTES = 8 * 1024 * 1024;

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new TypeError(`${name} requires a value`);
  }
  return value;
}

export async function verifyFundingSolana(input: {
  amountMinor: string;
  fetchImpl?: (url: URL, init?: RequestInit) => Promise<Response>;
  recipient: string;
  rpcUrl?: string;
  signature: string;
}) {
  if (
    !isSolanaTransactionId(input.signature) ||
    !isSolanaAddress(input.recipient) ||
    input.amountMinor.length > 40 ||
    !/^[1-9]\d*$/u.test(input.amountMinor)
  ) {
    throw new TypeError("signature, recipient, or amount is invalid");
  }
  const rpc = new URL(input.rpcUrl ?? DEFAULT_RPC);
  if (rpc.protocol !== "https:" || rpc.username || rpc.password || rpc.hash) {
    throw new TypeError("Solana RPC must be a credential-free HTTPS URL");
  }
  const response = await (input.fetchImpl ?? fetch)(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [
        input.signature,
        {
          commitment: "finalized",
          encoding: "jsonParsed",
          maxSupportedTransactionVersion: 0,
        },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(`Solana RPC returned HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_RPC_BYTES) {
    throw new RangeError("Solana RPC response is empty or oversized");
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch (error) {
    throw new TypeError("Solana RPC response is invalid JSON", {
      cause: error,
    });
  }
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    Array.isArray(envelope)
  ) {
    throw new TypeError("Solana RPC response is invalid");
  }
  const result = (envelope as Record<string, unknown>).result;
  if (result === null || result === undefined) {
    throw new TypeError("Solana transaction is absent at finalized commitment");
  }
  const verified = assertFinalizedUsdcFundingTransfer(
    result,
    input.signature,
    input.recipient,
    input.amountMinor,
  );
  const checkedAt = new Date().toISOString();
  return {
    state: "verified-on-chain" as const,
    finality: { kind: "finalized" as const },
    verifier: {
      version: SOLANA_FUNDING_VERIFIER_VERSION,
      checkedAt,
      evidenceUrl: `https://solscan.io/tx/${input.signature}`,
      reason: null,
    },
    chainEvidence: verified,
  };
}

if (import.meta.main) {
  const signature = argument("--signature");
  const recipient = argument("--recipient");
  const amountMinor = argument("--amount-minor");
  const rpcUrl = argument("--rpc-url") ?? undefined;
  if (!signature || !recipient || !amountMinor) {
    throw new TypeError(
      "Usage: verify-funding-solana.ts --signature <signature> --recipient <owner> --amount-minor <integer> [--rpc-url <https-url>]",
    );
  }
  process.stdout.write(
    `${JSON.stringify(await verifyFundingSolana({ signature, recipient, amountMinor, rpcUrl }), null, 2)}\n`,
  );
}

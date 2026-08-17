/** Queries finalized Solana data and emits reviewed direct-funding evidence. */

import { isSolanaTransactionId } from "../src/lib/funding-address.mjs";
import {
  assertFinalizedUsdcFundingTransfer,
  SOLANA_FUNDING_VERIFIER_VERSION,
} from "../src/lib/solana-settlement";
import { isSolanaAddress } from "../src/lib/wallets";
import {
  DEFAULT_SOLANA_RPC_URL,
  fetchFinalizedSolanaTransaction,
} from "./solana-rpc";

const MAX_RPC_BYTES = 8 * 1024 * 1024;
const CLI_ARGUMENTS = new Set([
  "--signature",
  "--recipient",
  "--amount-minor",
  "--rpc-url",
]);
const CLI_USAGE =
  "Usage: verify-funding-solana.ts --signature <signature> --recipient <owner> --amount-minor <integer> [--rpc-url <https-url>]";

export function parseSolanaFundingArguments(argv: readonly string[]) {
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      !name ||
      !CLI_ARGUMENTS.has(name) ||
      !value ||
      value.startsWith("--") ||
      parsed.has(name)
    ) {
      throw new TypeError(CLI_USAGE);
    }
    parsed.set(name, value);
  }
  return {
    signature: parsed.get("--signature") ?? null,
    recipient: parsed.get("--recipient") ?? null,
    amountMinor: parsed.get("--amount-minor") ?? null,
    rpcUrl: parsed.get("--rpc-url") ?? null,
  };
}

export async function verifyFundingSolana(input: {
  amountMinor: string;
  fetchImpl?: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
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
  const result = await fetchFinalizedSolanaTransaction(
    input.rpcUrl ?? DEFAULT_SOLANA_RPC_URL,
    input.signature,
    {
      fetcher: input.fetchImpl,
      maxBytes: MAX_RPC_BYTES,
    },
  );
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
  const { signature, recipient, amountMinor, rpcUrl } =
    parseSolanaFundingArguments(process.argv.slice(2));
  if (!signature || !recipient || !amountMinor) {
    throw new TypeError(CLI_USAGE);
  }
  process.stdout.write(
    `${JSON.stringify(await verifyFundingSolana({ signature, recipient, amountMinor, rpcUrl: rpcUrl ?? undefined }), null, 2)}\n`,
  );
}

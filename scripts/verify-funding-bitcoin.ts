/** Queries confirmed Bitcoin data and emits reviewed direct-funding evidence. */

import {
  assertConfirmedBtcFundingTransfer,
  BITCOIN_FUNDING_VERIFIER_VERSION,
  isBitcoinBlockHash,
  isBitcoinTransactionId,
} from "../src/lib/bitcoin-funding";
import { isFundingAddress } from "../src/lib/funding-address.mjs";

const DEFAULT_API = "https://mempool.space/api";
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new TypeError(`${name} requires a value`);
  }
  return value;
}

async function apiGet(
  base: URL,
  fetchImpl: (url: URL, init?: RequestInit) => Promise<Response>,
  path: string,
): Promise<Uint8Array> {
  const url = new URL(`${base.pathname.replace(/\/$/u, "")}${path}`, base);
  const response = await fetchImpl(url, {
    method: "GET",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Bitcoin API ${path} returned HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_RESPONSE_BYTES) {
    throw new RangeError(`Bitcoin API ${path} response is empty or oversized`);
  }
  return bytes;
}

function decodeText(bytes: Uint8Array, field: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new TypeError(`${field} is not valid UTF-8`, { cause: error });
  }
}

function decodeJson(bytes: Uint8Array, field: string): unknown {
  try {
    return JSON.parse(decodeText(bytes, field));
  } catch (error) {
    throw new TypeError(`${field} is invalid JSON`, { cause: error });
  }
}

export async function verifyFundingBitcoin(input: {
  amountMinor: string;
  apiUrl?: string;
  fetchImpl?: (url: URL, init?: RequestInit) => Promise<Response>;
  recipient: string;
  transactionId: string;
}) {
  if (
    !isBitcoinTransactionId(input.transactionId) ||
    !isFundingAddress("bitcoin", input.recipient) ||
    input.amountMinor.length > 40 ||
    !/^[1-9]\d*$/u.test(input.amountMinor)
  ) {
    throw new TypeError("transaction id, recipient, or amount is invalid");
  }
  const api = new URL(input.apiUrl ?? DEFAULT_API);
  if (api.protocol !== "https:" || api.username || api.password || api.hash) {
    throw new TypeError("Bitcoin API must be a credential-free HTTPS URL");
  }
  const fetchImpl = input.fetchImpl ?? fetch;

  const transaction = decodeJson(
    await apiGet(api, fetchImpl, `/tx/${input.transactionId}`),
    "Bitcoin transaction response",
  );
  const tipText = decodeText(
    await apiGet(api, fetchImpl, "/blocks/tip/height"),
    "Bitcoin tip height response",
  ).trim();
  if (!/^\d{1,9}$/u.test(tipText)) {
    throw new TypeError("Bitcoin tip height response is invalid");
  }
  const status =
    typeof transaction === "object" && transaction !== null
      ? (transaction as Record<string, unknown>).status
      : null;
  const blockHeight =
    typeof status === "object" && status !== null
      ? (status as Record<string, unknown>).block_height
      : null;
  if (!Number.isSafeInteger(blockHeight) || Number(blockHeight) < 0) {
    throw new TypeError("Bitcoin transaction is unconfirmed");
  }
  const bestChainHash = decodeText(
    await apiGet(api, fetchImpl, `/block-height/${Number(blockHeight)}`),
    "Bitcoin block-height response",
  ).trim();
  if (!isBitcoinBlockHash(bestChainHash)) {
    throw new TypeError("Bitcoin block-height response is invalid");
  }
  const verified = assertConfirmedBtcFundingTransfer(
    transaction,
    input.transactionId,
    input.recipient,
    input.amountMinor,
    Number(tipText),
    bestChainHash,
  );
  const checkedAt = new Date().toISOString();
  return {
    state: "verified-on-chain" as const,
    finality: {
      kind: "confirmations" as const,
      confirmations: verified.confirmations,
    },
    verifier: {
      version: BITCOIN_FUNDING_VERIFIER_VERSION,
      checkedAt,
      evidenceUrl: `https://mempool.space/tx/${input.transactionId}`,
      reason: null,
    },
    chainEvidence: verified,
  };
}

if (import.meta.main) {
  const transactionId = argument("--transaction");
  const recipient = argument("--recipient");
  const amountMinor = argument("--amount-minor");
  const apiUrl = argument("--api-url") ?? undefined;
  if (!transactionId || !recipient || !amountMinor) {
    throw new TypeError(
      "Usage: verify-funding-bitcoin.ts --transaction <txid> --recipient <bech32-address> --amount-minor <satoshis> [--api-url <https-url>]",
    );
  }
  process.stdout.write(
    `${JSON.stringify(await verifyFundingBitcoin({ transactionId, recipient, amountMinor, apiUrl }), null, 2)}\n`,
  );
}

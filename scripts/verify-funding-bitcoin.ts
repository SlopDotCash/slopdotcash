/** Queries confirmed Bitcoin data and emits reviewed direct-funding evidence. */

import {
  assertConfirmedBtcFundingTransfer,
  BITCOIN_FUNDING_VERIFIER_VERSION,
  isBitcoinBlockHash,
  isBitcoinTransactionId,
} from "../src/lib/bitcoin-funding";
import { isFundingAddress } from "../src/lib/funding-address.mjs";

export const BITCOIN_FUNDING_API_AUTHORITIES = [
  "https://mempool.space/api",
  "https://blockstream.info/api",
  "https://mempool.emzy.de/api",
] as const;
const BITCOIN_FUNDING_API_QUORUM = 2;
export const MAX_BITCOIN_API_BYTES = 8 * 1024 * 1024;

type FetchLike = (url: URL, init?: RequestInit) => Promise<Response>;

const CLI_ARGUMENTS = new Set([
  "--transaction",
  "--recipient",
  "--amount-minor",
]);

export function parseBitcoinFundingArguments(argv: readonly string[]) {
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
      throw new TypeError(
        "Usage: verify-funding-bitcoin.ts --transaction <txid> --recipient <bech32-address> --amount-minor <satoshis>",
      );
    }
    parsed.set(name, value);
  }
  return {
    transactionId: parsed.get("--transaction") ?? null,
    recipient: parsed.get("--recipient") ?? null,
    amountMinor: parsed.get("--amount-minor") ?? null,
  };
}

async function boundedBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new TypeError("Bitcoin API returned an invalid Content-Length");
    }
    if (parsedLength > MAX_BITCOIN_API_BYTES) {
      throw new RangeError("Bitcoin API response exceeded its size limit");
    }
  }
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError("Bitcoin API returned no readable body");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let body = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_BITCOIN_API_BYTES) {
        throw new RangeError("Bitcoin API response exceeded its size limit");
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } catch (error) {
    if (error instanceof TypeError) {
      throw new TypeError("Bitcoin API response is not valid UTF-8", {
        cause: error,
      });
    }
    throw error;
  }
  if (byteLength === 0) throw new RangeError("Bitcoin API response is empty");
  return body;
}

async function apiGet(
  base: URL,
  fetchImpl: FetchLike,
  path: string,
): Promise<string> {
  const url = new URL(`${base.pathname.replace(/\/$/u, "")}${path}`, base);
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Bitcoin API ${path} returned HTTP ${response.status}`);
  }
  return boundedBody(response);
}

async function verifyWithAuthority(
  input: { amountMinor: string; recipient: string; transactionId: string },
  authority: string,
  fetchImpl: FetchLike,
) {
  const api = new URL(authority);
  let transaction: unknown;
  try {
    transaction = JSON.parse(
      await apiGet(api, fetchImpl, `/tx/${input.transactionId}`),
    );
  } catch (error) {
    throw new TypeError("Bitcoin transaction response is invalid JSON", {
      cause: error,
    });
  }
  const tipText = (await apiGet(api, fetchImpl, "/blocks/tip/height")).trim();
  if (!/^\d{1,9}$/u.test(tipText)) {
    throw new TypeError("Bitcoin tip height response is invalid");
  }
  const tipHeight = Number(tipText);
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
  const bestChainHash = (
    await apiGet(api, fetchImpl, `/block-height/${Number(blockHeight)}`)
  ).trim();
  if (!isBitcoinBlockHash(bestChainHash)) {
    throw new TypeError("Bitcoin block-height response is invalid");
  }
  const verified = assertConfirmedBtcFundingTransfer(
    transaction,
    input.transactionId,
    input.recipient,
    input.amountMinor,
    tipHeight,
    bestChainHash,
  );
  return { authority: api.toString(), tipHeight, verified };
}

export async function verifyFundingBitcoin(input: {
  amountMinor: string;
  fetchImpl?: FetchLike;
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
  const fetchImpl = input.fetchImpl ?? fetch;
  const settled = await Promise.allSettled(
    BITCOIN_FUNDING_API_AUTHORITIES.map((authority) =>
      verifyWithAuthority(input, authority, fetchImpl),
    ),
  );
  const groups = new Map<
    string,
    Array<Awaited<ReturnType<typeof verifyWithAuthority>>>
  >();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    const { verified } = result.value;
    const key = `${verified.transactionId}:${verified.blockHeight}:${verified.blockHash}`;
    const group = groups.get(key) ?? [];
    group.push(result.value);
    groups.set(key, group);
  }
  const results = [...groups.values()].sort(
    (left, right) => right.length - left.length,
  )[0];
  const first = results?.[0];
  if (!first || !results || results.length < BITCOIN_FUNDING_API_QUORUM) {
    throw new TypeError(
      "Bitcoin API authorities did not reach canonical transaction quorum",
    );
  }
  const confirmations = Math.min(
    ...results.map(({ verified }) => verified.confirmations),
  );
  const checkedAt = new Date().toISOString();
  return {
    state: "verified-on-chain" as const,
    finality: {
      kind: "confirmations" as const,
      confirmations,
    },
    verifier: {
      version: BITCOIN_FUNDING_VERIFIER_VERSION,
      checkedAt,
      evidenceUrl: `https://mempool.space/tx/${input.transactionId}`,
      reason: null,
    },
    chainEvidence: {
      ...first.verified,
      confirmations,
      authorities: results.map(({ authority, tipHeight }) => ({
        authority,
        tipHeight,
      })),
    },
  };
}

if (import.meta.main) {
  const { transactionId, recipient, amountMinor } =
    parseBitcoinFundingArguments(process.argv.slice(2));
  if (!transactionId || !recipient || !amountMinor) {
    throw new TypeError(
      "Usage: verify-funding-bitcoin.ts --transaction <txid> --recipient <bech32-address> --amount-minor <satoshis>",
    );
  }
  process.stdout.write(
    `${JSON.stringify(await verifyFundingBitcoin({ transactionId, recipient, amountMinor }), null, 2)}\n`,
  );
}

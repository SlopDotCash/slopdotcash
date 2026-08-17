/**
 * Fetches one finalized Solana transaction through a credential-free HTTPS
 * JSON-RPC boundary with strict time, byte, encoding, and response checks.
 */

export const DEFAULT_SOLANA_RPC_URL =
  "https://api.mainnet-beta.solana.com" as const;
export const MAX_SOLANA_RPC_BYTES = 16 * 1024 * 1024;
export const SOLANA_RPC_TIMEOUT_MS = 20_000;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function rpcUrl(value: string): string {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new TypeError(
      "Solana RPC URL must be HTTPS without embedded credentials or a fragment",
    );
  }
  return parsed.toString();
}

function signature(value: string): string {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,128}$/u.test(value)) {
    throw new TypeError("Solana transaction signature is invalid");
  }
  return value;
}

async function boundedBody(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!/^\d+$/u.test(declaredLength) || !Number.isSafeInteger(parsedLength)) {
      throw new Error("Solana RPC returned an invalid Content-Length");
    }
    if (parsedLength > maxBytes) {
      throw new RangeError("Solana RPC response exceeded its size limit");
    }
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Solana RPC returned no readable body");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let body = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel("response exceeded size limit");
        throw new RangeError("Solana RPC response exceeded its size limit");
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Solana RPC response was not valid UTF-8", {
        cause: error,
      });
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
  return body;
}

/** Returns only a finalized transaction whose JSON-RPC id matches the query. */
export async function fetchFinalizedSolanaTransaction(
  url: string,
  transactionSignature: string,
  options: {
    fetcher?: FetchLike;
    maxBytes?: number;
    timeoutMs?: number;
  } = {},
): Promise<unknown> {
  const endpoint = rpcUrl(url);
  const expectedSignature = signature(transactionSignature);
  const maxBytes = options.maxBytes ?? MAX_SOLANA_RPC_BYTES;
  const timeoutMs = options.timeoutMs ?? SOLANA_RPC_TIMEOUT_MS;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("Solana RPC byte limit is invalid");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Solana RPC timeout is invalid");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetcher ?? globalThis.fetch)(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: expectedSignature,
        method: "getTransaction",
        params: [
          expectedSignature,
          {
            commitment: "finalized",
            encoding: "jsonParsed",
            maxSupportedTransactionVersion: 0,
          },
        ],
      }),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Solana RPC returned HTTP ${response.status}`);
    }
    const body = await boundedBody(response, maxBytes);
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch (error) {
      throw new TypeError("Solana RPC response was not valid JSON", {
        cause: error,
      });
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError("Solana RPC response must be an object");
    }
    const envelope = value as Record<string, unknown>;
    if (
      envelope.jsonrpc !== "2.0" ||
      envelope.id !== expectedSignature ||
      (envelope.error !== undefined && envelope.error !== null) ||
      typeof envelope.result !== "object" ||
      envelope.result === null ||
      Array.isArray(envelope.result)
    ) {
      throw new Error("Solana RPC did not return a finalized transaction");
    }
    return envelope.result;
  } finally {
    clearTimeout(timer);
  }
}

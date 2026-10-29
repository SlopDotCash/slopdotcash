/**
 * Reads a reward token's decimals (and, on EVM, its symbol) from chain once,
 * when a maintainer submits or changes the reward asset. The result is stored
 * in the manifest; page views never read chain.
 */

import {
  readTokenMint,
  type TokenMintReading,
} from "../../contracts/solana/token-extensions";
import { decodeBase58Bytes } from "../../src/lib/base58";
import { readBoundedJson } from "../../src/lib/browser-json";
import {
  REWARD_ASSET_NETWORKS,
  type RewardAssetNetwork,
} from "../../src/lib/reward-asset.mjs";

type TokenMetadata = { decimals: number; symbol: string | null };

export type TokenMetadataReader = (
  network: RewardAssetNetwork,
  address: string,
) => Promise<TokenMetadata>;

export class TokenMetadataError extends Error {}

/** Public mainnet RPC endpoints; a Pages variable may replace each one. */
const DEFAULT_REWARD_RPC_URLS: Readonly<Record<RewardAssetNetwork, string>> =
  Object.freeze({
    base: "https://mainnet.base.org",
    ethereum: "https://ethereum-rpc.publicnode.com",
    robinhood: "https://robinhood-rpc.publicnode.com",
    solana: "https://api.mainnet-beta.solana.com",
  });

const MAX_RPC_BYTES = 64 * 1024;
const SYMBOL = /^[A-Za-z0-9$._-]{1,16}$/u;

async function rpc(
  fetcher: typeof fetch,
  url: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  // An HTTP failure, such as a rate limit, says nothing about the token, so
  // it is not a TokenMetadataError: the owner gets a retry, not a refusal.
  if (!response.ok)
    throw new Error(`The network RPC returned HTTP ${response.status}`);
  let body: { result?: unknown; error?: unknown };
  try {
    body = (await readBoundedJson(response, MAX_RPC_BYTES, "network RPC")) as {
      result?: unknown;
      error?: unknown;
    };
  } catch (error) {
    if (error instanceof RangeError)
      throw new TokenMetadataError("The network RPC response is too large");
    throw error;
  }
  if (body.error !== undefined || !Object.hasOwn(body, "result"))
    throw new TokenMetadataError("The network RPC refused the request");
  return body.result;
}

function word(hex: string, index: number): bigint {
  const start = 2 + index * 64;
  const slice = hex.slice(start, start + 64);
  if (slice.length !== 64) throw new TokenMetadataError("Short ABI response");
  return BigInt(`0x${slice}`);
}

/**
 * Decodes an ABI `string` or a legacy `bytes32` symbol; null when neither.
 * The offset and length are checked before reading, so a short answer fails.
 * A bytes32 symbol loses only its trailing zero padding, not inner bytes.
 */
function decodeSymbol(result: unknown): string | null {
  if (typeof result !== "string" || !result.startsWith("0x")) return null;
  const hex = result.slice(2);
  if (hex.length % 2 !== 0) return null;
  const bytes: number[] = [];
  for (let index = 0; index < hex.length; index += 2) {
    const pair = hex.slice(index, index + 2);
    if (!/^(?:[0-9a-fA-F]{2})$/u.test(pair)) return null;
    bytes.push(Number.parseInt(pair, 16));
  }
  if (bytes.length === 32) {
    let end = bytes.length;
    while (end > 0 && bytes[end - 1] === 0) end -= 1;
    try {
      const symbol = new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(bytes.slice(0, end)),
      );
      return SYMBOL.test(symbol) ? symbol : null;
    } catch {
      return null;
    }
  }
  if (bytes.length < 64) return null;
  const offset = word(result, 0);
  if (offset < 32n || offset % 32n !== 0n) return null;
  const length = word(result, Number(offset / 32n));
  if (length > 64n || offset + 32n + length > BigInt(bytes.length)) return null;
  const body = Number(offset + 32n);
  try {
    const symbol = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(bytes.slice(body, body + Number(length))),
    );
    return SYMBOL.test(symbol) ? symbol : null;
  } catch {
    return null;
  }
}
async function evmMetadata(
  fetcher: typeof fetch,
  url: string,
  chainId: string,
  address: string,
): Promise<TokenMetadata> {
  const reportedChain = await rpc(fetcher, url, "eth_chainId", []);
  if (
    typeof reportedChain !== "string" ||
    BigInt(reportedChain) !== BigInt(chainId)
  )
    throw new TokenMetadataError("The network RPC reports a different chain");
  const code = await rpc(fetcher, url, "eth_getCode", [address, "latest"]);
  if (typeof code !== "string" || code === "0x")
    throw new TokenMetadataError("No contract exists at that token address");
  const decimals = await rpc(fetcher, url, "eth_call", [
    { to: address, data: "0x313ce567" },
    "latest",
  ]);
  if (typeof decimals !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(decimals))
    throw new TokenMetadataError("The token does not report ERC-20 decimals");
  const value = BigInt(decimals);
  if (value > 255n)
    throw new TokenMetadataError("The token reports invalid decimals");
  let symbol: string | null = null;
  try {
    symbol = decodeSymbol(
      await rpc(fetcher, url, "eth_call", [
        { to: address, data: "0x95d89b41" },
        "latest",
      ]),
    );
  } catch {
    // error-policy:J3 an unreadable symbol keeps the maintainer's display symbol.
    symbol = null;
  }
  return { decimals: Number(value), symbol };
}

async function solanaMetadata(
  fetcher: typeof fetch,
  url: string,
  address: string,
): Promise<TokenMetadata> {
  const result = (await rpc(fetcher, url, "getAccountInfo", [
    address,
    { encoding: "base64", commitment: "finalized" },
  ])) as { value?: { owner?: unknown } | null } | null;
  const account = result?.value;
  if (!account)
    throw new TokenMetadataError("No account exists at that mint address");
  // Keep applicant errors independent of the reader's internal layout-check order.
  // The shared reader still admits only classic SPL and the approved Token-2022 subset.
  let mint: TokenMintReading;
  try {
    mint = readTokenMint(account, decodeBase58Bytes(address));
  } catch {
    throw new TokenMetadataError("The account is not a supported SPL mint");
  }
  return { decimals: mint.decimals, symbol: null };
}

export function rpcTokenMetadataReader(
  fetcher: typeof fetch,
  urls: Partial<Record<RewardAssetNetwork, string>> = {},
): TokenMetadataReader {
  return async (network, address) => {
    const definition = REWARD_ASSET_NETWORKS[network];
    const url = urls[network] ?? DEFAULT_REWARD_RPC_URLS[network];
    return definition.family === "evm"
      ? evmMetadata(fetcher, url, definition.chainId as string, address)
      : solanaMetadata(fetcher, url, address);
  };
}

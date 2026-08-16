/** Queries confirmed Base/Ethereum data and emits reviewed direct-funding evidence. */

import {
  assertConfirmedUsdcFundingTransfer,
  assertEvmCanonicalBlock,
  EVM_FUNDING_CHAIN_IDS,
  EVM_FUNDING_VERIFIER_VERSIONS,
  type EvmFundingNetwork,
  evmQuantity,
  isEvmFundingNetwork,
  isEvmTransactionHash,
} from "../src/lib/evm-funding";
import { isFundingAddress } from "../src/lib/funding-address.mjs";

export const EVM_FUNDING_RPC_AUTHORITIES = {
  base: [
    "https://mainnet.base.org",
    "https://base-rpc.publicnode.com",
    "https://base.drpc.org",
  ],
  ethereum: [
    "https://ethereum-rpc.publicnode.com",
    "https://eth.drpc.org",
    "https://rpc.flashbots.net",
  ],
} as const;
const EVM_FUNDING_RPC_QUORUM = 2;
const EVIDENCE_HOSTS = {
  base: "https://basescan.org",
  ethereum: "https://etherscan.io",
} as const;
export const MAX_EVM_RPC_BYTES = 8 * 1024 * 1024;

type FetchLike = (url: URL, init?: RequestInit) => Promise<Response>;

const CLI_ARGUMENTS = new Set([
  "--network",
  "--transaction",
  "--recipient",
  "--amount-minor",
]);

export function parseEvmFundingArguments(argv: readonly string[]) {
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
        "Usage: verify-funding-evm.ts --network <base|ethereum> --transaction <0x-hash> --recipient <0x-address> --amount-minor <integer>",
      );
    }
    parsed.set(name, value);
  }
  return {
    network: parsed.get("--network") ?? null,
    transactionHash: parsed.get("--transaction") ?? null,
    recipient: parsed.get("--recipient") ?? null,
    amountMinor: parsed.get("--amount-minor") ?? null,
  };
}

async function boundedBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new TypeError("EVM RPC returned an invalid Content-Length");
    }
    if (parsedLength > MAX_EVM_RPC_BYTES) {
      throw new RangeError("EVM RPC response exceeded its size limit");
    }
  }
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError("EVM RPC returned no readable body");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let body = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_EVM_RPC_BYTES) {
        throw new RangeError("EVM RPC response exceeded its size limit");
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } catch (error) {
    if (error instanceof TypeError) {
      throw new TypeError("EVM RPC response is not valid UTF-8", {
        cause: error,
      });
    }
    throw error;
  }
  if (byteLength === 0) throw new RangeError("EVM RPC response is empty");
  return body;
}

async function rpcCall(
  rpc: URL,
  fetchImpl: FetchLike,
  method: string,
  params: readonly unknown[],
  id: string,
): Promise<unknown> {
  const response = await fetchImpl(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`EVM RPC ${method} returned HTTP ${response.status}`);
  }
  const responseBody = await boundedBody(response);
  let envelope: unknown;
  try {
    envelope = JSON.parse(responseBody);
  } catch (error) {
    throw new TypeError(`EVM RPC ${method} response is invalid JSON`, {
      cause: error,
    });
  }
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    Array.isArray(envelope)
  ) {
    throw new TypeError(`EVM RPC ${method} response is invalid`);
  }
  const body = envelope as Record<string, unknown>;
  if (body.jsonrpc !== "2.0" || body.id !== id) {
    throw new TypeError(`EVM RPC ${method} response identity is invalid`);
  }
  if (body.error !== undefined && body.error !== null) {
    throw new TypeError(
      `EVM RPC ${method} returned an error: ${JSON.stringify(body.error)}`,
    );
  }
  if (!("result" in body)) {
    throw new TypeError(`EVM RPC ${method} response has no result`);
  }
  return body.result;
}

async function verifyWithAuthority(
  input: {
    amountMinor: string;
    network: EvmFundingNetwork;
    recipient: string;
    transactionHash: string;
  },
  authority: string,
  authorityIndex: number,
  fetchImpl: FetchLike,
) {
  const rpc = new URL(authority);
  let requestIndex = 0;
  const request = (method: string, params: readonly unknown[]) =>
    rpcCall(
      rpc,
      fetchImpl,
      method,
      params,
      `slop-funding:${input.network}:${authorityIndex}:${requestIndex++}:${method}`,
    );
  const chainId = evmQuantity(
    await request("eth_chainId", []),
    "eth_chainId result",
  );
  if (chainId !== EVM_FUNDING_CHAIN_IDS[input.network]) {
    throw new TypeError(
      `EVM RPC chain id ${chainId} is not ${input.network} mainnet`,
    );
  }
  const finalizedBlock = assertEvmCanonicalBlock(
    await request("eth_getBlockByNumber", ["finalized", false]),
    "finalized block",
  );
  const receipt = await request("eth_getTransactionReceipt", [
    input.transactionHash,
  ]);
  if (
    typeof receipt !== "object" ||
    receipt === null ||
    Array.isArray(receipt)
  ) {
    throw new TypeError("EVM transaction receipt is absent or invalid");
  }
  const receiptBlockNumber = (receipt as Record<string, unknown>).blockNumber;
  evmQuantity(receiptBlockNumber, "receipt.blockNumber");
  const receiptBlock = assertEvmCanonicalBlock(
    await request("eth_getBlockByNumber", [receiptBlockNumber, false]),
    "canonical receipt block",
  );
  const verified = assertConfirmedUsdcFundingTransfer(
    receipt,
    input.network,
    input.transactionHash,
    input.recipient,
    input.amountMinor,
    finalizedBlock,
    receiptBlock,
  );
  return { authority: rpc.toString(), finalizedBlock, verified };
}

export async function verifyFundingEvm(input: {
  amountMinor: string;
  fetchImpl?: FetchLike;
  network: EvmFundingNetwork;
  recipient: string;
  transactionHash: string;
}) {
  if (
    !isEvmFundingNetwork(input.network) ||
    !isEvmTransactionHash(input.transactionHash) ||
    !isFundingAddress(input.network, input.recipient) ||
    input.amountMinor.length > 40 ||
    !/^[1-9]\d*$/u.test(input.amountMinor)
  ) {
    throw new TypeError(
      "network, transaction hash, recipient, or amount is invalid",
    );
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const authorities = EVM_FUNDING_RPC_AUTHORITIES[input.network];
  const settled = await Promise.allSettled(
    authorities.map((authority, index) =>
      verifyWithAuthority(input, authority, index, fetchImpl),
    ),
  );
  const groups = new Map<
    string,
    Array<Awaited<ReturnType<typeof verifyWithAuthority>>>
  >();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    const { verified } = result.value;
    const key = `${verified.transactionHash}:${verified.blockNumber}:${verified.blockHash}`;
    const group = groups.get(key) ?? [];
    group.push(result.value);
    groups.set(key, group);
  }
  const results = [...groups.values()].sort(
    (left, right) => right.length - left.length,
  )[0];
  const first = results?.[0];
  if (!first || !results || results.length < EVM_FUNDING_RPC_QUORUM) {
    throw new TypeError(
      "EVM RPC authorities did not reach canonical transaction quorum",
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
      version: EVM_FUNDING_VERIFIER_VERSIONS[input.network],
      checkedAt,
      evidenceUrl: `${EVIDENCE_HOSTS[input.network]}/tx/${input.transactionHash}`,
      reason: null,
    },
    chainEvidence: {
      ...first.verified,
      confirmations,
      authorities: results.map(({ authority, finalizedBlock }) => ({
        authority,
        finalizedBlockHash: finalizedBlock.hash,
        finalizedBlockNumber: Number(finalizedBlock.number),
      })),
    },
  };
}

if (import.meta.main) {
  const { network, transactionHash, recipient, amountMinor } =
    parseEvmFundingArguments(process.argv.slice(2));
  if (
    !network ||
    !isEvmFundingNetwork(network) ||
    !transactionHash ||
    !recipient ||
    !amountMinor
  ) {
    throw new TypeError(
      "Usage: verify-funding-evm.ts --network <base|ethereum> --transaction <0x-hash> --recipient <0x-address> --amount-minor <integer>",
    );
  }
  process.stdout.write(
    `${JSON.stringify(await verifyFundingEvm({ network, transactionHash, recipient, amountMinor }), null, 2)}\n`,
  );
}

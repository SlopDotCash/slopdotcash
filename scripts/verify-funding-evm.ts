/** Queries confirmed Base/Ethereum data and emits reviewed direct-funding evidence. */

import {
  assertConfirmedUsdcFundingTransfer,
  EVM_FUNDING_CHAIN_IDS,
  EVM_FUNDING_VERIFIER_VERSIONS,
  type EvmFundingNetwork,
  evmQuantity,
  isEvmFundingNetwork,
  isEvmTransactionHash,
} from "../src/lib/evm-funding";
import { isFundingAddress } from "../src/lib/funding-address.mjs";

const DEFAULT_RPCS = {
  base: "https://mainnet.base.org",
  ethereum: "https://ethereum-rpc.publicnode.com",
} as const;
const EVIDENCE_HOSTS = {
  base: "https://basescan.org",
  ethereum: "https://etherscan.io",
} as const;
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

async function rpcCall(
  rpc: URL,
  fetchImpl: (url: URL, init?: RequestInit) => Promise<Response>,
  method: string,
  params: readonly unknown[],
): Promise<unknown> {
  const response = await fetchImpl(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`EVM RPC ${method} returned HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_RPC_BYTES) {
    throw new RangeError(`EVM RPC ${method} response is empty or oversized`);
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
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

export async function verifyFundingEvm(input: {
  amountMinor: string;
  fetchImpl?: (url: URL, init?: RequestInit) => Promise<Response>;
  network: EvmFundingNetwork;
  recipient: string;
  rpcUrl?: string;
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
  const rpc = new URL(input.rpcUrl ?? DEFAULT_RPCS[input.network]);
  if (rpc.protocol !== "https:" || rpc.username || rpc.password || rpc.hash) {
    throw new TypeError("EVM RPC must be a credential-free HTTPS URL");
  }
  const fetchImpl = input.fetchImpl ?? fetch;

  const chainId = evmQuantity(
    await rpcCall(rpc, fetchImpl, "eth_chainId", []),
    "eth_chainId result",
  );
  if (chainId !== EVM_FUNDING_CHAIN_IDS[input.network]) {
    throw new TypeError(
      `EVM RPC chain id ${chainId} is not ${input.network} mainnet`,
    );
  }
  const finalizedBlock = await rpcCall(rpc, fetchImpl, "eth_getBlockByNumber", [
    "finalized",
    false,
  ]);
  if (
    typeof finalizedBlock !== "object" ||
    finalizedBlock === null ||
    Array.isArray(finalizedBlock)
  ) {
    throw new TypeError("EVM RPC did not return a finalized block");
  }
  const finalizedBlockNumber = evmQuantity(
    (finalizedBlock as Record<string, unknown>).number,
    "finalized block number",
  );
  const receipt = await rpcCall(rpc, fetchImpl, "eth_getTransactionReceipt", [
    input.transactionHash,
  ]);
  if (receipt === null || receipt === undefined) {
    throw new TypeError("EVM transaction receipt is absent");
  }
  const verified = assertConfirmedUsdcFundingTransfer(
    receipt,
    input.network,
    input.transactionHash,
    input.recipient,
    input.amountMinor,
    finalizedBlockNumber,
  );
  const checkedAt = new Date().toISOString();
  return {
    state: "verified-on-chain" as const,
    finality: {
      kind: "confirmations" as const,
      confirmations: verified.confirmations,
    },
    verifier: {
      version: EVM_FUNDING_VERIFIER_VERSIONS[input.network],
      checkedAt,
      evidenceUrl: `${EVIDENCE_HOSTS[input.network]}/tx/${input.transactionHash}`,
      reason: null,
    },
    chainEvidence: verified,
  };
}

if (import.meta.main) {
  const network = argument("--network");
  const transactionHash = argument("--transaction");
  const recipient = argument("--recipient");
  const amountMinor = argument("--amount-minor");
  const rpcUrl = argument("--rpc-url") ?? undefined;
  if (
    !network ||
    !isEvmFundingNetwork(network) ||
    !transactionHash ||
    !recipient ||
    !amountMinor
  ) {
    throw new TypeError(
      "Usage: verify-funding-evm.ts --network <base|ethereum> --transaction <0x-hash> --recipient <0x-address> --amount-minor <integer> [--rpc-url <https-url>]",
    );
  }
  process.stdout.write(
    `${JSON.stringify(await verifyFundingEvm({ network, transactionHash, recipient, amountMinor, rpcUrl }), null, 2)}\n`,
  );
}

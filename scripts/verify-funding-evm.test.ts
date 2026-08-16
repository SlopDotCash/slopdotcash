/** Proves the read-only EVM verifier pins mainnet finality and fails closed. */

import { describe, expect, it } from "vitest";
import { EVM_FUNDING_USDC_CONTRACTS } from "../src/lib/evm-funding";
import { verifyFundingEvm } from "./verify-funding-evm";

const RECIPIENT = `0x${"1".repeat(40)}`;
const SENDER = `0x${"2".repeat(40)}`;
const HASH = `0x${"a".repeat(64)}`;
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function chainResponses(overrides: Record<string, unknown> = {}) {
  return {
    eth_chainId: "0x1",
    eth_getBlockByNumber: { number: "0x1000" },
    eth_getTransactionReceipt: {
      status: "0x1",
      transactionHash: HASH,
      blockNumber: "0x100",
      logs: [
        {
          address: EVM_FUNDING_USDC_CONTRACTS.ethereum,
          topics: [
            TRANSFER_TOPIC,
            `0x${"0".repeat(24)}${SENDER.slice(2)}`,
            `0x${"0".repeat(24)}${RECIPIENT.slice(2)}`,
          ],
          data: `0x${1_000_000n.toString(16).padStart(64, "0")}`,
          removed: false,
        },
      ],
    },
    ...overrides,
  } as Record<string, unknown>;
}

function fetchFor(responses: Record<string, unknown>, calls: string[] = []) {
  return async (_url: URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      method: string;
      params: unknown[];
    };
    calls.push(body.method);
    if (!(body.method in responses)) {
      throw new Error(`unexpected RPC method ${body.method}`);
    }
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: responses[body.method] }),
    );
  };
}

describe("EVM funding verifier", () => {
  it("checks chain id and finalized head, then emits reviewed record fields", async () => {
    const calls: string[] = [];
    const result = await verifyFundingEvm({
      network: "ethereum",
      transactionHash: HASH,
      recipient: RECIPIENT,
      amountMinor: "1000000",
      fetchImpl: fetchFor(chainResponses(), calls),
    });
    expect(calls).toEqual([
      "eth_chainId",
      "eth_getBlockByNumber",
      "eth_getTransactionReceipt",
    ]);
    expect(result).toMatchObject({
      state: "verified-on-chain",
      finality: { kind: "confirmations", confirmations: 0x1000 - 0x100 + 1 },
      verifier: {
        version: "funding-ethereum-v1",
        evidenceUrl: `https://etherscan.io/tx/${HASH}`,
        reason: null,
      },
      chainEvidence: { transactionHash: HASH, blockNumber: 0x100 },
    });
  });

  it("rejects an RPC that is not the declared mainnet", async () => {
    await expect(
      verifyFundingEvm({
        network: "base",
        transactionHash: HASH,
        recipient: RECIPIENT,
        amountMinor: "1000000",
        fetchImpl: fetchFor(chainResponses()),
      }),
    ).rejects.toThrow(/not base mainnet/u);
  });

  it("rejects an absent receipt at the finalized head", async () => {
    await expect(
      verifyFundingEvm({
        network: "ethereum",
        transactionHash: HASH,
        recipient: RECIPIENT,
        amountMinor: "1000000",
        fetchImpl: fetchFor(
          chainResponses({ eth_getTransactionReceipt: null }),
        ),
      }),
    ).rejects.toThrow(/receipt is absent/u);
  });

  it("rejects an RPC error envelope", async () => {
    await expect(
      verifyFundingEvm({
        network: "ethereum",
        transactionHash: HASH,
        recipient: RECIPIENT,
        amountMinor: "1000000",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              error: { code: -32601, message: "nope" },
            }),
          ),
      }),
    ).rejects.toThrow(/returned an error/u);
  });

  it("rejects invalid inputs and credentialed RPCs before querying", async () => {
    let queried = false;
    const spy = async () => {
      queried = true;
      return new Response();
    };
    await expect(
      verifyFundingEvm({
        network: "ethereum",
        transactionHash: HASH,
        recipient: RECIPIENT,
        amountMinor: "1".repeat(41),
        fetchImpl: spy,
      }),
    ).rejects.toThrow(/invalid/u);
    await expect(
      verifyFundingEvm({
        network: "ethereum",
        transactionHash: HASH.toUpperCase(),
        recipient: RECIPIENT,
        amountMinor: "1000000",
        fetchImpl: spy,
      }),
    ).rejects.toThrow(/invalid/u);
    await expect(
      verifyFundingEvm({
        network: "ethereum",
        transactionHash: HASH,
        recipient: RECIPIENT,
        amountMinor: "1000000",
        rpcUrl: "https://user:pass@rpc.example.com",
        fetchImpl: spy,
      }),
    ).rejects.toThrow(/credential-free/u);
    expect(queried).toBe(false);
  });
});

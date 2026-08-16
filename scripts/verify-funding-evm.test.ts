/** Proves the read-only EVM verifier pins a bounded, canonical RPC quorum. */

import { describe, expect, it } from "vitest";
import { EVM_FUNDING_USDC_CONTRACTS } from "../src/lib/evm-funding";
import {
  EVM_FUNDING_RPC_AUTHORITIES,
  MAX_EVM_RPC_BYTES,
  parseEvmFundingArguments,
  verifyFundingEvm,
} from "./verify-funding-evm";

const RECIPIENT = `0x${"1".repeat(40)}`;
const SENDER = `0x${"2".repeat(40)}`;
const HASH = `0x${"a".repeat(64)}`;
const BLOCK_HASH = `0x${"b".repeat(64)}`;
const FINALIZED_HASH = `0x${"c".repeat(64)}`;
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function chainResponses(
  overrides: {
    blockHash?: string;
    chainId?: string;
    finalizedNumber?: string;
    receipt?: unknown;
  } = {},
) {
  const blockHash = overrides.blockHash ?? BLOCK_HASH;
  return {
    chainId: overrides.chainId ?? "0x1",
    finalizedBlock: {
      number: overrides.finalizedNumber ?? "0x1000",
      hash: FINALIZED_HASH,
    },
    canonicalBlock: { number: "0x100", hash: blockHash },
    receipt:
      overrides.receipt === undefined
        ? {
            status: "0x1",
            transactionHash: HASH,
            blockNumber: "0x100",
            blockHash,
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
                transactionHash: HASH,
                blockNumber: "0x100",
                blockHash,
              },
            ],
          }
        : overrides.receipt,
  };
}

interface RpcCall {
  id: string;
  method: string;
  redirect: RequestRedirect | undefined;
  url: string;
}

function fetchFor(
  selectResponses: (url: URL) => ReturnType<typeof chainResponses> = () =>
    chainResponses(),
  calls: RpcCall[] = [],
) {
  return async (url: URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      id: string;
      method: string;
      params: unknown[];
    };
    calls.push({
      id: body.id,
      method: body.method,
      redirect: init?.redirect,
      url: url.toString(),
    });
    const responses = selectResponses(url);
    let result: unknown;
    if (body.method === "eth_chainId") result = responses.chainId;
    else if (body.method === "eth_getTransactionReceipt") {
      result = responses.receipt;
    } else if (body.method === "eth_getBlockByNumber") {
      result =
        body.params[0] === "finalized"
          ? responses.finalizedBlock
          : responses.canonicalBlock;
    } else throw new Error(`unexpected RPC method ${body.method}`);
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
    );
  };
}

function verification(fetchImpl: ReturnType<typeof fetchFor>) {
  return verifyFundingEvm({
    network: "ethereum",
    transactionHash: HASH,
    recipient: RECIPIENT,
    amountMinor: "1000000",
    fetchImpl,
  });
}

describe("EVM funding verifier", () => {
  it("requires fixed authorities and emits conservative canonical evidence", async () => {
    const calls: RpcCall[] = [];
    const result = await verification(
      fetchFor(
        (url) =>
          chainResponses({
            finalizedNumber:
              url.hostname === "eth.drpc.org" ? "0xff0" : "0x1000",
          }),
        calls,
      ),
    );
    expect(new Set(calls.map(({ url }) => url))).toEqual(
      new Set(
        EVM_FUNDING_RPC_AUTHORITIES.ethereum.map((url) =>
          new URL(url).toString(),
        ),
      ),
    );
    expect(calls).toHaveLength(12);
    expect(calls.every(({ redirect }) => redirect === "error")).toBe(true);
    expect(new Set(calls.map(({ id }) => id)).size).toBe(12);
    expect(result).toMatchObject({
      state: "verified-on-chain",
      finality: { kind: "confirmations", confirmations: 0xff0 - 0x100 + 1 },
      verifier: {
        version: "funding-ethereum-v1",
        evidenceUrl: `https://etherscan.io/tx/${HASH}`,
        reason: null,
      },
      chainEvidence: {
        transactionHash: HASH,
        blockNumber: 0x100,
        blockHash: BLOCK_HASH,
        authorities: [{}, {}, {}],
      },
    });
  });

  it("rejects a wrong chain or absent receipt from either authority", async () => {
    await expect(
      verifyFundingEvm({
        network: "base",
        transactionHash: HASH,
        recipient: RECIPIENT,
        amountMinor: "1000000",
        fetchImpl: fetchFor(() => chainResponses()),
      }),
    ).rejects.toThrow(/quorum/u);
    await expect(
      verification(fetchFor(() => chainResponses({ receipt: null }))),
    ).rejects.toThrow(/quorum/u);
  });

  it("rejects malformed JSON-RPC versions, ids, and error envelopes", async () => {
    for (const envelope of [
      { jsonrpc: "1.0", id: "wrong", result: "0x1" },
      { jsonrpc: "2.0", id: "wrong", result: "0x1" },
    ]) {
      await expect(
        verification(async () => new Response(JSON.stringify(envelope))),
      ).rejects.toThrow(/quorum/u);
    }
    await expect(
      verification(async (_url, init) => {
        const { id } = JSON.parse(String(init?.body)) as { id: string };
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: "nope" },
          }),
        );
      }),
    ).rejects.toThrow(/quorum/u);
  });

  it("tolerates one disagreement but rejects without a two-authority quorum", async () => {
    const tolerated = await verification(
      fetchFor((url) =>
        chainResponses({
          blockHash:
            url.hostname === "eth.drpc.org"
              ? `0x${"d".repeat(64)}`
              : BLOCK_HASH,
        }),
      ),
    );
    expect(tolerated.chainEvidence.authorities).toHaveLength(2);
    const healthyFetch = fetchFor();
    const outageTolerated = await verification((url, init) => {
      if (url.hostname === "rpc.flashbots.net") {
        throw new Error("simulated authority outage");
      }
      return healthyFetch(url, init);
    });
    expect(outageTolerated.chainEvidence.authorities).toHaveLength(2);
    await expect(
      verification(
        fetchFor((url) => {
          const suffix =
            url.hostname === "ethereum-rpc.publicnode.com"
              ? "b"
              : url.hostname === "eth.drpc.org"
                ? "d"
                : "e";
          return chainResponses({ blockHash: `0x${suffix.repeat(64)}` });
        }),
      ),
    ).rejects.toThrow(/quorum/u);
  });

  it("enforces declared and streamed response byte bounds", async () => {
    await expect(
      verification(
        async () =>
          new Response("x", {
            headers: { "content-length": String(MAX_EVM_RPC_BYTES + 1) },
          }),
      ),
    ).rejects.toThrow(/quorum/u);
    await expect(
      verification(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(MAX_EVM_RPC_BYTES));
                controller.enqueue(new Uint8Array(1));
                controller.close();
              },
            }),
          ),
      ),
    ).rejects.toThrow(/quorum/u);
  });

  it("rejects arbitrary RPC CLI arguments and invalid inputs before querying", async () => {
    expect(() =>
      parseEvmFundingArguments([
        "--network",
        "ethereum",
        "--rpc-url",
        "https://attacker.example",
      ]),
    ).toThrow(/Usage/u);
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
    expect(queried).toBe(false);
  });
});

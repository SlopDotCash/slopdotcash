/** Proves the read-only Base payout verifier pins a canonical RPC quorum. */

import { describe, expect, it } from "vitest";
import { EVM_FUNDING_USDC_CONTRACTS } from "../src/lib/evm-funding";
import { EVM_FUNDING_RPC_AUTHORITIES } from "./verify-funding-evm";
import {
  parseEvmSettlementArguments,
  parseEvmSettlementTransfers,
  verifySettlementEvm,
} from "./verify-settlement-evm";

const SOURCE = `0x${"2".repeat(40)}`;
const RECIPIENT = `0x${"1".repeat(40)}`;
const SECOND = `0x${"4".repeat(40)}`;
const HASH = `0x${"a".repeat(64)}`;
const BLOCK_HASH = `0x${"b".repeat(64)}`;
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function transferLog(to: string, value: bigint) {
  return {
    address: EVM_FUNDING_USDC_CONTRACTS.base,
    topics: [
      TRANSFER_TOPIC,
      `0x${"0".repeat(24)}${SOURCE.slice(2)}`,
      `0x${"0".repeat(24)}${to.slice(2)}`,
    ],
    data: `0x${value.toString(16).padStart(64, "0")}`,
    removed: false,
    transactionHash: HASH,
    blockNumber: "0x100",
    blockHash: BLOCK_HASH,
  };
}

function chainResponses(overrides: { chainId?: string; logs?: unknown[] }) {
  return {
    chainId: overrides.chainId ?? "0x2105",
    finalizedBlock: { number: "0x1000", hash: `0x${"c".repeat(64)}` },
    canonicalBlock: {
      number: "0x100",
      hash: BLOCK_HASH,
      timestamp: "0x6553f100",
    },
    receipt: {
      status: "0x1",
      transactionHash: HASH,
      blockNumber: "0x100",
      blockHash: BLOCK_HASH,
      logs: overrides.logs ?? [
        transferLog(RECIPIENT, 1_000_000n),
        transferLog(SECOND, 2_000_000n),
      ],
    },
  };
}

function fetchFor(
  selectResponses: (url: URL) => ReturnType<typeof chainResponses>,
  calls: Array<{ id: string; url: string }> = [],
) {
  return async (url: URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      id: string;
      method: string;
      params: unknown[];
    };
    calls.push({ id: body.id, url: url.toString() });
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

const TRANSFERS = [
  { recipient: RECIPIENT, amountMinor: "1000000" },
  { recipient: SECOND, amountMinor: "2000000" },
];

describe("Base settlement verifier", () => {
  it("queries only the fixed Base authorities and emits exact evidence", async () => {
    const calls: Array<{ id: string; url: string }> = [];
    const result = await verifySettlementEvm({
      network: "base",
      transactionHash: HASH,
      source: SOURCE,
      transfers: TRANSFERS,
      fetchImpl: fetchFor(() => chainResponses({}), calls),
    });
    expect(new Set(calls.map((call) => call.url))).toEqual(
      new Set(
        EVM_FUNDING_RPC_AUTHORITIES.base.map((url) => new URL(url).toString()),
      ),
    );
    expect(calls.every((call) => call.id.startsWith("slop-settlement:"))).toBe(
      true,
    );
    expect(result.state).toBe("verified-on-chain");
    expect(result.verifier.version).toBe("settlement-base-v1");
    expect(result.verifier.evidenceUrl).toBe(`https://basescan.org/tx/${HASH}`);
    expect(result.settlement.totalMinor).toBe("3000000");
    expect(result.chainEvidence.authorities).toHaveLength(3);
  });

  it("survives one dissenting authority but not two", async () => {
    const dissent = (hosts: string[]) =>
      fetchFor((url) =>
        chainResponses(
          hosts.includes(url.hostname)
            ? { logs: [transferLog(RECIPIENT, 1_000_000n)] }
            : {},
        ),
      );
    const input = {
      network: "base" as const,
      transactionHash: HASH,
      source: SOURCE,
      transfers: TRANSFERS,
    };
    const result = await verifySettlementEvm({
      ...input,
      fetchImpl: dissent(["base.drpc.org"]),
    });
    expect(result.chainEvidence.authorities).toHaveLength(2);
    await expect(
      verifySettlementEvm({
        ...input,
        fetchImpl: dissent(["base.drpc.org", "mainnet.base.org"]),
      }),
    ).rejects.toThrow(/quorum.*source USDC debit is not exact/u);
  });

  it("refuses authorities that serve any chain other than Base mainnet", async () => {
    await expect(
      verifySettlementEvm({
        network: "base",
        transactionHash: HASH,
        source: SOURCE,
        transfers: TRANSFERS,
        fetchImpl: fetchFor(() => chainResponses({ chainId: "0x1" })),
      }),
    ).rejects.toThrow(/quorum.*not base mainnet/u);
  });

  it("refuses non-Base networks and malformed input without any RPC call", async () => {
    const calls: Array<{ id: string; url: string }> = [];
    const fetchImpl = fetchFor(() => chainResponses({}), calls);
    await expect(
      verifySettlementEvm({
        network: "ethereum" as "base",
        transactionHash: HASH,
        source: SOURCE,
        transfers: TRANSFERS,
        fetchImpl,
      }),
    ).rejects.toThrow(/invalid/u);
    await expect(
      verifySettlementEvm({
        network: "base",
        transactionHash: HASH,
        source: `0x${"A".repeat(40)}`,
        transfers: TRANSFERS,
        fetchImpl,
      }),
    ).rejects.toThrow(/invalid/u);
    expect(calls).toHaveLength(0);
  });

  it("parses strict arguments and transfer lists", () => {
    expect(
      parseEvmSettlementArguments([
        "--network",
        "base",
        "--transaction",
        HASH,
        "--source",
        SOURCE,
        "--transfers",
        `${RECIPIENT}:1000000`,
      ]),
    ).toEqual({
      network: "base",
      transactionHash: HASH,
      source: SOURCE,
      transfers: `${RECIPIENT}:1000000`,
    });
    expect(() =>
      parseEvmSettlementArguments(["--network", "base", "--network", "base"]),
    ).toThrow(/Usage/u);
    expect(() => parseEvmSettlementArguments(["--rpc-url", "x"])).toThrow(
      /Usage/u,
    );
    expect(
      parseEvmSettlementTransfers(`${RECIPIENT}:1000000,${SECOND}:2000000`),
    ).toEqual(TRANSFERS);
    for (const malformed of [
      `${RECIPIENT}:0`,
      `${RECIPIENT}:1.5`,
      `${RECIPIENT.toUpperCase()}:1`,
      `${RECIPIENT}`,
      `${RECIPIENT}:1,`,
    ]) {
      expect(() => parseEvmSettlementTransfers(malformed)).toThrow(
        /--transfers entry/u,
      );
    }
  });
});

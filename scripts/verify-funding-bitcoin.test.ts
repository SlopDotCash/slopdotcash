/** Proves the read-only Bitcoin verifier pins a bounded, canonical API quorum. */

import { describe, expect, it } from "vitest";
import {
  BITCOIN_FUNDING_API_AUTHORITIES,
  MAX_BITCOIN_API_BYTES,
  parseBitcoinFundingArguments,
  verifyFundingBitcoin,
} from "./verify-funding-bitcoin";

const RECIPIENT = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const SENDER = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const TXID = "a".repeat(64);
const BLOCK_HASH = "f".repeat(64);

function transactionBody(blockHash = BLOCK_HASH) {
  return JSON.stringify({
    txid: TXID,
    status: { confirmed: true, block_height: 800_000, block_hash: blockHash },
    vin: [
      {
        is_coinbase: false,
        prevout: { scriptpubkey_address: SENDER, value: 200_000 },
      },
    ],
    vout: [
      { scriptpubkey_address: RECIPIENT, value: 150_000 },
      { scriptpubkey_address: SENDER, value: 49_000 },
    ],
    fee: 1_000,
  });
}

function authorityResponses(overrides: Record<string, string> = {}) {
  return {
    [`/tx/${TXID}`]: transactionBody(),
    "/blocks/tip/height": "800010",
    "/block-height/800000": BLOCK_HASH,
    ...overrides,
  } as Record<string, string>;
}

function fetchFor(
  perHost: Record<string, Record<string, string>>,
  requests: string[] = [],
  redirects: Array<RequestRedirect | undefined> = [],
) {
  return async (url: URL, init?: RequestInit) => {
    const path = url.pathname.replace(/^\/api/u, "");
    requests.push(`${url.host}${path}`);
    redirects.push(init?.redirect);
    const responses = perHost[url.host];
    if (!responses || !(path in responses)) {
      throw new Error(`unexpected API request ${url.host}${path}`);
    }
    return new Response(responses[path]);
  };
}

const HOSTS = BITCOIN_FUNDING_API_AUTHORITIES.map(
  (authority) => new URL(authority).host,
);

function allHosts(responses: Record<string, string>) {
  return Object.fromEntries(HOSTS.map((host) => [host, responses]));
}

describe("Bitcoin funding verifier", () => {
  it("reaches quorum across fixed authorities and emits reviewed fields", async () => {
    const requests: string[] = [];
    const redirects: Array<RequestRedirect | undefined> = [];
    const result = await verifyFundingBitcoin({
      transactionId: TXID,
      recipient: RECIPIENT,
      amountMinor: "150000",
      fetchImpl: fetchFor(allHosts(authorityResponses()), requests, redirects),
    });
    for (const host of HOSTS) {
      expect(requests).toContain(`${host}/tx/${TXID}`);
      expect(requests).toContain(`${host}/blocks/tip/height`);
      expect(requests).toContain(`${host}/block-height/800000`);
    }
    expect(redirects.every((redirect) => redirect === "error")).toBe(true);
    expect(result).toMatchObject({
      state: "verified-on-chain",
      finality: { kind: "confirmations", confirmations: 11 },
      verifier: {
        version: "funding-bitcoin-v1",
        evidenceUrl: `https://mempool.space/tx/${TXID}`,
        reason: null,
      },
      chainEvidence: {
        transactionId: TXID,
        blockHeight: 800_000,
        blockHash: BLOCK_HASH,
      },
    });
    expect(result.chainEvidence.authorities).toHaveLength(HOSTS.length);
  });

  it("uses the minimum agreeing confirmations and survives one divergence", async () => {
    const result = await verifyFundingBitcoin({
      transactionId: TXID,
      recipient: RECIPIENT,
      amountMinor: "150000",
      fetchImpl: fetchFor({
        [HOSTS[0]]: authorityResponses({ "/blocks/tip/height": "800020" }),
        [HOSTS[1]]: authorityResponses(),
        [HOSTS[2]]: authorityResponses({
          "/block-height/800000": "e".repeat(64),
        }),
      }),
    });
    expect(result.finality).toEqual({
      kind: "confirmations",
      confirmations: 11,
    });
    expect(result.chainEvidence.authorities).toHaveLength(2);
  });

  it("survives one unavailable authority", async () => {
    const result = await verifyFundingBitcoin({
      transactionId: TXID,
      recipient: RECIPIENT,
      amountMinor: "150000",
      fetchImpl: fetchFor({
        [HOSTS[0]]: authorityResponses(),
        [HOSTS[1]]: authorityResponses(),
      }),
    });
    expect(result.chainEvidence.authorities).toHaveLength(2);
  });

  it("fails closed when authorities cannot reach canonical quorum", async () => {
    await expect(
      verifyFundingBitcoin({
        transactionId: TXID,
        recipient: RECIPIENT,
        amountMinor: "150000",
        fetchImpl: fetchFor({
          [HOSTS[0]]: authorityResponses(),
          [HOSTS[1]]: authorityResponses({
            "/block-height/800000": "e".repeat(64),
          }),
          [HOSTS[2]]: authorityResponses({
            [`/tx/${TXID}`]: transactionBody("d".repeat(64)),
            "/block-height/800000": "d".repeat(64),
          }),
        }),
      }),
    ).rejects.toThrow(/quorum/u);
  });

  it("rejects invalid inputs before querying any authority", async () => {
    let queried = false;
    const spy = async () => {
      queried = true;
      return new Response();
    };
    await expect(
      verifyFundingBitcoin({
        transactionId: `0x${"a".repeat(62)}`,
        recipient: RECIPIENT,
        amountMinor: "150000",
        fetchImpl: spy,
      }),
    ).rejects.toThrow(/invalid/u);
    await expect(
      verifyFundingBitcoin({
        transactionId: TXID,
        recipient: `${RECIPIENT.slice(0, -1)}Q`,
        amountMinor: "150000",
        fetchImpl: spy,
      }),
    ).rejects.toThrow(/invalid/u);
    await expect(
      verifyFundingBitcoin({
        transactionId: TXID,
        recipient: RECIPIENT,
        amountMinor: "1".repeat(41),
        fetchImpl: spy,
      }),
    ).rejects.toThrow(/invalid/u);
    expect(queried).toBe(false);
  });

  it("rejects malformed, repeated, or unknown CLI arguments", () => {
    expect(
      parseBitcoinFundingArguments([
        "--transaction",
        TXID,
        "--recipient",
        RECIPIENT,
        "--amount-minor",
        "150000",
      ]),
    ).toEqual({
      transactionId: TXID,
      recipient: RECIPIENT,
      amountMinor: "150000",
    });
    expect(() =>
      parseBitcoinFundingArguments(["--api-url", "https://example.com"]),
    ).toThrow(/Usage/u);
    expect(() =>
      parseBitcoinFundingArguments([
        "--transaction",
        TXID,
        "--transaction",
        TXID,
      ]),
    ).toThrow(/Usage/u);
  });

  it("rejects declared and streamed bodies above 8 MiB", async () => {
    await expect(
      verifyFundingBitcoin({
        transactionId: TXID,
        recipient: RECIPIENT,
        amountMinor: "150000",
        fetchImpl: async () =>
          new Response("{}", {
            headers: {
              "content-length": String(MAX_BITCOIN_API_BYTES + 1),
            },
          }),
      }),
    ).rejects.toThrow(/quorum/u);
    await expect(
      verifyFundingBitcoin({
        transactionId: TXID,
        recipient: RECIPIENT,
        amountMinor: "150000",
        fetchImpl: async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array(MAX_BITCOIN_API_BYTES));
                controller.enqueue(new Uint8Array(1));
                controller.close();
              },
            }),
          ),
      }),
    ).rejects.toThrow(/quorum/u);
  });
});

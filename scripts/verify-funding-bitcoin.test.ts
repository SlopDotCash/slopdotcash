/** Proves the read-only Bitcoin verifier pins best-chain data and fails closed. */

import { describe, expect, it } from "vitest";
import { verifyFundingBitcoin } from "./verify-funding-bitcoin";

const RECIPIENT = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const SENDER = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const TXID = "a".repeat(64);
const BLOCK_HASH = "f".repeat(64);

function apiResponses(overrides: Record<string, string> = {}) {
  return {
    [`/tx/${TXID}`]: JSON.stringify({
      txid: TXID,
      status: {
        confirmed: true,
        block_height: 800_000,
        block_hash: BLOCK_HASH,
      },
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
    }),
    "/blocks/tip/height": "800010",
    "/block-height/800000": BLOCK_HASH,
    ...overrides,
  } as Record<string, string>;
}

function fetchFor(responses: Record<string, string>, paths: string[] = []) {
  return async (url: URL) => {
    const path = url.pathname.replace(/^\/api/u, "");
    paths.push(path);
    if (!(path in responses)) throw new Error(`unexpected API path ${path}`);
    return new Response(responses[path]);
  };
}

describe("Bitcoin funding verifier", () => {
  it("checks tip and best-chain hash, then emits reviewed record fields", async () => {
    const paths: string[] = [];
    const result = await verifyFundingBitcoin({
      transactionId: TXID,
      recipient: RECIPIENT,
      amountMinor: "150000",
      fetchImpl: fetchFor(apiResponses(), paths),
    });
    expect(paths).toEqual([
      `/tx/${TXID}`,
      "/blocks/tip/height",
      "/block-height/800000",
    ]);
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
  });

  it("rejects a transaction whose block left the best chain", async () => {
    await expect(
      verifyFundingBitcoin({
        transactionId: TXID,
        recipient: RECIPIENT,
        amountMinor: "150000",
        fetchImpl: fetchFor(
          apiResponses({ "/block-height/800000": "e".repeat(64) }),
        ),
      }),
    ).rejects.toThrow(/best chain/u);
  });

  it("rejects invalid inputs and credentialed APIs before querying", async () => {
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
        amountMinor: "150000",
        apiUrl: "https://user:pass@mempool.example.com/api",
        fetchImpl: spy,
      }),
    ).rejects.toThrow(/credential-free/u);
    expect(queried).toBe(false);
  });
});

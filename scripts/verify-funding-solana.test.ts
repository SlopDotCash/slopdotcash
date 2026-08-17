/** Proves the read-only Solana verifier requests finalized data and fails closed. */

import { describe, expect, it } from "vitest";
import { SOLANA_MAINNET_USDC_MINT } from "../src/lib/settlement-plan";
import {
  parseSolanaFundingArguments,
  verifyFundingSolana,
} from "./verify-funding-solana";

const SOURCE = "Vote111111111111111111111111111111111111111";
const RECIPIENT = "11111111111111111111111111111111";
const SIGNATURE = "3".repeat(88);
const MAX_TEST_RPC_BYTES = 8 * 1024 * 1024;

function balance(accountIndex: number, owner: string, amount: string) {
  return {
    accountIndex,
    mint: SOLANA_MAINNET_USDC_MINT,
    owner,
    uiTokenAmount: { amount, decimals: 6 },
  };
}

function rpcResult() {
  return {
    slot: 123,
    blockTime: 1_786_000_000,
    meta: {
      err: null,
      preTokenBalances: [
        balance(0, SOURCE, "2000000"),
        balance(1, RECIPIENT, "0"),
      ],
      postTokenBalances: [
        balance(0, SOURCE, "1000000"),
        balance(1, RECIPIENT, "1000000"),
      ],
    },
    transaction: { signatures: [SIGNATURE] },
  };
}

describe("Solana funding verifier", () => {
  it("requests finalized mainnet evidence and emits reviewed record fields", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const result = await verifyFundingSolana({
      signature: SIGNATURE,
      recipient: RECIPIENT,
      amountMinor: "1000000",
      fetchImpl: async (_url, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: SIGNATURE,
            result: rpcResult(),
          }),
        );
      },
    });

    expect(requestBody).toMatchObject({
      method: "getTransaction",
      params: [SIGNATURE, { commitment: "finalized", encoding: "jsonParsed" }],
    });
    expect(result).toMatchObject({
      state: "verified-on-chain",
      finality: { kind: "finalized" },
      verifier: {
        version: "funding-solana-v1",
        evidenceUrl: `https://solscan.io/tx/${SIGNATURE}`,
      },
      chainEvidence: { signature: SIGNATURE, slot: 123 },
    });
  });

  it("rejects a transaction absent at finalized commitment", async () => {
    await expect(
      verifyFundingSolana({
        signature: SIGNATURE,
        recipient: RECIPIENT,
        amountMinor: "1000000",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({ jsonrpc: "2.0", id: SIGNATURE, result: null }),
          ),
      }),
    ).rejects.toThrow(/did not return a finalized transaction/u);
  });

  it("rejects an unbounded amount before querying an RPC", async () => {
    let queried = false;
    await expect(
      verifyFundingSolana({
        signature: SIGNATURE,
        recipient: RECIPIENT,
        amountMinor: "1".repeat(41),
        fetchImpl: async () => {
          queried = true;
          return new Response();
        },
      }),
    ).rejects.toThrow(/invalid/u);
    expect(queried).toBe(false);
  });

  it("rejects unknown, repeated, and valueless CLI arguments", () => {
    expect(() =>
      parseSolanaFundingArguments(["--signature", SIGNATURE, "--unknown", "x"]),
    ).toThrow(/Usage/u);
    expect(() =>
      parseSolanaFundingArguments([
        "--signature",
        SIGNATURE,
        "--signature",
        SIGNATURE,
      ]),
    ).toThrow(/Usage/u);
    expect(() => parseSolanaFundingArguments(["--recipient"])).toThrow(
      /Usage/u,
    );
  });

  it("rejects an oversized streamed RPC response before buffering it", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_TEST_RPC_BYTES));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    await expect(
      verifyFundingSolana({
        signature: SIGNATURE,
        recipient: RECIPIENT,
        amountMinor: "1000000",
        fetchImpl: async () => new Response(body),
      }),
    ).rejects.toThrow(/size limit/u);
  });
});

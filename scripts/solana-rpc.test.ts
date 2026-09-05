/**
 * Exercises the real Solana JSON-RPC boundary with deterministic Response
 * objects, including credential, byte-limit, identifier, and timeout failures.
 */

import { describe, expect, it, vi } from "vitest";
import { fetchFinalizedSolanaTransaction } from "./solana-rpc";

const SIGNATURE = "2".repeat(88);

function rpcResponse(result: unknown, id = SIGNATURE): Response {
  return Response.json({ jsonrpc: "2.0", id, result });
}

describe("Solana RPC boundary", () => {
  it("requests a finalized jsonParsed transaction and validates its id", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _request?: RequestInit) =>
        rpcResponse({ slot: 42 }),
    );

    await expect(
      fetchFinalizedSolanaTransaction(
        "https://api.mainnet-beta.solana.com",
        SIGNATURE,
        { fetcher },
      ),
    ).resolves.toEqual({ slot: 42 });
    const [, request] = fetcher.mock.calls[0];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      id: SIGNATURE,
      method: "getTransaction",
      params: [SIGNATURE, { commitment: "finalized", encoding: "jsonParsed" }],
    });
  });

  it("rejects credentials, mismatched ids, and oversized bodies", async () => {
    await expect(
      fetchFinalizedSolanaTransaction("https://secret@example.com", SIGNATURE),
    ).rejects.toThrow("without embedded credentials");
    await expect(
      fetchFinalizedSolanaTransaction("https://rpc.example", SIGNATURE, {
        fetcher: async () => rpcResponse({}, "different"),
      }),
    ).rejects.toThrow("did not return a finalized transaction");
    await expect(
      fetchFinalizedSolanaTransaction("https://rpc.example", SIGNATURE, {
        fetcher: async () =>
          new Response("{}", {
            headers: { "content-length": "3" },
          }),
        maxBytes: 2,
      }),
    ).rejects.toThrow("exceeded its size limit");
  });

  it("rejects a base58 value that is not a 64-byte signature", async () => {
    const fetcher = vi.fn(async () => rpcResponse({ slot: 42 }));

    await expect(
      fetchFinalizedSolanaTransaction(
        "https://api.mainnet-beta.solana.com",
        "2".repeat(64),
        { fetcher },
      ),
    ).rejects.toThrow(/signature is invalid/u);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("aborts a stalled request at the bounded timeout", async () => {
    const fetcher = async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });

    await expect(
      fetchFinalizedSolanaTransaction("https://rpc.example", SIGNATURE, {
        fetcher,
        timeoutMs: 5,
      }),
    ).rejects.toThrow("aborted");
  });
});

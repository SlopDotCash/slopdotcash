import { describe, expect, test } from "bun:test";
import {
  rpcTokenMetadataReader,
  TokenMetadataError,
} from "../backend/projects/token-metadata";
import { solanaBase58 } from "../contracts/solana/adapter";

/**
 * The reward-asset reader is the owner-setup surface: a maintainer submits a mint
 * address and Slop stores its decimals. It now admits classic SPL Token and the
 * approved metadata-only Token-2022 subset, and refuses every other owner, layout
 * and extension.
 */
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const MINT_BYTES = new Uint8Array(32).fill(9);
const MINT = solanaBase58(MINT_BYTES);
const RPC = "https://rpc.invalid";

/** A classic SPL mint with the given decimals. */
function classicMint(decimals: number, size = 82): Uint8Array {
  const data = new Uint8Array(size);
  data[44] = decimals;
  data[45] = 1;
  return data;
}

/** The approved metadata-only Token-2022 mint that names `MINT`. */
function token2022Mint(decimals: number): Uint8Array {
  const data = new Uint8Array(166 + 68 + 4 + 89);
  data[44] = decimals;
  data[45] = 1;
  data[165] = 1;
  const view = new DataView(data.buffer);
  let at = 166;
  view.setUint16(at, 18, true);
  view.setUint16(at + 2, 64, true);
  data.set(MINT_BYTES, at + 4 + 32);
  at += 4 + 64;
  view.setUint16(at, 19, true);
  view.setUint16(at + 2, 89, true);
  const payload = at + 4;
  data.set(MINT_BYTES, payload + 32);
  for (const [offset, text] of [
    [64, "TEST"],
    [72, "TEST"],
    [80, "u"],
  ] as const) {
    view.setUint32(payload + offset, text.length, true);
    data.set(
      Uint8Array.from(text, (c) => c.charCodeAt(0)),
      payload + offset + 4,
    );
  }
  view.setUint32(payload + 85, 0, true);
  return data;
}

/** Answers getAccountInfo with one base64 account and records the request. */
function stubRpc(owner: string | null, data: Uint8Array) {
  const calls: { method: string; params: unknown[] }[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ method: body.method, params: body.params ?? [] });
    const value =
      owner === null
        ? null
        : {
            owner,
            executable: false,
            lamports: 1,
            data: [Buffer.from(data).toString("base64"), "base64"],
          };
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value } }),
    );
  }) as typeof fetch;
  return { fetcher, calls };
}

const read = (owner: string | null, data: Uint8Array) => {
  const { fetcher, calls } = stubRpc(owner, data);
  return {
    calls,
    metadata: rpcTokenMetadataReader(fetcher, { solana: RPC })("solana", MINT),
  };
};

describe("reward token metadata", () => {
  test("reads a classic SPL mint from a finalized base64 account", async () => {
    const { calls, metadata } = read(TOKEN, classicMint(6));
    expect(await metadata).toEqual({ decimals: 6, symbol: null });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("getAccountInfo");
    expect(calls[0].params[0]).toBe(MINT);
    expect(calls[0].params[1]).toEqual({
      encoding: "base64",
      commitment: "finalized",
    });
  });

  test("reads the approved metadata-only Token-2022 mint", async () => {
    expect(await read(TOKEN_2022, token2022Mint(9)).metadata).toEqual({
      decimals: 9,
      symbol: null,
    });
  });

  test("refuses a Token-2022 mint outside the subset", async () => {
    const authorized = token2022Mint(6);
    authorized[46] = 1;
    await expect(read(TOKEN_2022, authorized).metadata).rejects.toThrow(
      "Token-2022 freeze authority is not disabled",
    );
    const extra = token2022Mint(6);
    extra[234] = 1;
    extra[235] = 0;
    await expect(read(TOKEN_2022, extra).metadata).rejects.toThrow(
      "Unsupported Token-2022 extension 1",
    );
    await expect(read(TOKEN_2022, classicMint(6)).metadata).rejects.toThrow(
      "Truncated Token-2022 account",
    );
  });

  test("refuses an account that is not a mint or not a token program", async () => {
    // A 165-byte token account that is initialized but is not a mint.
    await expect(read(TOKEN, classicMint(6, 165)).metadata).rejects.toThrow(
      "Classic mint layout mismatch",
    );
    await expect(read(TOKEN, classicMint(6, 83)).metadata).rejects.toThrow(
      "Classic mint layout mismatch",
    );
    const uninitialized = classicMint(6);
    uninitialized[45] = 0;
    await expect(read(TOKEN, uninitialized).metadata).rejects.toThrow(
      "Mint is not initialized",
    );
    await expect(
      read("11111111111111111111111111111111", classicMint(6)).metadata,
    ).rejects.toThrow("Not a supported token program account");
  });

  test("reports a missing account and wraps every refusal as a token metadata error", async () => {
    const missing = read(null, classicMint(6));
    await expect(missing.metadata).rejects.toThrow(
      "No account exists at that mint address",
    );
    await expect(read(null, classicMint(6)).metadata).rejects.toBeInstanceOf(
      TokenMetadataError,
    );
  });
});

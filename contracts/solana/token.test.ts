import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  rpcTokenMetadataReader,
  TokenMetadataError,
} from "../../backend/projects/token-metadata";
import {
  CLASSIC_TOKEN_PROGRAM,
  inspectMintAccount,
  inspectTokenAccount,
  TOKEN_2022_PROGRAM,
} from "./token";

const mint = "3qbR1eZRqXUWroWKKYhbDmR3FfqTHfqSU8zZSxtANzYh";
const fixture = new Uint8Array(
  readFileSync(
    new URL("./integration/fixtures/token-2022-mint.bin", import.meta.url),
  ),
);
const account = (bytes: Uint8Array, owner = TOKEN_2022_PROGRAM) => ({
  owner,
  data: [Buffer.from(bytes).toString("base64"), "base64"],
});

test("the synthetic metadata mint is admitted without admitting active mint or freeze authority", () => {
  expect(inspectMintAccount(account(fixture), mint).decimals).toBe(6);
  for (const offset of [0, 46]) {
    const changed = fixture.slice();
    changed[offset] = 1;
    expect(() => inspectMintAccount(account(changed), mint)).toThrow();
  }
  // Classic USDC-style authorities remain valid under the existing asset policy.
  const classic = fixture.slice(0, 82);
  classic[0] = 1;
  classic[46] = 1;
  expect(
    inspectMintAccount(account(classic, CLASSIC_TOKEN_PROGRAM), mint).decimals,
  ).toBe(6);
});

test("economic, hook, duplicate and unknown mint extensions cannot ride alongside allowed metadata", () => {
  for (const kind of [1, 14, 60000]) {
    const changed = fixture.slice();
    new DataView(changed.buffer).setUint16(166, kind, true);
    expect(() => inspectMintAccount(account(changed), mint)).toThrow();
  }
  const duplicate = new Uint8Array(fixture.length + 68);
  duplicate.set(fixture);
  duplicate.set(fixture.slice(166, 234), fixture.length);
  expect(() => inspectMintAccount(account(duplicate), mint)).toThrow();
  for (const changed of [fixture.slice(0, -1), fixture.slice()]) {
    if (changed.length === fixture.length) changed[270] ^= 1; // Metadata's bound mint.
    expect(() => inspectMintAccount(account(changed), mint)).toThrow();
  }
});

test("ImmutableOwner token accounts preserve program identity and refuse unrelated extensions", () => {
  const bytes = new Uint8Array(170);
  bytes[108] = 1;
  bytes[165] = 2;
  bytes[166] = 7;
  expect(inspectTokenAccount(account(bytes), TOKEN_2022_PROGRAM).bytes).toEqual(
    bytes,
  );
  expect(() =>
    inspectTokenAccount(account(bytes), CLASSIC_TOKEN_PROGRAM),
  ).toThrow();
  const memo = new Uint8Array(171);
  memo.set(bytes);
  memo[166] = 8;
  memo[168] = 1;
  expect(() =>
    inspectTokenAccount(account(memo), TOKEN_2022_PROGRAM),
  ).toThrow();
});

test("maintainer token submission admits a synthetic mint from raw state but cannot hide a transfer hook in JSON parsing", async () => {
  let bytes = fixture;
  const reader = rpcTokenMetadataReader(
    (async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      expect(request.method).toBe("getAccountInfo");
      expect(request.params).toEqual([
        mint,
        { encoding: "base64", commitment: "finalized" },
      ]);
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { value: account(bytes) },
        }),
      );
    }) as typeof fetch,
    { solana: "https://fixture.invalid" },
  );
  expect(await reader("solana", mint)).toEqual({ decimals: 6, symbol: null });
  bytes = fixture.slice();
  new DataView(bytes.buffer).setUint16(166, 14, true);
  await expect(reader("solana", mint)).rejects.toBeInstanceOf(
    TokenMetadataError,
  );
});

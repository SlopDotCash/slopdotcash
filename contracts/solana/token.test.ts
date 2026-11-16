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
import { readTokenAccount, readTokenMint } from "./token-extensions";

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
  for (const changed of [fixture.slice(0, 361), fixture.slice()]) {
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

test("Token-2022 metadata keeps full payload extents inside the mint-size bound", () => {
  const padded = new Uint8Array(1024);
  padded.set(fixture);
  const reading = readTokenMint(account(padded));
  expect(reading.extensions).toEqual([18, 19]);
  expect(reading.decimals).toBe(6);
  expect(reading.raw).toEqual(padded);
  // Even zero padding cannot grow an admitted mint beyond the program's limit.
  const oversized = new Uint8Array(1025);
  oversized.set(fixture);
  expect(() => readTokenMint(account(oversized))).toThrow(
    /exceeds the 1024-byte limit/,
  );
});

test("Token-2022 refuses the first invalid TLV with the original diagnostic priority", () => {
  const bytes = new Uint8Array(170);
  bytes[165] = 2;
  const view = new DataView(bytes.buffer);
  view.setUint16(166, 8, true);
  view.setUint16(168, 65535, true);
  // The unknown type wins even when its declared payload is truncated.
  expect(() => readTokenAccount(account(bytes))).toThrow(
    "Unsupported Token-2022 extension 8",
  );
  view.setUint16(166, 7, true);
  expect(() => readTokenAccount(account(bytes))).toThrow(
    "Truncated Token-2022 extension",
  );
  view.setUint16(168, 0, true);
  const repeated = new Uint8Array(174);
  repeated.set(bytes);
  repeated[170] = 7;
  repeated[172] = 255;
  // The duplicate wins before the repeated record's invalid payload length.
  expect(() => readTokenAccount(account(repeated))).toThrow(
    "Duplicate Token-2022 extension 7",
  );
});

test("TokenMetadata walks all string fields and key/value pairs without adding UTF-8 policy", () => {
  const word = (value: number) => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    return bytes;
  };
  const field = (bytes: number[]) =>
    Buffer.concat([word(bytes.length), Uint8Array.from(bytes)]);
  const payload = Buffer.concat([
    new Uint8Array(64),
    field([255, 254]),
    field([128]),
    field([]),
    word(2),
    field([255]),
    field([0]),
    field([]),
    field([254]),
    new Uint8Array(5),
  ]);
  const bytes = new Uint8Array(170 + payload.length);
  bytes[44] = 6;
  bytes[45] = 1;
  bytes[165] = 1;
  new DataView(bytes.buffer).setUint16(166, 19, true);
  new DataView(bytes.buffer).setUint16(168, payload.length, true);
  bytes.set(payload, 170);
  expect(readTokenMint(account(bytes)).extensions).toEqual([19]);
  expect(readTokenMint(account(bytes)).decimals).toBe(6);
});

test("TokenMetadata refuses oversized u32 fields, incomplete pairs and nonzero suffixes", () => {
  const payload = new Uint8Array(88); // Three empty strings and one empty pair.
  new DataView(payload.buffer).setUint32(76, 1, true);
  const read = (value: Uint8Array) => {
    const bytes = new Uint8Array(170 + value.length);
    bytes[45] = 1;
    bytes[165] = 1;
    new DataView(bytes.buffer).setUint16(166, 19, true);
    new DataView(bytes.buffer).setUint16(168, value.length, true);
    bytes.set(value, 170);
    return readTokenMint(account(bytes));
  };
  expect(read(payload).extensions).toEqual([19]);
  for (const offset of [64, 68, 72, 76, 80, 84]) {
    const changed = payload.slice();
    new DataView(changed.buffer).setUint32(offset, 0xffffffff, true);
    expect(() => read(changed)).toThrow("Malformed token metadata");
  }
  for (const length of [72, 75, 79, 83, 87])
    expect(() => read(payload.slice(0, length))).toThrow(
      "Malformed token metadata",
    );
  const suffix = new Uint8Array(89);
  suffix.set(payload);
  suffix[88] = 1;
  expect(() => read(suffix)).toThrow("Malformed token metadata");
});

test("maintainer token submission admits a synthetic mint from raw state but cannot hide a transfer hook in JSON parsing", async () => {
  let bytes = fixture;
  const reader = rpcTokenMetadataReader(
    (async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      if (request.method === "getGenesisHash")
        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
        });
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

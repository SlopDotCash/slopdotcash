/** Source-authored parser/consumer regressions; unexecuted in this change. */
import { expect, test } from "bun:test";
import { encodeBase58Bytes } from "../src/lib/base58";
import {
  assertFundingAddresses,
  fundingAssetForNetwork,
  isFundingAddress,
  isSolanaTransactionId,
} from "../src/lib/funding-address.mjs";
import { rewardAssetChoice } from "../src/lib/reward-asset.mjs";
import { isWalletAddress } from "../src/lib/wallets";

const evm = (value: number) => `0x${value.toString(16).padStart(40, "0")}`;
const time = (second: number) =>
  new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString();
const route = (address: number, from: number, until: number | null) => ({
  network: "base",
  asset: "USDC",
  address: evm(address),
  effectiveAt: time(from),
  replacedAt: until === null ? null : time(until),
});

test("historical routes allow exact touching boundaries and preserve input order without mutation", () => {
  const input = Object.freeze([
    Object.freeze(route(2, 2, 4)),
    Object.freeze(route(1, 1, 2)),
    Object.freeze({ ...route(3, 1, null), network: "ethereum" }),
  ]);
  const result = assertFundingAddresses(input);
  expect(result).toEqual(input);
  expect(result).not.toBe(input);
  expect(result[0]).not.toBe(input[0]);
  expect(input[0].address).toBe(evm(2));
});

test("same-group overlap and an open predecessor refuse the entire history", () => {
  expect(() =>
    assertFundingAddresses([route(1, 1, 3), route(2, 2, null)]),
  ).toThrow("overlapping active routes");
  expect(() =>
    assertFundingAddresses([route(2, 2, null), route(1, 1, null)]),
  ).toThrow("overlapping active routes");
});

test("duplicate receiving address is rejected even when intervals do not overlap", () => {
  expect(() =>
    assertFundingAddresses([route(1, 1, 2), route(1, 3, null)]),
  ).toThrow("duplicate receiving address");
  expect(
    assertFundingAddresses([
      route(1, 1, null),
      { ...route(1, 1, null), network: "ethereum" },
    ]),
  ).toHaveLength(2);
});

test("empty and 32-route histories are accepted while 33 routes refuse", () => {
  expect(assertFundingAddresses([])).toEqual([]);
  const routes = Array.from({ length: 32 }, (_, index) =>
    route(index + 1, index, index === 31 ? null : index + 1),
  );
  expect(assertFundingAddresses(routes)).toHaveLength(32);
  expect(() =>
    assertFundingAddresses([...routes, route(33, 33, null)]),
  ).toThrow("at most 32 routes");
});

test("route records require exact fields and strictly increasing canonical UTC endpoints", () => {
  const valid = route(1, 1, 2);
  for (const candidate of [null, [], { ...valid, extra: true }])
    expect(() => assertFundingAddresses([candidate])).toThrow();
  const { replacedAt: _, ...missing } = valid;
  expect(() => assertFundingAddresses([missing])).toThrow();
  for (const invalid of [
    { ...valid, replacedAt: valid.effectiveAt },
    { ...valid, replacedAt: time(0) },
    { ...valid, effectiveAt: "2026-01-01T00:00:01Z" },
    { ...valid, effectiveAt: "2026-01-01T00:00:01.000+00:00" },
    { ...valid, effectiveAt: "2026-02-30T00:00:01.000Z" },
  ])
    expect(() => assertFundingAddresses([invalid])).toThrow();
});

test("network assets are exact and Robinhood remains wallet-valid but direct-route-invalid", () => {
  expect(fundingAssetForNetwork("robinhood")).toBe("USDG");
  expect(fundingAssetForNetwork("unsupported")).toBeNull();
  expect(isFundingAddress("robinhood", evm(1))).toBe(true);
  expect(isWalletAddress("robinhood", evm(1))).toBe(true);
  expect(() =>
    assertFundingAddresses([
      { ...route(1, 1, null), network: "robinhood", asset: "USDG" },
    ]),
  ).toThrow("direct funding address is not supported");
  expect(() =>
    assertFundingAddresses([{ ...route(1, 1, null), asset: "BTC" }]),
  ).toThrow("network or asset is unsupported");
});

test("strict EVM spelling and token-input normalization stay distinct", () => {
  const address = `0x${"a".repeat(40)}`;
  expect(isFundingAddress("base", address)).toBe(true);
  expect(isFundingAddress("base", address.toUpperCase())).toBe(false);
  expect(isFundingAddress("base", evm(0))).toBe(false);
  expect(
    rewardAssetChoice("base", "token", ` ${address.toUpperCase()} `, "TEST")
      .address,
  ).toBe(address);
});

test("Solana decoded public-key and transaction-signature lengths are not interchangeable", () => {
  const key = encodeBase58Bytes(new Uint8Array(32).fill(7));
  const signature = encodeBase58Bytes(new Uint8Array(64).fill(7));
  expect(isFundingAddress("solana", key)).toBe(true);
  expect(isWalletAddress("solana", key)).toBe(true);
  expect(isFundingAddress("solana", signature)).toBe(false);
  expect(isSolanaTransactionId(signature)).toBe(true);
  expect(isSolanaTransactionId(key)).toBe(false);
  for (const length of [31, 33])
    expect(
      isFundingAddress(
        "solana",
        encodeBase58Bytes(new Uint8Array(length).fill(7)),
      ),
    ).toBe(false);
  expect(isFundingAddress("solana", `0${key.slice(1)}`)).toBe(false);
});

// Public BSD-2-Clause BIP350 vectors. The v1/40-byte case is valid BIP350
// encoding but deliberately excluded by this parser's 32-byte Taproot rule.
// https://github.com/bitcoin/bips/blob/master/bip-0350.mediawiki#test-vectors
test("Bitcoin address parsing retains checksum version and Taproot length rules", () => {
  const v0 = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
  const taproot =
    "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0";
  const future = "bc1zw508d6qejxtdg4y5r3zarvaryvaxxpcs";
  expect(isFundingAddress("bitcoin", v0)).toBe(true);
  expect(isFundingAddress("bitcoin", taproot)).toBe(true);
  expect(isFundingAddress("bitcoin", future)).toBe(true);
  expect(isFundingAddress("bitcoin", taproot.toUpperCase())).toBe(false);
  for (const invalid of [
    "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd",
    "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh",
    "bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7kt5nd6y",
    "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7v07qwwzcrf",
  ])
    expect(isFundingAddress("bitcoin", invalid)).toBe(false);
});

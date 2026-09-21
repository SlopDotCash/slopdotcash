/** Tests fail-closed parsing of public GitHub profile wallet attribution. */

import { describe, expect, it } from "vitest";
import {
  formatPublishedWallet,
  isBaseAddress,
  isSolanaAddress,
  parsePublishedWallet,
  parsePublishedWallets,
} from "./wallets";

const ADDRESS = "11111111111111111111111111111111";
const BASE_ADDRESS = "0x1111111111111111111111111111111111111111";

describe("public wallet markers", () => {
  it("round-trips one standalone Solana marker", () => {
    const marker = formatPublishedWallet(ADDRESS);
    expect(parsePublishedWallet(`# profile\n\n${marker}\n`)).toEqual({
      address: ADDRESS,
      chain: "solana",
    });
  });

  it("does not treat examples or prose as wallet publication", () => {
    const marker = formatPublishedWallet(ADDRESS);
    expect(parsePublishedWallet(`\`\`\`md\n${marker}\n\`\`\``)).toBeNull();
    expect(parsePublishedWallet(`Example: ${marker}`)).toBeNull();
    expect(parsePublishedWallet("No wallet published.")).toBeNull();
  });

  it("rejects ambiguity, foreign chains, extra fields, and malformed keys", () => {
    const marker = formatPublishedWallet(ADDRESS);
    expect(() => parsePublishedWallet(`${marker}\n${marker}`)).toThrow(
      /multiple/u,
    );
    expect(() =>
      parsePublishedWallet(
        `<!-- gitarmy-wallet:v1 {"chain":"ethereum","address":"${ADDRESS}"} -->`,
      ),
    ).toThrow(/Solana/u);
    expect(() =>
      parsePublishedWallet(
        `<!-- gitarmy-wallet:v1 {"chain":"solana","address":"${ADDRESS}","note":"pay me"} -->`,
      ),
    ).toThrow(/unexpected/u);
    expect(() =>
      parsePublishedWallet(
        '<!-- gitarmy-wallet:v1 {"chain":"solana","address":"not-a-key"} -->',
      ),
    ).toThrow(/invalid Solana/u);
  });

  it("validates decoded public-key length, not base58 appearance alone", () => {
    expect(isSolanaAddress(ADDRESS)).toBe(true);
    expect(isSolanaAddress("2".repeat(32))).toBe(false);
    expect(isSolanaAddress("0".repeat(32))).toBe(false);
  });

  it("accepts one Base marker beside the Solana marker", () => {
    const solana = formatPublishedWallet(ADDRESS);
    const base = formatPublishedWallet(BASE_ADDRESS, "base");
    expect(parsePublishedWallets(`${solana}\n${base}\n`)).toEqual({
      base: { address: BASE_ADDRESS, chain: "base" },
      solana: { address: ADDRESS, chain: "solana" },
    });
    expect(parsePublishedWallet(`${base}\n`)).toBeNull();
    expect(parsePublishedWallet(`${solana}\n${base}\n`)).toEqual({
      address: ADDRESS,
      chain: "solana",
    });
  });

  it("refuses a second marker on the same chain and cross-chain addresses", () => {
    const base = formatPublishedWallet(BASE_ADDRESS, "base");
    expect(() => parsePublishedWallets(`${base}\n${base}`)).toThrow(
      /multiple base/u,
    );
    expect(() =>
      parsePublishedWallets(
        `<!-- slop-wallet:v1 {"chain":"base","address":"${ADDRESS}"} -->`,
      ),
    ).toThrow(/invalid Base/u);
    expect(() =>
      parsePublishedWallets(
        `<!-- slop-wallet:v1 {"chain":"solana","address":"${BASE_ADDRESS}"} -->`,
      ),
    ).toThrow(/invalid Solana/u);
    expect(() => formatPublishedWallet(ADDRESS, "base")).toThrow(/Base/u);
  });

  it("accepts only the canonical lowercase spelling of a Base account", () => {
    expect(isBaseAddress(BASE_ADDRESS)).toBe(true);
    expect(isBaseAddress(`0x${"A".repeat(40)}`)).toBe(false);
    expect(isBaseAddress(`0x${"0".repeat(40)}`)).toBe(false);
    expect(isBaseAddress(`0x${"1".repeat(39)}`)).toBe(false);
    expect(isBaseAddress(BASE_ADDRESS.slice(2))).toBe(false);
  });
});

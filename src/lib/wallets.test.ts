/** Tests fail-closed parsing of public GitHub profile wallet attribution. */

import { describe, expect, it } from "vitest";
import {
  formatPublishedWallet,
  isSolanaAddress,
  parsePublishedWallet,
} from "./wallets";

const ADDRESS = "11111111111111111111111111111111";

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
        `<!-- open-work-wallet:v1 {"chain":"ethereum","address":"${ADDRESS}"} -->`,
      ),
    ).toThrow(/Solana/u);
    expect(() =>
      parsePublishedWallet(
        `<!-- open-work-wallet:v1 {"chain":"solana","address":"${ADDRESS}","note":"pay me"} -->`,
      ),
    ).toThrow(/unexpected/u);
    expect(() =>
      parsePublishedWallet(
        '<!-- open-work-wallet:v1 {"chain":"solana","address":"not-a-key"} -->',
      ),
    ).toThrow(/invalid Solana/u);
  });

  it("validates decoded public-key length, not base58 appearance alone", () => {
    expect(isSolanaAddress(ADDRESS)).toBe(true);
    expect(isSolanaAddress("2".repeat(32))).toBe(false);
    expect(isSolanaAddress("0".repeat(32))).toBe(false);
  });
});

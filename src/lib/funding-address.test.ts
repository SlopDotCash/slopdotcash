// Funding address rules: the EVM rule on Robinhood Chain and the published
// bitcoin witness program vectors.
import { describe, expect, test } from "bun:test";
import { type FundingNetwork, isFundingAddress } from "./funding-address.mjs";

const evm = "0x8f77c37d8650776bfe73c9b12b15209ee15d9b86";

describe("funding address primitives", () => {
  test("Robinhood Chain addresses follow the EVM rule", () => {
    expect(isFundingAddress("robinhood", evm)).toBe(true);
    expect(isFundingAddress("robinhood", evm.toUpperCase())).toBe(false);
    expect(isFundingAddress("robinhood", `0x${"0".repeat(40)}`)).toBe(false);
    expect(
      isFundingAddress(
        "robinhood",
        "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
      ),
    ).toBe(false);
    expect(isFundingAddress("evm" as unknown as FundingNetwork, evm)).toBe(
      false,
    );
  });
});

// Published BIP173, BIP341, and BIP350 address vectors.
describe("isFundingAddress bitcoin witness program lengths", () => {
  test("accepts version 0 and 32-byte version 1 programs", () => {
    for (const address of [
      "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3",
      "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
    ]) {
      expect(isFundingAddress("bitcoin", address)).toBe(true);
    }
  });

  test("rejects an anyone-can-spend version 1 program that is not 32 bytes", () => {
    expect(
      isFundingAddress(
        "bitcoin",
        "bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7kt5nd6y",
      ),
    ).toBe(false);
  });

  test("keeps future witness versions forward-compatible", () => {
    expect(
      isFundingAddress("bitcoin", "bc1zw508d6qejxtdg4y5r3zarvaryvaxxpcs"),
    ).toBe(true);
  });
});

// Explorer links stay null for unknown networks; amounts use base units.
import { describe, expect, test } from "bun:test";
import {
  acceptsPayoutFee,
  formatAssetAmount,
  formatBaseUnits,
  isBaseUnits,
  MAX_BASE_UNITS,
  ordinaryFee,
  payoutFee,
  transactionUrl,
} from "./contracts";

describe("transactionUrl", () => {
  test("unknown networks and missing hashes have no explorer link", () => {
    expect(transactionUrl("anvil", "0xab")).toBeNull();
    expect(transactionUrl("robinhood-mainnet", null)).toBeNull();
  });
});

describe("base-unit amounts", () => {
  test("format by the asset decimals, exactly, without floats", () => {
    expect(formatBaseUnits("98000000", 6)).toBe("98");
    expect(formatBaseUnits("1234567", 6)).toBe("1.234567");
    expect(formatBaseUnits("1000000000000000001", 18)).toBe(
      "1.000000000000000001",
    );
    expect(formatBaseUnits("340282366920938463463374607431768211455", 18)).toBe(
      "340,282,366,920,938,463,463.374607431768211455",
    );
    expect(formatBaseUnits("5", 0)).toBe("5");
    expect(formatBaseUnits("0", 9)).toBe("0");
  });
  test("only the reviewed network asset has a symbol; never a dollar sign", () => {
    expect(
      formatAssetAmount("2000000", {
        network: "base-mainnet",
        assetAddress: "0x833589FCD6eDb6E08f4c7C32D4f71b54bdA02913",
        assetDecimals: 6,
      }),
    ).toBe("2 USDC");
    expect(
      formatAssetAmount("1500000000000000000", {
        network: "base-mainnet",
        assetAddress: "0x6b175474e89094c44da98b954eedeac495271d0f",
        assetDecimals: 18,
      }),
    ).toBe("1.5 token 0x6b17…1d0f");
    // A reference address read with other decimals is not given its symbol.
    expect(
      formatAssetAmount("2000000", {
        network: "ethereum",
        assetAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        assetDecimals: 18,
      }),
    ).toBe("0.000000000002 token 0xa0b8…eb48");
    expect(
      formatAssetAmount("2000000", {
        network: "ethereum",
        assetAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        assetDecimals: 6,
      }),
    ).toBe("2 USDC");
  });
  test("payout fee is 2% in base units, rounded up, up to uint128", () => {
    expect(payoutFee(100n)).toBe(2n);
    expect(payoutFee(1n)).toBe(1n);
    expect(payoutFee(49n)).toBe(1n);
    expect(payoutFee(51n)).toBe(2n);
    expect(payoutFee(MAX_BASE_UNITS)).toBe(MAX_BASE_UNITS / 50n + 1n);
    expect(ordinaryFee(0n)).toBe(0n);
    expect(ordinaryFee(399n)).toBe(8n);
    expect(() => payoutFee(MAX_BASE_UNITS + 1n)).toThrow();
    expect(isBaseUnits("340282366920938463463374607431768211456")).toBe(false);
    expect(isBaseUnits("01")).toBe(false);
  });
  test("reconciliation accepts the rounded-up fee or a live vault's rounded-down fee only", () => {
    // Rounded up, as upgraded vaults record it.
    expect(acceptsPayoutFee(49n, 1n)).toBe(true);
    expect(acceptsPayoutFee(851n, 18n)).toBe(true);
    // Rounded down, as vaults not yet upgraded record it, only when it is one unit lower.
    expect(acceptsPayoutFee(49n, 0n)).toBe(true);
    expect(acceptsPayoutFee(851n, 17n)).toBe(true);
    // An exact multiple of 50 has one fee.
    expect(acceptsPayoutFee(850n, 17n)).toBe(true);
    expect(acceptsPayoutFee(850n, 16n)).toBe(false);
    expect(acceptsPayoutFee(850n, 18n)).toBe(false);
    // Nothing else.
    expect(acceptsPayoutFee(851n, 16n)).toBe(false);
    expect(acceptsPayoutFee(851n, 19n)).toBe(false);
    expect(acceptsPayoutFee(49n, 2n)).toBe(false);
    // A bounty split is exact: 25%, with no alternative rounding.
    expect(acceptsPayoutFee(100n, 25n, "security-bounty")).toBe(true);
    expect(acceptsPayoutFee(100n, 24n, "security-bounty")).toBe(false);
    expect(acceptsPayoutFee(100n, 2n, "security-bounty")).toBe(false);
    expect(() => acceptsPayoutFee(101n, 25n, "security-bounty")).toThrow();
    expect(() => acceptsPayoutFee(0n, 0n)).toThrow();
  });
});

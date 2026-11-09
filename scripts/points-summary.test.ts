import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { type PointsJournal, pointMembers } from "../src/lib/points";
import { isPointsSummary } from "../src/lib/points-summary";
import { isReceivedTotals, isUsdMicroAsset } from "../src/lib/received-totals";
import { pointsSummary } from "./generate-points";

const journal = JSON.parse(
  readFileSync("data/points/history.json", "utf8"),
) as PointsJournal;

test("the home points summary keeps every contributor's all-time total in rank order", () => {
  const members = pointMembers(journal);
  const summary = pointsSummary(journal, members, "a".repeat(64));
  expect(isPointsSummary(summary)).toBe(true);
  const positive = members.filter((member) => member.total > 0);
  expect(summary.totals.contributors).toBe(positive.length);
  expect(summary.contributors).toHaveLength(positive.length);
  expect(summary.contributors[0].total).toBe(
    Math.max(...positive.map((member) => member.total)),
  );
  expect(summary.totals.points).toBe(
    positive.reduce((sum, member) => sum + member.total, 0),
  );
  // A reordered or altered summary is rejected rather than shown.
  const reordered = structuredClone(summary);
  reordered.contributors.reverse();
  expect(isPointsSummary(reordered)).toBe(summary.contributors.length < 2);
  const inflated = structuredClone(summary);
  inflated.totals.points += 1;
  expect(isPointsSummary(inflated)).toBe(false);
});

const received = {
  schemaVersion: "1",
  generatedAt: "2026-10-28T00:00:00.000Z",
  contributors: [
    {
      githubUserId: "32437884",
      login: "ss251",
      usdMicro: "1763990000",
      directMicro: "1763990000",
      vaultUsdMicro: "0",
      directTransfers: 3,
      vaultPayments: 0,
      projects: [
        { projectId: "eliza", usdMicro: "1407908903" },
        { projectId: "asi", usdMicro: "356081097" },
      ],
      otherAssets: [],
    },
  ],
  totals: {
    usdMicro: "1763990000",
    directMicro: "1763990000",
    vaultUsdMicro: "0",
    directTransfers: 3,
    vaultPayments: 0,
    contributors: 1,
  },
};

test("received totals reject a total that does not add up", () => {
  expect(isReceivedTotals(received)).toBe(true);
  expect(
    isReceivedTotals({
      ...received,
      totals: { ...received.totals, usdMicro: "1" },
    }),
  ).toBe(false);
});

test("only six-decimal reference stablecoins count as dollars, and testnets only off production", () => {
  const baseUsdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  expect(isUsdMicroAsset("base-mainnet", baseUsdc, 6, false)).toBe(true);
  expect(
    isUsdMicroAsset(
      "base-mainnet",
      baseUsdc.toUpperCase().replace("0X", "0x"),
      6,
      false,
    ),
  ).toBe(true);
  expect(isUsdMicroAsset("base-mainnet", `0x${"2".repeat(40)}`, 6, false)).toBe(
    false,
  );
  const sepoliaUsdc = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
  expect(isUsdMicroAsset("base-sepolia", sepoliaUsdc, 6, false)).toBe(false);
  expect(isUsdMicroAsset("base-sepolia", sepoliaUsdc, 6, true)).toBe(true);
  expect(
    isUsdMicroAsset(
      "solana-mainnet",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      6,
      false,
    ),
  ).toBe(true);
});

for (const [label, value] of [
  ["numeric GitHub id", 32437884],
  ["null GitHub id", null],
  ["boolean GitHub id", true],
  ["array-coerced GitHub id", ["32437884"]],
  ["object GitHub id", {}],
  ["zero GitHub id", "0"],
  ["leading-zero GitHub id", "01"],
  ["fractional GitHub id", "1.2"],
  ["exponent GitHub id", "1e3"],
  ["overlong GitHub id", "1".repeat(17)],
] as const) {
  test(`received totals reject ${label} without coercion`, () => {
    expect(isReceivedTotals({
      ...received,
      contributors: [{ ...received.contributors[0], githubUserId: value }],
    })).toBe(false);
  });
}

test("received totals retain exact sixteen-digit string identities and large base units", () => {
  const amount = "900719925474099312345678901234567890";
  expect(isReceivedTotals({
    ...received,
    contributors: [{
      ...received.contributors[0], githubUserId: "9999999999999999",
      usdMicro: amount, directMicro: amount, vaultUsdMicro: "0",
    }],
    totals: { ...received.totals, usdMicro: amount, directMicro: amount },
  })).toBe(true);
});

test("received totals require each contributor's USD components to reconcile", () => {
  expect(isReceivedTotals({
    ...received,
    contributors: [{ ...received.contributors[0], directMicro: "0", vaultUsdMicro: "0" }],
  })).toBe(false);
});

test("received envelope does not reconcile grand component and transfer counts", () => {
  expect(isReceivedTotals({
    ...received,
    totals: { ...received.totals, directMicro: "0", vaultUsdMicro: "123", directTransfers: 99, vaultPayments: 99 },
  })).toBe(true);
});

test("received envelope does not infer actor uniqueness or project-subtotal equality", () => {
  const duplicate = { ...received.contributors[0], projects: [{ projectId: "", usdMicro: "0" }] };
  expect(isReceivedTotals({
    ...received,
    contributors: [duplicate, duplicate],
    totals: { ...received.totals, contributors: 2, usdMicro: (BigInt(duplicate.usdMicro) * 2n).toString() },
  })).toBe(true);
});

test("received envelope asset metadata is typed but not deployment-qualified", () => {
  expect(isReceivedTotals({
    ...received,
    contributors: [{ ...received.contributors[0], otherAssets: [{
      network: "unknown-network", assetAddress: "not-a-chain-address", assetDecimals: -1, netBase: "0",
    }] }],
  })).toBe(true);
});

for (const [label, change] of [
  ["noncanonical project amount", { projects: [{ projectId: "eliza", usdMicro: "01" }] }],
  ["nonstring project identity", { projects: [{ projectId: 1, usdMicro: "0" }] }],
  ["unsafe asset decimals", { otherAssets: [{ network: "base-mainnet", assetAddress: "asset", assetDecimals: 1.5, netBase: "0" }] }],
  ["noncanonical asset amount", { otherAssets: [{ network: "base-mainnet", assetAddress: "asset", assetDecimals: 6, netBase: "-1" }] }],
] as const) {
  test(`received totals reject ${label}`, () => {
    expect(isReceivedTotals({
      ...received, contributors: [{ ...received.contributors[0], ...change }],
    })).toBe(false);
  });
}

test("received totals reject invalid generation dates and contributor counts", () => {
  expect(isReceivedTotals({ ...received, generatedAt: "not-a-date" })).toBe(false);
  expect(isReceivedTotals({ ...received, totals: { ...received.totals, contributors: 2 } })).toBe(false);
});

for (const value of [
  { label: "uppercase hex prefix", network: "base-mainnet", address: "0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913", decimals: 6, testnets: false },
  { label: "wrong reference decimals", network: "base-mainnet", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 18, testnets: false },
  { label: "negative decimals", network: "base-mainnet", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: -1, testnets: false },
  { label: "native asset", network: "base-mainnet", address: "0x0000000000000000000000000000000000000000", decimals: 6, testnets: false },
  { label: "different Solana address case", network: "solana-mainnet", address: "epjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, testnets: false },
  { label: "network without reference assets", network: "solana-testnet", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, testnets: true },
  { label: "unknown network", network: "unknown-mainnet", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6, testnets: true },
  { label: "inherited constructor name", network: "constructor", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6, testnets: true },
  { label: "inherited prototype name", network: "__proto__", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6, testnets: true },
  { label: "inherited object method", network: "toString", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6, testnets: true },
]) {
  test(`USD reference classification excludes ${value.label}`, () => {
    expect(isUsdMicroAsset(value.network, value.address, value.decimals, value.testnets)).toBe(false);
  });
}

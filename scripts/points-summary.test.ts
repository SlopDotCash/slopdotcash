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
    },
  ],
  totals: {
    usdMicro: "1763990000",
    directTransfers: 3,
    vaultPayments: 0,
    contributors: 1,
  },
};

test("received totals reject a total that does not add up", () => {
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

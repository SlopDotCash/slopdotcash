import { expect, test } from "bun:test";
import { readDeploymentMonthPledges } from "../../workers/payments/index";
import {
  chainPeriod,
  pledgeReadPeriods,
  sitePeriod,
  storedMonthPledges,
} from "./month-pledges";

test("a refresh reads the previous month and the next eleven", () => {
  const periods = pledgeReadPeriods(new Date("2026-12-02T10:00:00Z"));
  expect(periods[0]).toBe("2026-11");
  expect(periods[1]).toBe("2026-12");
  expect(periods.at(-1)).toBe("2027-11");
  expect(periods.map(chainPeriod)[2]).toBe(202701);
  expect(sitePeriod(202701)).toBe("2027-01");
  expect(() => sitePeriod(202613)).toThrow("Invalid pledge period");
});

test("chain pledges are stored as canonical text, sorted, without duplicates", () => {
  expect(
    storedMonthPledges({
      openPledgedGross: 5n,
      pledges: [
        { period: 202701, amount: 2n, open: true },
        { period: 202612, amount: 3n, open: true },
      ],
    }),
  ).toEqual({
    openPledgedGross: "5",
    pledges: [
      { period: "2026-12", amount: "3", open: true },
      { period: "2027-01", amount: "2", open: true },
    ],
  });
  expect(() =>
    storedMonthPledges({
      openPledgedGross: 0n,
      pledges: [
        { period: 202612, amount: 1n, open: true },
        { period: 202612, amount: 1n, open: true },
      ],
    }),
  ).toThrow("Duplicate pledge period");
});

const totals = { blockNumber: "300", blockTime: "2026-12-02T10:00:00.000Z" };

test("without a pledge reader every vault reads as one without pledge support", async () => {
  expect(
    await readDeploymentMonthPledges(
      { chain: "base", network: "base-mainnet", vault: "0xabc" },
      "https://rpc.invalid",
      totals,
      { evm: undefined, solana: undefined },
    ),
  ).toBeNull();
});

test("the EVM reader is asked at the totals' block for thirteen months", async () => {
  const calls: unknown[] = [];
  const read = await readDeploymentMonthPledges(
    { chain: "base", network: "base-mainnet", vault: "0xabc" },
    "https://rpc.invalid",
    totals,
    {
      evm: async (input) => {
        calls.push(input);
        return {
          openPledgedGross: 7n,
          pledges: [{ period: 202612, amount: 7n, open: true }],
        };
      },
      solana: undefined,
    },
  );
  expect(calls).toEqual([
    {
      rpcUrl: "https://rpc.invalid",
      vault: "0xabc",
      periods: pledgeReadPeriods(new Date(totals.blockTime)).map(chainPeriod),
      blockTag: "0x12c",
    },
  ]);
  expect(read).toEqual({
    openPledgedGross: "7",
    pledges: [{ period: "2026-12", amount: "7", open: true }],
  });
});

test("the Solana reader gets the project account; a vault before the upgrade reads null", async () => {
  const calls: unknown[] = [];
  const read = await readDeploymentMonthPledges(
    {
      chain: "solana",
      network: "solana-mainnet",
      vault: "Vault111",
      programId: "Program111",
      projectPda: "Project111",
    },
    "https://rpc.invalid",
    totals,
    {
      evm: undefined,
      solana: async (input) => {
        calls.push(input);
        return null;
      },
    },
  );
  expect(read).toBeNull();
  expect(calls).toMatchObject([
    {
      network: "solana-mainnet",
      programId: "Program111",
      projectPda: "Project111",
    },
  ]);
});

import { expect, test } from "bun:test";
import { handlePoolFundingApi } from "./pool-funding";

const ROWS = [
  {
    project_id: "demo",
    network: "base-mainnet",
    vault: "0xabc",
    free_balance: "250000000",
    total_gross_withdrawn: "0",
    block_time: "2026-11-15T11:00:00.000Z",
    observed_at: "2026-11-15T11:05:00.000Z",
    open_pledged_gross: null,
  },
  {
    project_id: "demo",
    network: "base-sepolia",
    vault: "0xdef",
    free_balance: "5",
    total_gross_withdrawn: "0",
    block_time: "2026-11-15T11:00:00.000Z",
    observed_at: "2026-11-15T11:05:00.000Z",
    open_pledged_gross: null,
  },
  {
    project_id: "locked",
    network: "base-mainnet",
    vault: "0xfed",
    free_balance: "900000000",
    total_gross_withdrawn: "0",
    block_time: "2026-11-15T11:00:00.000Z",
    observed_at: "2026-11-15T11:05:00.000Z",
    open_pledged_gross: "500000000",
  },
];

const PLEDGES = [
  {
    project_id: "locked",
    network: "base-mainnet",
    vault: "0xfed",
    period: "2026-11",
    amount: "250000000",
    open: 1,
  },
  {
    project_id: "locked",
    network: "base-mainnet",
    vault: "0xfed",
    period: "2026-12",
    amount: "250000000",
    open: 1,
  },
];

const STARTS = [
  {
    project_id: "demo",
    network: "base-mainnet",
    vault: "0xabc",
    period: "2026-11",
    free_balance: "250000000",
    total_gross_withdrawn: "0",
    block_time: "2026-11-01T00:04:00.000Z",
  },
];
let bound: unknown[] = [];
let pledgeBound: unknown[] = [];

const db = {
  prepare: (sql: string) => ({
    bind(...values: unknown[]) {
      if (sql.includes("vault_month_pledges")) pledgeBound = values;
      else bound = values;
      return this;
    },
    async all() {
      return {
        results: sql.includes("vault_month_starts")
          ? STARTS
          : sql.includes("vault_month_pledges")
            ? PLEDGES
            : ROWS,
      };
    },
  }),
} as never;

async function read(tier: string) {
  const response = await handlePoolFundingApi(
    new Request("https://slop.cash/api/v1/pool-funding"),
    { db, tier, now: () => new Date("2026-11-15T12:00:00Z") },
  );
  expect(response?.status).toBe(200);
  expect(response?.headers.get("cache-control")).toContain("max-age=60");
  return (await response?.json()) as {
    schema: string;
    projects: Array<{
      projectId: string;
      vaults: Array<Record<string, unknown>>;
    }>;
  };
}

test("production serves mainnet vault balances only", async () => {
  const body = await read("production");
  expect(body.schema).toBe("slop-pool-funding-v1");
  expect(body.projects).toEqual([
    {
      projectId: "demo",
      vaults: [
        {
          network: "base-mainnet",
          vault: "0xabc",
          freeBalance: "250000000",
          totalGrossWithdrawn: "0",
          blockTime: "2026-11-15T11:00:00.000Z",
          observedAt: "2026-11-15T11:05:00.000Z",
          monthStarts: [
            {
              period: "2026-11",
              freeBalance: "250000000",
              totalGrossWithdrawn: "0",
              blockTime: "2026-11-01T00:04:00.000Z",
            },
          ],
          openPledgedGross: null,
          pledges: [],
        },
      ],
    },
    {
      projectId: "locked",
      vaults: [
        {
          network: "base-mainnet",
          vault: "0xfed",
          freeBalance: "900000000",
          totalGrossWithdrawn: "0",
          blockTime: "2026-11-15T11:00:00.000Z",
          observedAt: "2026-11-15T11:05:00.000Z",
          monthStarts: [],
          openPledgedGross: "500000000",
          pledges: [
            { period: "2026-11", amount: "250000000", open: true },
            { period: "2026-12", amount: "250000000", open: true },
          ],
        },
      ],
    },
  ]);
  // This month and the one before.
  expect(bound).toEqual(["2026-10", "2026-11"]);
  // Pledges from the month before on.
  expect(pledgeBound).toEqual(["2026-10"]);
});

test("staging keeps testnet vaults", async () => {
  const body = await read("staging");
  expect(body.projects[0].vaults.map((v) => v.network)).toEqual([
    "base-mainnet",
    "base-sepolia",
  ]);
});

test("other paths and writes are not handled here", async () => {
  expect(
    await handlePoolFundingApi(new Request("https://slop.cash/api/v1/x"), {
      db,
      tier: "production",
    }),
  ).toBeNull();
  const post = await handlePoolFundingApi(
    new Request("https://slop.cash/api/v1/pool-funding", { method: "POST" }),
    { db, tier: "production" },
  );
  expect(post?.status).toBe(405);
});

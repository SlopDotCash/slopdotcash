/** Regression: the authenticated /me account view must apply the same
 * deployment-tier filter as /totals, /vault, /received and /vault-payments.
 * Production must exclude testnet payments, monthly awards, balances and
 * direct transfers; staging keeps them because it pays in testnet
 * stablecoins. See the first-round audit, finding A2. */

import { expect, test } from "bun:test";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { deploymentOrigins } from "../../src/lib/deployment";
import type { PaymentsAccount } from "../../src/lib/payments/contracts";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { D1TransactionalDatabase } from "../d1";
import { handlePaymentsApi } from "./handler";

const when = "2026-12-05T12:00:00.000Z";
const actor = "123";
const token = "c".repeat(43);
const mainnetAsset = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const testnetAsset = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const vault = `0x${"3".repeat(40)}`;

function fixture() {
  const { db, sqlite } = sqliteD1();
  const database = db as unknown as D1TransactionalDatabase;
  return { db: database, sqlite };
}

async function seed(f: ReturnType<typeof fixture>) {
  const { sqlite } = f;
  sqlite
    .prepare(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('node-first',?,'first',?,0)",
    )
    .run(actor, when);
  sqlite
    .prepare("INSERT INTO points_sessions VALUES(?,?,?)")
    .run(await sha256Hex(token), "node-first", "2027-01-01T00:00:00.000Z");
  // One reserved mainnet obligation and one reserved testnet obligation.
  // The settlement lock allows one (network, chain, vault) per project, so
  // the two obligations live under different projects.
  for (const [n, projectId, network, assetAddress, gross, fee] of [
    [1, "project", "base-mainnet", mainnetAsset, "10000", "200"],
    [2, "project-test", "base-sepolia", testnetAsset, "50000", "1000"],
  ] as const) {
    const digest = n.toString(16).padStart(64, "0");
    sqlite
      .prepare(
        "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at,paid_transaction) VALUES(?,?,?,?,'base',?,?,6,?,?,?,'reserved',?,NULL)",
      )
      .run(
        `obligation-${n}`,
        projectId,
        actor,
        network,
        vault,
        assetAddress,
        gross,
        fee,
        digest,
        when,
      );
  }
  // One monthly award per network, in separate project-months (a run serves
  // a single network). Both are underfunded, so neither has an obligation.
  for (const [n, projectId, network, assetAddress] of [
    [3, "project", "base-mainnet", mainnetAsset],
    [4, "project-test", "base-sepolia", testnetAsset],
  ] as const) {
    const digest = n.toString(16).padStart(64, "0");
    const manifest = JSON.stringify({
      rewardAsset: { address: assetAddress, decimals: 6 },
    });
    sqlite
      .prepare(
        "INSERT INTO monthly_reward_bases VALUES(?, '2026-11', ?, ?, ?, '10000', 1, ?)",
      )
      .run(projectId, manifest, "a".repeat(64), "b".repeat(64), when);
    const snapshot = JSON.stringify({
      asset: assetAddress,
      awards: [
        {
          githubUserId: actor,
          grossBase: "600",
          feeBase: "12",
          netBase: "588",
          sourceDigest: digest,
        },
      ],
    });
    sqlite
      .prepare(
        "INSERT INTO monthly_payment_runs VALUES(?, '2026-11', 'automatic', NULL, 0, ?, ?, ?, ?, '600', ?, NULL)",
      )
      .run(projectId, snapshot, "c".repeat(64), network, vault, when);
  }
  // One direct transfer per network.
  for (const [network, transaction, amount] of [
    ["base-mainnet", "t-main", "1000000"],
    ["base-sepolia", "t-test", "5000000"],
  ] as const) {
    sqlite
      .prepare(
        "INSERT INTO payment_direct_transfers VALUES(?,?,?, '2026-11', ?, 'node-123', 'first', 'base', ?, ?, ?, 'block-1', 'disclosures/x.json', ?)",
      )
      .run(
        network,
        transaction,
        "project",
        actor,
        `0x${"4".repeat(40)}`,
        amount,
        when,
        when,
      );
  }
}

async function readMe(
  f: ReturnType<typeof fixture>,
  tier?: "staging" | "production",
) {
  const response = await handlePaymentsApi(
    new Request(`${deploymentOrigins(tier).site}/api/v1/payments/me`, {
      headers: { cookie: `__Host-slop_points=${token}` },
    }),
    { db: f.db, tier, now: () => new Date(when) },
  );
  return {
    status: response.status,
    body: (await response.json()) as PaymentsAccount,
  };
}

test("production /me excludes testnet payments, awards, balances and direct transfers", async () => {
  const f = fixture();
  try {
    await seed(f);
    const result = await readMe(f);
    expect(result.status).toBe(200);
    expect(result.body.payments.map((p) => p.network)).toEqual([
      "base-mainnet",
    ]);
    expect(result.body.monthlyAwards.map((a) => a.network)).toEqual([
      "base-mainnet",
    ]);
    expect(result.body.balances).toEqual([
      {
        chain: "base",
        network: "base-mainnet",
        assetAddress: mainnetAsset,
        assetDecimals: 6,
        netBase: "9800",
      },
    ]);
    expect(result.body.directTransfers.map((t) => t.transactionId)).toEqual([
      "t-main",
    ]);
  } finally {
    f.sqlite.close();
  }
});

test("staging /me retains testnet payments, awards, balances and direct transfers", async () => {
  const f = fixture();
  try {
    await seed(f);
    const result = await readMe(f, "staging");
    expect(result.status).toBe(200);
    expect(result.body.payments.map((p) => p.network).sort()).toEqual([
      "base-mainnet",
      "base-sepolia",
    ]);
    expect(result.body.monthlyAwards.map((a) => a.network).sort()).toEqual([
      "base-mainnet",
      "base-sepolia",
    ]);
    expect(result.body.balances.map((b) => b.network).sort()).toEqual([
      "base-mainnet",
      "base-sepolia",
    ]);
    expect(
      result.body.directTransfers.map((t) => t.transactionId).sort(),
    ).toEqual(["t-main", "t-test"]);
  } finally {
    f.sqlite.close();
  }
});

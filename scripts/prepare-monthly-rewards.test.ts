import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fixtureProject } from "../tests/fixture-overlay.mjs";
import { sqliteD1 } from "../tests/sqlite-d1";
import { buildMonthlyBase, monthlyBasesSql } from "./prepare-monthly-rewards";

const snapshotBytes = readFileSync(
  "tests/fixtures/history/cycles/eliza/2026-09/source-snapshot.json",
);
function fundedProject(projectId = "eliza", effectiveCycle = "2026-09") {
  const project = fixtureProject(projectId);
  project.reward.feeBasisPoints = 200;
  project.escrow = {
    schemaVersion: "1",
    effectiveCycle,
    chain: "solana",
    feeBasisPoints: 200,
    withdrawalFeeBasisPoints: 200,
    feeMode: "deduct-from-gross",
    deployments: [],
  };
  return project;
}

test("a month's proposal is stored once; a later ledger never adds or replaces rows", async () => {
  const { db, sqlite } = sqliteD1(
    readdirSync("migrations")
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  try {
    const project = fundedProject();
    const policyBytes = Buffer.from(JSON.stringify(project));
    const base = buildMonthlyBase(
      {
        projectId: "eliza",
        period: "2026-09",
        generatedAt: "2026-10-01T00:00:00.000Z",
      },
      snapshotBytes,
      policyBytes,
      project,
    );
    const result = {
      period: "2026-09",
      skipped: [],
      bases: [{ ...base, manifest: policyBytes.toString() }],
    };
    const sql = monthlyBasesSql(result, "2026-10-01T00:11:00.000Z");
    sqlite.exec(sql);
    sqlite.exec(sql);
    const later = {
      ...result,
      bases: [
        {
          ...result.bases[0],
          sourceSnapshotSha256: "f".repeat(64),
          rows: [
            ...base.rows.map((row) => ({ ...row, grossBase: "1" })),
            {
              githubUserId: "999999999",
              login: "late-actor",
              grossBase: "5",
              sourceDigest: "e".repeat(64),
            },
          ],
        },
      ],
    };
    sqlite.exec(monthlyBasesSql(later, "2026-10-02T00:11:00.000Z"));
    const stored = await db
      .prepare(
        "SELECT b.source_snapshot_sha256 digest,b.recipient_count count,(SELECT COUNT(*) FROM monthly_reward_base_rows) rows,(SELECT SUM(CAST(gross_base AS INTEGER)) FROM monthly_reward_base_rows) total FROM monthly_reward_bases b",
      )
      .first<{ digest: string; count: number; rows: number; total: number }>();
    expect(stored).toEqual({
      digest: base.sourceSnapshotSha256,
      count: 41,
      rows: 41,
      total: Number(base.capBase),
    });
    expect(() => sqlite.exec("DELETE FROM monthly_reward_base_rows")).toThrow(
      "monthly base permanent",
    );
    expect(monthlyBasesSql({ ...result, bases: [] }, "x")).toBe("");
  } finally {
    sqlite.close();
  }
});

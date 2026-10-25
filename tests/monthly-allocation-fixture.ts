/** Shared migrated monthly workflow fixture; chain evidence is supplied by each integration. */
import { readdirSync, readFileSync } from "node:fs";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import { monthlyBasesSql } from "../scripts/prepare-monthly-rewards";
import { escrowAwardOrigin } from "../src/lib/payments/escrow-cycle";
import { sha256Hex } from "../workers/identity/crypto";
import { sqliteD1 } from "./sqlite-d1";

export async function createMonthlyAllocationFixture({
  deployment: selected,
  unit = 1n,
  applyAmountRange = true,
  period = "2026-11",
  capBase = (1000n * unit).toString(),
  rows,
}: {
  deployment: Record<string, string | null>;
  unit?: bigint;
  applyAmountRange?: boolean;
  period?: string;
  capBase?: string;
  rows?: readonly { githubUserId: string; grossBase: string }[];
}) {
  const { db, sqlite } = sqliteD1(
    readdirSync("migrations")
      .filter((name) => name.endsWith(".sql"))
      .filter(
        (name) =>
          applyAmountRange || name !== "0081_monthly_asset_amount_range.sql",
      )
      .sort(),
  );
  const manifest = JSON.parse(
    readFileSync("tests/fixtures/projects/eliza.json", "utf8"),
  );
  manifest.reward.feeBasisPoints = 200;
  const chain = selected.network?.startsWith("solana") ? "solana" : "base";
  manifest.reward.chain = chain;
  if (unit > 1n) {
    manifest.reward.currency = "TOKEN";
    manifest.reward.monthlyCapMinor = capBase;
    manifest.reward.monthlyCapDisplay = "1,000 TOKEN";
    manifest.rewardAsset = {
      network: chain,
      kind: "token",
      address: selected.asset,
      symbol: "TOKEN",
      decimals: 18,
      chainId: chain === "solana" ? null : "8453",
      cluster: chain === "solana" ? "mainnet-beta" : null,
      verifiedAt: "2026-10-01T00:00:00.000Z",
    };
  }
  manifest.escrow = {
    schemaVersion: "1",
    effectiveCycle: period,
    chain,
    feeBasisPoints: 200,
    withdrawalFeeBasisPoints: 200,
    feeMode: "deduct-from-gross",
    deployments: [selected],
  };
  const text = JSON.stringify(manifest);
  const digest = await sha256Hex(text);
  sqlite
    .prepare(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,?,?)",
    )
    .run(manifest.id, text, digest, "Fixture", "2026-10-01T00:00:00.000Z");
  sqlite
    .prepare(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,?,1,?,?,?,?)",
    )
    .run(
      manifest.id,
      manifest.status,
      text,
      digest,
      "2026-10-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
    );
  const stored = await new CloudflareProjectPersistence(db).getProject(
    manifest.id,
  );
  if (!stored) throw new Error("fixture project missing");
  const project = stored;
  sqlite.exec(
    monthlyBasesSql(
      {
        period: period,
        skipped: [],
        bases: [
          {
            projectId: project.id,
            period: period,
            manifest: text,
            manifestSha256: digest,
            sourceSnapshotSha256: "5".repeat(64),
            capBase: capBase,
            rows: (
              rows ?? [
                { githubUserId: "101", grossBase: (600n * unit).toString() },
                { githubUserId: "202", grossBase: (400n * unit).toString() },
              ]
            ).map((row, index) => ({
              ...row,
              login: index === 0 ? "first" : "second",
              sourceDigest: escrowAwardOrigin(
                project.id,
                period,
                row.githubUserId,
              ),
            })),
          },
        ],
      },
      "2026-12-01T00:11:00.000Z",
    ),
  );
  return {
    db,
    sqlite,
    project,
    getProject: (id: string) =>
      new CloudflareProjectPersistence(db).getProject(id),
    restricted: async () => false,
  };
}

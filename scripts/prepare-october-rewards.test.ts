import type { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { monthlyOwnerService } from "../backend/payments/monthly";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import { escrowAwardOrigin } from "../src/lib/payments/escrow-cycle";
import { sha256Hex } from "../src/lib/sha256";
import { octoberRunnerFixture } from "../tests/october-runner-fixture";
import { sqliteD1 } from "../tests/sqlite-d1";
import { monthlyBasesSql } from "./prepare-monthly-rewards";
import { prepareGuardedOctoberImport } from "./prepare-october-rewards";

const terms = readFileSync(
  new URL("../tests/fixtures/october-approved-terms.txt", import.meta.url),
);
const fixtureNow = new Date("2026-11-15T01:00:02.000Z");
const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
const fixtures = octoberRunnerFixture;

const CREATED = "2026-11-15T01:00:03.000Z";

function compile(fixture = fixtures()) {
  const reviewedPacket = encode(fixture.packet);
  return prepareGuardedOctoberImport({
    approvedTerms: terms,
    reviewedPacket,
    reviewedPacketSha256: sha256Hex(reviewedPacket),
    currentRegistry: encode(fixture.registry),
    now: fixtureNow,
  });
}

function oneProject() {
  const input = fixtures();
  input.packet.projects = input.packet.projects.slice(0, 1);
  input.registry.projects = input.registry.projects.slice(0, 1);
  return input;
}

type ReviewedPlan = ReturnType<typeof compile>;

function localStore(plan: ReviewedPlan) {
  return seededStore(plan).sqlite;
}

function seededStore(plan: ReviewedPlan) {
  const store = sqliteD1();
  const { sqlite } = store;
  for (const { monthlyBase: base, manifest, revision } of plan.reviews
    .projects) {
    sqlite
      .query(`INSERT INTO project_revisions
      (project_id,revision,manifest,manifest_sha256,reason,created_at)
      VALUES(?,?,?,?,?,?)`)
      .run(
        base.projectId,
        revision,
        manifest,
        base.manifestSha256,
        "synthetic October fixture",
        CREATED,
      );
    sqlite
      .query(`INSERT INTO projects
      (id,status,revision,manifest,manifest_sha256,created_at,updated_at)
      VALUES(?,'active',?,?,?,?,?)`)
      .run(
        base.projectId,
        revision,
        manifest,
        base.manifestSha256,
        CREATED,
        CREATED,
      );
  }
  sqlite
    .query(
      "INSERT INTO points_batches(digest,generated_at,coverage,revision_count) VALUES(?,?,'[]',0)",
    )
    .run(String(plan.reviews.evidence.pointsBatch), CREATED);
  return store;
}

function applyLocal(sqlite: Database, plan: ReviewedPlan) {
  sqlite
    .transaction(() => {
      // Execute one statement at a time inside the same transaction, as the
      // published D1 import does. Keep the exact emitted guard and writer SQL.
      for (const sql of plan.sql.trimEnd().split("\n")) sqlite.query(sql).run();
    })
    .immediate();
}

function retained(sqlite: Database, projectId: string, period = "2026-10") {
  return {
    header: sqlite
      .query(
        "SELECT * FROM monthly_reward_bases WHERE project_id=? AND period=?",
      )
      .get(projectId, period),
    rows: sqlite
      .query(
        "SELECT * FROM monthly_reward_base_rows WHERE project_id=? AND period=? ORDER BY github_user_id",
      )
      .all(projectId, period),
  };
}

function wrongBase(
  plan: ReviewedPlan,
  update: Partial<ReviewedPlan["reviews"]["projects"][number]["monthlyBase"]>,
) {
  const { monthlyBase, manifest } = plan.reviews.projects[0];
  const base = { ...monthlyBase, ...update, manifest };
  return monthlyBasesSql(
    { period: base.period, bases: [base], skipped: [] },
    CREATED,
  );
}

test("all five approved gross pools and settlement networks are reproduced from exact terms", () => {
  const plan = compile();
  expect(
    plan.reviews.projects.map(({ id, grossBase, network, decimals }) => [
      id,
      grossBase,
      network,
      decimals,
    ]),
  ).toEqual([
    ["eliza", "1000000000", "solana-mainnet", 6],
    ["slopdotcash", "1000000000", "base-mainnet", 6],
    ["asi", "250000000", "robinhood-mainnet", 6],
    ["feed", "500000000", "solana-mainnet", 6],
    ["thenetwork", "500000000", "robinhood-mainnet", 6],
  ]);
});

test("the guarded one-time import stores exact approved base units and exact replay writes nothing", () => {
  const plan = compile(oneProject());
  const sqlite = localStore(plan);
  try {
    const { monthlyBase: base } = plan.reviews.projects[0];
    sqlite.exec(
      wrongBase(plan, {
        period: "2026-11",
        rows: base.rows.map((row) => ({
          ...row,
          sourceDigest: escrowAwardOrigin(
            base.projectId,
            "2026-11",
            row.githubUserId,
          ),
        })),
      }),
    );
    const later = retained(sqlite, base.projectId, "2026-11");
    applyLocal(sqlite, plan);
    const readback = retained(sqlite, base.projectId);
    expect(readback.header).toMatchObject({
      cap_base: "1000000000",
      recipient_count: 2,
    });
    expect(readback.rows).toMatchObject([
      {
        github_user_id: "7101",
        gross_base: "333333333",
        source_digest: escrowAwardOrigin(base.projectId, base.period, "7101"),
      },
      {
        github_user_id: "7102",
        gross_base: "666666667",
        source_digest: escrowAwardOrigin(base.projectId, base.period, "7102"),
      },
    ]);
    // A newer source checkpoint prevents creating another base, and still
    // allows exact replay of the immutable October base.
    sqlite
      .query(
        "INSERT INTO points_batches(digest,generated_at,coverage,revision_count) VALUES(?,?,'[]',0)",
      )
      .run("f".repeat(64), "2026-11-15T01:00:04.000Z");
    const before = sqlite.query("SELECT total_changes() AS changes").get();
    applyLocal(sqlite, plan);
    expect(sqlite.query("SELECT total_changes() AS changes").get()).toEqual(
      before,
    );
    expect(retained(sqlite, base.projectId)).toEqual(readback);
    expect(retained(sqlite, base.projectId, "2026-11")).toEqual(later);
  } finally {
    sqlite.close();
  }
});

test("guards reject conflicting cap, source, recipient, and missing-row variants before the canonical writer", () => {
  const plan = compile(oneProject());
  const { monthlyBase: base } = plan.reviews.projects[0];
  const wrongRows = [
    { ...base.rows[0], grossBase: "333333334" },
    ...base.rows.slice(1),
  ];
  const corruptions = [
    wrongBase(plan, { capBase: "999999999" }),
    wrongBase(plan, { sourceSnapshotSha256: "a".repeat(64) }),
    wrongBase(plan, { rows: wrongRows }),
    wrongBase(plan, {}).split("\n").slice(0, 2).join("\n"),
  ];
  for (const sql of corruptions) {
    const sqlite = localStore(plan);
    try {
      sqlite.exec(sql);
      const before = retained(sqlite, base.projectId);
      expect(() => applyLocal(sqlite, plan)).toThrow(
        /NOT NULL constraint failed/u,
      );
      expect(retained(sqlite, base.projectId)).toEqual(before);
    } finally {
      sqlite.close();
    }
  }
});

test("guarded import refuses stale registry, Points or enforcement state", () => {
  const plan = compile(oneProject());
  const { monthlyBase: base } = plan.reviews.projects[0];
  for (const mutation of [
    (sqlite: Database) => {
      sqlite
        .query(`INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at)
        SELECT id,revision+1,manifest,manifest_sha256,'synthetic new revision',? FROM projects WHERE id=?`)
        .run(CREATED, base.projectId);
      sqlite
        .query("UPDATE projects SET revision=revision+1 WHERE id=?")
        .run(base.projectId);
    },
    (sqlite: Database) =>
      sqlite
        .query(
          "INSERT INTO points_batches(digest,generated_at,coverage,revision_count) VALUES(?,?,'[]',0)",
        )
        .run("f".repeat(64), "2026-11-15T01:00:04.000Z"),
  ]) {
    const sqlite = localStore(plan);
    try {
      mutation(sqlite);
      expect(() => applyLocal(sqlite, plan)).toThrow(
        /NOT NULL constraint failed/u,
      );
      expect(retained(sqlite, base.projectId)).toEqual({
        header: null,
        rows: [],
      });
    } finally {
      sqlite.close();
    }
  }
  const staleGeneration = oneProject();
  staleGeneration.packet.enforcementGeneration = 1;
  staleGeneration.registry.enforcementGeneration = 1;
  const stale = compile(staleGeneration);
  const empty = localStore(stale);
  try {
    expect(() => applyLocal(empty, stale)).toThrow(
      /NOT NULL constraint failed/u,
    );
    expect(retained(empty, base.projectId)).toEqual({ header: null, rows: [] });
  } finally {
    empty.close();
  }
});

test("protected payment records refuse the complete import", () => {
  const plan = compile(oneProject());
  const project = plan.reviews.projects[0];
  const sqlite = localStore(plan);
  try {
    sqlite
      .query(`INSERT INTO payment_obligations
      (id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at)
      VALUES('synthetic-held',?,'7101',?,'solana',?,?,6,'100','2',?,'reserved',?)`)
      .run(
        project.id,
        project.network,
        project.vault,
        project.assetAddress,
        project.monthlyBase.rows[0].sourceDigest,
        CREATED,
      );
    expect(() => applyLocal(sqlite, plan)).toThrow(
      /NOT NULL constraint failed/u,
    );
    expect(retained(sqlite, project.id)).toEqual({ header: null, rows: [] });
  } finally {
    sqlite.close();
  }
});

test("an incomplete second project rolls back all already inserted rows", () => {
  const input = fixtures();
  input.packet.projects = input.packet.projects.slice(0, 2);
  input.registry.projects = input.registry.projects.slice(0, 2);
  const plan = compile(input);
  const sqlite = localStore(plan);
  try {
    sqlite.exec(`CREATE TRIGGER synthetic_refuse_child BEFORE INSERT ON monthly_reward_base_rows
      WHEN NEW.project_id='slopdotcash' AND NEW.github_user_id='7102'
      BEGIN SELECT RAISE(IGNORE); END;`);
    expect(() => applyLocal(sqlite, plan)).toThrow(
      /NOT NULL constraint failed/u,
    );
    for (const { id } of plan.reviews.projects)
      expect(retained(sqlite, id)).toEqual({ header: null, rows: [] });
  } finally {
    sqlite.close();
  }
});

test("preserves historical review budget bytes and refuses invalid current committed terms", () => {
  const input = oneProject();
  const entry = input.registry.projects[0];
  const manifest = JSON.parse(entry.manifestText);
  const budget = {
    committedMinor: "0",
    effectiveAt: "2026-10-01T00:00:00.000Z",
    fundingState: "pledged",
    monthlyCapDisplay: "$1",
    monthlyCapMinor: "1000000",
    paymentMode: "disabled",
    unusedFunds: "rollover-without-cap-increase",
  };
  const update = (reviewBudget: typeof budget) => {
    entry.manifestText = JSON.stringify({
      ...manifest,
      reward: { ...manifest.reward, reviewBudget },
    });
    entry.manifestSha256 = sha256Hex(entry.manifestText);
    input.packet.projects[0].manifestSha256 = entry.manifestSha256;
  };
  update(budget);
  expect(compile(input).reviews.projects[0].manifest).toBe(entry.manifestText);
  update({ ...budget, fundingState: "committed", committedMinor: "1000000" });
  expect(() => compile(input)).toThrow("committed funding is unsupported");
});

test("packet rejects another month or quarter and an unverified enforcement binding", () => {
  const input = oneProject();
  input.packet.period = "2026-11";
  expect(() => compile(input)).toThrow("approved October");
  input.packet.period = "2026-Q4";
  expect(() => compile(input)).toThrow("approved October");
  input.packet.period = "2026-10";
  input.packet.reviewerGithubId = input.packet.producerGithubId;
  expect(() => compile(input)).not.toThrow();
  input.registry.enforcementGeneration = 1;
  expect(() => compile(input)).toThrow("generation changed after review");
});

test("native D1 batch aborts all October rows when a later postcondition fails", () => {
  const input = fixtures();
  input.packet.projects = input.packet.projects.slice(0, 2);
  input.registry.projects = input.registry.projects.slice(0, 2);
  const plan = compile(input);
  const result = execFileSync(
    "node",
    ["tests/october-guarded-d1.workflow.mjs"],
    {
      input: JSON.stringify({ ...plan, createdAt: CREATED }),
      encoding: "utf8",
      // The native worker applies the entire retained D1 migration history.
      timeout: 150_000,
    },
  );
  expect(result.trim()).toContain(
    "October D1 rollback and complete import passed",
  );
}, 180_000);

test("the owner can finalize a funded October proposal before the November schedule", async () => {
  const plan = compile(oneProject());
  const { db, sqlite } = seededStore(plan);
  const { id, network, vault, assetAddress, grossBase, awards } =
    plan.reviews.projects[0];
  const registry = new CloudflareProjectPersistence(db);
  const actor = { githubId: "7002", githubLogin: "fixture-owner" };
  const service = monthlyOwnerService({
    db,
    getProject: (projectId) => registry.getProject(projectId),
    networks: () => [network],
    restricted: async () => false,
    verifyAuthority: async () => true,
    schedule: () => ({
      firstPeriod: "2026-11",
      cutoffSecondsAfterPeriodEnd: 259_200,
    }),
    now: () => fixtureNow,
  });
  try {
    applyLocal(sqlite, plan);
    const state = await service.view(id, "2026-10", actor);
    expect(state.cutoffAt).toBeNull();
    expect(state.proposal?.capBase).toBe(grossBase);
    sqlite
      .query(`INSERT INTO vault_snapshots
      (project_id,network,chain,vault,asset_address,asset_decimals,total_deposited,
       total_paid,total_payout_fees,total_gross_withdrawn,total_withdrawal_fees,
       total_service_fees,free_balance,reserved,block_number,block_time,observed_at)
      VALUES (?,?,'solana',?,?,6,?,'0','0','0','0','0',?,'0','100',?,?)`)
      .run(
        id,
        network,
        vault,
        assetAddress,
        grossBase,
        grossBase,
        CREATED,
        CREATED,
      );
    const frozen = await service.finalize(id, "2026-10", actor, 0);
    expect(frozen.run).toMatchObject({
      trigger: "owner",
      funded: true,
      totalGrossBase: grossBase,
      awards: awards.map(({ githubUserId, grossBase, feeBase }) => ({
        githubUserId,
        grossBase,
        feeBase,
        state: "awaiting-reservation",
      })),
    });
    expect(() => applyLocal(sqlite, plan)).not.toThrow();
    expect(
      sqlite.query("SELECT period FROM monthly_payment_runs").all(),
    ).toEqual([{ period: "2026-10" }]);
  } finally {
    sqlite.close();
  }
});

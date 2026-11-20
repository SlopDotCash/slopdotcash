import { expect, test } from "bun:test";
import { monthlyOwnerService } from "../backend/payments/monthly";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import { ESCROW_NETWORKS } from "../src/lib/escrow-policy.mjs";
import {
  createLeaderboardSnapshot,
  type ScoreEvent,
} from "../src/lib/leaderboard";
import { ASI_NOVEMBER_CLOSEOUT as approved } from "../src/lib/payments/asi-november-closeout";
import { escrowAwardOrigin } from "../src/lib/payments/escrow-cycle";
import { PRD_MONTHLY_SCHEDULE } from "../src/lib/payments/monthly-allocation";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import { sha256Hex } from "../src/lib/sha256";
import { closedMonthLedger } from "../tests/closed-month-ledger";
import { fixtureProject } from "../tests/fixture-overlay.mjs";
import { octoberRunnerFixture } from "../tests/october-runner-fixture";
import { sqliteD1 } from "../tests/sqlite-d1";
import { prepareAsiNovemberCloseout } from "./prepare-asi-november-closeout";
import {
  asiCloseoutPreviewDigest,
  executeAsiCloseout,
} from "./run-asi-november-closeout";

const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
const collectedAt = "2026-11-19T00:01:00.000Z";
const from = "2026-10-15T00:01:00.000Z";
const now = new Date("2026-11-19T00:02:00.000Z");
const owner = { githubId: "7100", githubLogin: "fixture-owner" };

function fixture() {
  const project = fixtureProject("asi");
  const original = octoberRunnerFixture().registry.projects.find(
    ({ id }) => id === approved.projectId,
  );
  const vault = assertProjectDefinition(
    JSON.parse(original?.manifestText ?? ""),
  ).escrow?.deployments[0];
  const asset = ESCROW_NETWORKS[approved.network].asset;
  if (!vault || !asset) throw new Error("Missing ASI test vault");
  const manifest = JSON.stringify({
    ...project,
    reward: {
      ...project.reward,
      chain: approved.chain,
      currency: approved.assetSymbol,
      monthlyCapMinor: "250000000",
      monthlyCapDisplay: "$250",
      feeBasisPoints: 200,
    },
    rewardAsset: {
      network: approved.chain,
      kind: "stablecoin",
      address: asset,
      symbol: approved.assetSymbol,
      decimals: approved.assetDecimals,
      chainId: "4663",
      cluster: null,
      verifiedAt: "2026-10-01T00:00:00.000Z",
    },
    escrow: {
      schemaVersion: "1",
      effectiveCycle: approved.period,
      chain: approved.chain,
      feeBasisPoints: 200,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross",
      deployments: [vault],
    },
  });
  const { source } = JSON.parse(closedMonthLedger(collectedAt, from));
  const repository = project.repositories[0].id;
  const awards = [1, 2, 3].map((points): ScoreEvent => {
    const numericId = 7100 + points;
    const login = `fixture-recipient-${points}`;
    return {
      id: `award_fixture_${points}`,
      actor: {
        id: Buffer.from(`04:User${numericId}`).toString("base64"),
        kind: "User",
        login,
        url: `https://github.com/${login}`,
        avatarUrl: `https://avatars.githubusercontent.com/u/${numericId}?v=4`,
      },
      category: "evaluated-contribution",
      points,
      occurredAt: points === 3 ? approved.cutoff : "2026-11-18T23:59:59.999Z",
      repository,
      source: {
        id: `PR_fixture_${points}`,
        kind: "pull-request",
        number: points,
        title: "Synthetic fixture only",
        url: `https://github.com/${repository}/pull/${points}`,
      },
      reason: "Synthetic accepted work fixture meeting the approved cutoff.",
      evaluation: {
        reviewer: owner.githubLogin,
        reviewedAt: collectedAt,
        decisionUrl: `https://github.com/SlopDotCash/slopdotcash/pull/${points}`,
        manifestPath: `evaluations/asi/award-fixture-${points}.json`,
        manifestSha256: "1".repeat(64),
      },
    };
  });
  const snapshot = encode(
    createLeaderboardSnapshot({
      generatedAt: collectedAt,
      windowFrom: from,
      windowTo: collectedAt,
      sourceUpdatedAt: collectedAt,
      source,
      mergedPullRequestOutcomes: [],
      mergedPullRequests: [],
      detailEligibleMergedPullRequestIds: [],
      closedIssueCount: 0,
      resolvedIssues: [],
      openIssues: [],
      openPullRequests: [],
      verificationWindowFrom: from,
      verifiedEvidence: [],
      evaluatedContributions: awards,
    }),
  );
  const packet = {
    schemaVersion: "1",
    kind: "reviewed-asi-november-closeout",
    projectId: approved.projectId,
    period: approved.period,
    cutoff: approved.cutoff,
    grossBase: approved.grossBase,
    reviewedAt: now.toISOString(),
    producerGithubId: "7103",
    reviewerGithubId: owner.githubId,
    snapshotSha256: sha256Hex(snapshot),
    pointsBatch: "2".repeat(64),
    manifestSha256: sha256Hex(manifest),
    revision: 1,
    enforcementGeneration: 0,
  };
  const registry = {
    schemaVersion: "1",
    origin: "https://slop.cash",
    capturedAt: now.toISOString(),
    enforcementGeneration: 0,
    projects: [
      {
        id: approved.projectId,
        revision: 1,
        manifestSha256: packet.manifestSha256,
        manifestText: manifest,
        restriction: "clear",
      },
    ],
  };
  return { manifest, repository, packet, registry, snapshot, vault };
}

function compile(input = fixture()) {
  const reviewedPacket = encode(input.packet);
  return prepareAsiNovemberCloseout({
    reviewedPacket,
    reviewedPacketSha256: sha256Hex(reviewedPacket),
    currentRegistry: encode(input.registry),
    snapshot: input.snapshot,
    now,
  });
}

test("ASI owner finalizes the exact cutoff allocation early via the normal award pipeline", async () => {
  const input = fixture();
  const plan = compile(input);
  expect(plan.review.contributionWindow).toEqual({
    from: "2026-11-01T00:00:00.000Z",
    to: approved.cutoff,
  });
  const { db, sqlite } = sqliteD1();
  const { manifest, packet, repository, vault } = input;
  const at = now.toISOString();
  let clock = now;
  try {
    sqlite.run(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('asi',1,?,?,?,?)",
      [manifest, packet.manifestSha256, "ASI closeout fixture", at],
    );
    sqlite.run(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('asi','active',1,?,?,?,?)",
      [manifest, packet.manifestSha256, at, at],
    );
    sqlite.run(
      "INSERT INTO points_batches(digest,generated_at,coverage,revision_count) VALUES(?,?,'[]',0)",
      [packet.pointsBatch, at],
    );

    const persistence = new CloudflareProjectPersistence(db);
    const service = monthlyOwnerService({
      db,
      getProject: (id) => persistence.getProject(id),
      restricted: async () => false,
      networks: () => [approved.network],
      verifyAuthority: async () => true,
      schedule: () => PRD_MONTHLY_SCHEDULE,
      now: () => clock,
    });
    const finalize = () =>
      service.finalize(approved.projectId, approved.period, owner, 0);
    await expect(finalize()).rejects.toMatchObject({ code: "month_open" });

    const apply = () =>
      sqlite
        .transaction(() => {
          for (const statement of plan.sql.trimEnd().split("\n"))
            sqlite.query(statement).run();
        })
        .immediate();
    expect(apply).toThrow();
    expect(
      sqlite.query("SELECT COUNT(*) AS n FROM monthly_reward_bases").get(),
    ).toEqual({ n: 0 });
    sqlite
      .query(
        "INSERT INTO points_batches(digest,generated_at,coverage,revision_count) VALUES(?,?,?,0)",
      )
      .run(
        "3".repeat(64),
        at,
        JSON.stringify([
          {
            repository,
            from,
            to: collectedAt,
            digest: packet.snapshotSha256,
          },
        ]),
      );
    input.packet.pointsBatch = "3".repeat(64);
    const reviewed = compile(input);
    const query = async (sql: string) =>
      sqlite.query<Record<string, unknown>, []>(sql).all();
    let applyCount = 0;
    const importFile = async () => {
      applyCount += 1;
      sqlite
        .transaction(() => {
          for (const statement of reviewed.sql.trimEnd().split("\n"))
            sqlite.query(statement).run();
        })
        .immediate();
      throw new Error("Simulated lost import response");
    };
    const preview = asiCloseoutPreviewDigest(reviewed);
    expect(await executeAsiCloseout(reviewed, query, null, importFile)).toBe(
      "preview",
    );
    await expect(
      executeAsiCloseout(reviewed, query, "f".repeat(64), importFile),
    ).rejects.toThrow("differs from the approved preview");
    expect(applyCount).toBe(0);
    expect(await executeAsiCloseout(reviewed, query, preview, importFile)).toBe(
      "applied",
    );
    expect(await executeAsiCloseout(reviewed, query, preview, importFile)).toBe(
      "already-imported",
    );
    expect(applyCount).toBe(1);
    expect(
      sqlite.query("SELECT COUNT(*) AS n FROM monthly_reward_base_rows").get(),
    ).toEqual({ n: 2 });
    clock = new Date(Date.parse(approved.cutoff) - 1);
    await expect(finalize()).rejects.toMatchObject({ code: "month_open" });
    clock = now;
    await expect(
      service.changeAllocation(approved.projectId, approved.period, owner, {
        githubUserId: "7101",
        grossBase: "1",
        expectedSequence: 0,
      }),
    ).rejects.toMatchObject({ code: "closeout_allocations_fixed" });
    sqlite.run(
      `INSERT INTO vault_snapshots(project_id,network,chain,vault,asset_address,asset_decimals,
      total_deposited,total_paid,total_payout_fees,total_gross_withdrawn,total_withdrawal_fees,total_service_fees,
      free_balance,reserved_principal,reserved_fees,accrued_fees,reserved,block_number,block_time,observed_at)
      VALUES('asi',?,'robinhood',?,?,6,'250000000','0','0','0','0','0','250000000','0','0','0','0','1',?,?)`,
      [vault.network, vault.vault, vault.asset, at, at],
    );
    const frozen = await finalize();
    expect(frozen.proposal?.earlyCloseAt).toBe(approved.cutoff);
    expect(frozen.run).toMatchObject({
      trigger: "owner",
      frozenAt: at,
      totalGrossBase: "150000000",
    });
    expect(
      frozen.run?.awards.map(({ githubUserId, grossBase, feeBase }) => [
        githubUserId,
        grossBase,
        feeBase,
      ]),
    ).toEqual([
      ["7101", "50000000", "1000000"],
      ["7102", "100000000", "2000000"],
    ]);
    const snapshotSha256 = frozen.run?.snapshotSha256;
    if (!snapshotSha256) throw new Error("Expected a frozen owner snapshot");
    const commitment = await service.commitment(
      approved.projectId,
      approved.period,
      owner,
      {
        network: approved.network,
        manifestSha256: packet.manifestSha256,
        snapshotSha256,
        githubUserId: "7102",
      },
    );
    expect(commitment.award).toMatchObject({
      sourceDigest: escrowAwardOrigin(
        approved.projectId,
        approved.period,
        "7102",
      ),
      gross: "100000000",
      fee: "2000000",
      net: "98000000",
    });
    await finalize();
    expect(
      sqlite
        .query("SELECT COUNT(*) AS n FROM monthly_payment_obligations")
        .get(),
    ).toEqual({ n: 2 });
  } finally {
    sqlite.close();
  }
}, 30_000);

test("ASI compilation refuses a complete but stale canonical snapshot", () => {
  const input = fixture();
  input.snapshot = new TextEncoder().encode(
    closedMonthLedger("2026-11-18T00:00:00.000Z", "2026-10-14T00:00:00.000Z"),
  );
  input.packet.snapshotSha256 = sha256Hex(input.snapshot);
  expect(() => compile(input)).toThrow("complete verified coverage");
});

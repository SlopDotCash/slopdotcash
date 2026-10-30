/**
 * Explicit payout exclusions (PRD section 7) through the real monthly payment
 * path: the published snapshot, the private monthly proposal of the closed
 * month, and the owner's private allocation change on the real migrations.
 * An excluded owner keeps the public score, receives nothing, and the
 * excluded weight does not reduce the other contributor's share.
 */
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { readdirSync } from "node:fs";
import {
  MonthlyPaymentError,
  monthlyOwnerService,
} from "../backend/payments/monthly";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import { createProjectView } from "../src/lib/project-view";
import { findProject, type ProjectDefinition } from "../src/lib/projects.mjs";
import { sha256Hex } from "../src/lib/sha256";
import {
  AFTER_NOVEMBER,
  PENALIZED_AUTHOR,
  PROJECT_OWNER,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";
import { sqliteD1 } from "../tests/sqlite-d1";
import { buildMonthlyBase, monthlyBasesSql } from "./prepare-monthly-rewards";

afterEach(() => setSystemTime());

const ADMIN = "900000071";
// The ASI fixture on the reviewed Base vault policy (as in monthly.test.ts).
function vaultProject(exclusions?: unknown[]): ProjectDefinition {
  const asi = findProject("asi");
  if (!asi) throw new Error("fixture project missing");
  const { cycleCaps: _caps, ...reward } = asi.reward;
  return assertProjectDefinition({
    ...asi,
    reward: {
      ...reward,
      chain: "base",
      feeBasisPoints: 200,
      ...(exclusions ? { payoutExclusions: exclusions } : {}),
    },
    escrow: {
      schemaVersion: "1",
      effectiveCycle: "2026-11",
      chain: "base",
      feeBasisPoints: 200,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross",
      deployments: [
        {
          network: "base-sepolia",
          vault: "0x1000000000000000000000000000000000000001",
          programId: null,
          upgradeAuthority: null,
          projectPda: null,
          networkDomain: null,
          asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
          owner: "0x2000000000000000000000000000000000000002",
          identityAuthority: "0x3000000000000000000000000000000000000003",
          feeRecipient: "0x4000000000000000000000000000000000000004",
          deploymentTransaction: `0x${"ab".repeat(32)}`,
          sourceCommit: "0123456789abcdef0123456789abcdef01234567",
          codeSha256: "ab".repeat(32),
          bindingDelaySeconds: "60",
          rotationDelaySeconds: null,
          factory: "0x5000000000000000000000000000000000000005",
          factoryCodeSha256: "cd".repeat(32),
          registrar: "0x6000000000000000000000000000000000000006",
        },
      ],
    },
  });
}

const OWNER_EXCLUSION = {
  actorId: "43",
  nodeId: PROJECT_OWNER.id,
  login: PROJECT_OWNER.login,
  relationship: "owner",
  fromCycle: "2026-11",
  untilCycle: null,
};

test("an excluded owner keeps the score, receives nothing, and the other share is not reduced", async () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const snapshot = createLeaderboardSnapshot(
    penaltyScoreInput([], AFTER_NOVEMBER),
  );
  const snapshotBytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const proposal = (project: ProjectDefinition) => {
    const policyBytes = new TextEncoder().encode(JSON.stringify(project));
    const base = buildMonthlyBase(
      { projectId: "asi", period: "2026-11", generatedAt: AFTER_NOVEMBER },
      snapshotBytes,
      policyBytes,
      project,
    );
    return {
      base,
      text: new TextDecoder().decode(policyBytes),
      rows: Object.fromEntries(
        base.rows.map((row) => [row.login, row.grossBase]),
      ),
    };
  };

  // Without an exclusion both November contributors share the $1,000 pool.
  expect(proposal(vaultProject()).rows).toEqual({
    author: "500000000",
    "project-owner": "500000000",
  });
  const excludedProject = vaultProject([OWNER_EXCLUSION]);
  const excluded = proposal(excludedProject);
  expect(excluded.rows).toEqual({
    author: "1000000000",
    "project-owner": "0",
  });
  // The public score stays; only the payment weight leaves the pool.
  const owner = createProjectView(
    snapshot,
    "asi",
    "2026-11",
    undefined,
    excludedProject,
  ).leaders.find((leader) => leader.actor.id === PROJECT_OWNER.id);
  expect(owner).toMatchObject({
    scoreThirds: 1,
    adjustedWeight: 0,
    payoutExclusion: "owner",
  });
  // October is before the exclusion and keeps its weight.
  expect(
    createProjectView(
      snapshot,
      "asi",
      "2026-10",
      undefined,
      excludedProject,
    ).leaders.find((leader) => leader.actor.id === PENALIZED_AUTHOR.id)
      ?.payoutExclusion,
  ).toBeNull();

  // The owner cannot privately allocate money to the excluded person.
  const { db, sqlite } = sqliteD1(
    readdirSync("migrations")
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  try {
    const digest = await sha256Hex(excluded.text);
    sqlite
      .prepare(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('asi',1,?,?,'Fixture',?)",
      )
      .run(excluded.text, digest, "2026-10-01T00:00:00.000Z");
    sqlite
      .prepare(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('asi',?,1,?,?,?,?)",
      )
      .run(
        excludedProject.status,
        excluded.text,
        digest,
        "2026-10-01T00:00:00.000Z",
        "2026-10-01T00:00:00.000Z",
      );
    sqlite.exec(
      monthlyBasesSql(
        {
          period: "2026-11",
          skipped: [],
          bases: [{ ...excluded.base, manifest: excluded.text }],
        },
        AFTER_NOVEMBER,
      ),
    );
    const persistence = new CloudflareProjectPersistence(db);
    const service = monthlyOwnerService({
      db,
      getProject: (id) => persistence.getProject(id),
      restricted: async () => false,
      networks: () => ["base-sepolia"],
      verifyAuthority: async () => {},
      schedule: () => null,
      now: () => new Date(AFTER_NOVEMBER),
    });
    const actor = { githubId: ADMIN, githubLogin: "maintainer" };
    const refused = await service
      .changeAllocation("asi", "2026-11", actor, {
        githubUserId: "43",
        grossBase: "1",
        expectedSequence: 0,
      })
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(MonthlyPaymentError);
    expect(refused).toMatchObject({
      status: 400,
      code: "invalid_allocation",
    });
    // Other private changes keep working.
    const view = await service.changeAllocation("asi", "2026-11", actor, {
      githubUserId: "42",
      grossBase: "900000000",
      expectedSequence: 0,
    });
    expect(view.proposal?.allocations.map((row) => row.grossBase)).toEqual([
      "900000000",
      "0",
    ]);
  } finally {
    sqlite.close();
  }
});

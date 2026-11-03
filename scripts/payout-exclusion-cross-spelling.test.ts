/**
 * Regression: payoutExclusionFor must match exclusions by decoded GitHub user
 * id so legacy MDQ6… and current U_kgDO… spellings of the same actor both
 * zero the monthly share (PRD §7). Distinct from #2152 (validate overlap only).
 */
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { buildMonthlyBase } from "../scripts/prepare-monthly-rewards";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import {
  payoutExcludedGithubUserIds,
  payoutExclusionFor,
} from "../src/lib/payout-exclusions.mjs";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import { createProjectView } from "../src/lib/project-view";
import { findProject, type ProjectDefinition } from "../src/lib/projects.mjs";
import {
  AFTER_NOVEMBER,
  PROJECT_OWNER,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

afterEach(() => setSystemTime());

const LEGACY = "MDQ6VXNlcjQz"; // PROJECT_OWNER.id
const CURRENT = "U_kgDOAAAAKw"; // same actor 43

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

const CURRENT_EXCLUSION = {
  actorId: "43",
  nodeId: CURRENT,
  login: "project-owner",
  relationship: "owner",
  fromCycle: "2026-11",
  untilCycle: null,
};

test("payoutExclusionFor matches the same actor under either node ID spelling", () => {
  const project = vaultProject([CURRENT_EXCLUSION]);
  expect(payoutExclusionFor(project, "2026-11", CURRENT)).toBe("owner");
  expect(payoutExclusionFor(project, "2026-11", LEGACY)).toBe("owner");
  expect([...payoutExcludedGithubUserIds(project, "2026-11")]).toEqual(["43"]);
});

test("monthly proposal zeros an excluded owner across node ID spellings", () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const snapshot = createLeaderboardSnapshot(
    penaltyScoreInput([], AFTER_NOVEMBER),
  );
  const snapshotBytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const project = vaultProject([CURRENT_EXCLUSION]);
  const policyBytes = new TextEncoder().encode(JSON.stringify(project));
  const base = buildMonthlyBase(
    { projectId: "asi", period: "2026-11", generatedAt: AFTER_NOVEMBER },
    snapshotBytes,
    policyBytes,
    project,
  );
  const rows = Object.fromEntries(
    base.rows.map((row) => [row.login, row.grossBase]),
  );
  // Same-spelling control (legacy exclusion + legacy census) zeros the owner.
  const sameSpelling = vaultProject([
    {
      actorId: "43",
      nodeId: LEGACY,
      login: "project-owner",
      relationship: "owner",
      fromCycle: "2026-11",
      untilCycle: null,
    },
  ]);
  const sameBytes = new TextEncoder().encode(JSON.stringify(sameSpelling));
  const sameBase = buildMonthlyBase(
    { projectId: "asi", period: "2026-11", generatedAt: AFTER_NOVEMBER },
    snapshotBytes,
    sameBytes,
    sameSpelling,
  );
  const sameRows = Object.fromEntries(
    sameBase.rows.map((row) => [row.login, row.grossBase]),
  );
  expect(sameRows["project-owner"]).toBe("0");
  expect(sameRows.author).toBe("1000000000");

  // Cross-spelling: exclusion is current U_, census actor is legacy → still zero.
  expect(rows["project-owner"]).toBe("0");
  expect(rows.author).toBe("1000000000");

  const owner = createProjectView(
    snapshot,
    "asi",
    "2026-11",
    undefined,
    project,
  ).leaders.find((leader) => leader.actor.id === PROJECT_OWNER.id);
  expect(owner?.payoutExclusion).toBe("owner");
  expect(owner?.adjustedWeight ?? 1).toBe(0);
});

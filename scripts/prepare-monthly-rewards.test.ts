import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import { escrowAwardOrigin } from "../src/lib/payments/escrow-cycle";
import { createProjectView } from "../src/lib/project-view";
import { findProject } from "../src/lib/projects.mjs";
import {
  type ProjectRunReceipt,
  runReceiptMarker,
  runReceiptSigningPayload,
} from "../src/lib/run-receipts";
import {
  AFTER_NOVEMBER,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";
import { sqliteD1 } from "../tests/sqlite-d1";
import {
  buildMonthlyBase,
  hasMonthlyAllocation,
  monthlyBasesSql,
} from "./prepare-monthly-rewards";
import { deviceKeyId } from "./run-receipt-crypto";

afterEach(() => setSystemTime());

const snapshotBytes = readFileSync(
  "tests/fixtures/history/cycles/eliza/2026-09/source-snapshot.json",
);
function fundedProject(projectId = "eliza", effectiveCycle = "2026-09") {
  const project = JSON.parse(
    readFileSync(`tests/fixtures/projects/${projectId}.json`, "utf8"),
  );
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

/** A synthetic device signature goes through the real receipt/policy checks. */
function contributionWithTrace(corruptSignature: boolean): string {
  const project = findProject("asi");
  if (!project) throw new Error("ASI fixture is missing");
  const binding = project.terms.receiptPolicy.bindings.at(-1);
  if (!binding) throw new Error("ASI receipt policy is missing");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  const digest = createHash("sha256").update("synthetic trace").digest("hex");
  const receipt: ProjectRunReceipt = {
    schemaVersion: "2",
    runId: "run_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    projectId: "asi",
    repositoryId: "elizaOS/asi",
    startedAt: "2026-11-03T12:00:00.000Z",
    completedAt: "2026-11-03T12:01:00.000Z",
    provider: "OpenAI",
    model: "gpt-5",
    client: "codex",
    skillRevision: `SlopDotCash/slopdotcash@fbc4ef8bff3b5e134a35c7c30bf4e709a41c6350:${project.skill.sourcePath}`,
    skillSha256: "a".repeat(64),
    policyAcknowledgement: {
      policyRevision: binding.policyRevision,
      licenseSha256: binding.licenseSha256,
      inboundTermsSha256: binding.inboundTermsSha256,
      prizeRulesSha256: binding.prizeRulesSha256,
      acknowledgedAt: "2026-11-03T12:00:30.000Z",
    },
    usage: {
      source: "none",
      confidence: "unavailable",
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      costMicroUsd: "0",
      sessionCount: 0,
    },
    trajectorySha256: digest,
    traceUpload: {
      authority: "https://api.slop.cash",
      serverRunId: "run-synthetic-trace-V",
      objectId: `sha256:${digest}`,
      sha256: digest,
    },
    signatureAlgorithm: "ed25519",
    devicePublicKey: publicDer.toString("base64url"),
    deviceKeyId: deviceKeyId(publicDer),
    deviceSignature: "A".repeat(86),
  };
  receipt.deviceSignature = sign(
    null,
    Buffer.from(runReceiptSigningPayload(receipt)),
    privateKey,
  ).toString("base64url");
  if (corruptSignature)
    receipt.deviceSignature =
      (receipt.deviceSignature[0] === "A" ? "B" : "A") +
      receipt.deviceSignature.slice(1);
  return `Fixes a defect.

AI provider/model: OpenAI / gpt-5
Client / agent tooling: codex
Contribution skill revision: ${receipt.skillRevision}
Attribution status: self-reported
— [local-proof]
<!-- slop-contribution-attribution:v1 ${JSON.stringify(runReceiptMarker(receipt))} -->`;
}

for (const trace of ["absent", "valid", "invalid"] as const) {
  test(`November monthly shares use accepted Points when the trace is ${trace}`, () => {
    setSystemTime(new Date(AFTER_NOVEMBER));
    const input = penaltyScoreInput([], AFTER_NOVEMBER);
    if (trace !== "absent") {
      const body = contributionWithTrace(trace === "invalid");
      // Change source material, never inject a score, bonus or payout row.
      input.mergedPullRequestOutcomes = input.mergedPullRequestOutcomes.map(
        (pull) => (pull.id === "PR_november" ? { ...pull, body } : pull),
      );
      input.mergedPullRequests = input.mergedPullRequests.map((pull) =>
        pull.id === "PR_november" ? { ...pull, body } : pull,
      );
    }
    const snapshot = createLeaderboardSnapshot(input);
    const project = fundedProject("asi", "2026-11");
    const view = createProjectView(
      snapshot,
      "asi",
      "2026-11",
      undefined,
      project,
    );
    const base = buildMonthlyBase(
      { projectId: "asi", period: "2026-11", generatedAt: AFTER_NOVEMBER },
      Buffer.from(JSON.stringify(snapshot)),
      Buffer.from(JSON.stringify(project)),
      project,
    );
    expect(view.leaders.map((leader) => leader.scoreThirds)).toEqual([1, 1]);
    expect(view.leaders.map((leader) => leader.simulatedMinor)).toEqual([
      "490000000",
      "490000000",
    ]);
    expect(
      Object.fromEntries(base.rows.map((row) => [row.login, row.grossBase])),
    ).toEqual({ author: "500000000", "project-owner": "500000000" });
    expect(
      snapshot.attributions.filter((record) => record.run?.traceUpload),
    ).toHaveLength(trace === "valid" ? 1 : 0);
    if (trace === "valid")
      expect(
        snapshot.ledger.find((event) => event.source.id === "PR_november")
          ?.evidenceBonusBasisPoints,
      ).toBe(1500);
    if (trace === "invalid")
      expect(
        snapshot.invalidAttributionMarkers.some((marker) =>
          marker.reason.includes("signature is invalid"),
        ),
      ).toBe(true);
  });
}

test("a closed month's proposal pays the whole cap by largest remainder to numeric actors with fixed source digests", () => {
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
  expect(base.rows).toHaveLength(41);
  // Exact archived September allocations, including their trace weights,
  // remain unchanged when the November payment policy is repaired.
  expect(
    createHash("sha256").update(JSON.stringify(base.rows)).digest("hex"),
  ).toBe("e527b99e653850c6e0883f06c260e3274554ee72a724ea9a28441e2e88bad20c");
  expect(base.rows.reduce((sum, row) => sum + BigInt(row.grossBase), 0n)).toBe(
    BigInt(base.capBase),
  );
  for (const row of base.rows) {
    expect(row.githubUserId).toMatch(/^[1-9][0-9]*$/);
    // The digest names the project month and actor, never the amount, so a
    // changed allocation cannot be reserved a second time.
    expect(row.sourceDigest).toBe(
      escrowAwardOrigin("eliza", "2026-09", row.githubUserId),
    );
  }
  // An open month has no complete evidence to propose from.
  expect(() =>
    buildMonthlyBase(
      {
        projectId: "eliza",
        period: "2026-09",
        generatedAt: "2026-09-30T23:59:59.999Z",
      },
      snapshotBytes,
      policyBytes,
      project,
    ),
  ).toThrow();
});

test("unfunded, paused and not-yet-effective projects get no monthly proposal", () => {
  const project = fundedProject();
  expect(hasMonthlyAllocation(project, "2026-09")).toBe(true);
  expect(hasMonthlyAllocation(project, "2026-08")).toBe(false);
  expect(
    hasMonthlyAllocation({ ...project, status: "paused" }, "2026-09"),
  ).toBe(false);
  expect(
    hasMonthlyAllocation({ ...project, escrow: undefined }, "2026-09"),
  ).toBe(false);
});

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

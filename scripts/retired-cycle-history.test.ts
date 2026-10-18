import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function rebuildCycles(retired: boolean, ids = ["asi", "delta-star"]) {
  const script = `
    import assert from "node:assert/strict";
    import { readFile } from "node:fs/promises";
    import { RAW_PROJECT_DEFINITIONS } from "./src/lib/project-registry.generated.mjs";
    const ids = ${JSON.stringify(ids)};
    if (${retired}) {
      for (const id of ids) {
        const project = RAW_PROJECT_DEFINITIONS.find((project) => project.id === id);
        project.status = "paused";
        project.listingTier = "retired";
      }
    }
    const { findProject } = await import("./src/lib/projects.mjs");
    const { TARGET_REPOSITORIES } = await import("./src/lib/repositories.mjs");
    const { createRewardCycleProposal } = await import("./src/lib/reward-cycle.ts");
    const { syncCycleIndex, validateCycleTransition } = await import("./scripts/sync-cycle-index.ts");
    const index = await syncCycleIndex({ checkOnly: true, generatedAt: "2026-10-16T00:00:00.000Z" });
    if (${retired}) {
      for (const id of ids) {
        assert.equal(findProject(id), null);
        assert.equal(TARGET_REPOSITORIES.some((repository) => repository.projectId === id), false);
        const entry = index.cycles.find((cycle) => cycle.projectId === id);
        assert.ok(entry);
        assert.deepEqual(await validateCycleTransition(id, entry.cycleId), entry);
        const directory = "cycles/" + id + "/" + entry.cycleId;
        const snapshot = JSON.parse(await readFile(directory + "/source-snapshot.json", "utf8"));
        assert.throws(() => createRewardCycleProposal({
          projectId: id,
          cycleId: entry.cycleId,
          generatedAt: entry.generatedAt,
          snapshot,
          sourceSnapshotSha256: entry.files.sourceSnapshot.sha256,
        }), /Unknown project/);
      }
    }
    console.log(JSON.stringify(index));
  `;
  const result = Bun.spawnSync([process.execPath, "--eval", script], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout.toString());
}

test("retiring projects preserves frozen monthly and external cycles without reopening intake", () => {
  expect(rebuildCycles(true)).toEqual(rebuildCycles(false));
}, 30_000);

test("retiring the primary project preserves every frozen cycle", () => {
  expect(rebuildCycles(true, ["eliza"])).toEqual(rebuildCycles(false));
}, 30_000);

test("retiring all projects with frozen cycles preserves their original inventory", () => {
  expect(rebuildCycles(true, ["eliza", "asi", "delta-star"])).toEqual(
    rebuildCycles(false),
  );
}, 30_000);

test("a retired primary snapshot keeps strict identity and publication boundaries", () => {
  const script = `
    import assert from "node:assert/strict";
    import { readFile } from "node:fs/promises";
    import { RAW_PROJECT_DEFINITIONS } from "./src/lib/project-registry.generated.mjs";
    const project = RAW_PROJECT_DEFINITIONS.find((project) => project.id === "eliza");
    project.status = "paused";
    project.listingTier = "retired";
    const { assertLeaderboardSnapshot, assertPublishableLeaderboardSnapshot, assignLeaderboardRanks, compareRankedEntries } = await import("./src/lib/leaderboard.ts");
    const { PRIMARY_REPOSITORY } = await import("./src/lib/repositories.mjs");
    const snapshot = JSON.parse(await readFile("cycles/eliza/2026-09/source-snapshot.json", "utf8"));
    assert.notEqual(snapshot.repository, PRIMARY_REPOSITORY.id);
    assertLeaderboardSnapshot(snapshot);
    const publication = structuredClone(snapshot);
    assignLeaderboardRanks(publication.leaders.sort(compareRankedEntries));
    assert.throws(() => assertPublishableLeaderboardSnapshot(publication, Date.parse(publication.generatedAt)), /complete target repository registry/);

    const wrongHeader = structuredClone(snapshot);
    wrongHeader.repository = PRIMARY_REPOSITORY.id;
    assert.throws(() => assertLeaderboardSnapshot(wrongHeader), /primary repository/);

    for (const index of [0, 1]) {
      const wrongRole = structuredClone(snapshot);
      wrongRole.repositories[index].role = index === 0 ? "member" : "primary";
      assert.throws(() => assertLeaderboardSnapshot(wrongRole), /role does not match/);
    }
    const unknown = structuredClone(snapshot);
    unknown.repository = unknown.repositories[0].id = "unknown/repository";
    assert.throws(() => assertLeaderboardSnapshot(unknown), /repository registry order/);

    const wrongOrder = structuredClone(snapshot);
    [wrongOrder.repositories[0], wrongOrder.repositories[1]] = [wrongOrder.repositories[1], wrongOrder.repositories[0]];
    wrongOrder.repository = wrongOrder.repositories[0].id;
    wrongOrder.repositories[0].role = "primary";
    wrongOrder.repositories[1].role = "member";
    assert.throws(() => assertLeaderboardSnapshot(wrongOrder), /repository registry order/);

    const wrongMetadata = structuredClone(snapshot);
    wrongMetadata.repositories[0].integrationBranch = "unregistered-branch";
    assert.throws(() => assertLeaderboardSnapshot(wrongMetadata), /integrationBranch does not match/);
  `;
  const result = Bun.spawnSync([process.execPath, "--eval", script], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});

test("retiring a project preserves its original receipt signature and signing bytes", () => {
  const results = [false, true].map((retired) => {
    const script = `
      import assert from "node:assert/strict";
      import { createHash } from "node:crypto";
      import { readFile } from "node:fs/promises";
      import { RAW_PROJECT_DEFINITIONS } from "./src/lib/project-registry.generated.mjs";
      const snapshot = JSON.parse(await readFile("cycles/delta-star/2026-09/source-snapshot.json", "utf8"));
      const receipt = snapshot.attributions.find((attribution) => attribution.run)?.run;
      assert.ok(receipt);
      const project = RAW_PROJECT_DEFINITIONS.find((project) => project.id === receipt.projectId);
      assert.ok(project);
      if (${retired}) {
        project.status = "paused";
        project.listingTier = "retired";
      }
      const { verifyRunReceiptSignature } = await import("./scripts/run-receipt-crypto.ts");
      const { runReceiptSigningPayload } = await import("./src/lib/run-receipts.ts");
      assert.deepEqual(verifyRunReceiptSignature(receipt), receipt);
      const signature = receipt.deviceSignature;
      assert.throws(() => verifyRunReceiptSignature({
        ...receipt,
        deviceSignature: (signature[0] === "A" ? "B" : "A") + signature.slice(1),
      }), /device signature is invalid/);
      assert.throws(() => verifyRunReceiptSignature({
        ...receipt,
        projectId: "unknown-retired-project",
      }), /project is not registered/);
      console.log(createHash("sha256").update(runReceiptSigningPayload(receipt)).digest("hex"));
    `;
    const result = Bun.spawnSync([process.execPath, "--eval", script], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    return result.stdout.toString().trim();
  });
  expect(results[1]).toBe(results[0]);
});

import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function rebuildCycles(retired: boolean) {
  const script = `
    import assert from "node:assert/strict";
    import { readFile } from "node:fs/promises";
    import { RAW_PROJECT_DEFINITIONS } from "./src/lib/project-registry.generated.mjs";
    const ids = ["asi", "delta-star"];
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

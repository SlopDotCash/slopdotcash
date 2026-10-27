import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fixtureCheckout } from "../tests/fixture-checkout";

let root = "";
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

// A registry edit must not change the frozen proposal that an owner reviews.
// Run the real proposal builder and archive validator in separate processes so
// each reads the changed registry instead of an already cached module.
test("a frozen owner proposal survives registry copy and primary changes", () => {
  root = fixtureCheckout("historical-cycle-registry-");
  copyFileSync(
    resolve(import.meta.dir, "../src/lib/leaderboard.ts"),
    join(root, "src/lib/leaderboard.ts"),
  );
  const registryPath = join(root, "src/lib/project-registry.generated.mjs");
  const registrySource = readFileSync(registryPath, "utf8");
  writeFileSync(
    join(root, "historical-cycle-check.ts"),
    `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { assertLeaderboardSnapshot, assertPublishableLeaderboardSnapshot } from "./src/lib/leaderboard";
import { buildEscrowCycle, validateEscrowCycle } from "./src/lib/payments/escrow-cycle";
import { createPaymentProjectView } from "./src/lib/project-view";
import { snapshotFixture } from "./tests/fixtures";
const bytes = readFileSync("cycles/eliza/2026-09/source-snapshot.json");
const snapshot = JSON.parse(bytes.toString());
assertLeaderboardSnapshot(snapshot);
const project = JSON.parse(readFileSync(${JSON.stringify(resolve(import.meta.dir, "../tests/fixtures/projects/eliza.json"))}, "utf8"));
project.reward.feeBasisPoints = 200;
project.escrow = { schemaVersion: "1", effectiveCycle: "2026-09", chain: "solana", feeBasisPoints: 200, withdrawalFeeBasisPoints: 200, feeMode: "deduct-from-gross", deployments: [] };
const view = createPaymentProjectView(snapshot, "eliza", "2026-09", undefined, project);
const identities = Buffer.from(JSON.stringify(view.leaders.map((row, i) => ({ nodeId: row.actor.id, githubUserId: String(i + 100), login: row.actor.login }))));
const policy = Buffer.from(JSON.stringify(project));
const proposal = buildEscrowCycle({ projectId: "eliza", cycleId: "2026-09", generatedAt: "2026-10-01T00:00:00.000Z" }, bytes, identities, policy);
const files = new Map([["source-snapshot.json", bytes], ["github-identities.json", identities], ["project.json", policy], ["proposal.json", Buffer.from(JSON.stringify(proposal))]]);
await validateEscrowCycle(async name => { const value = files.get(name); assert(value); return value; }, "eliza", "2026-09");
for (const alter of [
  value => { value.repositories[0].projectId = "unrelated-project"; },
  value => { value.repositories[0].githubUrl = "https://github.com/unrelated/repository"; },
  value => { value.repositories.push(value.repositories[0]); },
  value => { value.source.repositories[0].id = "unrelated/repository"; },
]) {
  const altered = structuredClone(snapshot); alter(altered);
  assert.throws(() => assertLeaderboardSnapshot(altered));
}
const alteredProposal = structuredClone(proposal);
alteredProposal.grossCapMicro = "1";
files.set("proposal.json", Buffer.from(JSON.stringify(alteredProposal)));
await assert.rejects(() => validateEscrowCycle(async name => files.get(name), "eliza", "2026-09"));
if (process.argv[2] !== "baseline") {
  // Normalize historical rank display, independently of registry validation.
  snapshot.leaders.sort((a, b) => b.scoreThirds - a.scoreThirds || (a.actor.id < b.actor.id ? -1 : a.actor.id > b.actor.id ? 1 : 0));
  snapshot.leaders.forEach((leader, index) => { leader.rank = index && leader.scoreThirds === snapshot.leaders[index - 1].scoreThirds ? snapshot.leaders[index - 1].rank : index + 1; });
  assert.throws(() => assertPublishableLeaderboardSnapshot(snapshot), /complete target repository registry/);
}
if (process.argv[2] === "copy") {
  const current = snapshotFixture("2026-07-30T00:00:00.000Z");
  assertPublishableLeaderboardSnapshot(current);
  current.repositories[0].description = "Earlier description";
  assertLeaderboardSnapshot(current);
  assert.throws(() => assertPublishableLeaderboardSnapshot(current), /description does not match/);
}
console.log(JSON.stringify({ awards: proposal.awards.length, digest: createHash("sha256").update(JSON.stringify(proposal)).digest("hex") }));
`,
  );
  function run(phase: string) {
    const result = spawnSync(
      process.execPath,
      ["historical-cycle-check.ts", phase],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 60000,
      },
    );
    if (result.status !== 0)
      throw new Error(result.stderr || String(result.error));
    return JSON.parse(result.stdout) as { awards: number; digest: string };
  }
  const baseline = run("baseline");
  expect(baseline.awards).toBe(41);
  writeFileSync(
    registryPath,
    `${registrySource}\nRAW_PROJECT_DEFINITIONS.find(p => p.id === "eliza").repositories[0].description = "Updated repository description after September";\n`,
  );
  expect(run("copy")).toEqual(baseline);
  writeFileSync(
    registryPath,
    `${registrySource}\nRAW_PROJECT_DEFINITIONS.find(p => p.id === "eliza").status = "paused";\n`,
  );
  expect(run("paused")).toEqual(baseline);
}, 180000);

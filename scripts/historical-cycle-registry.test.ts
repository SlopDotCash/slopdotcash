import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ProfileReadmeWalletProof } from "../src/lib/rewards";
import { fixtureCheckout } from "../tests/fixture-checkout";
import { fixtureProject } from "../tests/fixture-overlay.mjs";
import { childEnvironment } from "./child-environment.mjs";

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
import { assertLeaderboardSnapshot } from "./src/lib/leaderboard";
import { buildEscrowCycle, validateEscrowCycle } from "./src/lib/payments/escrow-cycle";
import { createPaymentProjectView } from "./src/lib/project-view";
const bytes = readFileSync("cycles/eliza/2026-09/source-snapshot.json");
const snapshot = JSON.parse(bytes.toString());
assertLeaderboardSnapshot(snapshot);
const project = ${JSON.stringify(fixtureProject("eliza"))};
project.reward.feeBasisPoints = 200;
project.escrow = { schemaVersion: "1", effectiveCycle: "2026-09", chain: "solana", feeBasisPoints: 200, withdrawalFeeBasisPoints: 200, feeMode: "deduct-from-gross", deployments: [] };
const view = createPaymentProjectView(snapshot, "eliza", "2026-09", undefined, project);
const identities = Buffer.from(JSON.stringify(view.leaders.map((row, i) => ({ nodeId: row.actor.id, githubUserId: String(i + 100), login: row.actor.login }))));
const policy = Buffer.from(JSON.stringify(project));
const proposal = buildEscrowCycle({ projectId: "eliza", cycleId: "2026-09", generatedAt: "2026-10-01T00:00:00.000Z" }, bytes, identities, policy);
const files = new Map([["source-snapshot.json", bytes], ["github-identities.json", identities], ["project.json", policy], ["proposal.json", Buffer.from(JSON.stringify(proposal))]]);
await validateEscrowCycle(async name => { const value = files.get(name); assert(value); return value; }, "eliza", "2026-09");
const alteredProposal = structuredClone(proposal);
alteredProposal.grossCapMicro = "1";
files.set("proposal.json", Buffer.from(JSON.stringify(alteredProposal)));
await assert.rejects(() => validateEscrowCycle(async name => files.get(name), "eliza", "2026-09"));
console.log(JSON.stringify({ awards: proposal.awards.length, digest: createHash("sha256").update(JSON.stringify(proposal)).digest("hex") }));
`,
  );
  function run() {
    const result = spawnSync(process.execPath, ["historical-cycle-check.ts"], {
      cwd: root,
      encoding: "utf8",
      timeout: 60000,
    });
    if (result.status !== 0)
      throw new Error(result.stderr || String(result.error));
    return JSON.parse(result.stdout) as { awards: number; digest: string };
  }
  const baseline = run();
  expect(baseline.awards).toBe(41);
  writeFileSync(
    registryPath,
    `${registrySource}\nRAW_PROJECT_DEFINITIONS.find(p => p.id === "eliza").repositories[0].description = "Updated repository description after September";\n`,
  );
  expect(run()).toEqual(baseline);
  writeFileSync(
    registryPath,
    `${registrySource}\nRAW_PROJECT_DEFINITIONS.find(p => p.id === "eliza").status = "paused";\n`,
  );
  expect(run()).toEqual(baseline);
}, 180000);

type HistoricalReadmeRow = {
  actor: { id: string; login: string };
  wallet: ProfileReadmeWalletProof | null;
  state?: string;
};

/**
 * Exercise the actual import command with historical file projections it reads.
 * These local inputs do not claim to be complete validated allocation manifests.
 * The canonical reviewed fixture supplies the exact legacy pin; no production
 * history is edited and the generated SQL is never applied to a database.
 */
function readmeImportFixture() {
  root = fixtureCheckout("historical-readme-import-");
  for (const directory of ["cycles", "disclosures", "funding/preparations"]) {
    rmSync(join(root, directory), { recursive: true, force: true });
    mkdirSync(join(root, directory), { recursive: true });
  }
  const historical = JSON.parse(readFileSync(
    resolve(import.meta.dir, "../tests/fixtures/history/cycles/eliza/2026-07/proposal.json"),
    "utf8",
  )) as { allocations: HistoricalReadmeRow[] };
  const pin = historical.allocations.find((row) => row.actor.id === "MDQ6VXNlcjE2Mzk1NDk2");
  if (!pin?.wallet) throw new Error("Missing frozen odilitime README proof");
  const output = join(root, "observations.sql");
  writeFileSync(output, "previous complete output\n");
  const cycle = (project: string, period: string, rows: HistoricalReadmeRow[]) => {
    const directory = join(root, "cycles", project, period);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "proposal.json"), JSON.stringify({ allocations: rows }));
  };
  const command = () => spawnSync(process.execPath, [
    "--no-env-file", join(root, "scripts/prepare-payments-import.ts"), output,
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
    env: childEnvironment(process.env, { TMPDIR: join(root, ".bun-tmp") }),
  });
  return { pin: { ...structuredClone(pin), wallet: structuredClone(pin.wallet) }, output, cycle, command };
}

function reorderedProof(wallet: ProfileReadmeWalletProof): ProfileReadmeWalletProof {
  return {
    sourceUrl: wallet.sourceUrl,
    sourceCommit: wallet.sourceCommit,
    observedAt: wallet.observedAt,
    chain: wallet.chain,
    address: wallet.address,
  };
}

test("the historical import accepts only the exact legacy README tuple and canonical property order", () => {
  const fixture = readmeImportFixture();
  fixture.cycle("eliza", "2026-06", [{ actor: fixture.pin.actor, wallet: null }]);
  fixture.cycle("eliza", "2026-07", [fixture.pin]);
  const first = fixture.command();
  expect(first.status, first.stderr).toBe(0);
  const original = readFileSync(fixture.output, "utf8");
  expect(original).toContain(fixture.pin.wallet.sourceUrl);
  expect(original.match(/INSERT INTO wallet_observations/g)?.length).toBe(1);
  expect(original).not.toContain("wallet_claims");
  expect(original).not.toContain("payment_direct_transfers");

  fixture.cycle("eliza", "2026-07", [{
    ...fixture.pin,
    wallet: reorderedProof(fixture.pin.wallet),
  }]);
  const reordered = fixture.command();
  expect(reordered.status, reordered.stderr).toBe(0);
  expect(readFileSync(fixture.output, "utf8")).toContain(fixture.pin.wallet.sourceUrl);
  expect(readFileSync(fixture.output, "utf8").match(/INSERT INTO wallet_observations/g)?.length).toBe(1);
}, 60_000);

test("the historical import binds every prior proof field and skips only the changed successor row", () => {
  const fixture = readmeImportFixture();
  fixture.cycle("eliza", "2026-06", [{ actor: fixture.pin.actor, wallet: null }]);
  // Noncarried rows still supply a prior README proof.
  fixture.cycle("eliza", "2026-07", [{ ...fixture.pin, state: "approved" }]);
  fixture.cycle("eliza", "2026-08", [{
    ...fixture.pin,
    wallet: reorderedProof(fixture.pin.wallet),
  }]);
  const accepted = fixture.command();
  expect(accepted.status, accepted.stderr).toBe(0);
  expect(readFileSync(fixture.output, "utf8")).toContain("cycles/eliza/2026-08/proposal.json");

  const changes: Partial<ProfileReadmeWalletProof>[] = [
    { address: "ZtdooyCSVFtdbz5Y4msPuanVyZYV2zaHCJnjZgyVU96" },
    { chain: "base" },
    { observedAt: "2026-08-21T02:59:01.754Z" },
    { sourceCommit: "a".repeat(40) },
    { sourceUrl: `${fixture.pin.wallet.sourceUrl}?changed=1` },
  ];
  for (const changed of changes) {
    fixture.cycle("eliza", "2026-08", [{ ...fixture.pin, wallet: { ...fixture.pin.wallet, ...changed } }]);
    const refused = fixture.command();
    expect(refused.status, refused.stderr).toBe(0);
    expect(refused.stderr).toContain("is not the proof that the prior manifest froze for it");
    const sql = readFileSync(fixture.output, "utf8");
    expect(sql).toContain("cycles/eliza/2026-07/proposal.json");
    expect(sql).not.toContain("cycles/eliza/2026-08/proposal.json");
    expect(sql.match(/INSERT INTO wallet_observations/g)?.length).toBe(1);
  }
}, 60_000);

test.each([
  { label: "actor", project: "eliza", prior: "2026-06", period: "2026-07", actorId: "MDQ6VXNlcjE=" },
  { label: "project", project: "asi", prior: "2026-06", period: "2026-07", actorId: "MDQ6VXNlcjE2Mzk1NDk2" },
  { label: "cycle", project: "eliza", prior: "2026-07", period: "2026-08", actorId: "MDQ6VXNlcjE2Mzk1NDk2" },
])("the historical import refuses a legacy README pin moved to another $label", ({ project, prior, period, actorId }) => {
  const fixture = readmeImportFixture();
  const actor = { ...fixture.pin.actor, id: actorId };
  fixture.cycle(project, prior, [{ actor, wallet: null }]);
  fixture.cycle(project, period, [{ ...fixture.pin, actor }]);
  const result = fixture.command();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("is new; only an actor-bound claim or a frozen prior proof is accepted");
  expect(result.stderr).toContain("no README wallet observations");
  expect(readFileSync(fixture.output, "utf8")).toBe("previous complete output\n");
}, 60_000);

test("a later malformed historical preparation leaves no partial import output and a corrected retry succeeds", () => {
  const fixture = readmeImportFixture();
  const path = join(root, "funding/preparations/readme.json");
  writeFileSync(path, JSON.stringify({ contributors: [
    fixture.pin,
    { ...fixture.pin, wallet: { ...fixture.pin.wallet, address: "invalid" } },
  ] }));
  const refused = fixture.command();
  expect(refused.status).not.toBe(0);
  expect(refused.stderr).toContain("invalid README wallet");
  expect(readFileSync(fixture.output, "utf8")).toBe("previous complete output\n");

  writeFileSync(path, JSON.stringify({ contributors: [fixture.pin] }));
  const retry = fixture.command();
  expect(retry.status, retry.stderr).toBe(0);
  const sql = readFileSync(fixture.output, "utf8");
  expect(sql.match(/INSERT INTO wallet_observations/g)?.length).toBe(1);
  expect(sql).toContain("funding/preparations/readme.json");
  expect(sql).not.toContain("wallet_claims");
}, 60_000);

test("absent historical sources produce empty SQL but a parsed source without observations refuses", () => {
  const fixture = readmeImportFixture();
  const empty = fixture.command();
  expect(empty.status, empty.stderr).toBe(0);
  expect(readFileSync(fixture.output, "utf8")).toBe("");
  writeFileSync(fixture.output, "previous complete output\n");
  writeFileSync(join(root, "funding/preparations/empty.json"), JSON.stringify({ contributors: [] }));
  const refused = fixture.command();
  expect(refused.status).not.toBe(0);
  expect(refused.stderr).toContain("no README wallet observations");
  expect(readFileSync(fixture.output, "utf8")).toBe("previous complete output\n");
}, 60_000);

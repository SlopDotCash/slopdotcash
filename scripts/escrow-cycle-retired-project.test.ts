// A committed escrow cycle stays valid after its project is retired.
import { afterEach, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPaymentProjectView } from "../src/lib/project-view";
import * as projects from "../src/lib/projects.mjs";
import { buildEscrowCycle, validateEscrowCycle } from "./prepare-escrow-cycle";

const registry = { ...projects };
afterEach(() => {
  mock.module("../src/lib/projects.mjs", () => registry);
});

/** Hide eliza from listed lookups while its history still resolves. */
function retireEliza() {
  mock.module("../src/lib/projects.mjs", () => ({
    ...registry,
    findProject: (value: string) =>
      value === "eliza" ? null : registry.findProject(value),
  }));
}

const eliza = JSON.parse(
  readFileSync("tests/fixtures/projects/eliza.json", "utf8"),
);
const evm = "0x8f77c37d8650776bfe73c9b12b15209ee15d9b86";
// Same keys as the reviewed deployment in src/lib/project-schema.robinhood.test.ts.
const deployment = {
  network: "robinhood-testnet",
  vault: "0x1000000000000000000000000000000000000001",
  programId: null,
  upgradeAuthority: null,
  projectPda: null,
  networkDomain: null,
  asset: "0x7e955252e15c84f5768b83c41a71f9eba181802f",
  owner: evm,
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
};
const policy = {
  ...eliza,
  reward: {
    ...eliza.reward,
    chain: "robinhood",
    currency: "USDG",
    feeBasisPoints: 200,
  },
  escrow: {
    schemaVersion: "1",
    effectiveCycle: "2026-09",
    chain: "robinhood",
    feeBasisPoints: 200,
    withdrawalFeeBasisPoints: 200,
    feeMode: "deduct-from-gross",
    deployments: [deployment],
  },
};

test("a retired project's committed escrow cycle still validates", async () => {
  const snapshotBytes = readFileSync(
    "tests/fixtures/history/cycles/eliza/2026-09/source-snapshot.json",
  );
  const view = createPaymentProjectView(
    JSON.parse(snapshotBytes.toString("utf8")),
    "eliza",
    "2026-09",
    undefined,
    policy,
  );
  const identityBytes = Buffer.from(
    `${JSON.stringify(
      view.leaders.map((leader, index) => ({
        nodeId: leader.actor.id,
        githubUserId: String(1000 + index),
        login: leader.actor.login,
      })),
      null,
      2,
    )}\n`,
  );
  const policyBytes = Buffer.from(JSON.stringify(policy));
  const proposal = buildEscrowCycle(
    {
      projectId: "eliza",
      cycleId: "2026-09",
      generatedAt: "2026-10-01T06:00:00.000Z",
    },
    snapshotBytes,
    identityBytes,
    policyBytes,
  );
  const directory = mkdtempSync(join(tmpdir(), "escrow-cycle-"));
  writeFileSync(join(directory, "source-snapshot.json"), snapshotBytes);
  writeFileSync(join(directory, "github-identities.json"), identityBytes);
  writeFileSync(join(directory, "project.json"), policyBytes);
  writeFileSync(
    join(directory, "proposal.json"),
    `${JSON.stringify(proposal, null, 2)}\n`,
  );
  // Retirement (or a restriction synced as retired) hides the project from
  // every list; the archived revision still governs its committed cycle.
  retireEliza();
  const validated = await validateEscrowCycle(directory, "eliza", "2026-09");
  expect(validated.proposal).toEqual(proposal);
});

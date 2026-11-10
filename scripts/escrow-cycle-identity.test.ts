// Archived escrow identities are external bytes: the node ID must decode to
// the claimed numeric GitHub ID, and the login must match the snapshot
// leader. A tampered mapping plus a regenerated proposal used to validate,
// because validateEscrowCycle rebuilds from the same bytes.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { githubUserIdFromNodeId } from "../src/lib/github-actor";
import {
  buildEscrowCycle,
  validateEscrowCycle,
} from "../src/lib/payments/escrow-cycle";
import { createPaymentProjectView } from "../src/lib/project-view";
import { fixtureProject } from "../tests/fixture-overlay.mjs";

const snapshotBytes = gunzipSync(
  readFileSync(
    "tests/fixtures/history/cycles/eliza/2026-09/source-snapshot.json.gz",
  ),
);
const GENERATED_AT = "2026-10-01T00:00:00.000Z";

function fixture() {
  const project = fixtureProject("eliza");
  project.reward.feeBasisPoints = 200;
  project.escrow = {
    schemaVersion: "1",
    effectiveCycle: "2026-09",
    chain: "solana",
    feeBasisPoints: 200,
    withdrawalFeeBasisPoints: 200,
    feeMode: "deduct-from-gross",
    deployments: [],
  };
  const snapshot = JSON.parse(snapshotBytes.toString());
  const view = createPaymentProjectView(
    snapshot,
    "eliza",
    "2026-09",
    undefined,
    project,
  );
  const derived = view.leaders.map((leader) => {
    const githubUserId = githubUserIdFromNodeId(leader.actor.id);
    if (!githubUserId)
      throw new Error(`No numeric GitHub identity for ${leader.actor.login}`);
    return {
      nodeId: leader.actor.id,
      githubUserId,
      login: leader.actor.login,
    };
  });
  const policyBytes = Buffer.from(JSON.stringify(project));
  const build = (identities: typeof derived | null) =>
    buildEscrowCycle(
      { projectId: "eliza", cycleId: "2026-09", generatedAt: GENERATED_AT },
      snapshotBytes,
      identities === null ? null : Buffer.from(JSON.stringify(identities)),
      policyBytes,
    );
  return { derived, policyBytes, build };
}

test("a swapped numeric identity mapping is rejected", () => {
  const { derived, build } = fixture();
  const tampered = structuredClone(derived);
  [tampered[0].githubUserId, tampered[1].githubUserId] = [
    tampered[1].githubUserId,
    tampered[0].githubUserId,
  ];
  expect(() => build(tampered)).toThrow(
    "Archived GitHub identity does not match its node ID",
  );
});

test("an identity login that differs from the snapshot leader is rejected", () => {
  const { derived, build } = fixture();
  const tampered = structuredClone(derived);
  tampered[0].login = "someone-else";
  expect(() => build(tampered)).toThrow(
    "Archived GitHub identity login differs from proposal",
  );
});

test("a tampered archive does not validate, even against its own proposal", async () => {
  const { derived, policyBytes, build } = fixture();
  const proposal = build(derived);
  const tampered = structuredClone(derived);
  [tampered[0].githubUserId, tampered[1].githubUserId] = [
    tampered[1].githubUserId,
    tampered[0].githubUserId,
  ];
  const files = new Map([
    ["source-snapshot.json", snapshotBytes],
    ["github-identities.json", Buffer.from(JSON.stringify(tampered))],
    ["project.json", policyBytes],
    ["proposal.json", Buffer.from(JSON.stringify(proposal))],
  ]);
  await expect(
    validateEscrowCycle(
      async (name) => {
        const value = files.get(name);
        if (!value) throw new Error(`missing ${name}`);
        return value;
      },
      "eliza",
      "2026-09",
    ),
  ).rejects.toThrow("Archived GitHub identity does not match its node ID");
});

test("derived identities and the monthly null-identity path still build and validate", async () => {
  const { derived, policyBytes, build } = fixture();
  const proposal = build(derived);
  expect(proposal.awards).toHaveLength(derived.length);
  const files = new Map([
    ["source-snapshot.json", snapshotBytes],
    ["github-identities.json", Buffer.from(JSON.stringify(derived))],
    ["project.json", policyBytes],
    ["proposal.json", Buffer.from(JSON.stringify(proposal))],
  ]);
  await expect(
    validateEscrowCycle(
      async (name) => {
        const value = files.get(name);
        if (!value) throw new Error(`missing ${name}`);
        return value;
      },
      "eliza",
      "2026-09",
    ),
  ).resolves.toMatchObject({ proposal });
  // The live monthly path derives identities from the snapshot, not a file.
  expect(build(null).awards).toEqual(proposal.awards);
});

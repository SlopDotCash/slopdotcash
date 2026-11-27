// spec/settlement/octoberImport.md, "An apply run writes only under the reviewed digest, current main and the production lock"
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { prepareOctoberProposal } from "../src/october/plan.ts";
import {
  assertOctoberReviewedWeights,
  decodeOctoberReviewedPacket,
  octoberApprovedTermsDigest,
  octoberPeriod,
  octoberThrough,
} from "../src/october/review.ts";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const actor = (githubUserId: string) => ({
  githubUserId,
  githubNodeId: Buffer.from(`04:User${githubUserId}`).toString("base64"),
  login: `demo-${githubUserId}`,
});
const a = actor("42");
const b = actor("43");
const pointsDigest = "2".repeat(64);
const packet = {
  schemaVersion: "1",
  kind: "reconciled-october-accepted-work",
  period: octoberPeriod,
  through: octoberThrough,
  approvedTermsSha256: octoberApprovedTermsDigest,
  producerGithubId: "101",
  reviewerGithubId: "102",
  reviewedAt: "2026-11-14T10:04:05.000Z",
  enforcementGeneration: 1,
  evidence: {
    census: "1".repeat(64),
    assessmentJournal: "1".repeat(64),
    pointsBatch: pointsDigest,
    attribution: "1".repeat(64),
    duplicateCredit: "1".repeat(64),
    protectedHistory: "1".repeat(64),
    eligibility: "1".repeat(64),
  },
  projects: [{
    id: "eliza",
    revision: 6,
    manifestSha256: "3".repeat(64),
    from: "2026-10-01T00:00:00.000Z",
    reconciliation: "complete",
    identities: [a, b],
    weights: [
      { githubUserId: a.githubUserId, acceptedWorkPoints: 60, eligible: true },
      { githubUserId: b.githubUserId, acceptedWorkPoints: 0, eligible: false },
    ],
  }],
};

function review(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return decodeOctoberReviewedPacket(bytes, digest(bytes));
}

test("Accepts the exact October packet and validates every weight and eligibility", () => {
  const checked = review(packet);
  assert.equal(checked.evidence.pointsBatch, pointsDigest);
  assert.equal(checked.projects.length, 1);
  assertOctoberReviewedWeights(
    checked.projects[0],
    new Map([[a.githubUserId, { githubNodeId: a.githubNodeId, acceptedWorkPoints: 60 }]]),
    new Map([[a.githubUserId, a.githubNodeId], [b.githubUserId, b.githubNodeId]]),
    new Set([a.githubUserId]),
  );
});

test("Rejects changed review bytes, extra fields, missing authority and wrong historical bounds", () => {
  const bytes = new TextEncoder().encode(JSON.stringify(packet));
  assert.throws(() => decodeOctoberReviewedPacket(bytes, "f".repeat(64)), /digest differs/);
  assert.throws(() => review({ ...packet, unexpected: true }), /Unexpected October/);
  assert.throws(() => review({ ...packet, reviewerGithubId: "unreviewed" }), /identity or checkpoint/);
  assert.throws(() => review({ ...packet, through: "2026-11-02T00:00:00.000Z" }), /complete month/);
  assert.throws(() => review({ ...packet, evidence: { ...packet.evidence, protectedHistory: "invalid" } }), /invalid evidence/);
});

test("Rejects repeated identity, unapproved project and no eligible positives", () => {
  const [project] = packet.projects;
  assert.throws(() => review({ ...packet, projects: [{ ...project, id: "unknown" }] }), /project binding/);
  assert.throws(() => review({ ...packet, projects: [project, project] }), /repeats a project/);
  assert.throws(() => review({ ...packet, projects: [{ ...project, identities: [a, a] }] }), /one disposition/);
  assert.throws(() => review({ ...packet, projects: [{ ...project, identities: [a, { ...b, githubNodeId: a.githubNodeId }] }] }), /node ID differ/);
  assert.throws(() => review({ ...packet, projects: [{ ...project, weights: project.weights.map((row) => ({ ...row, eligible: false })) }] }), /no reviewed positive/);
});

test("Rejects omitted, changed, unknown and newly ineligible weight rows", () => {
  const [project] = review(packet).projects;
  const expected = new Map([
    [a.githubUserId, { githubNodeId: a.githubNodeId, acceptedWorkPoints: 60 }],
    [b.githubUserId, { githubNodeId: b.githubNodeId, acceptedWorkPoints: 0 }],
  ]);
  const known = new Map([[a.githubUserId, a.githubNodeId], [b.githubUserId, b.githubNodeId]]);
  const eligible = new Set([a.githubUserId]);
  assert.throws(() => assertOctoberReviewedWeights({ ...project, weights: project.weights.slice(0, 1) }, expected, known, eligible), /omits a contributor/);
  assert.throws(() => assertOctoberReviewedWeights(project, new Map(), known, eligible), /differ from canonical/);
  assert.throws(() => assertOctoberReviewedWeights(project, expected, known, new Set()), /eligibility changed/);
  assert.throws(() => assertOctoberReviewedWeights(project, new Map([[a.githubUserId, expected.get(a.githubUserId)!]]), new Map(), eligible), /differ from canonical/);
});

const assetAddress = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const now = "2026-11-26T21:00:00.000Z";
const manifest = {
  id: "eliza",
  status: "active",
  reward: { kind: "monthly-pool", chain: "solana", currency: "USDC", feeBasisPoints: 200, rewardStartAt: "2026-10-01T00:00:00.000Z" },
  escrow: {
    chain: "solana",
    feeMode: "deduct-from-gross",
    feeBasisPoints: 200,
    deployments: [{ network: "solana-mainnet", asset: assetAddress, vault: "11111111111111111111111111111111" }],
  },
  rewardAsset: { network: "solana", symbol: "USDC", decimals: 6, address: assetAddress },
};

function proposalFixture(registry: unknown = manifest, scope = { id: "eliza", from: "2026-10-01T00:00:00.000Z" }) {
  const identities = [{ ...a, login: "Zulu" }, { ...b, login: "alpha" }, actor("44"), actor("45")];
  const weights = identities.map(({ githubUserId }) => ({
    githubUserId,
    acceptedWorkPoints: 1,
    eligible: githubUserId !== "45",
  }));
  const manifestText = JSON.stringify(registry);
  const manifestSha256 = createHash("sha256").update(manifestText).digest("hex");
  const reviewed = {
    ...packet,
    projects: [{ ...packet.projects[0], ...scope, manifestSha256, identities, weights }],
  };
  const bytes = new TextEncoder().encode(JSON.stringify(reviewed));
  const capture = {
    capturedAt: now,
    enforcementGeneration: 1,
    revision: 6,
    manifestSha256,
    manifest: manifestText,
    restricted: false,
    verifiedOwnerGithubId: "102",
    publicPointsBatch: pointsDigest,
    privatePointsBatch: pointsDigest,
    observedWeights: new Map(identities.map(({ githubUserId, githubNodeId }) => [githubUserId, { githubNodeId, acceptedWorkPoints: 1 }])),
    knownIdentities: new Map(identities.map(({ githubUserId, githubNodeId }) => [githubUserId, githubNodeId])),
    eligible: new Set(["42", "43", "44"]),
  };
  return { bytes, capture, reviewed, reviewDigest: digest(bytes) };
}

test("Eliza October divides the approved gross, preserves the legacy tie order and rounds individual fees up", () => {
  const { bytes, capture, reviewDigest } = proposalFixture();
  const plan = prepareOctoberProposal("eliza", bytes, reviewDigest, capture, now);
  assert.equal(plan.grossBase, "1000000000");
  assert.equal(plan.feeBase, "20000001");
  assert.equal(plan.netBase, "979999999");
  assert.equal(plan.sourceSnapshotSha256, reviewDigest);
  assert.equal(plan.pointsBatch, pointsDigest);
  assert.deepEqual(plan.awards.map(({ githubUserId, grossBase }) => [githubUserId, grossBase]), [
    ["42", "333333333"], ["43", "333333334"], ["44", "333333333"],
  ]);
  assert.equal(plan.awards[1]?.sourceDigest, createHash("sha256").update(JSON.stringify(["slop-escrow-origin-v2", "eliza", "2026-10", "43"])).digest("hex"));
});

test("Eliza October refuses stale registry, changed eligibility, unverified owner and mismatched public or private Points", () => {
  const { bytes, capture, reviewDigest } = proposalFixture();
  const run = (overrides: Partial<typeof capture>) => prepareOctoberProposal("eliza", bytes, reviewDigest, { ...capture, ...overrides }, now);
  for (const altered of [
    { capturedAt: "2026-11-13T00:00:00.000Z" }, { capturedAt: "2026-12-01T00:00:00.000Z" },
    { enforcementGeneration: 2 }, { revision: 7 }, { manifest: "{}" }, { restricted: true },
  ]) {
    assert.throws(() => run(altered), /registry or enforcement/);
  }
  assert.throws(() => run({ verifiedOwnerGithubId: "101" }), /verified current project owner/);
  assert.throws(() => run({ privatePointsBatch: "b".repeat(64) }), /public and private Points/);
  assert.throws(() => run({ publicPointsBatch: "b".repeat(64) }), /public and private Points/);
  assert.throws(() => run({ eligible: new Set(["42", "43", "44", "45"]) }), /eligibility changed/);
});

test("Eliza October admits only the approved rail, time window and project", () => {
  for (const current of [
    { ...manifest, reward: { ...manifest.reward, chain: "base" } },
    { ...manifest, reward: { ...manifest.reward, feeBasisPoints: 100 } },
    { ...manifest, escrow: { ...manifest.escrow, deployments: [...manifest.escrow.deployments, ...manifest.escrow.deployments] } },
    { ...manifest, rewardAsset: { ...manifest.rewardAsset, decimals: 18 } },
  ]) {
    const { bytes, capture, reviewDigest } = proposalFixture(current);
    assert.throws(() => prepareOctoberProposal("eliza", bytes, reviewDigest, capture, now), /approved October rail/);
  }
  const { reviewed, capture } = proposalFixture();
  for (const project of [
    { ...reviewed.projects[0], from: "2026-10-02T00:00:00.000Z" },
    { ...reviewed.projects[0], id: "slopdotcash" },
  ]) {
    const bytes = new TextEncoder().encode(JSON.stringify({ ...reviewed, projects: [project] }));
    assert.throws(() => prepareOctoberProposal("eliza", bytes, digest(bytes), capture, now), /selected project|approved contribution window/);
  }
});

const slopScope = { id: "slopdotcash", from: "2026-10-11T00:00:00.000Z" };
const baseUsdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const slopVault = "0x6c1297c3b96a00347cb501f572cb5811c2a8ed36";
const slopManifest = {
  ...manifest,
  id: slopScope.id,
  reward: {
    ...manifest.reward,
    chain: "base",
    rewardStartAt: slopScope.from,
    cycleCaps: [{ cycleId: octoberPeriod, monthlyCapMinor: "0" }],
  },
  terms: { receiptPolicy: { state: "active" } },
  escrow: {
    ...manifest.escrow,
    chain: "base",
    effectiveCycle: octoberPeriod,
    deployments: [{ network: "base-mainnet", asset: baseUsdc, vault: slopVault }],
  },
  rewardAsset: { network: "base", symbol: "USDC", decimals: 6, address: baseUsdc, chainId: "8453" },
};

test("Slop October uses the reviewed Base vault, exact gross, rounded fees and project-specific award origins", () => {
  const { bytes, capture, reviewDigest } = proposalFixture(slopManifest, slopScope);
  const plan = prepareOctoberProposal("slopdotcash", bytes, reviewDigest, capture, now);
  assert.equal(plan.id, "slopdotcash");
  assert.equal(plan.vault, slopVault);
  assert.equal(plan.network, "base-mainnet");
  assert.equal(plan.assetAddress, baseUsdc);
  assert.equal(plan.grossBase, "1000000000");
  assert.equal(plan.feeBase, "20000001");
  assert.equal(plan.netBase, "979999999");
  assert.deepEqual(plan.awards.map(({ githubUserId, grossBase }) => [githubUserId, grossBase]), [
    ["42", "333333333"], ["43", "333333334"], ["44", "333333333"],
  ]);
  assert.equal(plan.awards[1]?.sourceDigest, createHash("sha256").update(JSON.stringify(["slop-escrow-origin-v2", "slopdotcash", "2026-10", "43"])).digest("hex"));
  assert.throws(() => prepareOctoberProposal("eliza", bytes, reviewDigest, capture, now), /selected project/);
});

test("Slop October refuses wrong rails, vaults and contribution windows", () => {
  for (const deployment of [
    { network: "ethereum-mainnet", asset: baseUsdc, vault: slopVault },
    { network: "base-mainnet", asset: "0x" + "1".repeat(40), vault: slopVault },
    { network: "base-mainnet", asset: baseUsdc, vault: "11111111111111111111111111111111" },
    { network: "base-mainnet", asset: baseUsdc, vault: "0x" + "1".repeat(40) },
  ]) {
    const altered = { ...slopManifest, escrow: { ...slopManifest.escrow, deployments: [deployment] } };
    const { bytes, capture, reviewDigest } = proposalFixture(altered, slopScope);
    assert.throws(() => prepareOctoberProposal("slopdotcash", bytes, reviewDigest, capture, now), /approved October rail/);
  }
  const futureEscrow = { ...slopManifest, escrow: { ...slopManifest.escrow, effectiveCycle: "2026-11" } };
  const fixture = proposalFixture(futureEscrow, slopScope);
  assert.throws(() => prepareOctoberProposal("slopdotcash", fixture.bytes, fixture.reviewDigest, fixture.capture, now), /approved October rail/);
  const wrongFrom = "2026-10-01T00:00:00.000Z";
  const altered = { ...slopManifest, reward: { ...slopManifest.reward, rewardStartAt: wrongFrom } };
  const { bytes, capture, reviewDigest } = proposalFixture(altered, { ...slopScope, from: wrongFrom });
  assert.throws(() => prepareOctoberProposal("slopdotcash", bytes, reviewDigest, capture, now), /approved contribution window/);
});

test("Slop's reviewed pool requires the explicit manual-only October override", () => {
  for (const cycleCaps of [
    undefined,
    [{ cycleId: "2026-11", monthlyCapMinor: "0" }],
    [{ cycleId: octoberPeriod, monthlyCapMinor: "1000000000" }],
    [{ cycleId: octoberPeriod, monthlyCapMinor: "0" }, { cycleId: octoberPeriod, monthlyCapMinor: "0" }],
  ]) {
    const { bytes, capture, reviewDigest } = proposalFixture({ ...slopManifest, reward: { ...slopManifest.reward, cycleCaps } }, slopScope);
    assert.throws(() => prepareOctoberProposal("slopdotcash", bytes, reviewDigest, capture, now), /explicit zero automatic cap/);
  }
  for (const current of [
    { ...slopManifest, rewardAsset: undefined },
    { ...slopManifest, rewardAsset: { ...slopManifest.rewardAsset, chainId: "1" } },
    { ...slopManifest, terms: { receiptPolicy: { state: "suspended" } } },
  ]) {
    const { bytes, capture, reviewDigest } = proposalFixture(current, slopScope);
    assert.throws(() => prepareOctoberProposal("slopdotcash", bytes, reviewDigest, capture, now), /active receipts and the verified Base asset/);
  }
});

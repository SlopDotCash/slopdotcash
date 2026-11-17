// spec/backend/projects.md, "Administrators hold, delist, change the steward or place a project"; spec/security/enforcement.md, "A moderator quarantines a clear project or bans it, and decides a service ban"
import type { EnforcementPreview } from "@repo/backend/client";
import type { FeeReport } from "./feeReport.ts";
import { type AdminProject, adminProjectsOf, type Enforcement, type ListedProject } from "./projects.ts";
import type { EvidenceRunView } from "./EvidenceRunCard.tsx";
import type { Assessment, Exemption } from "./vetting.ts";

export const engineManifest = {
  schemaVersion: "1",
  id: "engine",
  slug: "engine",
  name: "Engine",
  status: "active",
  listingTier: "community",
  headline: "A fast engine for building open-source things.",
  description: "A fast engine for building open-source things, kept small and tested.",
  contribution: { approvedScope: "Merged pull requests that fix a reproduced bug.", contributionGuide: "", supportedTasks: "", requiredTests: "", reviewExpectations: "", securityContact: "", closurePolicy: "", maintainerNotes: "" },
  repositories: [{ id: "octo-org/engine", githubUrl: "https://github.com/octo-org/engine" }],
  reward: { kind: "monthly-pool", chain: "base", currency: "USDC", monthlyCapMinor: "1500000000" },
  rewardAsset: { network: "base", kind: "stablecoin", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6, verifiedAt: "2026-10-01T12:00:00.000Z" },
  skill: { id: "contribute-to-engine", sourcePath: "skills/project-contributor-template" },
  reviewSkill: { id: "review-engine-contributions", sourcePath: "skills/project-reviewer-template" },
};

export const clearEnforcement: Enforcement = {
  state: "clear",
  appeal: "none",
  projectAppeal: "none",
  since: null,
  restrictedBy: [],
  nextSequence: 1,
  revisionPending: false,
  moderation: "moderator",
  decisionRequired: false,
  bannedMaintainers: [],
  records: [],
};

export const decisionEnforcement: Enforcement = {
  ...clearEnforcement,
  state: "quarantined",
  since: "2026-11-10T09:30:00.000Z",
  nextSequence: 2,
  decisionRequired: true,
  revisionPending: true,
  restrictedBy: [{ githubId: "501", githubLogin: "octo-reviewer" }],
  records: [
    {
      id: "enf-1",
      projectId: "engine",
      sequence: 1,
      action: "quarantine",
      stateAfter: "quarantined",
      appealAfter: "none",
      reason: "The admission scan confirmed a credential stealer in the install script.",
      evidenceReference: "https://github.com/octo-org/engine/security/advisories/GHSA-0000",
      repositoryGithubId: "4242",
      repositoryKeys: ["4242"],
      actor: null,
      actorRole: "service",
      decisionSource: "vetting",
      beforeRevision: 3,
      beforeManifestSha256: "a".repeat(64),
      afterRevision: null,
      afterManifestSha256: null,
      result: "revision_pending",
      createdAt: "2026-11-10T09:30:00.000Z",
    },
  ],
};

const listed = (enforcement: Enforcement, manifest: Record<string, unknown> = engineManifest): ListedProject => ({
  id: "engine",
  status: "active",
  revision: 3,
  manifestSha256: "b".repeat(64),
  createdAt: "2026-10-01T12:00:00.000Z",
  updatedAt: "2026-11-01T12:00:00.000Z",
  sourceApplicationId: null,
  referrer: null,
  manifest,
  enforcement,
});

const projectsOf = (rows: ReadonlyArray<ListedProject>): ReadonlyArray<AdminProject> => adminProjectsOf(rows) ?? [];

export const projects: ReadonlyArray<AdminProject> = projectsOf([
  listed(clearEnforcement),
  { ...listed(decisionEnforcement, { ...engineManifest, id: "forge", slug: "forge", name: "Forge", repositories: [{ id: "octo-org/forge" }] }), id: "forge" },
  { ...listed(clearEnforcement, { ...engineManifest, id: "docs", slug: "docs", name: "Docs", repositories: [{ id: "octo-org/docs" }] }), id: "docs", status: "paused" },
]);

export const preview: EnforcementPreview = {
  projectId: "forge",
  projectName: "Forge",
  action: "ban",
  sequence: 2,
  stateBefore: "quarantined",
  stateAfter: "banned",
  appealBefore: "none",
  appealAfter: "none",
  result: "revision_appended",
  pendingReason: null,
  maintainerBans: [{ githubId: "777", githubLogin: "forge-owner" }],
  accountReinstatements: [],
  revision: { before: 3, after: 4, statusBefore: "active", statusAfter: "paused", listingTierBefore: "community", listingTierAfter: "retired" },
};

export const feeReport: FeeReport = {
  schemaVersion: "1",
  recent: [],
  routes: [
    { network: "base", targetToken: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", status: "usdc" },
    { network: "ethereum", targetToken: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", status: "usdc" },
    { network: "robinhood", targetToken: null, status: "not_converted" },
  ],
  totals: [{ network: "base", token: "0x4200000000000000000000000000000000000006", targetToken: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", conversions: 2, amountIn: "1000000000000000000", amountOut: "3150250000" }],
  last24Hours: [],
  buyback: { recent: [], totals: [] },
};

export const assessment: Assessment = {
  id: "assess-1",
  projectId: "engine",
  revision: 3,
  state: "incomplete",
  commitSha: "c".repeat(40),
  templateSha256: "d".repeat(64),
  manifestSha256: "b".repeat(64),
  policyVersion: "slop-scan-2026-11",
  requestedAt: "2026-11-02T08:00:00.000Z",
  completedAt: "2026-11-02T08:20:00.000Z",
  modelRuns: [{ reviewer: "primary", provider: "anthropic", model: "claude" }],
  artifacts: 2,
  heldArtifacts: 1,
  requestedBy: { githubId: "1", githubLogin: "slop-admin" },
  requestReason: "Investigate the new install script.",
  resultSha256: "e".repeat(64),
  signingKeySha256: "f".repeat(64),
  result: {
    scan: { runId: "run-1" },
    reusedAssessmentId: null,
    coverage: { sourceFiles: { state: "complete", items: 120 }, binaries: { state: "partial", items: 2 } },
    checks: { credentialTheft: "flagged", persistence: "passed" },
    visibilityGaps: ["primary:binaries:partial"],
    artifacts: [{ sha256: "1".repeat(64), path: "bin/install", type: "executable", state: "held", analysis: "sandboxed" }],
    findings: [{ severity: "high", category: "credentialTheft", summary: "Reads the npm token and posts it to a remote host." }],
    confirmation: null,
  },
};

export const exemption: Exemption = {
  id: "exempt-1",
  kind: "owner-approved-admission",
  projectId: "engine",
  revision: 3,
  manifestSha256: "b".repeat(64),
  repositoryId: "4242",
  repositoryNodeId: "R_kgDOengine",
  stewardId: "1001",
  stewardNodeId: "U_kgDOsteward",
  grantedBy: { githubId: "1", githubLogin: "slop-admin" },
  grantedAt: "2026-11-03T10:00:00.000Z",
  reason: "The owner approved admission after a manual review.",
  decisionReference: "https://github.com/SlopDotCash/slopdotcash/issues/1",
  revokedAt: null,
  revokedBy: null,
  revocationReason: null,
  revocationDecisionReference: null,
};

export const evidenceRun: EvidenceRunView = {
  assembly: { retained: true, state: "closed", scanReady: false, reason: "Runtime image and toolchain pins are not retained here." },
  assessmentId: "assess-1",
  runId: "run-1",
  traceSha256: "2".repeat(64),
  manifestSha256: "3".repeat(64),
  createdAt: "2026-11-02T08:20:00.000Z",
  expiresAt: null,
  permanentAdmissionEvidence: false,
  policy: { version: "slop-scanner-evidence-2026-10-28" },
  objects: [
    { sha256: "4".repeat(64), sizeBytes: 2048, kind: "report", label: "Scan report", contentType: "application/json", streamed: false, state: "stored-unverified" },
    { sha256: "5".repeat(64), sizeBytes: 5_242_880, kind: "artifact", label: "Held binary", contentType: "application/octet-stream", streamed: true, state: "expired" },
  ],
};

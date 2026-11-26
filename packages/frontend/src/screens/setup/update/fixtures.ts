// spec/backend/projects.md, "Owner revisions publish at once against the expected revision"; spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
import type { RevisionChanges } from "@repo/backend/owner/classify";
import type { IntegrationBranchChoice, StoredRepository } from "../../../flows/projects/github.vibe";
import type { ChangeRow } from "./revision.ts";

export const manifest = {
  schemaVersion: "1",
  id: "engine",
  slug: "engine",
  name: "engine",
  status: "active",
  headline: "A fast engine for building open-source things.",
  description: "A fast engine for building open-source things, kept small and tested.",
  slopbot: { automaticClosure: true },
  links: { repository: "https://github.com/octo-org/engine", issues: "https://github.com/octo-org/engine/issues", website: "https://ntwrk.party" },
  contribution: { approvedScope: "Merged pull requests that fix a reproduced bug.", contributionGuide: "", supportedTasks: "", requiredTests: "", reviewExpectations: "", securityContact: "", closurePolicy: "", maintainerNotes: "" },
  authority: { repositoryId: "1296269", repositoryNodeId: "MDEwOlJlcG9zaXRvcnkxMjk2MjY5" },
  repositories: [{ id: "octo-org/engine", githubUrl: "https://github.com/octo-org/engine", integrationBranch: "main", countsFrom: "2026-10-01T00:00:00.000Z" }],
  reward: { kind: "monthly-pool", chain: "base", currency: "USDC", monthlyCapMinor: "1500000000", monthlyCapDisplay: "$1,500", committedMinor: "0", fundingState: "pledged", paymentMode: "disabled", rewardStartAt: "2026-10-01T00:00:00.000Z" },
  rewardAsset: { network: "base", kind: "stablecoin", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6 },
};

export const promised = { ...manifest, reward: { ...manifest.reward, honorSystem: true } };

export const appended: RevisionChanges = { presentation: [], executable: ["repositories"], financial: [], restricted: [] };

export const mixed: RevisionChanges = { presentation: ["headline"], executable: ["contribution"], financial: ["reward"], restricted: [] };

export const rows: ReadonlyArray<ChangeRow> = [
  { field: "repositories", label: "Repositories", current: "octo-org/engine", proposed: "octo-org/engine, octo-org/engine-docs" },
  { field: "monthly", label: "Monthly funding", current: "1,500 USDC", proposed: "2,000 USDC" },
];

export const promiseRows: ReadonlyArray<ChangeRow> = [
  { field: "slopbot", label: "Auto-close", current: "Not allowed", proposed: "Allowed" },
  { field: "headline", label: "Short description", current: "A fast engine for building open-source things.", proposed: "A faster engine for building open things." },
  { field: "honorSystem", label: "Honor-system promise", current: "Off", proposed: "On" },
];

export const revokedRows: ReadonlyArray<ChangeRow> = [
  { field: "slopbot", label: "Auto-close", current: "Allowed", proposed: "Not allowed" },
  { field: "honorSystem", label: "Honor-system promise", current: "On", proposed: "Off" },
];

export const stored: StoredRepository = { path: "octo-org/engine", numericId: "1296269", nodeId: "MDEwOlJlcG9zaXRvcnkxMjk2MjY5", integrationBranch: "main" };

export const branchChoices: ReadonlyArray<IntegrationBranchChoice> = [
  { name: "release", commitSha: "7638417db6d59f3c431d3e1f261cc637155684cd" },
  { name: "next", commitSha: "6dcb09b5b57875f334f61aebed695e2e4193db5e" },
];

export const configured = {
  ...manifest,
  slopbot: { automaticClosure: true, intakeCap: 40, submissionFee: { enabled: true, amountMinor: "2500000" }, wantedIssues: true },
  security: { reportDeposit: false },
  reward: { ...manifest.reward, maintainerShare: 1000, maintainerShareHistory: [{ throughCycle: "2026-10", basisPoints: 0 }] },
};

export const settingsRows: ReadonlyArray<ChangeRow> = [
  { field: "intakeCap", label: "Pause new contributors", current: "Off", proposed: "At 40 open outside pull requests" },
  { field: "submissionFee", label: "Submission fee", current: "Off", proposed: "On: 2.5 USDC or USDG" },
  { field: "wantedIssues", label: "Wanted issues", current: "Off", proposed: "On: slop-wanted" },
  { field: "reportDeposit", label: "Report deposit", current: "On", proposed: "Off" },
  { field: "maintainerShare", label: "Maintainer share", current: "None", proposed: "10%" },
];

export const branchRows: ReadonlyArray<ChangeRow> = [{ field: "integrationBranch", label: "Integration branch", current: "main", proposed: "release" }];

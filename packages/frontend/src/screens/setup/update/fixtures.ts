// spec/backend/projects.md, "Owner revisions publish at once against the expected revision"
import type { RevisionChanges } from "@repo/backend/owner/classify";
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
  contribution: { approvedScope: "Merged pull requests that fix a reproduced bug.", contributionGuide: "", supportedTasks: "", requiredTests: "", reviewExpectations: "", securityContact: "", closurePolicy: "", maintainerNotes: "" },
  repositories: [{ id: "octo-org/engine", githubUrl: "https://github.com/octo-org/engine", countsFrom: "2026-10-01T00:00:00.000Z" }],
  reward: { kind: "monthly-pool", chain: "base", currency: "USDC", monthlyCapMinor: "1500000000", monthlyCapDisplay: "$1,500", committedMinor: "0", fundingState: "pledged", paymentMode: "disabled", rewardStartAt: "2026-10-01T00:00:00.000Z" },
  rewardAsset: { network: "base", kind: "stablecoin", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6 },
};

export const appended: RevisionChanges = { presentation: [], executable: ["repositories"], financial: [], restricted: [] };

export const mixed: RevisionChanges = { presentation: ["headline"], executable: ["contribution"], financial: ["reward"], restricted: [] };

export const rows: ReadonlyArray<ChangeRow> = [
  { label: "Repositories", current: "octo-org/engine", proposed: "octo-org/engine, octo-org/engine-docs" },
  { label: "Monthly funding", current: "1,500 USDC", proposed: "2,000 USDC" },
];

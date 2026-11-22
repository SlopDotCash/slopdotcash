// spec/backend/projects.md, "Owner revisions publish at once against the expected revision"; spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
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
  links: { repository: "https://github.com/octo-org/engine", issues: "https://github.com/octo-org/engine/issues", website: "https://ntwrk.party" },
  contribution: { approvedScope: "Merged pull requests that fix a reproduced bug.", contributionGuide: "", supportedTasks: "", requiredTests: "", reviewExpectations: "", securityContact: "", closurePolicy: "", maintainerNotes: "" },
  repositories: [{ id: "octo-org/engine", githubUrl: "https://github.com/octo-org/engine", countsFrom: "2026-10-01T00:00:00.000Z" }],
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

// spec/frontend/presentation.md, "Setup readiness shows authority, Slopbot, security and funding separately"
import type { SetupStatus } from "@repo/backend/client";
import type { ClearanceView } from "../../../projections/clearance.ts";

const checkedAt = "2026-11-17T12:00:00.000Z";

export const ready: SetupStatus = {
  projectId: "engine",
  name: "engine",
  slug: "engine",
  revision: 3,
  status: "active",
  state: "ready",
  nextAction: { kind: "none", message: "Contributors can find this project and its skills.", href: null },
  checks: {
    authority: { state: "verified", message: "octocat can administer octo-org/engine." },
    installation: { state: "installed", message: "Slopbot is installed on octo-org/engine." },
    scan: { state: "cleared", message: "Repository admission passed at revision 2." },
  },
  funding: { mode: "monthly", network: "base", symbol: "USDC", monthlyAmountMinor: "1500000000", decimals: 6 },
  activatedRevision: 3,
  checkedAt,
};

export const installNeeded: SetupStatus = {
  ...ready,
  status: "paused",
  state: "action_required",
  nextAction: { kind: "install_slopbot", message: "Slopbot is not installed on octo-org/engine. Install it to continue. It is free.", href: "https://github.com/apps/slopbot/installations/new" },
  checks: { ...ready.checks, installation: { state: "missing", message: "Slopbot is not installed on octo-org/engine." } },
  funding: { mode: "none" },
  activatedRevision: null,
};

export const ownerApproved: SetupStatus = {
  ...ready,
  status: "paused",
  state: "action_required",
  nextAction: { kind: "activate_project", message: "Owner-approved admission exemption. No passed scan is claimed. Your edit kept the project paused. Check again to activate it.", href: null },
  checks: { ...ready.checks, scan: { state: "cleared", exempt: true, exemptionKind: "owner-approved-admission", message: "Owner-approved admission exemption. No passed scan is claimed." } },
  activatedRevision: null,
};

export const unavailable: SetupStatus = {
  ...ready,
  status: "paused",
  state: "retry",
  nextAction: { kind: "retry_authority", message: "GitHub did not answer. Check again later.", href: null },
  checks: { ...ready.checks, authority: { state: "retry", message: "GitHub did not answer. Check again later." } },
  activatedRevision: null,
};

export const quarantined: SetupStatus = {
  ...ready,
  status: "paused",
  state: "action_required",
  nextAction: { kind: "request_scan", message: "The last scan could not finish, so it did not clear the project. Fix the cause if you know it, then request a new scan.", href: null },
  checks: { ...ready.checks, scan: { state: "quarantined", message: "The last scan could not finish, so it did not clear the project." } },
  funding: { mode: "bounty", network: "base", symbol: "USDC", awardAmountMinor: "2000000000", decimals: 6, state: "pledged" },
  activatedRevision: null,
};

export const incomplete: ClearanceView = {
  checks: [
    { tone: "danger", icon: "fail", label: "Secret exfiltration flagged · 2 high" },
    { tone: "neutral", icon: "skip", label: "Dependency confusion not run" },
  ],
  coverage: [{ tone: "warning", icon: "held", label: "1 artifact held" }],
  review: [{ tone: "success", icon: "pass", label: "Primary: clear" }],
};

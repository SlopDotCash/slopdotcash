// spec/backend/projects.md, "Administrators hold, delist, change the steward or place a project"; spec/frontend/navigation.md, "Administration sections and project selection are parameters of the one Administration page"; spec/security/enforcement.md, "A moderator quarantines a clear project or bans it, and decides a service ban"; spec/fees/feeReport.md, "The report shows the latest 100 rows, finalized live totals per token as decimal strings, 24-hour state counts and each network's target"
import { vectors } from "../../kernels/vectors.ts";
import { builtManifest, changedFields, editorMessages, initialDraft, type ManifestDraft, withProjectField } from "./editor.ts";
import { availableActions } from "./enforcement.ts";
import { networkConversions, wellFormedReport } from "./feeReport.ts";
import { clearEnforcement, decisionEnforcement, feeReport, projects } from "./fixtures.ts";
import { adminAddressOf } from "./projects.ts";

const engine = projects.find((project) => project.id === "engine");
const edited = (change: (draft: ManifestDraft) => ManifestDraft) => {
  if (engine === undefined) return "no fixture";
  const built = builtManifest(engine, change(initialDraft(engine, undefined)));
  return built.kind === "invalid" ? built.message : changedFields(engine.raw, built.manifest);
};

export const addressesOpenTheirAdministrationView = vectors<string, readonly [string | null, string]>(
  [
    ["/admin", [null, "AdminOverview"]],
    ["/admin?section=fees", [null, "AdminFees"]],
    ["/admin?project=engine&section=fees", ["engine", "AdminOverview"]],
    ["/admin?project=engine&section=settings", ["engine", "AdminSettings"]],
    ["/admin?project=engine#admin-vetting", ["engine", "AdminSecurity"]],
    ["/admin?project=engine&section=overview", ["engine", "AdminOverview"]],
    ["/admin?section=constructor", [null, "AdminOverview"]],
  ],
  (address) => {
    const { project, view } = adminAddressOf(address);
    return [project, view] as const;
  },
);

export const theEditorChangesOnlyWhatTheAdministratorChanged = vectors<string, unknown>(
  [
    ["untouched", []],
    ["status", ["status"]],
    ["featured", ["listingTier"]],
    ["controlled", editorMessages.controlledKeys],
    ["broken", editorMessages.notObject],
    ["scope", editorMessages.skillIncomplete],
    ["cleared skill", []],
    ["native coin", ["reward", "rewardAsset"]],
    ["unselected native coin", []],
  ],
  (name) =>
    edited((draft) => {
      const fields = JSON.parse(draft.text) as Record<string, unknown>;
      switch (name) {
        case "status":
          return { ...draft, status: "paused" };
        case "featured":
          return { ...draft, text: withProjectField(fields, "listingTier", "featured") };
        case "controlled":
          return { ...draft, text: withProjectField(fields, "status", "paused") };
        case "broken":
          return { ...draft, text: "[1]" };
        case "scope":
          return { ...draft, skill: { ...draft.skill, approvedScope: "abc" } };
        case "cleared skill":
          return { ...draft, skill: { ...draft.skill, approvedScope: "  Merged pull requests that fix a reproduced bug.  " } };
        case "native coin":
          return { ...draft, asset: { network: "base", kind: "native", address: "0x0000000000000000000000000000000000000000", symbol: "ETH" } };
        case "unselected native coin":
          return { ...draft, assetSelected: false, asset: { network: "base", kind: "native", address: "0x0000000000000000000000000000000000000000", symbol: "ETH" } };
        default:
          return draft;
      }
    }),
);

export const moderatorsSeeOnlyTheActionsTheRestrictionAllows = vectors<string, ReadonlyArray<string>>(
  [
    ["clear", ["quarantine", "ban"]],
    ["decision", ["ban", "request_reinstatement"]],
    ["appealed decision", ["ban", "reinstate"]],
    ["banned with an account appeal", ["reinstate_accounts", "request_reinstatement", "deny_reinstatement"]],
  ],
  (name) => {
    switch (name) {
      case "clear":
        return availableActions(clearEnforcement);
      case "decision":
        return availableActions(decisionEnforcement);
      case "appealed decision":
        return availableActions({ ...decisionEnforcement, projectAppeal: "requested" });
      default:
        return availableActions({ ...clearEnforcement, state: "banned", appeal: "requested", bannedMaintainers: [{ githubId: "777", githubLogin: "forge-owner" }] });
    }
  },
);

export const feeTotalsShowExactAmountsAndRobinhoodIsNotConverted = vectors<string, unknown>(
  [
    ["report", [["Base", "USDC", ["2 conversions: 1000000000000000000 base units of token 0x4200000000000000000000000000000000000006 to 3,150.25 USDC"], false], ["Ethereum", "USDC", [], true], ["Robinhood Chain", "Not converted", [], false]]],
    ["negative count", false],
    ["leading zero", false],
  ],
  (name) => {
    const [total] = feeReport.totals;
    if (name === "negative count" && total) return wellFormedReport({ ...feeReport, totals: [{ ...total, conversions: 0 }] });
    if (name === "leading zero" && total) return wellFormedReport({ ...feeReport, totals: [{ ...total, amountIn: "01" }] });
    return networkConversions(feeReport).map((network) => [network.name, network.target, network.lines, network.none]);
  },
);

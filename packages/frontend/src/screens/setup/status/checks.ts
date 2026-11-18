// spec/ui/status.md, "Setup checks never look ready unless they are"; spec/frontend/presentation.md, "Setup readiness shows authority, Slopbot, security and funding separately"; spec/security/enforcement.md, "Each repository clears on its own admission, exemption or retained clean scan"
import type { NextAction, ScanCheckState, SetupCheckState, SetupStatus } from "@repo/backend/client";
import { isChain } from "@repo/settlement/kernels/networks";
import type { StatusProps } from "@repo/ui";
import type { SetupStatus as Readiness } from "../../../../gen/frontend__presentation.ts";
import { type AssetKind, assetSymbol } from "../../../kernels/assetText.ts";
import { rewardChains, rewardNetwork } from "../fields/rewardAsset.ts";
import { baseUnits } from "../update/revision.ts";

export const setupStates = {
  ready: { tone: "Positive", icon: "Check", label: "Ready" },
  action_required: { tone: "Caution", icon: "Alert", label: "Action needed" },
  waiting: { tone: "Notice", icon: "Clock", label: "Scanning" },
  retry: { tone: "Caution", icon: "Alert", label: "Unavailable" },
  restricted: { tone: "Negative", icon: "Lock", label: "Closed" },
} as const satisfies Record<SetupStatus["state"], StatusProps["presentation"]>;

export const exemptionLabels = {
  "existing-project": "Exempt",
  "owner-approved-admission": "Owner-approved exemption",
} as const satisfies Record<NonNullable<ScanCheckState["exemptionKind"]>, string>;

/** @throws {never} */
export function authorityReadiness({ state }: SetupCheckState): Readiness {
  return state === "verified" ? "SetupReady" : state === "denied" ? "SetupRefused" : "SetupUnavailable";
}

/** @throws {never} */
export function installationReadiness({ state }: SetupCheckState): Readiness {
  if (state === "installed") return "SetupReady";
  if (state === "missing") return "SetupMissing";
  return state === "suspended" ? "SetupRefused" : "SetupUnavailable";
}

/** An exemption clears like a scan but is never called one. @throws {never} */
export function scanReadiness({ state }: ScanCheckState): Readiness {
  if (state === "cleared") return "SetupReady";
  if (state === "queued") return "SetupChecking";
  if (state === "unscanned" || state === "stale") return "SetupMissing";
  return state === "quarantined" || state === "banned" ? "SetupRefused" : "SetupUnavailable";
}

/** The exemption that cleared the scan check, by its own name, never as a passed scan. @throws {never} */
export function scanExemption(scan: ScanCheckState): string | undefined {
  if (scan.exempt !== true) return undefined;
  return scan.exemptionKind === undefined ? exemptionLabels["existing-project"] : exemptionLabels[scan.exemptionKind];
}

/** Whether checking again can change what the next action asks. @throws {never} */
export function checksAgain({ kind }: NextAction): boolean {
  return kind !== "none" && kind !== "restricted" && kind !== "complete_skill_fields";
}

function kindOf(network: string | null | undefined, symbol: string): AssetKind {
  const chains = network !== null && network !== undefined && isChain(network) ? [network] : rewardChains.map(([chain]) => chain);
  const coins = chains.map((chain) => rewardNetwork(chain)).filter((coin) => coin !== undefined);
  if (coins.some((coin) => coin.native.symbol === symbol)) return "native";
  return coins.some((coin) => coin.stablecoin.symbol === symbol) ? "stablecoin" : "token";
}

/** An exact amount in its asset's decimals with its ticker. @throws {never} */
export function fundingAmount(minor: string, decimals: number, symbol: string, network: string | null | undefined): string {
  return `${baseUnits(minor, decimals) ?? minor} ${assetSymbol({ kind: kindOf(network, symbol), symbol }) ?? symbol}`;
}

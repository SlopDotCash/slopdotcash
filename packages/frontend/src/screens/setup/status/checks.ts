// spec/ui/status.md, "Setup checks never look ready unless they are"; spec/frontend/presentation.md, "Setup readiness shows authority, Slopbot, security and funding separately"; spec/security/enforcement.md, "Each repository clears on its own admission, exemption or retained clean scan"
import type { NextAction, ScanCheckState, SetupCheckState, SetupStatus } from "@repo/backend/client";
import { isChain } from "@repo/settlement/kernels/networks";
import type { SetupStatus as Readiness } from "../../../../gen/frontend__presentation.ts";
import { type AssetKind, assetSymbol } from "../../../kernels/assetText.ts";
import { rewardChains, rewardNetwork } from "../fields/rewardAsset.ts";
import { baseUnits } from "../update/revision.ts";

export const setupHeadings: Readonly<Record<SetupStatus["state"], string>> = {
  ready: "Ready",
  action_required: "Action needed",
  waiting: "Waiting for the security scan",
  retry: "Unavailable",
  restricted: "Closed to contributors",
};

export const exemptionLabels = {
  "existing-project": "Existing-project exemption",
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

/** What the scan check found: the exemption by its own name, otherwise the check's message. @throws {never} */
export function scanFinding(scan: ScanCheckState): string {
  return scan.exempt === true ? (scan.exemptionKind === undefined ? scan.message : exemptionLabels[scan.exemptionKind]) : scan.message;
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

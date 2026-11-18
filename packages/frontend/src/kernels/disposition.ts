// spec/settlement/contributorAllocation.md, "An unpublished distribution exposes no recipient row"; spec/settlement/contributorAllocation.md, "A timely first wallet confirmation survives replacement"; spec/frontend/projections.md, "Award, funding and settlement status are independent facts"
import type { StatusProps } from "@repo/ui";

export type AllocationPhase = "AwaitingWallet" | "Scheduled" | "Sent" | "Unclaimed";

export interface AllocationFacts {
  readonly recordedTransfer: boolean;
  readonly closed: boolean;
  readonly registeredWallet: boolean;
  readonly beforeDeadline: boolean;
}

export interface AllocationWallet {
  readonly chain: string;
  readonly authorized: boolean;
  readonly firstAuthorizedAtMs?: number;
}

export interface AllocationDisplay {
  readonly presentation: StatusProps["presentation"];
}

export const allocationDisplays = Object.freeze({
  Sent: { presentation: { tone: "Positive", icon: "Check", label: "Sent" } },
  Scheduled: { presentation: { tone: "Neutral", icon: "Clock", label: "Scheduled" } },
  AwaitingWallet: { presentation: { tone: "Caution", icon: "Wallet", label: "Awaiting wallet" } },
  Unclaimed: { presentation: { tone: "Neutral", icon: "Alert", label: "Unclaimed" } },
} as const satisfies Record<AllocationPhase, AllocationDisplay>);

/** @throws {never} */
export function allocationPhase({ recordedTransfer, closed, registeredWallet, beforeDeadline }: AllocationFacts): AllocationPhase {
  if (recordedTransfer) return "Sent";
  if (closed) return "Unclaimed";
  if (registeredWallet) return "Scheduled";
  return beforeDeadline ? "AwaitingWallet" : "Unclaimed";
}

/** @throws {never} */
export function walletRegisteredInTime(wallets: ReadonlyArray<AllocationWallet>, chain: string, closesAtMs: number): boolean {
  return wallets.some((wallet) => wallet.chain === chain && wallet.authorized && wallet.firstAuthorizedAtMs !== undefined && wallet.firstAuthorizedAtMs < closesAtMs);
}

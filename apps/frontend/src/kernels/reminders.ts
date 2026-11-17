// spec/frontend/views.md, "A cycle reminds viewers to check funding from seven days before close only for an unsettled monthly pool with a non-zero cap"
import { fundingReminderVisible, type ReminderLifecycle } from "../../gen/frontend__views.ts";

export type CycleState = "closed-no-awards" | "external-provisional" | "live" | "paid" | "payment-ready" | "review" | "settlement-planned" | "wound-up";

export type CycleRewardKind = "external-prize-share" | "monthly-pool";

export interface CycleReminder {
  readonly kind: "funding-check";
  readonly message: string;
}

const lifecycles = {
  "closed-no-awards": "ClosedNoAwards",
  "external-provisional": "ExternalProvisional",
  live: "LiveCycle",
  paid: "PaidCycle",
  "payment-ready": "PaymentReady",
  review: "InReview",
  "settlement-planned": "SettlementPlanned",
  "wound-up": "WoundUp",
} as const satisfies Record<CycleState, ReminderLifecycle>;

export const fundingCheck: CycleReminder = Object.freeze({ kind: "funding-check", message: "This record does not verify the month's funding status." });

/** @throws {never} */
export function cycleSettlementReminder({ closesAtMs, capMinor, kind, nowMs, settled, state }: {
  closesAtMs: number;
  capMinor: bigint;
  kind: CycleRewardKind;
  nowMs: number;
  settled: boolean;
  state: CycleState;
}): CycleReminder | undefined {
  const visible = fundingReminderVisible({
    monthlyPool: kind === "monthly-pool",
    settled,
    lifecycle: lifecycles[state],
    msSinceClose: nowMs - closesAtMs,
    capPositive: capMinor > 0n,
  });
  return visible ? fundingCheck : undefined;
}

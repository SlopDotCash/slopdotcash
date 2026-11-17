// spec/frontend/views.md, "A cycle reminds viewers to check funding from seven days before close only for an unsettled monthly pool with a non-zero cap"
import { type CycleReminder, type CycleRewardKind, type CycleState, cycleSettlementReminder, fundingCheck } from "./reminders.ts";
import { vectors } from "./vectors.ts";

const closesAtMs = Date.parse("2026-12-01T00:00:00Z");
const week = 604_800_000;

interface Reminder {
  readonly kind?: CycleRewardKind;
  readonly state?: CycleState;
  readonly settled?: boolean;
  readonly capMinor?: bigint;
  readonly before: number;
}

export const fundingRemindersOpenInTheLastWeekOfAnUnsettledPool = vectors<Reminder, CycleReminder | undefined>([
  [{ before: week }, fundingCheck],
  [{ before: week + 1 }, undefined],
  [{ before: -week }, fundingCheck],
  [{ before: 0, state: "review" }, fundingCheck],
  [{ before: 0, state: "payment-ready" }, fundingCheck],
  [{ before: 0, state: "settlement-planned" }, fundingCheck],
  [{ before: 0, state: "paid" }, undefined],
  [{ before: 0, state: "wound-up" }, undefined],
  [{ before: 0, state: "closed-no-awards" }, undefined],
  [{ before: 0, state: "external-provisional" }, undefined],
  [{ before: 0, settled: true }, undefined],
  [{ before: 0, capMinor: 0n }, undefined],
  [{ before: 0, kind: "external-prize-share" }, undefined],
], ({ kind = "monthly-pool", state = "live", settled = false, capMinor = 250_000_000n, before }) =>
  cycleSettlementReminder({ closesAtMs, capMinor, kind, nowMs: closesAtMs - before, settled, state }));

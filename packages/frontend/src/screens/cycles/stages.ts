// spec/frontend/views.md, "A cycle reminds viewers to check funding from seven days before close only for an unsettled monthly pool with a non-zero cap"; spec/settlement/monthly.md, "The owner may finalize early; the coordinator freezes at the cutoff unless the default is off"
import type { CycleIndexEntry } from "@repo/settlement/client";
import { parseBaseUnits } from "@repo/settlement/kernels/amounts";
import { automaticCutoffAt, type Period } from "@repo/settlement/kernels/calendar";
import { fundingReminderVisible, type ReminderLifecycle } from "../../../gen/frontend__views.ts";
import { formatDateTime } from "../../app/format.ts";
import type { ProjectCycleView } from "../../projections/projectView.ts";
import { formatDate } from "../projects/index.ts";
import { awaitingApproval } from "./labels.ts";

export type Lifecycle = CycleIndexEntry["state"] | "live" | "closed";

export interface CycleFacts {
  readonly record: CycleIndexEntry | undefined;
  readonly view: ProjectCycleView | undefined;
  readonly period: Period;
  readonly capMinor: bigint;
  readonly from: string;
  readonly to: string;
  readonly nowMs: number;
}

export interface Stage {
  readonly label: string;
  readonly description: string;
}

const lifecycles: Readonly<Record<CycleIndexEntry["state"], ReminderLifecycle>> = {
  "closed-no-awards": "ClosedNoAwards",
  "external-provisional": "ExternalProvisional",
  paid: "PaidCycle",
  "payment-ready": "PaymentReady",
  review: "InReview",
  "settlement-planned": "SettlementPlanned",
  "wound-up": "WoundUp",
};

/** The recorded state, or the live view's. @throws {never} */
export function lifecycleOf({ record, view }: Pick<CycleFacts, "record" | "view">): Lifecycle {
  return record?.state ?? (view?.cycle.status === "live" ? "live" : "closed");
}

/** The funding reminder, shown from seven days before close only for an unsettled monthly pool with a non-zero cap. @throws {never} */
export function reminderShown({ record, view, capMinor, to, nowMs }: CycleFacts): boolean {
  const monthlyPool = (record?.kind ?? (view?.kind === "external-prize-share" ? "external-prize-share" : "monthly-pool")) === "monthly-pool";
  const lifecycle: ReminderLifecycle = record ? lifecycles[record.state] : view?.cycle.status === "live" ? "LiveCycle" : "InReview";
  const cap = record ? (parseBaseUnits(record.reward.capMinor) ?? 0n) : capMinor;
  return fundingReminderVisible({ monthlyPool, settled: (record?.settledAt ?? null) !== null, lifecycle, msSinceClose: nowMs - Date.parse(to), capPositive: cap > 0n });
}

/** The owner's monthly cutoff in milliseconds, for months from the first automatic period. @throws {never} */
export function ownerCutoffMs(period: Period): number | undefined {
  const seconds = automaticCutoffAt(period);
  return seconds === undefined ? undefined : seconds * 1000;
}

/** Contribution, owner changes (or review before the monthly cutoff began), approval and payment, and which of them is current. @throws {never} */
export function stagesOf(facts: CycleFacts): { readonly stages: ReadonlyArray<Stage>; readonly current: number } {
  const { record, from, to, period, nowMs } = facts;
  const reviewClosed = record ? awaitingApproval(record, nowMs) : false;
  const cutoff = ownerCutoffMs(period);
  const lifecycle = lifecycleOf(facts);
  const current = record?.state === "paid" || record?.state === "settlement-planned" ? 3 : record?.state === "payment-ready" || reviewClosed ? 2 : lifecycle === "live" ? 0 : 1;
  const second: Stage =
    cutoff !== undefined
      ? { label: "Owner changes", description: `${cutoff <= nowMs ? "Closed" : "Closes"} ${formatDateTime(new Date(cutoff).toISOString())}` }
      : { label: "Review", description: record?.reviewEndsAt ? `${reviewClosed ? "Ended" : "Ends"} ${formatDate(record.reviewEndsAt)}` : "—" };
  return {
    current,
    stages: [
      { label: "Contribution", description: `${formatDate(from)}–${formatDate(to)}` },
      second,
      { label: "Approval", description: record?.approvedAt ? `Approved ${formatDate(record.approvedAt)}` : reviewClosed ? "Awaiting owner" : "—" },
      { label: "Payment", description: record?.settledAt ? `Paid ${formatDate(record.settledAt)}` : record?.state === "settlement-planned" ? "Ready" : "Unverified" },
    ],
  };
}

/** The words for a record that ends without an ordinary payment; a cycle closed without awards has only its status. @throws {never} */
export function terminalMessage(record: CycleIndexEntry | undefined): string | undefined {
  if (record?.kind === "external-prize-share") return "External prize · not paid by Slop";
  if (record?.state === "wound-up") return "Vault returned · awards unfunded";
  return undefined;
}

/** A terminal cycle has no stage progress; its status names its state. @throws {never} */
export function cycleTerminal(record: CycleIndexEntry | undefined): boolean {
  return terminalMessage(record) !== undefined || record?.state === "closed-no-awards";
}

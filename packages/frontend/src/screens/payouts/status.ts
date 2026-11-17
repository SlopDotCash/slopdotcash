// spec/frontend/projections.md, "Award, funding and settlement status are independent facts"; spec/ui/status.md, "Payment states keep award, funding and settlement apart"
import type { AccountMonthlyAward, AccountPayment, AllocationState, UnreservedAwardState } from "@repo/settlement/client";
import { paymentPresentation, type StatusProps } from "@repo/ui";
import { type AwardFacts, settlementDisplay } from "../../../gen/frontend__projections.ts";

export type Presentation = StatusProps["presentation"];

const approved: AwardFacts = { decision: "ApprovedAward", funding: "Funded", wallet: true, scheduled: false, held: false, submitted: false, exactFinality: false };

const unreserved: Readonly<Record<UnreservedAwardState, AwardFacts>> = {
  underfunded: { ...approved, funding: "Underfunded" },
  "awaiting-reservation": approved,
  conflict: { ...approved, held: true },
};

const unreservedTitles: Readonly<Record<UnreservedAwardState, string>> = {
  underfunded: "Approved, underfunded",
  "awaiting-reservation": "Approved, awaiting reservation",
  conflict: "Approved, conflict: cannot be reserved",
};

/** @throws {never} */
export function paymentFacts(payment: Pick<AccountPayment, "deliveryState" | "state" | "transactionId">): AwardFacts {
  const finalized = payment.deliveryState === "paid" && payment.state === "paid" && payment.transactionId !== null && payment.transactionId !== "";
  return {
    ...approved,
    wallet: payment.deliveryState !== "needs_wallet",
    held: payment.deliveryState === "held",
    submitted: payment.deliveryState === "submitted" || (payment.deliveryState === "paid" && !finalized),
    exactFinality: finalized,
  };
}

function presented(facts: AwardFacts): Presentation {
  return paymentPresentation(settlementDisplay(facts));
}

/** @throws {never} */
export function paymentStatus(payment: Pick<AccountPayment, "deliveryState" | "state" | "transactionId">): Presentation {
  return presented(paymentFacts(payment));
}

/** @throws {never} */
export function awardStatus(award: Pick<AccountMonthlyAward, "state">): { readonly presentation: Presentation; readonly title: string } {
  return { presentation: presented(unreserved[award.state]), title: unreservedTitles[award.state] };
}

export const receivedStatus: Presentation = { tone: "Positive", icon: "Check", label: "Received" };

export const allocationStatus: Readonly<Record<AllocationState, Presentation>> = {
  sent: { tone: "Positive", icon: "Check", label: "Sent" },
  scheduled: { tone: "Notice", icon: "Clock", label: "Scheduled" },
  "awaiting-wallet": { tone: "Notice", icon: "Wallet", label: "Awaiting wallet" },
  unclaimed: { tone: "Neutral", icon: "Alert", label: "Unclaimed" },
};

export const allocationTitles: Readonly<Partial<Record<AllocationState, string>>> = {
  scheduled: "Scheduled for the next transfer batch",
};

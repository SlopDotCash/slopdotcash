// spec/security/cases.md, "Current technical approvers and triagers request information on the current report version"; spec/security/cases.md, "An award commits only under paid terms, eligibility and project clearance"; spec/security/cases.md, "An independent moderator upholds or returns the appeal"
import { formatSecurityAmount } from "@repo/security/client";
import type { CaseTerms, SecurityCase } from "./case.schema.ts";

export type ReportFilter = "all" | "review" | "waiting" | "award" | "resolved";

export const reportFilters: ReadonlyArray<readonly [ReportFilter, string]> = [
  ["all", "All reports"],
  ["review", "Needs your review"],
  ["waiting", "Waiting for researcher"],
  ["award", "Award and payment"],
  ["resolved", "Paid or ineligible"],
];

export const receiptLabels: Readonly<Record<string, string>> = {
  received: "Received — waiting for the owner",
  triaging: "Under review",
  "needs-information": "The owner asked for more information",
  confirmed: "Confirmed",
  duplicate: "Duplicate of an earlier report",
  "out-of-scope": "Out of scope",
  rejected: "Not accepted",
  disputed: "Under appeal",
};

const awardLabels: Readonly<Record<string, string>> = {
  "not-applicable": "No paid program was open when this report was received",
  pending: "Award not decided yet",
  ineligible: "No award",
  reserved: "Reserved",
  "capacity-exhausted": "Waiting for the owner's award decision",
  approved: "Approved and reserved",
};

const paymentLabels: Readonly<Record<string, string>> = {
  "not-applicable": "No approved award",
  "rail-unavailable": "Approved, not paid yet",
  "awaiting-owner-commitment": "Waiting for the vault owner",
  "needs-wallet": "Wallet required",
  uncertain: "Submission outcome not yet confirmed",
  ready: "Ready for payment",
  processing: "Payment in progress",
  submitted: "Waiting for finality",
  held: "Payment held",
  paid: "Paid",
};

export const submissionLabels: Readonly<Record<string, string>> = {
  claimed: "Confirming with GitHub",
  verified: "Received by GitHub",
  "link-rejected": "Not confirmed by GitHub",
};

const eventLabels: Readonly<Record<string, string>> = {
  submit: "Reporter submitted privately; GitHub receipt verified",
  "submit-direct": "Reporter linked their GitHub report; GitHub receipt verified",
  claim: "Reporter linked the GitHub report",
  record: "Maintainer recorded the GitHub report",
  "verify-link": "Maintainer verified the GitHub report",
  "reject-link": "Maintainer rejected the link",
  receive: "GitHub receipt verified",
  "receipt-mismatch": "GitHub did not confirm this link",
  "assign-triager": "Triager assigned",
  "revoke-triager": "Triager removed",
  triage: "Triage state changed",
  "next-action": "Next action set",
  "request-information": "Owner asked for information",
  "report-revised": "Reporter revised the report",
  decide: "Finding decided",
  award: "Award decided",
  remediation: "Remediation state changed",
  disclosure: "Disclosure decision recorded",
  recognition: "Recognition choice changed",
  appeal: "Appeal sent",
  "decide-appeal": "Appeal decided",
  "approve-award": "Award approved",
  "consent-payment": "Reporter accepted chain visibility",
  "prepare-payment": "Unsigned payment prepared",
  "verify-payment": "Payment checked",
  "recover-payment": "Payment wallet recovered",
  "decide-related-party": "Related-party award reviewed",
  "reserve-award": "Award reserved with raised capacity",
};

const responseKinds = new Set(["request-information", "decide", "award", "decide-appeal", "decide-related-party", "reject-link"]);

export const relatedPartyLabels: Readonly<Record<string, string>> = {
  "not-applicable": "No related-party review",
  pending: "Waiting for an independent reviewer",
  approved: "Approved by an independent reviewer",
  refused: "Refused by an independent reviewer",
};

export const lossLabels: Readonly<Record<string, string>> = {
  likely: "Likely path to loss of funds",
  unlikely: "No path to loss of funds found",
  unclear: "Loss of funds unclear",
};

export const escalationLabels: Readonly<Record<string, string>> = {
  "private-security-case": "Every private security case goes to a moderator",
  "confidence-below-floor": "Slopbot's confidence is below 0.9",
};

export const receivedAtSourceLabels: Readonly<Record<string, string>> = {
  "github-verified": " (verified from GitHub)",
  "slop-received": " (received privately by Slop)",
  "maintainer-attested": " (maintainer-attested)",
};

/** An exact amount in the case's frozen asset. @throws {never} */
export function money(minor: string, terms: Pick<CaseTerms, "currency" | "decimals" | "asset">): string {
  return formatSecurityAmount(minor, { currency: terms.currency, decimals: terms.decimals, ...(terms.asset ? { asset: terms.asset } : {}) }) ?? minor;
}

/** @throws {never} */
export function caseTitle(record: Pick<SecurityCase, "id" | "advisory">): string {
  return record.advisory?.ghsa ?? `Case ${record.id.slice(-8)}`;
}

/** @throws {never} */
export function awardText(record: SecurityCase): string {
  if (record.award === null || record.terms === null)
    return record.paymentRail === "direct" && record.awardState === "approved" ? "Approved" : (awardLabels[record.awardState] ?? record.awardState);
  const { terms, award } = record;
  const amount = `${money(award.researcherMinor, terms)} to the researcher · ${money(award.slopMinor, terms)} to Slop · ${money(award.grossMinor, terms)} gross`;
  if (record.awardState !== "pending") return amount;
  const waiting =
    record.relatedPartyReview === "pending" ? "Proposed; awaiting independent review" : record.paymentRail === "direct" ? "Selected; awaiting payment approval" : "Selected; awaiting verified funding";
  return `${waiting} · ${amount}`;
}

/** @throws {never} */
export function paymentLabel(record: SecurityCase): string {
  if (record.paymentRail === "direct" && record.settlement?.state === "awaiting-external-payment")
    return (record.settlement.confirmedTransactionIds?.length ?? 0) > 0 ? "Partly paid" : "Ready for external payment";
  if (record.paymentRail === "direct" && record.paymentState === "awaiting-owner-commitment") return "Waiting for the payer";
  return paymentLabels[record.paymentState] ?? record.paymentState;
}

/** @throws {never} */
export function eventLabel(record: SecurityCase, kind: string): string {
  if (kind === "submit" && record.receivedAtSource === "slop-received") return "Reporter submitted privately to Slop";
  return eventLabels[kind] ?? kind;
}

/** The owner's latest words to the reporter, from the case history. @throws {never} */
export function ownerResponse(record: SecurityCase): string | null {
  const event = [...(record.events ?? [])].reverse().find((entry) => responseKinds.has(entry.kind) && entry.reason);
  return event?.reason ?? null;
}

/** Disclosure is offered first once a fix exists or a disclosure decision was recorded. @throws {never} */
export function disclosureRelevant(record: SecurityCase): boolean {
  return ["resolved", "mitigation-verified"].includes(record.remediationState ?? "") || record.disclosureState !== "embargoed";
}

/** @throws {never} */
export function matchesReport(record: SecurityCase, filter: ReportFilter): boolean {
  switch (filter) {
    case "review":
      return record.allowedActions.some((action) => ["decide", "verify-link", "request-information"].includes(action));
    case "waiting":
      return record.receiptState === "needs-information";
    case "award":
      return record.allowedActions.some((action) => ["award", "prepare-payment"].includes(action)) || (record.award !== null && record.paymentState !== "paid");
    case "resolved":
      return record.paymentState === "paid" || ["rejected", "duplicate", "out-of-scope"].includes(record.receiptState ?? "") || record.awardState === "ineligible";
    case "all":
      return true;
    default: {
      const _exhaustive: never = filter;
      return _exhaustive;
    }
  }
}

/** @throws {never} */
export function recoveryMessage(mode: string, payer: boolean, reporter: boolean): string {
  switch (mode) {
    case "wallet-required":
      return reporter ? "Confirm your payout wallet in Settings." : "Waiting for the reporter's verified payout wallet.";
    case "consent-required":
      return reporter ? "Accept payment visibility for this payout wallet." : "Waiting for the reporter to accept payment visibility for this wallet.";
    case "fee-pending":
      return payer ? "Pay and verify the unchanged fee first." : "Waiting for the payer to verify the unchanged fee.";
    case "retirement-required":
      return payer ? "This wallet nonce was used. Verify its failed or cancelled transaction before preparing a replacement." : "Waiting for verification of the previous wallet transaction.";
    case "retirement-unproven":
      return payer ? "Verify any payment already sent. This consumed wallet nonce needs manual review before a replacement." : "The previous wallet transaction needs review.";
    case "payer-review":
      return "The payer wallet needs manual review before recovery. Existing payments can still be verified.";
    case "legacy-manual":
      return "This older payment request requires manual review. Existing transfers can still be verified.";
    case "resume-original":
      return payer ? "Resume the original verified payout wallet." : "Waiting for the payer to resume the original wallet.";
    case "cancellation-required":
      return payer ? "Cancel the old transfer before sending to this wallet." : "Waiting for the payer to cancel the old transfer.";
    case "payment-found":
      return payer ? "An existing payment was found. Verify it before continuing." : "Waiting for verification of an existing payment.";
    case "signature-required":
    case "history-check":
      return payer ? "Check the finalized history of the expired request." : "Waiting for the payer to check the expired request.";
    default:
      return payer ? "Wait for the old transaction to expire, then check payment recovery." : "Waiting for the old transaction to expire.";
  }
}

/** Whether the viewer may pay or verify this case's award. @throws {never} */
export function canPay(record: SecurityCase): boolean {
  return record.viewerRoles.includes("financial") || record.viewerRoles.includes("security-maintainer");
}

// spec/security/cases.md, "Current technical approvers and triagers request information on the current report version"; spec/security/cases.md, "An award commits only under paid terms, eligibility and project clearance"; spec/security/cases.md, "An independent moderator upholds or returns the appeal"
import { formatSecurityAmount } from "@repo/security/client";
import type { StatusProps } from "@repo/ui";
import type { CaseTerms, SecurityCase } from "./case.schema.ts";

export type Presentation = StatusProps["presentation"];

export type Tone = Presentation["tone"];

export type ReportFilter = "all" | "review" | "waiting" | "award" | "resolved";

export const reportFilters: ReadonlyArray<readonly [ReportFilter, string]> = [
  ["all", "All"],
  ["review", "Review"],
  ["waiting", "Waiting"],
  ["award", "Award"],
  ["resolved", "Closed"],
];

const receiptLabels: Readonly<Record<string, string>> = {
  received: "Received",
  triaging: "In review",
  "needs-information": "Info needed",
  confirmed: "Confirmed",
  duplicate: "Duplicate",
  "out-of-scope": "Out of scope",
  rejected: "Rejected",
  disputed: "Appeal",
};

const receiptTones: Readonly<Record<string, Tone>> = {
  "needs-information": "Caution",
  confirmed: "Positive",
  rejected: "Negative",
};

const awardLabels: Readonly<Record<string, string>> = {
  "not-applicable": "No program",
  pending: "Pending",
  ineligible: "None",
  reserved: "Reserved",
  "capacity-exhausted": "Pending",
  approved: "Approved",
};

const paymentLabels: Readonly<Record<string, string>> = {
  "not-applicable": "No award",
  "rail-unavailable": "Unpaid",
  "awaiting-owner-commitment": "Owner",
  "needs-wallet": "Wallet",
  uncertain: "Unconfirmed",
  ready: "Ready",
  processing: "Sending",
  submitted: "Finalizing",
  held: "Held",
  paid: "Paid",
};

const submissionLabels: Readonly<Record<string, readonly [string, Tone]>> = {
  claimed: ["Checking", "Caution"],
  verified: ["Received", "Positive"],
  "link-rejected": ["Unconfirmed", "Negative"],
};

const eventLabels: Readonly<Record<string, string>> = {
  submit: "Submitted",
  "submit-direct": "Linked",
  claim: "Linked",
  record: "Recorded",
  "verify-link": "Verified",
  "reject-link": "Link rejected",
  receive: "Receipt verified",
  "receipt-mismatch": "Receipt mismatch",
  "assign-triager": "Triager +",
  "revoke-triager": "Triager −",
  triage: "Triage",
  "next-action": "Next action",
  "request-information": "Info requested",
  "report-revised": "Revised",
  decide: "Decided",
  award: "Award decided",
  remediation: "Remediation",
  disclosure: "Disclosure",
  recognition: "Recognition",
  appeal: "Appealed",
  "decide-appeal": "Appeal decided",
  "approve-award": "Award approved",
  "consent-payment": "Visibility accepted",
  "prepare-payment": "Payment prepared",
  "verify-payment": "Payment checked",
  "recover-payment": "Wallet recovered",
  "decide-related-party": "Related-party review",
  "reserve-award": "Award reserved",
};

const reporterEvents = new Set(["submit", "submit-direct", "claim", "report-revised", "recognition", "appeal", "consent-payment"]);

const githubEvents = new Set(["receive", "receipt-mismatch"]);

export type Actor = "Reporter" | "GitHub" | "Program team";

const responseKinds = new Set(["request-information", "decide", "award", "decide-appeal", "decide-related-party", "reject-link"]);

const relatedPartyLabels: Readonly<Record<string, readonly [string, Tone]>> = {
  "not-applicable": ["None", "Neutral"],
  pending: ["Pending", "Caution"],
  approved: ["Approved", "Positive"],
  refused: ["Refused", "Negative"],
};

export const lossLabels: Readonly<Record<string, readonly [string, Tone]>> = {
  likely: ["Likely", "Negative"],
  unlikely: ["Unlikely", "Positive"],
  unclear: ["Unclear", "Neutral"],
};

export const escalationLabels: Readonly<Record<string, string>> = {
  "private-security-case": "Every private security case goes to a moderator",
  "confidence-below-floor": "Slopbot's confidence is below 0.9",
};

const severityTones: Readonly<Record<string, Tone>> = {
  critical: "Negative",
  high: "Negative",
  medium: "Caution",
  low: "Notice",
};

export type RecoveryParty = "Reporter" | "Payer" | "Slop review";

/** A short state in its tone, marked by a dot unless the state has an icon of its own. @throws {never} */
export function badge(label: string, tone: Tone = "Neutral", icon: Presentation["icon"] = "Dot"): Presentation {
  return { tone, icon, label };
}

/** An exact amount in the case's frozen asset. @throws {never} */
export function money(minor: string, terms: Pick<CaseTerms, "currency" | "decimals" | "asset">): string {
  return formatSecurityAmount(minor, { currency: terms.currency, decimals: terms.decimals, ...(terms.asset ? { asset: terms.asset } : {}) }) ?? minor;
}

/** @throws {never} */
export function caseTitle(record: Pick<SecurityCase, "id" | "advisory">): string {
  return record.advisory?.ghsa ?? `Case ${record.id.slice(-8)}`;
}

/** @throws {never} */
export function receiptPresentation(state: string): Presentation {
  return badge(receiptLabels[state] ?? state, receiptTones[state] ?? "Neutral");
}

/** How the case reached Slop: GitHub's receipt state, or Slop's own receipt. @throws {never} */
export function submissionPresentation(record: Pick<SecurityCase, "submissionState" | "receivedAtSource">): Presentation {
  if (record.receivedAtSource === "slop-received") return badge("Slop received", record.submissionState === "verified" ? "Positive" : "Caution", "Check");
  const [label, tone] = submissionLabels[record.submissionState] ?? [record.submissionState, "Neutral"];
  return badge(label, tone, tone === "Positive" ? "Check" : "Clock");
}

/** The case's first state in the list: the owner's answer once there is one, else the receipt. @throws {never} */
export function listPresentation(record: SecurityCase): Presentation {
  if (record.receiptState) return receiptPresentation(record.receiptState);
  return badge(submissionLabels[record.submissionState]?.[0] ?? record.submissionState, "Neutral");
}

/** @throws {never} */
export function relatedPartyPresentation(review: string): Presentation {
  const [label, tone] = relatedPartyLabels[review] ?? [review, "Neutral"];
  return badge(label, tone);
}

/** @throws {never} */
export function severityPresentation(severity: string): Presentation {
  return badge(severity, severityTones[severity] ?? "Neutral");
}

/** The gross award with its researcher and Slop parts, or null without one. @throws {never} */
export function awardAmounts(record: SecurityCase): string | null {
  if (record.award === null || record.terms === null) return null;
  return `${money(record.award.grossMinor, record.terms)} (${money(record.award.researcherMinor, record.terms)} + ${money(record.award.slopMinor, record.terms)} Slop)`;
}

/** Why a selected award is not yet approved, or null once it is decided. @throws {never} */
export function awardPending(record: SecurityCase): string | null {
  if (record.award === null || record.awardState !== "pending") return null;
  return record.relatedPartyReview === "pending" ? "In review" : record.paymentRail === "direct" ? "Awaiting approval" : "Unfunded";
}

/** @throws {never} */
export function awardText(record: SecurityCase): string {
  const amount = awardAmounts(record);
  if (amount === null) return record.paymentRail === "direct" && record.awardState === "approved" ? "Approved" : (awardLabels[record.awardState] ?? record.awardState);
  const pending = awardPending(record);
  return pending ? `${pending} · ${amount}` : amount;
}

/** The award as a list chip: its state, then the gross amount when one exists. @throws {never} */
export function awardShort(record: SecurityCase): string {
  if (record.award === null || record.terms === null) return awardText(record);
  const gross = money(record.award.grossMinor, record.terms);
  const pending = awardPending(record);
  return pending ? `${pending} · ${gross}` : gross;
}

/** @throws {never} */
export function paymentLabel(record: SecurityCase): string {
  if (record.paymentRail === "direct" && record.settlement?.state === "awaiting-external-payment") {
    const confirmed = record.settlement.confirmedTransactionIds?.length ?? 0;
    return confirmed > 0 ? `${confirmed}/${confirmed + (record.settlement.remainingTransfers?.length ?? 0)} paid` : "Ready";
  }
  if (record.paymentRail === "direct" && record.paymentState === "awaiting-owner-commitment") return "Payer";
  return paymentLabels[record.paymentState] ?? record.paymentState;
}

/** @throws {never} */
export function payoutPresentation(record: SecurityCase): Presentation {
  if (record.paymentState === "paid") return badge(paymentLabel(record), "Positive", "Check");
  return badge(paymentLabel(record), record.paymentState === "held" ? "Caution" : "Neutral", record.paymentState === "held" ? "Pause" : "Dot");
}

/** @throws {never} */
export function eventLabel(kind: string): string {
  return eventLabels[kind] ?? kind;
}

/** Who acted in a history event, read from its kind only. @throws {never} */
export function eventActor(kind: string): Actor {
  return reporterEvents.has(kind) ? "Reporter" : githubEvents.has(kind) ? "GitHub" : "Program team";
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

/** A filter option with the number of cases it shows; "All" carries none. @throws {never} */
export function filterOption(filter: ReportFilter, label: string, cases: ReadonlyArray<SecurityCase>): string {
  return filter === "all" ? label : `${label} ${cases.filter((record) => matchesReport(record, filter)).length}`;
}

/** The recovery step and who must take it. @throws {never} */
export function recoveryStep(mode: string): readonly [RecoveryParty | null, string] {
  switch (mode) {
    case "wallet-required":
      return ["Reporter", "Confirm wallet"];
    case "consent-required":
      return ["Reporter", "Accept visibility"];
    case "fee-pending":
      return ["Payer", "Verify fee"];
    case "retirement-required":
      return ["Payer", "Verify old transaction"];
    case "retirement-unproven":
    case "payer-review":
    case "legacy-manual":
      return ["Slop review", "Manual review"];
    case "resume-original":
      return ["Payer", "Resume wallet"];
    case "cancellation-required":
      return ["Payer", "Cancel old transfer"];
    case "payment-found":
      return ["Payer", "Verify found payment"];
    case "signature-required":
    case "history-check":
      return ["Payer", "Check expired request"];
    default:
      return [null, "Awaiting expiry"];
  }
}

/** Whether the viewer may pay or verify this case's award. @throws {never} */
export function canPay(record: SecurityCase): boolean {
  return record.viewerRoles.includes("financial") || record.viewerRoles.includes("security-maintainer");
}

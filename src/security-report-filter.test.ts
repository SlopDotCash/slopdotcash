import { describe, expect, test } from "bun:test";
import { matchesReport } from "./SecurityBounty";

type CaseRecord = Parameters<typeof matchesReport>[0];

function record(fields: Partial<CaseRecord>): CaseRecord {
  return {
    id: "sc_case00000001",
    projectId: "bounty",
    revision: 1,
    view: "restricted",
    viewerRoles: ["security-maintainer"],
    allowedActions: [],
    nextStep: "No action needed.",
    nextStepDueAt: null,
    submissionState: "verified",
    receivedAt: "2026-10-19T09:10:00.000Z",
    receivedAtSource: "github-verified",
    policyRevision: 1,
    terms: null,
    awardState: "not-applicable",
    award: null,
    relatedParty: "unrelated",
    relatedPartyReview: "not-applicable",
    paymentState: "not-applicable",
    paymentRail: "unavailable",
    paymentNetworks: [],
    settlement: null,
    paymentDeadline: null,
    ...fields,
  };
}

// The list record the security API returns to an appeal reviewer for a case
// whose rejection is under appeal (verified against the real handler): the
// server grants "decide-appeal" and names "Decide the appeal." as the next
// step, so the case belongs in "Needs your review" and is not resolved yet.
const openAppeal = record({
  viewerRoles: ["dispute", "security-maintainer"],
  allowedActions: [
    "remediation",
    "disclosure",
    "assign-triager",
    "revoke-triager",
    "decide-appeal",
  ],
  nextStep: "Decide the appeal.",
  receiptState: "disputed",
  appealState: "open",
  awardState: "ineligible",
  award: null,
  paymentState: "not-applicable",
});

describe("security report filter", () => {
  test("an open appeal awaits the reviewer's decision, not resolution", () => {
    expect(matchesReport(openAppeal, "review")).toBe(true);
    expect(matchesReport(openAppeal, "resolved")).toBe(false);
    expect(matchesReport(openAppeal, "waiting")).toBe(false);
    expect(matchesReport(openAppeal, "award")).toBe(false);
    expect(matchesReport(openAppeal, "all")).toBe(true);
  });

  test("an open appeal of a no-program rejection is still review work", () => {
    const noTerms = { ...openAppeal, awardState: "not-applicable" };
    expect(matchesReport(noTerms, "review")).toBe(true);
    expect(matchesReport(noTerms, "resolved")).toBe(false);
  });

  test("a decided appeal returns the case to its settled bucket", () => {
    const upheld = {
      ...openAppeal,
      allowedActions: ["remediation", "disclosure"],
      receiptState: "rejected",
      appealState: "upheld",
    };
    expect(matchesReport(upheld, "resolved")).toBe(true);
    expect(matchesReport(upheld, "review")).toBe(false);
  });

  test("the existing buckets keep their cases", () => {
    const received = record({
      allowedActions: ["decide", "request-information"],
      receiptState: "received",
    });
    expect(matchesReport(received, "review")).toBe(true);
    expect(matchesReport(received, "resolved")).toBe(false);

    const waiting = record({
      allowedActions: ["decide", "request-information"],
      receiptState: "needs-information",
    });
    expect(matchesReport(waiting, "waiting")).toBe(true);
    expect(matchesReport(waiting, "review")).toBe(true);

    const paying = record({
      allowedActions: ["prepare-payment"],
      awardState: "approved",
      award: {
        grossMinor: "1000000",
        researcherMinor: "750000",
        slopMinor: "250000",
      },
      paymentState: "awaiting-owner-commitment",
    });
    expect(matchesReport(paying, "award")).toBe(true);

    // Pinned by tests/e2e/inbox-reports-session.spec.ts: a paid case stays
    // in "Paid or ineligible" while its remediation is still open.
    const paid = record({
      awardState: "approved",
      paymentState: "paid",
      remediationState: "investigating",
    });
    expect(matchesReport(paid, "resolved")).toBe(true);
  });
});

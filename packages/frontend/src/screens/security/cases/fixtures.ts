// spec/security/privacy.md, "Read authorization comes from the current case roles and is audited before delivery"
import type { CaseList, SecurityCase } from "./case.schema.ts";

const terms = { grossMinor: "10000000000", currency: "USDC", decimals: 6, fundingPolicy: "after-approval", asset: { kind: "stablecoin", symbol: "USDC" } };

export const maintainerCase: SecurityCase = {
  id: "sc_7f3a91c2d4e5b6a7",
  projectId: "acme-vault",
  revision: 4,
  view: "restricted",
  viewerRoles: ["security-maintainer"],
  allowedActions: ["request-information", "decide", "assign-triager", "revoke-triager", "analyze"],
  nextStep: "Review the report and the AI summary, then decide or ask the reporter for information.",
  nextStepDueAt: "2026-11-18T09:00:00.000Z",
  submissionState: "verified",
  receivedAt: "2026-11-17T09:00:00.000Z",
  receivedAtSource: "slop-received",
  policyRevision: 3,
  terms,
  awardState: "pending",
  award: null,
  relatedParty: "not-assessed",
  relatedPartyReview: "not-applicable",
  paymentState: "not-applicable",
  paymentRail: "unavailable",
  settlement: null,
  paymentNetworks: [],
  paymentDeadline: null,
  advisory: { repository: "acme/vault", ghsa: "GHSA-2c3f-4g5h-6j7m", url: "https://github.com/acme/vault/security/advisories/GHSA-2c3f-4g5h-6j7m" },
  receiptState: "triaging",
  remediationState: "not-started",
  disclosureState: "embargoed",
  recognition: "private",
  severity: null,
  lossFinding: null,
  appealState: "none",
  reporter: { githubLogin: "octocat" },
  analysis: {
    state: "complete",
    summary: "A rounding error lets a withdrawal exceed the depositor's balance.",
    proposedSeverity: "critical",
    potentialLoss: "likely",
    duplicateCaseIds: [],
    rootCauseKey: "withdrawal-rounding",
    remediation: "Round the withdrawable amount down.",
  },
  appealTriage: null,
  rootCauseKey: null,
  duplicateOf: null,
  triagers: [{ githubId: "583231", githubLogin: "hubot", revokedAt: null }],
  events: [
    { revision: 1, kind: "submit", at: "2026-11-17T09:00:00.000Z", reason: null },
    { revision: 2, kind: "assign-triager", at: "2026-11-17T10:00:00.000Z", reason: null },
  ],
};

export const awardCase: SecurityCase = {
  ...maintainerCase,
  revision: 6,
  allowedActions: ["award", "assign-triager", "revoke-triager"],
  nextStep: "Choose an award amount or no award.",
  nextStepDueAt: null,
  receiptState: "confirmed",
  severity: "critical",
  lossFinding: "verified-potential",
  rootCauseKey: "withdrawal-rounding",
};

export const paidCase: SecurityCase = {
  ...awardCase,
  revision: 9,
  allowedActions: [],
  nextStep: "No action needed.",
  awardState: "approved",
  award: { grossMinor: "10000000000", researcherMinor: "7500000000", slopMinor: "2500000000" },
  paymentState: "paid",
  paymentRail: "escrow",
  settlement: { state: "paid", network: "base", transactionIds: ["0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060"], privacyNotice: "Chain transactions show the wallet, time and amount. The report stays private." },
  paymentDeadline: "2026-12-01T00:00:00.000Z",
};

export const appealCase: SecurityCase = {
  ...maintainerCase,
  viewerRoles: ["dispute"],
  allowedActions: ["decide-appeal", "triage-appeal"],
  nextStep: "Decide the appeal.",
  nextStepDueAt: null,
  receiptState: "rejected",
  appealState: "open",
  appealTriage: {
    state: "complete",
    proposedOutcome: "return",
    rationale: "The reproduction shows a loss path the decision did not consider.",
    confidence: 0.62,
    escalationReasons: ["private-security-case", "confidence-below-floor"],
  },
};

export const reporterCase: SecurityCase = {
  ...maintainerCase,
  view: "reporter",
  viewerRoles: ["reporter"],
  allowedActions: ["recognition"],
  nextStep: "Waiting for the project owner's response.",
  analysis: undefined,
  triagers: undefined,
};

export const caseList: CaseList = {
  viewer: { githubId: "1", githubLogin: "octocat" },
  programs: [{ projectId: "acme-vault", roles: ["security-maintainer"] }],
  cases: [maintainerCase, { ...paidCase, id: "sc_9b8c7d6e5f4a3b2c", advisory: null }],
  authorityUnavailable: false,
};

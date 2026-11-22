// spec/security/terms.md, "Paid terms carry their split, funding policy, eligibility class and asset"; spec/security/terms.md, "Exclusions are frozen with the terms and stay advice"; spec/frontend/reportDetails.md, "Private report IDs scope both heading references"
import type { IntakeReadiness, SubmissionView } from "@repo/security/client";
import type { DetailHeadings } from "../../../flows/security/details.vibe";
import type { ReportDraft } from "../../../flows/security/private.vibe";
import type { ReadinessShown } from "./runtime.vibe";
import type { CaseSummary } from "./summary.ts";
import type { ProgramProject, ProgramTerms } from "./terms.schema.ts";

const person = (githubLogin: string) => ({ githubLogin });

export const terms: ProgramTerms = {
  status: "open",
  rewardMode: "separate",
  eligibility: "critical-loss-of-funds",
  fundingPolicy: "after-approval",
  split: { researcherBasisPoints: 7500, slopBasisPoints: 2500 },
  amount: { currency: "USDC", decimals: 6, grossMinor: "10000000000", network: "base", asset: { kind: "stablecoin", symbol: "USDC" } },
  funding: { state: "pledged" },
  capacity: { awards: 2, closesAt: "2027-03-31T23:59:00.000Z", exhaustionRule: "The program pauses once the published awards are made." },
  scope: {
    sourceRevisions: [{ repository: "acme/vault", commit: "4f2c9a1e7b3d5c8f0a6e2b4d9c1f3a5e7b8d0c2e" }],
    deployments: [{ network: "base", address: "0x8ba1f109551bd432803012645ac136ddd64dba72", codeIdentity: "Vault v2" }],
    includedAssets: ["Vault contracts", "Withdrawal queue"],
    excludedDependencies: [],
    testingPermission: "Local forks and isolated test networks only.",
    severityRubric: "Critical means a direct loss of deposited funds.",
    lossDefinition: "A loss of funds is any unauthorized transfer of a depositor's assets.",
  },
  sponsor: { name: "Acme" },
  intake: { repository: "acme/vault" },
  approvers: { technical: [person("octocat")], financial: [person("hubot")], dispute: [person("monalisa")] },
  dispute: { process: "Open a dispute within 14 days of the decision." },
  responseTargets: { acknowledgeHours: 48, triageBusinessDays: 5, updateIntervalDays: 7 },
  disclosure: "Coordinated disclosure after a fix ships, or 90 days after receipt.",
  safeHarbor: "Good-faith research under these terms is authorized.",
};

export const project: ProgramProject = {
  id: "acme-vault",
  slug: "acme-vault",
  name: "Acme Vault",
  links: { repository: "https://github.com/acme/vault" },
  securityBounty: terms,
};

export const unpublished: ProgramProject = { id: "acme-docs", slug: "acme-docs", name: "Acme Docs" };

export const fullAward: ProgramTerms = { ...terms, split: { researcherBasisPoints: 10000, slopBasisPoints: 0 }, sponsor: { name: "Slop" } };

export const paused: ProgramTerms = { ...terms, status: "paused" };

export const funded: ProgramTerms = { ...terms, capacity: { ...terms.capacity, awards: null }, funding: { state: "verified-available", evidence: "Vault 0x8ba1…ba72 held 25,000 USDC at block 22,418,906.", verifiedAt: "2026-11-15T12:00:00.000Z" } };

export const ownerExclusions = ["Price feed staleness within the documented heartbeat", "Rounding dust below one cent"];

export const withOwnerExclusions: ProgramTerms = { ...terms, scope: { ...terms.scope, excludedDependencies: ["OpenZeppelin contracts"], excludedFindings: ownerExclusions } };

const ready: IntakeReadiness = {
  projectId: "acme-vault",
  repository: "acme/vault",
  state: "ready",
  automatic: "ready",
  automaticConfigured: true,
  storedIntake: true,
  checkedAt: "2026-11-17T09:00:00.000Z",
  stale: false,
  maxAgeSeconds: 30,
  programStatus: "open",
  paidParticipation: "open",
  handoffUrl: "https://github.com/acme/vault/security/advisories/new",
};

export const readiness = {
  checking: { status: "checking" },
  ready: { status: "checked", projectId: "acme-vault", value: ready, stale: false, rechecking: false },
  stale: { status: "checked", projectId: "acme-vault", value: { ...ready, stale: true }, stale: true, rechecking: false },
  disabled: { status: "checked", projectId: "acme-vault", value: { ...ready, state: "disabled", storedIntake: false, handoffUrl: null }, stale: false, rechecking: false },
  closed: { status: "checked", projectId: "acme-vault", value: { ...ready, paidParticipation: "closed" }, stale: false, rechecking: false },
  failed: { status: "error", projectId: "acme-vault", message: "Private reporting status is unavailable." },
} satisfies Record<string, ReadinessShown>;

export const draft: ReportDraft = {
  summary: "Withdrawal queue lets a depositor drain other balances",
  description: "Affected component and revision: Vault v2 at 4f2c9a1.\n\nImpact: any depositor can withdraw another depositor's balance.\n\nSafe reproduction steps:\n1. Fork Base locally.\n2. Queue two withdrawals in one block.",
  severity: "critical",
  cvss: "",
  cwe: "CWE-284",
  proofName: "",
  proofText: "",
};

export const proof = {
  fileName: "drain.t.sol",
  patch: "function test_drain() public {\n  vault.queue(alice, 10);\n  vault.queue(alice, 10);\n  assertEq(vault.balanceOf(bob), 0);\n}\n",
};

export const proofDraft: ReportDraft = { ...draft, proofName: proof.fileName, proofText: proof.patch };

export const headings: DetailHeadings = { card: "private-report-card-48211", summary: "private-report-summary-48211" };

const intake = {
  state: "legitimate",
  receivedAt: "2026-11-16T14:20:00.000Z",
  revision: 2,
  reportVersion: 1,
  routingState: "routed",
  reason: null,
  reviewedAt: null,
  canReview: false,
  canForward: true,
  canRetryScreening: false,
  canAuthorize: true,
  canRevise: true,
};

const received: SubmissionView = {
  id: "ss_8d1f3b2c4a5e6f70",
  projectId: "acme-vault",
  repository: "acme/vault",
  origin: "slop",
  state: "draft",
  revision: 3,
  attempt: 0,
  advisory: null,
  githubCreatedAt: null,
  failureCode: null,
  caseId: "sc_0c9f2e71a4b8d3e5",
  retryAllowed: false,
  reconcileAfter: null,
  createdAt: "2026-11-16T14:20:00.000Z",
  updatedAt: "2026-11-16T14:25:00.000Z",
  intake,
};

export const submissions = {
  received,
  needsInformation: { ...received, id: "ss_1a2b3c4d5e6f7081", caseId: null, intake: { ...intake, state: "needs-information", canForward: false, canAuthorize: false, reason: "Add the transaction trace of step 2." } },
  reviewing: { ...received, id: "ss_9e8d7c6b5a4f3021", intake: { ...intake, canReview: true, canForward: false, canAuthorize: false } },
  uncertain: { ...received, id: "ss_5f4e3d2c1b0a9f8e", state: "uncertain", attempt: 1, reconcileAfter: "2026-11-16T15:00:00.000Z", intake: { ...intake, canAuthorize: false } },
  verified: {
    ...received,
    id: "ss_7a6b5c4d3e2f1a0b",
    state: "receipt-verified",
    attempt: 1,
    advisory: { ghsa: "GHSA-q4xm-5v7p-2r9w", url: "https://github.com/acme/vault/security/advisories/GHSA-q4xm-5v7p-2r9w" },
    githubCreatedAt: "2026-11-16T14:40:00.000Z",
    intake: { ...intake, canAuthorize: false, canRevise: false },
  },
  unsentFromTab: { ...received, id: "ss_3c2b1a0f9e8d7c6b", caseId: null, intake: null },
  abandoned: { ...received, id: "ss_0f1e2d3c4b5a6978", caseId: null, state: "abandoned", intake: null },
} satisfies Record<string, SubmissionView>;

export const caseRecord: CaseSummary = {
  id: "sc_0c9f2e71a4b8d3e5",
  advisory: null,
  nextStep: "The owner reviews the screened report.",
  nextStepDueAt: "2026-11-21T14:20:00.000Z",
  award: "Not decided",
};

export const reportText = {
  summary: draft.summary,
  description: draft.description,
  severity: "critical",
  cweIds: ["CWE-284"],
};

export const reportWithProof = { ...reportText, proofOfConcept: proof };

export const nowMs = Date.parse("2026-11-16T14:50:00.000Z");

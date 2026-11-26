// spec/security/privacy.md, "Read authorization comes from the current case roles and is audited before delivery"; spec/security/cases.md, "Current technical approvers and triagers request information on the current report version"; spec/security/reportDeposit.md, "A report that waits for its deposit belongs to its reporter alone"
import { Result, Schema } from "effect";

const Login = Schema.Struct({ githubLogin: Schema.String });

const Split = Schema.Struct({ researcherBasisPoints: Schema.Number, slopBasisPoints: Schema.Number });

export const CaseTerms = Schema.Struct({
  grossMinor: Schema.optional(Schema.String),
  currency: Schema.String,
  decimals: Schema.Number,
  fundingPolicy: Schema.optional(Schema.String),
  split: Schema.optional(Schema.NullOr(Split)),
  asset: Schema.optional(Schema.NullOr(Schema.Struct({ kind: Schema.optional(Schema.String), symbol: Schema.String }))),
});

const Shares = Schema.Struct({ grossMinor: Schema.String, researcherMinor: Schema.String, slopMinor: Schema.String });

const Analysis = Schema.Struct({
  state: Schema.Literals(["running", "complete", "failed", "unavailable"]),
  summary: Schema.NullOr(Schema.String),
  proposedSeverity: Schema.NullOr(Schema.String),
  potentialLoss: Schema.NullOr(Schema.String),
  duplicateCaseIds: Schema.Array(Schema.String),
  rootCauseKey: Schema.NullOr(Schema.String),
  remediation: Schema.NullOr(Schema.String),
});

const AppealTriage = Schema.Struct({
  state: Schema.Literals(["running", "complete", "failed", "unavailable"]),
  proposedOutcome: Schema.NullOr(Schema.String),
  rationale: Schema.NullOr(Schema.String),
  confidence: Schema.NullOr(Schema.Number),
  escalationReasons: Schema.Array(Schema.String),
});

const Recovery = Schema.Struct({
  generation: Schema.Number,
  mode: Schema.String,
  target: Schema.optional(Schema.NullOr(Schema.Struct({ id: Schema.optional(Schema.String), address: Schema.String, digest: Schema.optional(Schema.String) }))),
  consented: Schema.optional(Schema.Boolean),
  cancellationRequest: Schema.optional(Schema.Unknown),
  payer: Schema.optional(Schema.String),
  messages: Schema.optional(Schema.Array(Schema.Struct({ messageId: Schema.String, message: Schema.String }))),
  transactionIds: Schema.optional(Schema.Array(Schema.String)),
  retirementNonce: Schema.optional(Schema.String),
  role: Schema.optional(Schema.String),
  legIndex: Schema.optional(Schema.Number),
});

const Settlement = Schema.Struct({
  state: Schema.String,
  network: Schema.String,
  generation: Schema.optional(Schema.Number),
  transactionId: Schema.optional(Schema.NullOr(Schema.String)),
  transactionIds: Schema.optional(Schema.Array(Schema.String)),
  confirmedTransactionIds: Schema.optional(Schema.Array(Schema.String)),
  remainingTransfers: Schema.optional(Schema.Array(Schema.Struct({ recipient: Schema.String, amountBase: Schema.String, role: Schema.String }))),
  recovery: Schema.optional(Schema.NullOr(Recovery)),
  privacyNotice: Schema.optional(Schema.String),
  ownerRequest: Schema.optional(Schema.NullOr(Schema.Unknown)),
});

const CaseEvent = Schema.Struct({
  revision: Schema.Number,
  kind: Schema.String,
  at: Schema.String,
  reason: Schema.NullOr(Schema.String),
  evidenceReference: Schema.optional(Schema.NullOr(Schema.String)),
  detail: Schema.optional(Schema.NullOr(Schema.Struct({ redactedContentDigest: Schema.optional(Schema.NullOr(Schema.String)), embargoChange: Schema.optional(Schema.NullOr(Schema.String)) }))),
});

const Triager = Schema.Struct({ githubId: Schema.String, githubLogin: Schema.String, revokedAt: Schema.NullOr(Schema.String) });

export const SecurityCase = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  revision: Schema.Number,
  view: Schema.Literals(["restricted", "reporter", "financial"]),
  viewerRoles: Schema.Array(Schema.String),
  allowedActions: Schema.Array(Schema.String),
  nextStep: Schema.String,
  nextStepDueAt: Schema.NullOr(Schema.String),
  submissionState: Schema.String,
  receivedAt: Schema.NullOr(Schema.String),
  receivedAtSource: Schema.NullOr(Schema.String),
  policyRevision: Schema.NullOr(Schema.Number),
  terms: Schema.NullOr(CaseTerms),
  awardState: Schema.String,
  award: Schema.NullOr(Shares),
  relatedParty: Schema.String,
  relatedPartyReview: Schema.String,
  paymentState: Schema.String,
  paymentRail: Schema.String,
  settlement: Schema.NullOr(Settlement),
  paymentNetworks: Schema.Array(Schema.String),
  paymentDeadline: Schema.NullOr(Schema.String),
  awardFunds: Schema.optional(Schema.NullOr(Schema.Struct({ currency: Schema.String, decimals: Schema.Number, availableMinor: Schema.String }))),
  advisory: Schema.optional(Schema.NullOr(Schema.Struct({ repository: Schema.String, ghsa: Schema.String, url: Schema.String, state: Schema.optional(Schema.NullOr(Schema.String)) }))),
  receiptState: Schema.optional(Schema.String),
  remediationState: Schema.optional(Schema.String),
  disclosureState: Schema.optional(Schema.String),
  recognition: Schema.optional(Schema.String),
  severity: Schema.optional(Schema.NullOr(Schema.String)),
  lossFinding: Schema.optional(Schema.NullOr(Schema.String)),
  appealState: Schema.optional(Schema.String),
  reporter: Schema.optional(Login),
  payee: Schema.optional(Login),
  analysis: Schema.optional(Schema.NullOr(Analysis)),
  appealTriage: Schema.optional(Schema.NullOr(AppealTriage)),
  rootCauseKey: Schema.optional(Schema.NullOr(Schema.String)),
  duplicateOf: Schema.optional(Schema.NullOr(Schema.String)),
  triagers: Schema.optional(Schema.Array(Triager)),
  events: Schema.optional(Schema.Array(CaseEvent)),
  deposit: Schema.optional(Schema.NullOr(Schema.Unknown)),
});

export const CaseList = Schema.Struct({
  viewer: Schema.Struct({ githubId: Schema.String, githubLogin: Schema.String }),
  programs: Schema.Array(Schema.Struct({ projectId: Schema.String, roles: Schema.Array(Schema.String) })),
  cases: Schema.Array(SecurityCase),
  authorityUnavailable: Schema.optional(Schema.Boolean),
});

export type CaseTerms = typeof CaseTerms.Type;
export type SecurityCase = typeof SecurityCase.Type;
export type CaseList = typeof CaseList.Type;
export type CaseEvent = typeof CaseEvent.Type;

const decodeCase = Schema.decodeUnknownResult(SecurityCase);
const decodeList = Schema.decodeUnknownResult(CaseList);

/** The case as its viewer may read it, or undefined when the answer is not one. @throws {never} */
export function caseOf(value: unknown): SecurityCase | undefined {
  const decoded = decodeCase(value);
  return Result.isSuccess(decoded) ? decoded.success : undefined;
}

/** The viewer's case list, or undefined when the answer is not one. @throws {never} */
export function caseListOf(value: unknown): CaseList | undefined {
  const decoded = decodeList(value);
  return Result.isSuccess(decoded) ? decoded.success : undefined;
}

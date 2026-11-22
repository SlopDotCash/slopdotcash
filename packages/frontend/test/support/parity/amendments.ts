// spec/frontend/requests.md, "Story: Read current data without losing the last good result"

export type AmendedMessage = string | { readonly raw: string };

export interface AmendedRefusal {
  readonly key: string;
  readonly status: number;
  readonly error: string;
  readonly message?: AmendedMessage;
  readonly like: string;
  readonly at: string;
}

export interface Amendment {
  readonly route: string;
  readonly from?: { readonly route: string; readonly name: string; readonly keep: ReadonlyArray<string> };
  readonly replaces?: ReadonlyArray<string>;
  readonly refusals: ReadonlyArray<AmendedRefusal>;
}

const verifiedEnforcement = "backend/projects/verified-enforcement.ts";
const monthly = "backend/payments/monthly.ts";
const monthLock = "backend/payments/solana-month-lock.ts";

const enforcementCodes: ReadonlyArray<AmendedRefusal> = [
  { key: "alreadyRestrictedState", status: 409, error: "already_restricted", message: { raw: "`The project is already ${input.state}`" }, like: "accountNotBanned", at: `${verifiedEnforcement}:449` },
  { key: "alreadyRestrictedBanned", status: 409, error: "already_restricted", message: "The project is already banned", like: "accountNotBanned", at: `${verifiedEnforcement}:456` },
  { key: "independentReviewRequiredRestriction", status: 403, error: "independent_review_required", message: "A moderator who did not place this restriction must decide the appeal", like: "accountNotBanned", at: `${verifiedEnforcement}:492` },
  { key: "independentReviewRequiredAuthor", status: 403, error: "independent_review_required", message: "Another moderator must decide an appeal its author filed", like: "accountNotBanned", at: `${verifiedEnforcement}:492` },
  { key: "independentReviewRequiredBan", status: 403, error: "independent_review_required", message: "A moderator who did not ban this account must decide its appeal.", like: "accountNotBanned", at: `${verifiedEnforcement}:503` },
  { key: "notRestricted", status: 409, error: "not_restricted", message: "The project has no restriction to appeal", like: "accountNotBanned", at: `${verifiedEnforcement}:533` },
  { key: "appealOpen", status: 409, error: "appeal_open", message: "A reinstatement request is already open", like: "accountNotBanned", at: `${verifiedEnforcement}:543` },
  { key: "noOpenAppealReinstate", status: 409, error: "no_open_appeal", message: "Record an appeal before reinstating an account", like: "accountNotBanned", at: `${verifiedEnforcement}:560` },
  { key: "noOpenAppealDecision", status: 409, error: "no_open_appeal", message: "Record a reinstatement request before a decision", like: "accountNotBanned", at: `${verifiedEnforcement}:631` },
  { key: "maliciousDecisionRequired", status: 409, error: "malicious_decision_required", message: "A confirmed malicious result needs a decision: ban the project and its maintainer, or reinstate it", like: "accountNotBanned", at: `${verifiedEnforcement}:670` },
  { key: "revisionPending", status: 409, error: "revision_pending", message: "Append the paused, retired revision of this restriction before reinstatement", like: "accountNotBanned", at: `${verifiedEnforcement}:688` },
];

const honorSystemMessage: AmendedRefusal = {
  key: "financialChangeRestrictedOnlyTheMonthlyAmount",
  status: 422,
  error: "financial_change_restricted",
  message: "Only the monthly amount, network, asset and honor-system promise change through owner self-service",
  like: "financialChangeRestrictedOnlyTheMonthlyAmount",
  at: "backend/projects/handler.ts:590",
};

const maintainerAuthority: ReadonlyArray<AmendedRefusal> = [
  { key: "ownerRequiredSteward", status: 403, error: "owner_required", message: "Only the current project steward can manage this project's awards.", like: "projectUnavailable", at: `${monthly}:121` },
  { key: "githubUnavailableAuthority", status: 503, error: "github_unavailable", message: "GitHub authority could not be checked. Retry.", like: "projectUnavailable", at: `${monthly}:132` },
  { key: "ownerRequiredMaintainer", status: 403, error: "owner_required", message: "Current GitHub maintainer authority could not be verified.", like: "projectUnavailable", at: `${monthly}:138` },
  { key: "githubUnavailableIdentity", status: 503, error: "github_unavailable", message: "GitHub repository identity could not be checked. Retry.", like: "projectUnavailable", at: `${monthly}:149` },
  { key: "repositoryChanged", status: 409, error: "repository_changed", message: "The GitHub repository identity differs from the project policy.", like: "projectUnavailable", at: `${monthly}:155` },
];

const ownerAuthority: ReadonlyArray<AmendedRefusal> = [
  ...maintainerAuthority,
  { key: "ownerRequiredOwner", status: 403, error: "owner_required", message: "Only the project steward or a repository admin can change monthly awards.", like: "projectUnavailable", at: `${monthly}:164` },
];

const ownAllocation: AmendedRefusal = { key: "invalidAllocationOwn", status: 403, error: "invalid_allocation", message: { raw: "error.message" }, like: "invalidAllocation", at: `${monthly}:1279` };

const preparationChanged: AmendedRefusal = {
  key: "paymentPreparationChanged",
  status: 409,
  error: "payment_preparation_changed",
  message: "The payment wallets or consent changed. Review the payment again.",
  like: "paymentConsentRequired",
  at: "backend/security/direct-payments.ts:359",
};

const monthLockRefusals: ReadonlyArray<AmendedRefusal> = [
  { key: "invalidMonthLock", status: 400, error: "invalid_month_lock", like: "invalidMonthlySetting", at: `${monthLock}:71` },
  { key: "invalidMonthLockAmount", status: 422, error: "invalid_month_lock_amount", message: "Enter a positive amount within this token's decimal precision.", like: "invalidMonthlySetting", at: `${monthLock}:109` },
  { key: "monthLockRejected", status: 422, error: "month_lock_rejected", message: { raw: "error.message" }, like: "invalidMonthlySetting", at: `${monthLock}:129` },
];

const monthlyPeriod = "/api/v1/payments/projects/:id/monthly/:period";

export const amendments: ReadonlyArray<Amendment> = [
  { route: "PUT /api/v1/projects/:id", replaces: [honorSystemMessage.key], refusals: [honorSystemMessage] },
  { route: "POST /api/v1/project-applications/:id/publish", replaces: [honorSystemMessage.key], refusals: [honorSystemMessage] },
  { route: "POST /api/v1/admin/projects/:id/enforcement-preview", refusals: enforcementCodes },
  { route: "POST /api/v1/admin/projects/:id/enforcement", refusals: enforcementCodes },
  { route: "POST /api/v1/project-appeals", refusals: enforcementCodes },
  { route: `GET ${monthlyPeriod}`, refusals: maintainerAuthority },
  { route: `POST ${monthlyPeriod}/allocations`, refusals: [...ownerAuthority, ownAllocation] },
  { route: `POST ${monthlyPeriod}/finalize`, refusals: ownerAuthority },
  { route: `POST ${monthlyPeriod}/commitment`, refusals: ownerAuthority },
  { route: `POST ${monthlyPeriod}/solana-commitment`, refusals: ownerAuthority },
  { route: `POST ${monthlyPeriod}/reserve-release`, refusals: ownerAuthority },
  { route: "POST /api/v1/payments/projects/:id/monthly-settings", refusals: ownerAuthority },
  { route: "POST /api/v1/security-cases/:id/actions", refusals: [preparationChanged] },
  {
    route: "POST /api/v1/payments/projects/:id/solana-month-lock",
    from: {
      route: "POST /api/v1/payments/projects/:id/solana-monthly-commitment",
      name: "postPaymentsProjectsByIdSolanaMonthLock",
      keep: ["originForbiddenPrivateNoStore", "fundingUnavailablePrivateNoStore", "notFoundPrivateNoStore", "fundingVaultNotFound", "paymentsUnavailable"],
    },
    refusals: monthLockRefusals,
  },
];

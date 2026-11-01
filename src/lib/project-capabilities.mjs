/**
 * One project capability evaluator (PRD sections 4 and 5). Registration,
 * restriction and funding state are separate facts; each capability reads
 * only the facts that govern it, so no single "active" switch decides all of
 * them.
 *
 * - Security review needs a verified registration. Paused, flagged,
 *   quarantined or banned projects may still receive authorized security
 *   review ("authorized security review may continue"). A retired project
 *   gets no review (owner decision D12).
 * - Contributor work needs an active, listed, unrestricted, unflagged
 *   registration. Funding is optional and never a prerequisite.
 * - Executing an already approved payment needs a verified registration and a
 *   funded vault. A pause or a ban does not erase a funded obligation. This is
 *   a project-level gate only: each payment keeps its own approval,
 *   destination, finality and exact reconciliation checks.
 *
 * Unknown facts fail closed for every capability that reads them.
 */

const RESTRICTIONS = new Set(["clear", "quarantined", "banned", "unknown"]);
const FUNDING = new Set(["funded", "unfunded", "unknown"]);

export function evaluateProjectCapabilities(state) {
  if (state === null || typeof state !== "object")
    throw new TypeError("project capability state is required");
  const restriction = state.restriction ?? "unknown";
  const funding = state.funding ?? "unknown";
  if (!RESTRICTIONS.has(restriction))
    throw new TypeError("unknown project restriction state");
  if (!FUNDING.has(funding))
    throw new TypeError("unknown project funding state");
  const registered = state.registered === true;
  const contributorRefusal = !registered
    ? "repository is not registered on slop.cash"
    : state.status !== "active"
      ? "project is paused"
      : state.listingTier === "retired"
        ? "project is retired"
        : restriction !== "clear"
          ? restriction === "unknown"
            ? "project restriction state is unknown"
            : `project is ${restriction}`
          : state.flagged === true
            ? "project is paused by contributor flags"
            : state.flagged === false || state.flagged === undefined
              ? null
              : "project flag state is unknown";
  const paymentRefusal = !registered
    ? "repository is not registered on slop.cash"
    : funding !== "funded"
      ? funding === "unknown"
        ? "project funding state is unknown"
        : "project vault is not funded"
      : null;
  // Owner decision D12: a retired project gets no review; retired means off.
  // The retirement a quarantine or ban applies keeps the security review.
  const securityRefusal = !registered
    ? "repository is not registered on slop.cash"
    : state.listingTier === "retired" && state.retiredByRestriction !== true
      ? "project is retired"
      : null;
  return {
    mayReviewForSecurity: securityRefusal === null,
    mayOfferContributorWork: contributorRefusal === null,
    mayExecuteApprovedPayment: paymentRefusal === null,
    reasons: {
      security: securityRefusal ?? "registered repository",
      contributor: contributorRefusal ?? "project is open to contributor work",
      payment: paymentRefusal ?? "funded project",
    },
  };
}

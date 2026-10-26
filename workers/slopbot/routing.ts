// Eligibility routing (PRD BOT-02 as amended by Slopbot v2). Pure: every input
// is resolved by the caller, and the order below is the published precedence.
import type { ClosureEligibility } from "./closure-eligibility";
import type { RepositoryConfig } from "./contracts";
import type { Exemption } from "./github";
import type { ReviewScope } from "./registry";

export type RoutingInput = {
  config: RepositoryConfig;
  itemKind: "issue" | "pull_request";
  itemOpen: boolean;
  draft: boolean;
  merged: boolean;
  authorType: string;
  authorIsSelf: boolean;
  scope: ReviewScope;
  exemption: Exemption;
  /** Audience filter only. A marker never enables closure or a penalty. */
  markerPresent: boolean;
  participant: boolean;
  /** The closure-eligibility check for this author and item. */
  closure: ClosureEligibility;
  humanReopenedThisRevision: boolean;
  authorCapReached: boolean;
};

export type Routing =
  | { review: false; reason: string }
  | {
      review: true;
      mayClose: boolean;
      penaltyEligible: boolean;
      reason: string;
    };

// The caller has already refused a removed or suspended installation and a
// private repository.
export function route(input: RoutingInput): Routing {
  if (input.itemKind === "issue" && !input.config.issues)
    return { review: false, reason: "issue review disabled" };
  if (input.itemKind === "pull_request" && !input.config.pullRequests) {
    return { review: false, reason: "pull request review disabled" };
  }
  if (!input.itemOpen || input.merged)
    return { review: false, reason: "item is not open" };
  if (input.draft) return { review: false, reason: "draft pull request" };
  if (input.authorIsSelf || input.authorType === "Bot")
    return { review: false, reason: "bot author" };
  if (input.humanReopenedThisRevision) {
    return {
      review: false,
      reason: "a human reopened this revision; maintainer decision stands",
    };
  }

  let reason = "eligible";
  if (input.exemption === "exempt") {
    if (!input.config.reviewExempt)
      return { review: false, reason: "maintainer or member is exempt" };
    reason = "exempt author, advisory review only";
  }

  if (
    input.config.audience === "participants" &&
    !input.markerPresent &&
    !input.participant
  ) {
    return { review: false, reason: "not a Slop participant submission" };
  }
  if (input.authorCapReached)
    return { review: false, reason: "daily review cap for new author reached" };

  // Advisory review stays broad. Closure, and so a penalty, needs the
  // explicit eligibility check: a verified member, a verified skill run for
  // this pull request and no maintainer role. A paused project gets security
  // review only and is never closed.
  if (input.scope === "security")
    return {
      review: true,
      mayClose: false,
      penaltyEligible: false,
      reason: "contributor work is paused; security review only",
    };
  const mayClose = input.closure.eligible;
  if (!mayClose && reason === "eligible")
    reason = `advisory review only: ${input.closure.why}`;
  return { review: true, mayClose, penaltyEligible: mayClose, reason };
}

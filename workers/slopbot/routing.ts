// Eligibility routing (PRD BOT-02 as amended by Slopbot v2). Pure: every input
// is resolved by the caller, and the order below is the published precedence.
import type { RepositoryConfig } from "./contracts";
import type { Exemption } from "./github";

export type RoutingInput = {
  config: RepositoryConfig;
  installationActive: boolean;
  repositoryPrivate: boolean;
  itemKind: "issue" | "pull_request";
  itemOpen: boolean;
  draft: boolean;
  merged: boolean;
  authorType: string;
  authorIsSelf: boolean;
  exemption: Exemption;
  markerPresent: boolean;
  participant: boolean;
  humanReopenedThisRevision: boolean;
  authorCapReached: boolean;
  balanceMicroUsdc: number;
};

export type Routing =
  | { review: false; reason: string }
  | {
      review: true;
      mayClose: boolean;
      penaltyEligible: boolean;
      reason: string;
    };

export function route(input: RoutingInput): Routing {
  if (!input.installationActive)
    return { review: false, reason: "installation removed or suspended" };
  // Surplus may never see private content, and v2 supports public repositories only.
  if (input.repositoryPrivate)
    return {
      review: false,
      reason: "private repositories are outside Slopbot v2",
    };
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

  let mayClose = true;
  let reason = "eligible";
  if (input.exemption === "exempt") {
    if (!input.config.reviewExempt)
      return { review: false, reason: "maintainer or member is exempt" };
    mayClose = false;
    reason = "exempt author, advisory review only";
  } else if (input.exemption === "unknown") {
    mayClose = false;
    reason = "membership unknown, closure blocked";
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
  if (input.balanceMicroUsdc <= 0)
    return { review: false, reason: "budget exhausted (Suspended)" };

  // A marker added by someone else never enables a penalty (BOT-06): only a
  // registered participant, matched by immutable actor ID, is penalty eligible.
  return { review: true, mayClose, penaltyEligible: input.participant, reason };
}

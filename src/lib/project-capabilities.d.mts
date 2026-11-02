/** Types for the shared project capability evaluator. */

export type ProjectRestrictionState =
  | "clear"
  | "quarantined"
  | "banned"
  | "unknown";
export type ProjectFundingState = "funded" | "unfunded" | "unknown";

export interface ProjectCapabilityState {
  /** The repository resolves to a D1 project with a matching immutable identity. */
  registered: boolean;
  status?: "active" | "paused";
  listingTier?: string;
  /**
   * The applied revision of the restriction in force retired the listing, not
   * the owner. Omitted means an owner's retirement.
   */
  retiredByRestriction?: boolean;
  /** Latest enforcement state; omitted means unknown and fails closed. */
  restriction?: ProjectRestrictionState;
  /** Two-flag pause. Omitted means no flag pause is recorded. */
  flagged?: boolean;
  /** Omitted means unknown and fails closed. */
  funding?: ProjectFundingState;
}

export interface ProjectCapabilities {
  mayReviewForSecurity: boolean;
  mayOfferContributorWork: boolean;
  mayExecuteApprovedPayment: boolean;
  reasons: { security: string; contributor: string; payment: string };
}

export declare function evaluateProjectCapabilities(
  state: ProjectCapabilityState,
): ProjectCapabilities;

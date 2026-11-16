/** Snapshot identity constants shared by the leaderboard and its snapshot types. */
import { PRIMARY_REPOSITORY } from "./repositories.mjs";

/** Backward-compatible alias for the primary registry repository. */
export const LEADERBOARD_REPOSITORY = PRIMARY_REPOSITORY?.id ?? null;

export const LEADERBOARD_SCHEMA_VERSION = "6" as const;

export const SCORE_RULE_VERSION = "slop-score-v2" as const;

export const REVIEW_EXCLUSION_REASONS = [
  "missing-reviewer",
  "bot-reviewer",
  "missing-pull-request-author",
  "bot-pull-request-author",
  "self-review",
  "missing-submission-time",
  "unmerged-pull-request",
  "post-merge",
  "non-decision",
  "insufficient-substance",
  "already-awarded-reviewer",
  "evaluated-contribution-award",
  "external-prize-policy",
  "reviewer-cycle-cap",
  "unchanged-outcome",
  "pull-request-review-awarded",
  "review-credit-reviewer-limit",
  "review-credit-zero-share",
  "review-credit-outside-window",
  "review-credit-before-policy",
  "review-credit-account-banned",
] as const;

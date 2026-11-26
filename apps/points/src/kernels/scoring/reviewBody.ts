//@ backend dafny
// spec/points/reviews.md, "Qualification excludes bots, self-review, repeated comments, empty reviews, and post-merge reviews"; spec/points/reviews.md, "A review is empty unless it is an approval or a change request with twenty substantive characters or an inline comment"
import { type ReviewContent, type ReviewDecision, decided, emptyReview } from "../../../gen/points__reviews.ts";

export interface ReviewActor { id: string; login: string; kind: string }

export type ReviewState = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";

export interface ReviewFacts {
  author: ReviewActor | null;
  state: ReviewState;
  submittedAt: number;
  body: string;
  inlineCommentCount: number;
}

export interface PullFacts { author: ReviewActor | null; mergedAt: number }

export type ReviewExclusion =
  | "qualifies"
  | "missing-reviewer"
  | "bot-reviewer"
  | "missing-pull-request-author"
  | "bot-pull-request-author"
  | "self-review"
  | "missing-submission-time"
  | "unmerged-pull-request"
  | "post-merge"
  | "non-decision"
  | "insufficient-substance";

export const approvalScoringEndsAt = 1790812800000;

/** @throws {never} */
export function isStrippedMarkup(code: number): boolean {
  return code === 35 || code === 42 || code === 95 || code === 62 || code === 96 || code === 126 || code === 91
    || code === 93 || code === 40 || code === 41 || code === 33 || code === 45;
}

/** @throws {never} */
export function findFrom(text: string, from: number, needle: string): number {
  //@ requires 0 <= from && from <= text.length && needle.length > 0
  //@ ensures \result === -1 || (from <= \result && \result + needle.length <= text.length)
  let i = from;
  while (i + needle.length <= text.length) {
    //@ invariant from <= i
    if (text.startsWith(needle, i)) return i;
    i = i + 1;
  }
  return -1;
}

/** @throws {never} */
export function withoutHtmlComments(body: string): string {
  let out = "";
  let i = 0;
  while (i < body.length) {
    //@ invariant 0 <= i && i <= body.length
    //@ decreases body.length - i
    const open = findFrom(body, i, "<!--");
    if (open < 0) {
      out = out + body.slice(i);
      i = body.length;
    } else {
      const close = findFrom(body, open + 4, "-->");
      if (close < 0) {
        out = out + body.slice(i);
        i = body.length;
      } else {
        out = out + body.slice(i, open);
        i = close + 3;
      }
    }
  }
  return out;
}

/** @throws {never} */
export function withoutMarkup(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    //@ invariant 0 <= i && i <= text.length
    if (!isStrippedMarkup(text.charCodeAt(i))) out = out + text.slice(i, i + 1);
    i = i + 1;
  }
  return out;
}

/** @throws {never} */
export function substantiveLength(body: string): number {
  //@ ensures \result >= 0
  return withoutMarkup(withoutHtmlComments(body)).trim().length;
}

/** @throws {never} */
//@ pure
export function reviewDecision(state: ReviewState): ReviewDecision {
  //@ ensures (\result === "ApprovedDecision" || \result === "ChangesRequestedDecision") === (state === "APPROVED" || state === "CHANGES_REQUESTED")
  return state === "APPROVED" ? "ApprovedDecision"
    : state === "CHANGES_REQUESTED" ? "ChangesRequestedDecision"
    : state === "COMMENTED" ? "CommentedOnly"
    : state === "DISMISSED" ? "DismissedReview"
    : "PendingReview";
}

/** @throws {never} */
export function reviewContent(review: ReviewFacts): ReviewContent {
  //@ ensures \result.decision === reviewDecision(review.state) && \result.inlineComments === review.inlineCommentCount && \result.substantiveChars >= 0
  return { decision: reviewDecision(review.state), substantiveChars: substantiveLength(review.body), inlineComments: review.inlineCommentCount };
}

/** @throws {never} */
export function sameReviewActor(left: ReviewActor, right: ReviewActor): boolean {
  return left.id === right.id || left.login.toLowerCase() === right.login.toLowerCase();
}

/** @throws {never} */
export function reviewExclusionReason(review: ReviewFacts, pull: PullFacts): ReviewExclusion {
  //@ ensures \result === "qualifies" ==> review.author !== null && review.author.kind !== "Bot"
  //@ ensures \result === "qualifies" ==> 0 <= review.submittedAt && review.submittedAt <= pull.mergedAt
  //@ ensures \result === "qualifies" ==> review.state === "APPROVED" || review.state === "CHANGES_REQUESTED"
  const reviewer = review.author;
  const author = pull.author;
  if (reviewer === null) return "missing-reviewer";
  if (reviewer.kind === "Bot") return "bot-reviewer";
  if (author === null) return "missing-pull-request-author";
  if (author.kind === "Bot") return "bot-pull-request-author";
  if (sameReviewActor(reviewer, author)) return "self-review";
  if (review.submittedAt < 0) return "missing-submission-time";
  if (pull.mergedAt < 0) return "unmerged-pull-request";
  if (review.submittedAt > pull.mergedAt) return "post-merge";
  const content = reviewContent(review);
  if (!decided(content)) return "non-decision";
  return emptyReview(content) ? "insufficient-substance" : "qualifies";
}

/** @throws {never} */
export function isExpandableReviewOpportunity(review: ReviewFacts, pull: PullFacts): boolean {
  //@ ensures \result ==> pull.mergedAt < 0 && (review.state === "APPROVED" || review.state === "CHANGES_REQUESTED")
  const reviewer = review.author;
  const author = pull.author;
  if (pull.mergedAt >= 0 || reviewer === null || author === null) return false;
  if (reviewer.kind === "Bot" || author.kind === "Bot" || sameReviewActor(reviewer, author)) return false;
  const content = reviewContent(review);
  if (review.submittedAt < 0 || !decided(content)) return false;
  if (review.state === "APPROVED" && review.submittedAt >= approvalScoringEndsAt) return false;
  return emptyReview(content);
}

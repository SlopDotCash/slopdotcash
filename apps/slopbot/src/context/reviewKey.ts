//@ backend dafny
// spec/slopbot/reviewLease.md, "An expired claim can be replaced and cannot finalize while waiting for takeover"

export const reviewKeyVersion = "visible-review-v1";
export const securityReviewPart = "security-review";

export interface ReviewKeyInput {
  readonly itemNode: string;
  readonly revision: string;
  readonly policyDigest: string;
  readonly itemDigest: string;
  readonly verifierKey: string;
  readonly sortedQualityIds: string[];
  readonly securityOnly: boolean;
}

export function joinedParts(parts: string[]): string {
  //@ requires parts.length >= 1
  let text = parts[0];
  let i = 1;
  while (i < parts.length) {
    //@ invariant 1 <= i && i <= parts.length
    text = text + "|" + parts[i];
    i = i + 1;
  }
  return text;
}

export function reviewKeyParts(input: ReviewKeyInput): string[] {
  //@ ensures \result.length >= 6
  //@ ensures \result[0] === reviewKeyVersion
  const head = [reviewKeyVersion, input.itemNode, input.revision, input.policyDigest, input.itemDigest, input.verifierKey];
  const withQuality = head.concat(input.sortedQualityIds);
  return input.securityOnly ? withQuality.concat([securityReviewPart]) : withQuality;
}

export function reviewKeyPreimage(input: ReviewKeyInput): string {
  return joinedParts(reviewKeyParts(input));
}

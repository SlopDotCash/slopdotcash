//@ backend dafny
// spec/slopbot/reviewLease.md, "An expired claim can be replaced and cannot finalize while waiting for takeover"; spec/slopbot/closure.md, "The evidence finding names a field that the declared change types of a signed Slop submission require"

export const reviewKeyVersion = "visible-review-v1";
export const securityReviewPart = "security-review";
export const submissionEvidencePart = "submission-evidence-v1";

export interface ReviewKeyInput {
  readonly itemNode: string;
  readonly revision: string;
  readonly policyDigest: string;
  readonly itemDigest: string;
  readonly verifierKey: string;
  readonly sortedQualityIds: string[];
  readonly evidenceParts: string[];
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

export function evidenceKeyParts(found: boolean, evidenceSwitch: string): string[] {
  //@ ensures found ==> \result.length === 2 && \result[0] === submissionEvidencePart && \result[1] === evidenceSwitch
  //@ ensures !found ==> \result.length === 0
  return found ? [submissionEvidencePart, evidenceSwitch] : [];
}

export function reviewKeyParts(input: ReviewKeyInput): string[] {
  //@ ensures \result.length === 6 + input.sortedQualityIds.length + input.evidenceParts.length + (input.securityOnly ? 1 : 0)
  //@ ensures \result[0] === reviewKeyVersion
  //@ ensures \result[1] === input.itemNode
  //@ ensures \result[2] === input.revision
  //@ ensures \result[3] === input.policyDigest
  //@ ensures \result[4] === input.itemDigest
  //@ ensures \result[5] === input.verifierKey
  //@ ensures forall(k, 0 <= k && k < input.sortedQualityIds.length ==> \result[6 + k] === input.sortedQualityIds[k])
  //@ ensures forall(k, 0 <= k && k < input.evidenceParts.length ==> \result[6 + input.sortedQualityIds.length + k] === input.evidenceParts[k])
  //@ ensures input.securityOnly ==> \result[\result.length - 1] === securityReviewPart
  const head = [reviewKeyVersion, input.itemNode, input.revision, input.policyDigest, input.itemDigest, input.verifierKey];
  const withEvidence = head.concat(input.sortedQualityIds).concat(input.evidenceParts);
  return input.securityOnly ? withEvidence.concat([securityReviewPart]) : withEvidence;
}

export function reviewKeyPreimage(input: ReviewKeyInput): string {
  return joinedParts(reviewKeyParts(input));
}

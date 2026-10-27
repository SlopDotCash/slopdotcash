import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import {
  VALUE_ASSESSMENT_SCHEMA,
  VALUE_RUBRIC_VERSION,
  VALUE_SYSTEM_PROMPT,
  validateValueAssessment,
} from "../../src/lib/value-assessment";
import type { ModelEnv } from "./models";
import { binarySourceLimitations } from "./value-binary";
import type { ValueEvidence } from "./value-evidence";
import {
  runValueInference,
  type ValueInferenceBudget,
} from "./value-inference";
import type { SubscriptionResult } from "./value-producer";

/** Callers must supply the approved spending mode and attempt identity.
 * This function returns a proposal and usage; it cannot publish or approve it.
 */
export async function assessValue(
  env: ModelEnv,
  evidence: ValueEvidence,
  policy: { sha: string; text: string },
  mayCall: () => Promise<boolean>,
  budget: ValueInferenceBudget,
) {
  if (evidence.indirectAcceptance)
    throw new Error("Indirect acceptance requires joint work-unit assessment");
  if (
    evidence.limitations.length > 0 ||
    (await binarySourceLimitations(evidence)).length > 0
  )
    throw new Error("Complete source evidence is required before valuation");
  if (!/^[a-f0-9]{40}$/u.test(policy.sha) || !policy.text.trim())
    throw new Error("Pinned project policy is required");
  const sourceDigest = await valueSourceDigest(evidence, policy);
  const result = await runValueInference(
    env,
    {
      system: VALUE_SYSTEM_PROMPT,
      policy: `Project policy at ${policy.sha}:\n${policy.text}`,
      item: JSON.stringify(evidence),
    },
    {
      sourceDigest,
      name: "slop_value_assessment",
      schema: VALUE_ASSESSMENT_SCHEMA,
      validate: (value) => validateEvidenceAssessment(value, evidence),
    },
    mayCall,
    budget,
  );
  return {
    rubricVersion: VALUE_RUBRIC_VERSION,
    sourceDigest,
    pullRequestNodeId: evidence.pull.node_id,
    headSha: evidence.pull.head.sha,
    policySha: policy.sha,
    assessedAt:
      "inferredAt" in result ? result.inferredAt : new Date().toISOString(),
    ...result,
  };
}

/** Receipt timestamps do not create a new source revision. */
export function valueSourceDigest(
  evidence: ValueEvidence,
  policy: { sha: string; text: string },
) {
  const { collectedAt: _collectedAt, ...sourceEvidence } = evidence;
  return sha256Hex(JSON.stringify({ policy, evidence: sourceEvidence }));
}

export function validateEvidenceAssessment(
  value: unknown,
  evidence: ValueEvidence,
) {
  if (evidence.indirectAcceptance) return null;
  return validateValueAssessment(value, {
    evidenceUrls: new Set(evidence.evidenceUrls),
    relatedPullRequestUrls: new Set(
      evidence.relatedPullRequests.map((pull) => pull.url),
    ),
    reviewIds: new Set(evidence.reviews.map((review) => review.node_id)),
    reviewUrls: new Map(
      evidence.reviews.map((review) => [review.node_id, review.html_url]),
    ),
    reviewTimes: new Map(
      evidence.reviews.map((review) => [review.node_id, review.submitted_at]),
    ),
    eligibleReviewIds: new Set(evidence.eligibleReviewIds),
    merged: evidence.pull.merged_at !== null,
    closed:
      evidence.pull.state === "closed" &&
      Number.isFinite(
        Date.parse(evidence.pull.merged_at ?? evidence.pull.closed_at ?? ""),
      ),
  });
}

export type ValueAssessmentResult =
  | Awaited<ReturnType<typeof assessValue>>
  | SubscriptionResult<Awaited<ReturnType<typeof assessValue>>>;

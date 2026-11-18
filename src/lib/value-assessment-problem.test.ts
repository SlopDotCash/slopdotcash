import { expect, test } from "bun:test";
import {
  VALUE_DIMENSIONS,
  validateValueAssessment,
  valueAssessmentProblem,
} from "./value-assessment";

const PR = "https://github.com/o/r/pull/1";
const REVIEW = "https://github.com/o/r/pull/1#pullrequestreview-1";
const context = {
  evidenceUrls: new Set([PR, REVIEW]),
  relatedPullRequestUrls: new Set<string>(),
  reviewIds: new Set(["R1"]),
  reviewUrls: new Map([["R1", REVIEW]]),
  reviewTimes: new Map<string, string | null>([["R1", "2026-11-01T00:00:00Z"]]),
  eligibleReviewIds: new Set(["R1"]),
  merged: true,
  closed: true,
};

function valid() {
  return {
    status: "assessed",
    tier: "small",
    rationale: "Repairs a verified defect.",
    dimensions: Object.fromEntries(
      VALUE_DIMENSIONS.map((name) => [name, `${name} explained`]),
    ),
    evidenceUrls: [PR],
    relatedPullRequests: [] as string[],
    limitations: [] as string[],
    reviews: [
      {
        sourceId: "R1",
        duplicateOf: null,
        tier: "standard",
        finding: "Found the failing case.",
        outcome: "Author fixed it.",
        evidenceUrls: [REVIEW, PR],
      },
    ],
  };
}

test("a valid assessment has no problem and validates", () => {
  expect(valueAssessmentProblem(valid(), context)).toBeNull();
  expect(validateValueAssessment(valid(), context)).not.toBeNull();
});

const cases: [string, (value: ReturnType<typeof valid>) => unknown][] = [
  [
    "evidenceUrls cites a URL not in the supplied evidence",
    (v) => {
      v.evidenceUrls = ["https://example.com/elsewhere"];
      return v;
    },
  ],
  [
    "an assessed merged pull request has no tier",
    (v) => ({ ...v, tier: null }),
  ],
  [
    "a credited review does not cite the review itself",
    (v) => {
      v.reviews[0].evidenceUrls = [PR, `${PR}/files`];
      context.evidenceUrls.add(`${PR}/files`);
      return v;
    },
  ],
  ["not every supplied review was assessed", (v) => ({ ...v, reviews: [] })],
  [
    "an unresolved assessment was given a tier",
    (v) => ({
      ...v,
      status: "unresolved",
      limitations: ["unclear scope"],
    }),
  ],
  [
    "the reply has missing or extra top-level fields",
    (v) => ({ ...v, extra: 1 }),
  ],
  [
    "a dimension explanation is empty",
    (v) => {
      v.dimensions[VALUE_DIMENSIONS[0]] = " ";
      return v;
    },
  ],
];

for (const [reason, mutate] of cases)
  test(`names the refused rule: ${reason}`, () => {
    const value = mutate(valid());
    expect(valueAssessmentProblem(value, context)).toBe(reason);
    expect(validateValueAssessment(value, context)).toBeNull();
  });

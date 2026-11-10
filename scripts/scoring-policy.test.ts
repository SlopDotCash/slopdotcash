import { describe, expect, it } from "bun:test";
import { allocatePullRequestReviewCredit } from "../src/lib/scoring-policy";

const SUBMITTED_AT = "2026-11-02T00:00:00.000Z";

describe("review pool with zero assessed size (B4)", () => {
  it("pays no review credit when the assessed size is zero", () => {
    const allocation = allocatePullRequestReviewCredit(
      [
        {
          reviewId: "PRR_1",
          actor: { id: "MDQ6VXNlcjE=" },
          submittedAt: SUBMITTED_AT,
          thirds: 24,
        },
      ],
      0,
    );
    expect(allocation.poolThirds).toBe(0);
    expect(allocation.credited.map((credited) => credited.shareThirds)).toEqual(
      [0],
    );
  });

  it("keeps the one-third floor when the assessed size is positive", () => {
    const allocation = allocatePullRequestReviewCredit(
      [
        {
          reviewId: "PRR_1",
          actor: { id: "MDQ6VXNlcjE=" },
          submittedAt: SUBMITTED_AT,
          thirds: 24,
        },
      ],
      1,
    );
    expect(allocation.poolThirds).toBe(1);
    expect(allocation.credited.map((credited) => credited.shareThirds)).toEqual(
      [1],
    );
  });
});

describe("reviewer order tie-break (B5)", () => {
  it("orders same-time reviewers by review node ID, not actor ID", () => {
    const allocation = allocatePullRequestReviewCredit(
      [
        {
          reviewId: "PRR_zzz",
          actor: { id: "MDQ6VXNlcjE=" },
          submittedAt: SUBMITTED_AT,
          thirds: 3,
        },
        {
          reviewId: "PRR_aaa",
          actor: { id: "MDQ6VXNlcjI=" },
          submittedAt: SUBMITTED_AT,
          thirds: 3,
        },
      ],
      6,
    );
    expect(
      allocation.credited.map((credited) => credited.source.reviewId),
    ).toEqual(["PRR_aaa", "PRR_zzz"]);
  });

  it("gives the fifth slot by review node ID when six reviewers share a time", () => {
    const allocation = allocatePullRequestReviewCredit(
      ["PRR_006", "PRR_005", "PRR_004", "PRR_003", "PRR_002", "PRR_001"].map(
        (reviewId, index) => ({
          reviewId,
          actor: { id: `MDQ6VXNlcj${index + 1}=` },
          submittedAt: SUBMITTED_AT,
          thirds: 3,
        }),
      ),
      30,
    );
    expect(
      allocation.credited.map((credited) => credited.source.reviewId),
    ).toEqual(["PRR_001", "PRR_002", "PRR_003", "PRR_004", "PRR_005"]);
    expect(allocation.beyondLimitReviewIds).toEqual(["PRR_006"]);
  });
});

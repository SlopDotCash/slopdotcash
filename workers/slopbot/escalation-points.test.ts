// The published penalty table (PRD section 7) and the contributor profile
// both state a penalty debit in points (POINTS_PER_THIRD = 10 per score
// third). The Slopbot appeal escalation notice must state the same figure
// in the same unit, or the contributor cannot reconcile the notice with
// their profile. This is the escalation-side propagation of the close
// notice fix (#2208): the close notice now says points, but the appeal
// escalation reason still said thirds.
import { expect, test } from "bun:test";
import { escalationFor } from "./appeals";

test("escalation states the debit threshold in points, not thirds", () => {
  expect(
    escalationFor({
      category: "spam",
      debitThirds: 24,
      moderatorReview: false,
      draftConfidence: 0.95,
    }),
  ).toBe("the debit at stake is 240 points or more");
});

test("escalation below the debit threshold stays null", () => {
  expect(
    escalationFor({
      category: "spam",
      debitThirds: 23,
      moderatorReview: false,
      draftConfidence: 0.95,
    }),
  ).toBeNull();
});

test("escalation for a confirmed-malicious finding is unchanged", () => {
  expect(
    escalationFor({
      category: "scam",
      debitThirds: 0,
      moderatorReview: false,
      draftConfidence: 0.95,
    }),
  ).toBe("the finding is a confirmed-malicious result");
});

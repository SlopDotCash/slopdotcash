// The published penalty table and the contributor profile state a penalty
// debit in points (PRD section 7, POINTS_PER_THIRD = 10 per score third). An
// appeal that escalates because of the debit is published in the item's
// appeal thread, so it must state the same figure in the same unit: a
// contributor reading "24 thirds" cannot reconcile it with the 240-point
// debit on their profile.
import { expect, test } from "bun:test";
import { escalationFor } from "./appeals";

test("an appeal escalation states the debit at stake in published points", () => {
  expect(
    escalationFor({
      category: "spam",
      debitThirds: 24,
      moderatorReview: false,
      draftConfidence: 1,
    }),
  ).toBe("the debit at stake is 240 points or more");
});

test("no escalation reason denominates an amount in score thirds", () => {
  // Every published reason, including the benign ones that carry no amount,
  // stays free of the internal unit.
  for (const reason of [
    escalationFor({
      category: "spam",
      debitThirds: 24,
      moderatorReview: false,
      draftConfidence: 1,
    }),
    escalationFor({
      category: "spam",
      debitThirds: 30,
      moderatorReview: false,
      draftConfidence: 1,
    }),
    escalationFor({
      category: "scam",
      debitThirds: 24,
      moderatorReview: true,
      draftConfidence: 1,
    }),
  ])
    expect(reason ?? "").not.toContain("third");
});

test("the escalation threshold still compares the recorded score thirds", () => {
  // Below the threshold and confident, Slopbot decides the appeal alone.
  expect(
    escalationFor({
      category: "spam",
      debitThirds: 23,
      moderatorReview: false,
      draftConfidence: 1,
    }),
  ).toBeNull();
});

test("low confidence still escalates a debit at the threshold", () => {
  expect(
    escalationFor({
      category: "spam",
      debitThirds: 24,
      moderatorReview: false,
      draftConfidence: 0.2,
    }),
  ).not.toBeNull();
});

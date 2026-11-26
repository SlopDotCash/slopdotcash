import { expect, test } from "bun:test";
import type { ValueEvidence } from "./value-evidence-types";
import { valueOutcomeRules } from "./value-review";

function evidence(pull: {
  state: string;
  merged_at: string | null;
  closed_at: string | null;
}) {
  return { pull } as unknown as ValueEvidence;
}

test("a merged pull request states it was merged and keeps the unresolved rule", () => {
  const rules = valueOutcomeRules(
    evidence({
      state: "closed",
      merged_at: "2026-11-17T10:00:00Z",
      closed_at: "2026-11-17T10:00:00Z",
    }),
  );
  expect(rules).toContain("This pull request was merged.");
  expect(rules).toContain("If status is unresolved, set tier to null");
  expect(rules).not.toContain("Set tier to null whatever its value");
  expect(rules).not.toContain("still open");
});

test("a closed unmerged pull request must have a null tier", () => {
  const rules = valueOutcomeRules(
    evidence({
      state: "closed",
      merged_at: null,
      closed_at: "2026-11-17T10:00:00Z",
    }),
  );
  expect(rules).toContain("This pull request was not merged. Set tier to null");
  expect(rules).not.toContain("still open");
});

test("an open pull request gets no tier and no review tiers", () => {
  const rules = valueOutcomeRules(
    evidence({ state: "open", merged_at: null, closed_at: null }),
  );
  expect(rules).toContain("not merged and is still open");
  expect(rules).toContain("give every review tier none.");
});

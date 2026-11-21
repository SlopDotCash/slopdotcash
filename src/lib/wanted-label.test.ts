import { expect, test } from "bun:test";
import { wantedIssues } from "./merge-activity";
import { assertProjectDefinition } from "./project-schema.mjs";
import { findProject } from "./projects.mjs";
import { WANTED_LABEL, wantedLabel } from "./wanted-label.mjs";

function withSlopbot(slopbot: Record<string, unknown>) {
  const original = findProject("asi");
  if (!original) throw new Error("Missing registry fixture");
  return { ...original, slopbot };
}

test("the owner setting is a boolean and turns on the one standard label", () => {
  const on = assertProjectDefinition(
    withSlopbot({ automaticClosure: false, wantedIssues: true }),
  );
  expect(wantedLabel(on)).toBe(WANTED_LABEL);
  expect(WANTED_LABEL).toBe("slop-wanted");
  expect(
    wantedLabel(
      assertProjectDefinition(
        withSlopbot({ automaticClosure: false, wantedIssues: false }),
      ),
    ),
  ).toBeNull();
  expect(
    wantedLabel(
      assertProjectDefinition(withSlopbot({ automaticClosure: false })),
    ),
  ).toBeNull();
  expect(() =>
    assertProjectDefinition(
      withSlopbot({ automaticClosure: false, wantedIssues: "slop-wanted" }),
    ),
  ).toThrow("project.slopbot.wantedIssues must be a boolean");
});

test("the page lists free wanted issues before ones with an open PR, only for the current label", () => {
  const issue = (number: number, openPullRequests: number) => ({
    number,
    title: `Issue ${number}`,
    url: `https://github.com/o/r/issues/${number}`,
    openPullRequests,
  });
  const rows = [
    {
      repository: "o/r",
      observedAt: "2026-11-20T00:00:00Z",
      lastAttemptFailed: false,
      lastMergedAt: null,
      waitingOutside: 0,
      waitingCapped: false,
      mergedOutsideLast30Days: 0,
      medianHoursToMerge: null,
      wantedLabel: WANTED_LABEL,
      wantedIssues: [issue(1, 2), issue(2, 0), issue(3, 0)],
    },
  ];
  expect(
    wantedIssues(rows, WANTED_LABEL, 10).map((item) => item.number),
  ).toEqual([2, 3, 1]);
  expect(wantedIssues(rows, WANTED_LABEL, 2)).toHaveLength(2);
  expect(wantedIssues(rows, null, 10)).toEqual([]);
  expect(wantedIssues(undefined, WANTED_LABEL, 10)).toEqual([]);
});

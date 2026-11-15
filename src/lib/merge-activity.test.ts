import { expect, test } from "bun:test";
import {
  mergeActivityCardLine,
  mergeActivityLine,
  type RepositoryMergeActivity,
} from "./merge-activity";

const NOW = new Date("2026-11-15T12:00:00Z");
const row = (
  patch: Partial<RepositoryMergeActivity>,
): RepositoryMergeActivity => ({
  repository: "owner/repo",
  observedAt: "2026-11-15T03:17:00Z",
  lastAttemptFailed: false,
  lastMergedAt: "2026-11-14T10:00:00Z",
  waitingOutside: 1,
  waitingCapped: false,
  mergedOutsideLast30Days: 2,
  medianHoursToMerge: 60,
  ...patch,
});

test("one line summarises merge speed with its check date", () => {
  expect(mergeActivityLine([row({})], NOW)).toBe(
    "Merging: last merge 1 day ago · 1 outside pull request waiting 7+ days for a maintainer · outside pull requests merged in a median 3 days (30 days) · checked 15 Nov",
  );
});

test("several repositories add their waiting pull requests and keep the oldest check date", () => {
  expect(
    mergeActivityLine(
      [
        row({ waitingOutside: 200, waitingCapped: true }),
        row({
          repository: "owner/other",
          observedAt: "2026-11-13T03:17:00Z",
          lastMergedAt: "2026-11-15T09:00:00Z",
          mergedOutsideLast30Days: 0,
          medianHoursToMerge: null,
        }),
      ],
      NOW,
    ),
  ).toBe(
    "Merging: last merge today · 201+ outside pull requests waiting 7+ days for a maintainer · outside pull requests merged in a median 3 days (30 days) · checked 13 Nov",
  );
});

test("no outside merges and nothing waiting read plainly; no rows read as unchecked", () => {
  expect(
    mergeActivityLine(
      [
        row({
          waitingOutside: 0,
          mergedOutsideLast30Days: 0,
          medianHoursToMerge: null,
          lastMergedAt: null,
        }),
      ],
      NOW,
    ),
  ).toBe(
    "Merging: no merge found · no outside pull request waiting 7+ days · no outside pull request merged in 30 days · checked 15 Nov",
  );
  expect(mergeActivityLine(undefined, NOW)).toBeNull();
});

test("the card line is short: last merge, waiting outside PRs, median", () => {
  expect(mergeActivityCardLine([row({ waitingOutside: 201 })], NOW)).toBe(
    "Last merge 1 day ago · 201 outside PRs waiting 7+ days · median merge 3 days",
  );
  expect(
    mergeActivityCardLine(
      [
        row({
          waitingOutside: 1,
          mergedOutsideLast30Days: 0,
          medianHoursToMerge: null,
        }),
      ],
      NOW,
    ),
  ).toBe("Last merge 1 day ago · 1 outside PR waiting 7+ days");
  expect(mergeActivityCardLine(undefined, NOW)).toBeNull();
});

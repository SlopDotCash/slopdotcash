import { expect, test } from "bun:test";
import { formatContributionWindow } from "../src/lib/contribution-window";

test("a contribution window shows its last included UTC day", () => {
  expect(
    formatContributionWindow(
      "2026-11-01T00:00:00.000Z",
      "2026-12-01T00:00:00.000Z",
    ),
  ).toBe("Nov 1, 2026–Nov 30, 2026");
  expect(
    formatContributionWindow(
      "2026-11-30T00:00:00.000Z",
      "2026-12-01T00:00:00.000Z",
    ),
  ).toBe("Nov 30, 2026–Nov 30, 2026");
  expect(
    formatContributionWindow(
      "2026-02-01T00:00:00.000Z",
      "2026-03-01T00:00:00.000Z",
    ),
  ).toBe("Feb 1, 2026–Feb 28, 2026");
  expect(
    formatContributionWindow(
      "2028-02-01T00:00:00.000Z",
      "2028-03-01T00:00:00.000Z",
    ),
  ).toBe("Feb 1, 2028–Feb 29, 2028");
  expect(
    formatContributionWindow(
      "2026-12-01T00:00:00.000Z",
      "2027-01-01T00:00:00.000Z",
    ),
  ).toBe("Dec 1, 2026–Dec 31, 2026");
  expect(
    formatContributionWindow(
      "2026-11-15T00:00:00.000Z",
      "2026-12-01T00:00:00.000Z",
    ),
  ).toBe("Nov 15, 2026–Nov 30, 2026");
});

/**
 * PRD section 7 in the real browser: a contributor's profile lists that
 * person's own reviews that did not score, each with its published reason,
 * so a reviewer can tell "not counted" from "not published yet". The
 * snapshot comes from the real snapshot builder; the exclusions are added
 * in the published shape and pass the snapshot validator.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import {
  assertLeaderboardSnapshot,
  createLeaderboardSnapshot,
} from "../../src/lib/leaderboard";
import type { ReviewExclusion } from "../../src/lib/leaderboard-types";
import { TARGET_REPOSITORIES } from "../../src/lib/repositories.mjs";
import { cycleIndexFixture } from "../fixtures";
import {
  GENERATED_AT,
  PENALIZED_AUTHOR,
  PROJECT_OWNER,
  penaltyScoreInput,
} from "../penalty-score-fixture";

const VIEWED_AT = new Date(Date.parse(GENERATED_AT) + 60 * 60 * 1000);
const ASI = "https://github.com/SlopDotCash/asi/pull";

function exclusion(
  pullRequestNumber: number,
  review: number,
  reason: ReviewExclusion["reason"],
  reviewerId: string,
): ReviewExclusion {
  const pullRequestId = `PR_review_exclusion_${pullRequestNumber}`;
  const reviewId = `PRR_review_exclusion_${review}`;
  return {
    id: `${pullRequestId}:review-exclusion:${reviewId}`,
    reviewId,
    pullRequestId,
    pullRequestNumber,
    repository: "elizaOS/asi",
    url: `${ASI}/${pullRequestNumber}#pullrequestreview-${review}`,
    reason,
    reviewerId,
  };
}

function publishedSnapshot() {
  const realNow = Date.now;
  Date.now = () => VIEWED_AT.getTime();
  try {
    const snapshot = createLeaderboardSnapshot(penaltyScoreInput([]));
    snapshot.reviewExclusions = [
      ...(snapshot.reviewExclusions ?? []),
      exclusion(71, 7101, "unchanged-outcome", PENALIZED_AUTHOR.id),
      exclusion(72, 7201, "unchanged-outcome", PENALIZED_AUTHOR.id),
      exclusion(73, 7301, "post-merge", PENALIZED_AUTHOR.id),
      // Another reviewer's exclusion never shows on this profile.
      exclusion(74, 7401, "self-review", PROJECT_OWNER.id),
    ];
    assertLeaderboardSnapshot(snapshot);
    return snapshot;
  } finally {
    Date.now = realNow;
  }
}

function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    if (
      new URL(response.url()).origin === new URL(page.url()).origin &&
      response.status() >= 400
    )
      errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}

test("a profile lists its own unscored reviews with their reasons", async ({
  page,
}, info) => {
  const snapshot = publishedSnapshot();
  await page.clock.setFixedTime(VIEWED_AT);
  await page.route("**/data/leaderboard.json?**", (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.route("**/data/cycles/index.json*", (route) =>
    route.fulfill({ json: cycleIndexFixture() }),
  );
  await page.route("**/data/profiles.json", (route) =>
    route.fulfill({
      json: {
        schemaVersion: "1",
        startedAt: VIEWED_AT.toISOString(),
        generatedAt: VIEWED_AT.toISOString(),
        repositories: TARGET_REPOSITORIES.map((repository) => ({
          repository: repository.id,
          count: 0,
          excluded: 0,
        })),
        people: [],
      },
    }),
  );
  await page.route("**/api/v1/wallet-claims/actors/*/current", (route) =>
    route.fulfill({ json: null }),
  );
  await page.route("https://avatars.githubusercontent.com/**", async (route) =>
    route.fulfill({ response: await page.request.get("/slop-mark.svg") }),
  );
  const errors = watch(page);

  await page.goto(`/contributors/${PENALIZED_AUTHOR.login}`, {
    waitUntil: "networkidle",
  });
  const section = page.getByRole("region", {
    name: "Reviews that did not score",
  });
  await expect(section).toContainText(
    `3 in the last ${snapshot.window.days} days`,
  );
  await expect(section).toContainText(
    "Did not change what merged: 2 · Submitted after the merge: 1",
  );
  const rows = section.getByRole("listitem");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toHaveText(/ASI #73\s+Submitted after the merge/u);
  await expect(section.getByRole("link", { name: /ASI #72/u })).toHaveAttribute(
    "href",
    `${ASI}/72#pullrequestreview-7201`,
  );
  await expect(section).not.toContainText("#74");
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("profile-review-exclusions.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(section).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("profile-review-exclusions-mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

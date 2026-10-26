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
import type {
  GitHubActor,
  LeaderboardInput,
  ReviewExclusion,
} from "../../src/lib/leaderboard-types";
import { TARGET_REPOSITORIES } from "../../src/lib/repositories.mjs";
import { valueScoringPolicy } from "../../src/lib/scoring-policy";
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
  reviewer: GitHubActor,
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
    reviewer,
  };
}

function publishedSnapshot() {
  const realNow = Date.now;
  Date.now = () => VIEWED_AT.getTime();
  try {
    const snapshot = createLeaderboardSnapshot(penaltyScoreInput([]));
    snapshot.reviewExclusions = [
      ...(snapshot.reviewExclusions ?? []),
      exclusion(71, 7101, "unchanged-outcome", PENALIZED_AUTHOR),
      exclusion(72, 7201, "unchanged-outcome", PENALIZED_AUTHOR),
      exclusion(73, 7301, "post-merge", PENALIZED_AUTHOR),
      // Another reviewer's exclusion never shows on this profile.
      exclusion(74, 7401, "self-review", PROJECT_OWNER),
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

async function prepareProfile(
  page: Page,
  snapshot: ReturnType<typeof createLeaderboardSnapshot>,
  directory: GitHubActor[] = [],
) {
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
        people: directory.map((actor) => ({ ...actor, repositories: [] })),
      },
    }),
  );
  await page.route("**/api/v1/wallet-claims/actors/*/current", (route) =>
    route.fulfill({ json: null }),
  );
  await page.route("https://avatars.githubusercontent.com/**", async (route) =>
    route.fulfill({ response: await page.request.get("/slop-mark.svg") }),
  );
  return watch(page);
}

test("a profile lists its own excluded reviews with their reasons", async ({
  page,
}, info) => {
  const snapshot = publishedSnapshot();
  const errors = await prepareProfile(page, snapshot);
  await page.goto(`/contributors/${PENALIZED_AUTHOR.login}`, {
    waitUntil: "networkidle",
  });
  const section = page.getByRole("region", {
    name: "Review credit exclusions",
  });
  await expect(section).toContainText("3 recorded in this snapshot");
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

const REVIEW_ONLY: GitHubActor = {
  id: "MDQ6VXNlcjQ0",
  login: "review-only",
  avatarUrl: "https://avatars.githubusercontent.com/u/44?v=4",
  url: "https://github.com/review-only",
  kind: "User",
};

/** Real policy producer: tier-none and old positive reviews are both exclusions. */
function reviewOnlySnapshot() {
  const input = penaltyScoreInput([]);
  const pull = input.mergedPullRequests.find((row) => row.id === "PR_november");
  if (!pull) throw new Error("Missing accepted fixture work");
  const reviews = [
    { id: "PRR_none", submittedAt: "2026-11-04T00:00:00.000Z", tier: "none" },
    {
      id: "PRR_old",
      submittedAt: "2026-10-01T00:00:00.000Z",
      tier: "standard",
    },
  ];
  input.valuePolicy = {
    ...valueScoringPolicy(),
    effectiveAt: "2026-09-01T00:00:00.000Z",
  };
  input.mergedPullRequests = input.mergedPullRequests.map((row) =>
    row.id !== pull.id
      ? row
      : {
          ...row,
          createdAt: "2026-09-20T00:00:00.000Z",
          reviews: reviews.map((review, index) => ({
            id: review.id,
            submittedAt: review.submittedAt,
            body: "Checked the accepted behavior.",
            state: "APPROVED",
            url: `${pull.url}#pullrequestreview-${8001 + index}`,
            author: REVIEW_ONLY,
            inlineCommentCount: 0,
            commitId: pull.headRefOid,
          })),
        },
  );
  input.mergedPullRequestOutcomes = input.mergedPullRequestOutcomes?.map(
    (row) =>
      row.id === pull.id
        ? { ...row, createdAt: "2026-09-20T00:00:00.000Z" }
        : row,
  );
  input.valueDecisions = new Map([
    [
      pull.id,
      {
        status: "assessed",
        history: [{ recorded_at: "2026-11-19T00:00:00.000Z" }],
        latestDigest: "c".repeat(64),
        implementationActorNodeIds: [PENALIZED_AUTHOR.id],
        record: {
          pullRequestNodeId: pull.id,
          repository: "elizaOS/asi",
          headSha: pull.headRefOid,
          occurredAt: pull.mergedAt,
          assessment: {
            tier: "small",
            rationale: "Repairs the accepted behavior.",
          },
        },
        assessment: {
          tier: "small",
          rationale: "Repairs the accepted behavior.",
          reviews: reviews.map((review) => ({
            sourceId: review.id,
            tier: review.tier,
            duplicateOf: null,
            finding: "Checked the accepted behavior.",
            outcome: "The outcome is retained.",
            evidenceUrls: [],
          })),
        },
      },
    ],
  ]) as unknown as LeaderboardInput["valueDecisions"];
  const realNow = Date.now;
  Date.now = () => VIEWED_AT.getTime();
  try {
    const snapshot = createLeaderboardSnapshot(input);
    assertLeaderboardSnapshot(snapshot);
    return snapshot;
  } finally {
    Date.now = realNow;
  }
}

test("a review-only nonmember sees accurate snapshot omissions", async ({
  page,
}, info) => {
  const snapshot = reviewOnlySnapshot();
  expect(snapshot.leaders.some((row) => row.actor.id === REVIEW_ONLY.id)).toBe(
    false,
  );
  expect(snapshot.reviewExclusions?.map((row) => row.reason).sort()).toEqual([
    "review-credit-outside-window",
    "review-credit-zero-share",
  ]);
  const errors = await prepareProfile(page, snapshot);
  await page.goto(`/contributors/${REVIEW_ONLY.login}`, {
    waitUntil: "networkidle",
  });
  const section = page.getByRole("region", {
    name: "Review credit exclusions",
  });
  await expect(section).toBeVisible();
  await expect(section).toContainText("2 recorded in this snapshot");
  await expect(section).toContainText("No review share: 1");
  await expect(section).toContainText(
    "Submitted outside the scoring window: 1",
  );
  await expect(section).toContainText("Earlier Points can remain.");
  await expect(section).not.toContainText(/rounded|in the last/u);
  await expect(section.getByRole("listitem")).toHaveCount(2);
  const explanation = section.getByRole("link", { name: "How reviews score" });
  await explanation.focus();
  await expect(explanation).toBeFocused();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("review-only-profile.png"),
    fullPage: true,
  });
  await explanation.press("Enter");
  await expect(page).toHaveURL(/\/how-it-works#points$/u);
  expect(errors).toEqual([]);
});

test("the current directory vetoes a renamed or recycled review-only login", async ({
  page,
}) => {
  const snapshot = reviewOnlySnapshot();
  const renamed = {
    ...REVIEW_ONLY,
    login: "renamed-reviewer",
    url: "https://github.com/renamed-reviewer",
  };
  const errors = await prepareProfile(page, snapshot, [renamed]);
  await page.goto(`/contributors/${REVIEW_ONLY.login}`, {
    waitUntil: "networkidle",
  });
  await expect(
    page.getByText(
      "Current contributor identity could not be verified. Contribution and wallet records are not shown.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Review credit exclusions" }),
  ).toHaveCount(0);
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
        people: [{ ...REVIEW_ONLY, id: "MDQ6VXNlcjQ1", repositories: [] }],
      },
    }),
  );
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.getByText(
      "Current contributor identity could not be verified. Contribution and wallet records are not shown.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Review credit exclusions" }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("legacy snapshots without reviewer metadata do not report zero exclusions", async ({
  page,
}) => {
  const snapshot = publishedSnapshot();
  for (const row of snapshot.reviewExclusions ?? []) delete row.reviewer;
  assertLeaderboardSnapshot(snapshot);
  const errors = await prepareProfile(page, snapshot);
  await page.goto(`/contributors/${PENALIZED_AUTHOR.login}`, {
    waitUntil: "networkidle",
  });
  await expect(
    page.getByRole("heading", { name: PENALIZED_AUTHOR.login, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Review credit exclusions" }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

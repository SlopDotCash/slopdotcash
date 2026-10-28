/**
 * A review-only login resolves through the published review exclusions, so the
 * current profile directory must still veto a renamed or recycled login. The
 * snapshot comes from the real snapshot builder.
 */
import type { Page } from "@playwright/test";
import {
  assertLeaderboardSnapshot,
  createLeaderboardSnapshot,
} from "../../src/lib/leaderboard";
import type {
  GitHubActor,
  LeaderboardInput,
} from "../../src/lib/leaderboard-types";
import { TARGET_REPOSITORIES } from "../../src/lib/repositories.mjs";
import { valueScoringPolicy } from "../../src/lib/scoring-policy";
import { cycleIndexFixture } from "../fixtures";
import {
  GENERATED_AT,
  PENALIZED_AUTHOR,
  penaltyScoreInput,
} from "../penalty-score-fixture";
import { expect, test } from "./fixtures";

const VIEWED_AT = new Date(Date.parse(GENERATED_AT) + 60 * 60 * 1000);

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
}

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

test("the current directory vetoes a renamed or recycled review-only login", async ({
  page,
}) => {
  const snapshot = reviewOnlySnapshot();
  const renamed = {
    ...REVIEW_ONLY,
    login: "renamed-reviewer",
    url: "https://github.com/renamed-reviewer",
  };
  await prepareProfile(page, snapshot, [renamed]);
  await page.goto(`/contributors/${REVIEW_ONLY.login}`, {
    waitUntil: "networkidle",
  });
  await expect(
    page.getByText("Contributor records are unavailable."),
  ).toBeVisible();
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
    page.getByText("Contributor records are unavailable."),
  ).toBeVisible();
});

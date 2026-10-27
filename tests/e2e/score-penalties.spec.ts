/**
 * PRD section 7 in the real browser: a published Slopbot debit and an explicit
 * payout exclusion show where a visitor reads the score. The snapshot comes
 * from the real snapshot builder; only the GitHub census is synthetic. The
 * worker-to-score path is covered in workers/slopbot/penalty-appeal.test.ts.
 */
import { createLeaderboardSnapshot } from "../../src/lib/leaderboard";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { TARGET_REPOSITORIES } from "../../src/lib/repositories.mjs";
import { PENALTY_TABLE } from "../../workers/slopbot/penalties";
import { cycleIndexFixture } from "../fixtures";
import {
  CLOSED_PULL_REQUEST_ID,
  GENERATED_AT,
  PENALIZED_AUTHOR,
  PROJECT_OWNER,
  penaltyScoreInput,
} from "../penalty-score-fixture";
import { expect, expectAccessible, test } from "./fixtures";

const VIEWED_AT = new Date(Date.parse(GENERATED_AT) + 60 * 60 * 1000);

/** The fixture is dated in November 2026; publish it as of that time. */
function publishedSnapshot() {
  const realNow = Date.now;
  Date.now = () => VIEWED_AT.getTime();
  try {
    return createLeaderboardSnapshot(
      penaltyScoreInput([
        {
          itemNodeId: CLOSED_PULL_REQUEST_ID,
          authorGithubId: "42",
          category: "spam",
          tableVersion: "slopbot-penalties-v1",
          debitThirds: PENALTY_TABLE.spam.debitThirds,
          period: "2026-11",
          recordedAt: "2026-11-10T00:00:05.000Z",
        },
      ]),
    );
  } finally {
    Date.now = realNow;
  }
}

test("a published debit and a payout exclusion show on the profile and the cycle", async ({
  page,
}, info) => {
  const snapshot = publishedSnapshot();
  const asi = PROJECTS.find((project) => project.id === "asi");
  if (!asi) throw new Error("ASI fixture project is missing");
  const excluded = {
    ...asi,
    reward: {
      ...asi.reward,
      payoutExclusions: [
        {
          actorId: "43",
          nodeId: PROJECT_OWNER.id,
          login: PROJECT_OWNER.login,
          relationship: "owner",
          fromCycle: "2026-11",
          untilCycle: null,
        },
      ],
    },
  };
  await page.clock.setFixedTime(VIEWED_AT);
  await page.route("**/data/fixture-project-registry.json", (route) =>
    route.fulfill({
      json: {
        schemaVersion: "1",
        projects: PROJECTS.map((project) =>
          project.id === "asi" ? excluded : project,
        ),
      },
    }),
  );
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

  await page.goto(`/contributors/${PENALIZED_AUTHOR.login}`, {
    waitUntil: "networkidle",
  });
  // October keeps 1 point; the November debit stops at November's 1/3.
  await expect(
    page.getByTitle("Closed cycles and ledger events outside those cycles"),
  ).toHaveCount(0);
  const penalties = page.getByRole("region", { name: "Penalties" });
  await expect(penalties).toContainText("1 recorded");
  await expect(penalties.getByRole("listitem")).toHaveText(
    /ASI #5\s+Spam · November 2026 · −30 point debit · 10 applied/u,
  );
  await expect(
    penalties.getByRole("link", { name: /ASI #5/u }),
  ).toHaveAttribute("href", "https://github.com/SlopDotCash/asi/pull/5");
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("profile-penalty.png"),
    fullPage: true,
  });

  await page.goto("/cycles/asi/2026-11", { waitUntil: "networkidle" });
  const table = page.getByRole("table", { name: "ASI leaderboard" });
  const row = (login: string) =>
    table.getByRole("row").filter({ hasText: login });
  await expect(row(PENALIZED_AUTHOR.login)).toContainText(
    "After a 10 point Slopbot penalty",
  );
  await expect(row(PROJECT_OWNER.login)).toContainText(
    "Excluded from payout (owner)",
  );
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("cycle-penalty-exclusion.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(row(PROJECT_OWNER.login)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("cycle-penalty-exclusion-mobile.png"),
    fullPage: true,
  });
});

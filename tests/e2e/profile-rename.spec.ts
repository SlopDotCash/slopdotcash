/** Public-record fixtures exercise profile identity, not OAuth or settlement. */
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { assertCycleIndex } from "../../src/lib/cycle-index";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import {
  assertFundingReviewIndex,
  createFundingReview,
} from "../../src/lib/funding-review-data";
import { assertLeaderboardSnapshot } from "../../src/lib/leaderboard";
import { assertProfiles } from "../../src/lib/profiles";
import { TARGET_REPOSITORIES } from "../../src/lib/repositories.mjs";
import { archivedPaidCycleIndex, snapshotFixture } from "../fixtures";

async function profileRecords(
  page: Page,
  options: {
    reusedHandle?: boolean;
    frozenOnly?: boolean;
    directoryOnly?: boolean;
    unverified?: boolean;
  } = {},
) {
  const snapshot = snapshotFixture();
  const current = snapshot.leaders[0].actor;
  current.id = "MDQ6VXNlcjE=";
  if (options.reusedHandle) {
    current.login = "archive-only";
    current.url = "https://github.com/archive-only";
  }
  const cycles = archivedPaidCycleIndex();
  const archived = cycles.cycles[0].contributors[0].actor;
  archived.id = "MDQ6VXNlcjI=";
  if (!options.reusedHandle && !options.directoryOnly && !options.unverified)
    archived.id = current.id;
  const reviews = assertFundingReviewIndex({
    schemaVersion: "1",
    generatedAt: "2026-09-02T00:00:00.000Z",
    reviews: [
      createFundingReview({
        projectId: "eliza",
        cycleId: "2026-08",
        sourceSnapshotSha256: "a".repeat(64),
        sourceAuditSha256: "b".repeat(64),
        observedAt: "2026-09-02T00:00:00.000Z",
        provenance: {
          ruleVersion: "slop-score-v2",
          walletObservationsSha256: "c".repeat(64),
          snapshotFrom: "2026-07-28T00:00:00.000Z",
          snapshotTo: "2026-09-01T00:00:00.000Z",
          periodFrom: "2026-08-01T00:00:00.000Z",
          periodTo: "2026-09-01T00:00:00.000Z",
          snapshotLedgerCount: 1,
          sourceMergedPullRequests: 1,
          mergedCensus: 1,
          scoredMerges: 1,
        },
        counts: {
          contributors: 1,
          events: 1,
          scoreThirds: "3",
          weight: "30000",
        },
        contributors: [
          {
            actor: { ...archived },
            scoreThirds: "3",
            weight: "30000",
            eventCount: 1,
            eventIdsSha256: "d".repeat(64),
            wallet: null,
            lookupUnavailable: false,
          },
        ],
      }),
    ],
  });
  if (options.frozenOnly) cycles.cycles = [];
  const now = new Date().toISOString();
  const profiles = {
    schemaVersion: "1",
    startedAt: now,
    generatedAt: now,
    repositories: TARGET_REPOSITORIES.map((repository) => ({
      repository: repository.id,
      count: 0,
      excluded: 0,
    })),
    people: [
      {
        id: current.id,
        login: current.login,
        avatarUrl: current.avatarUrl,
        repositories: [],
      },
      ...(options.directoryOnly
        ? [
            {
              ...archived,
              avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
              repositories: [],
            },
          ]
        : []),
    ],
  };
  assertLeaderboardSnapshot(snapshot);
  assertCycleIndex(cycles);
  assertProfiles(profiles);
  await page.route("**/data/profiles.json", (r) =>
    r.fulfill({ json: profiles }),
  );
  await page.route("**/data/leaderboard.json?**", (r) =>
    r.fulfill({ json: snapshot }),
  );
  await page.route("**/data/cycles/index.json*", (r) =>
    r.fulfill({ json: cycles }),
  );
  await page.route("**/data/funding-reviews.json*", (r) =>
    r.fulfill({ json: reviews }),
  );
  // Decorative images are local fixtures, so these identity regressions do
  // not depend on GitHub's image service or a machine-specific CA store.
  await page.route("https://avatars.githubusercontent.com/**", async (r) =>
    r.fulfill({ response: await page.request.get("/slop-mark.svg") }),
  );
  const walletRequests: string[] = [];
  await page.route("**/api/v1/wallet-claims/actors/*/current", (r) => {
    walletRequests.push(new URL(r.request().url()).pathname);
    return r.fulfill({ json: null });
  });
  return {
    snapshot,
    cycles,
    reviews,
    profiles,
    current,
    archived,
    walletRequests,
  };
}

test("a renamed contributor keeps archived cycles and frozen-month links", async ({
  page,
}, info) => {
  const { current } = await profileRecords(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`/contributors/${current.login}`, {
    waitUntil: "networkidle",
  });
  await expect(page.locator("main.profile-page")).toBeVisible();
  const history = page.locator(".profile-section", {
    has: page.getByRole("heading", { name: "Past cycles", exact: true }),
  });
  const pastCycle = history.getByRole("link");
  await expect(pastCycle).toHaveAttribute("href", "/cycles/eliza/2026-07");
  await expect(pastCycle).toContainText("7 score");
  await expect(pastCycle).toContainText("$1");
  const frozen = page.locator(".profile-section", {
    has: page.getByRole("heading", { name: "Frozen months", exact: true }),
  });
  await expect(frozen.getByRole("link")).toHaveAttribute(
    "href",
    "/projects/eliza/funding",
  );
  await expect(frozen).toContainText("2026-08");
  await expect(frozen).toContainText("1 score");
  // July Eliza events are replaced by the archived 7, plus 10 from Delta
  // Star. Resolving identity must not recalculate or double-count the score.
  await expect(
    page.getByTitle("Closed cycles and ledger events outside those cycles"),
  ).toHaveText("17");
  await pastCycle.focus();
  await expect(pastCycle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/cycles\/eliza\/2026-07$/u);
  await page.goBack();
  await expect(pastCycle).toBeVisible();
  await page.reload();
  await expect(pastCycle).toBeVisible();
  await expect(frozen.getByRole("link")).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath("renamed-profile.png") });
  expect(errors).toEqual([]);
});

test("a different actor reusing an old login does not inherit its history", async ({
  page,
}) => {
  const { current } = await profileRecords(page, { reusedHandle: true });
  await page.goto(`/contributors/${current.login}`, {
    waitUntil: "networkidle",
  });
  await expect(page.locator("main.profile-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Past cycles" })).toHaveCount(
    0,
  );
  // networkidle above includes the independent frozen-month loader.
  await expect(
    page.getByRole("heading", { name: "Frozen months" }),
  ).toHaveCount(0);
  await expect(
    page.getByTitle("Closed cycles and ledger events outside those cycles"),
  ).toHaveText("10");
  await expect(
    page.getByRole("heading", { name: current.login, exact: true }),
  ).toBeVisible();
});

for (const frozenOnly of [false, true]) {
  test(`an inactive new owner does not inherit ${frozenOnly ? "frozen-only" : "archived"} records or wallet lookups`, async ({
    page,
  }, info) => {
    const { current, archived, walletRequests } = await profileRecords(page, {
      frozenOnly,
    });
    // The new owner has no leaderboard, points, census or membership record.
    await page.goto(`/contributors/${archived.login}`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByRole("heading", { name: "Past cycles" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Frozen months" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: current.login }),
    ).toHaveCount(0);
    await expect(page.getByText(/Historical payout wallet/)).toHaveCount(0);
    await expect(
      page.getByTitle("Closed cycles and ledger events outside those cycles"),
    ).toHaveCount(0);
    expect(walletRequests).toEqual([]);
    await page.reload({ waitUntil: "networkidle" });
    expect(walletRequests).toEqual([]);
    await page.screenshot({ path: info.outputPath("inactive-owner.png") });
    // The same immutable actor's new URL must retain its own history.
    await page.goto(`/contributors/${current.login}`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByRole("heading", { name: current.login, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByTitle("Closed cycles and ledger events outside those cycles"),
    ).toHaveText(frozenOnly ? "34" : "17");
    await expect(
      page.getByRole("heading", { name: "Frozen months" }),
    ).toBeVisible();
    expect(walletRequests).toEqual(["/api/v1/wallet-claims/actors/1/current"]);
  });
}

test("a directory-verified historical contributor keeps archived and frozen links", async ({
  page,
}) => {
  const { archived } = await profileRecords(page, { directoryOnly: true });
  await page.goto(`/contributors/${archived.login}`, {
    waitUntil: "networkidle",
  });
  await expect(
    page.getByRole("heading", { name: "Past cycles", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Frozen months", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTitle("Closed cycles and ledger events outside those cycles"),
  ).toHaveText("7");
});

test("historical names alone do not identify a current contributor or wallet", async ({
  page,
}) => {
  const { archived, walletRequests } = await profileRecords(page, {
    unverified: true,
  });
  await page.goto(`/contributors/${archived.login}`, {
    waitUntil: "networkidle",
  });
  await expect(page.getByRole("heading", { name: "Past cycles" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "Frozen months" }),
  ).toHaveCount(0);
  await expect(page.getByText(/Historical payout wallet/)).toHaveCount(0);
  expect(walletRequests).toEqual([]);
  await expect(page.getByRole("status")).toContainText(
    "Current contributor identity could not be verified",
  );
});

test("a new owner listed without activity uses only its own identity and wallet", async ({
  page,
}) => {
  const { profiles, archived, walletRequests } = await profileRecords(page);
  profiles.people.push({
    id: "MDQ6VXNlcjI=",
    login: archived.login,
    avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
    repositories: [],
  });
  assertProfiles(profiles);
  await page.goto(`/contributors/${archived.login}`, {
    waitUntil: "networkidle",
  });
  await expect(
    page.getByRole("heading", { name: archived.login, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Past cycles" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "Frozen months" }),
  ).toHaveCount(0);
  await expect(page.getByText(/Historical payout wallet/)).toHaveCount(0);
  expect(walletRequests).toEqual(["/api/v1/wallet-claims/actors/2/current"]);
});

test("conflicting current names withhold history and wallet lookups", async ({
  page,
}) => {
  const { profiles, archived, walletRequests } = await profileRecords(page);
  // The activity snapshot knows the rename but the directory still has the old alias.
  profiles.people[0].login = archived.login;
  assertProfiles(profiles);
  await page.goto(`/contributors/${archived.login}`, {
    waitUntil: "networkidle",
  });
  await expect(page.getByRole("status")).toContainText(
    "Current contributor identity could not be verified",
  );
  await expect(page.getByRole("heading", { name: "Past cycles" })).toHaveCount(
    0,
  );
  await expect(page.getByText(/Historical payout wallet/)).toHaveCount(0);
  expect(walletRequests).toEqual([]);
});

test("an unavailable identity directory hides historical records until retry succeeds", async ({
  page,
}) => {
  const { profiles, archived, walletRequests } = await profileRecords(page, {
    directoryOnly: true,
  });
  let unavailable = true;
  await page.route("**/data/profiles.json", (route) =>
    unavailable
      ? route.fulfill({ status: 503, body: "Unavailable" })
      : route.fulfill({ json: profiles }),
  );
  await page.goto(`/contributors/${archived.login}`, {
    waitUntil: "networkidle",
  });
  await expect(page.getByRole("status")).toContainText(
    "Current contributor identity is unavailable",
  );
  expect(walletRequests).toEqual([]);
  unavailable = false;
  await page
    .getByRole("button", { name: "Retry profile", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Past cycles", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Frozen months", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => walletRequests)
    .toEqual(["/api/v1/wallet-claims/actors/2/current"]);
});

async function serveProfileSite(page: Page) {
  const { site } = deploymentOrigins(
    deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
  );
  await page.route(`${site}/**`, (route) =>
    route.fulfill({
      path: join(
        process.cwd(),
        "dist",
        route.request().resourceType() === "document"
          ? "index.html"
          : new URL(route.request().url()).pathname,
      ),
    }),
  );
  return site;
}

for (const staleMembership of [false, true]) {
  test(
    staleMembership
      ? "a stale public membership cannot override a known rename"
      : "an anonymous visitor sees a points-only new owner's own identity",
    async ({ page }) => {
      const site = await serveProfileSite(page);
      const { current, archived, walletRequests } = await profileRecords(page);
      const member = {
        actor: {
          id: staleMembership ? current.id : "MDQ6VXNlcjI=",
          login: archived.login,
        },
        joinedAt: "2026-10-17T00:00:00.000Z",
        public: true,
        welcome: 5,
      };
      await page.route(`${site}/api/v1/points/**`, (route) =>
        route.fulfill({
          json: new URL(route.request().url()).pathname.endsWith("/member")
            ? member
            : null,
        }),
      );
      await page.route(
        "**/api/v1/payments/actors/*/direct-transfers",
        (route) => route.fulfill({ json: { transfers: [], totalMicro: "0" } }),
      );
      await page.goto(`${site}/contributors/${archived.login}`, {
        waitUntil: "networkidle",
      });
      await expect(
        page.getByRole("heading", { name: archived.login, exact: true }),
      ).toBeVisible();
      if (staleMembership) {
        await expect(
          page.getByRole("heading", { name: "Past cycles" }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("heading", { name: "Frozen months" }),
        ).toHaveCount(0);
        await expect(page.getByText(/Historical payout wallet/)).toHaveCount(0);
        await expect(page.getByRole("status")).toContainText(
          "could not be verified",
        );
        await expect(
          page.getByText("Points · recorded history", { exact: true }),
        ).toHaveCount(0);
        expect(walletRequests).toEqual([]);
        return;
      }
      await expect(
        page
          .getByText("Points · recorded history", { exact: true })
          .locator("..")
          .locator("strong"),
      ).toHaveText("5");
      await expect(
        page.getByRole("heading", { name: "Past cycles" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Frozen months" }),
      ).toHaveCount(0);
      await expect(page.getByText(/Historical payout wallet/)).toHaveCount(0);
      expect(walletRequests).toEqual([
        "/api/v1/wallet-claims/actors/2/current",
      ]);
    },
  );
}

for (const scenario of [
  "renamed actor",
  "reassigned login",
  "delayed directory",
  "current member",
] as const) {
  test(`directory-only membership identity: ${scenario}`, async ({ page }) => {
    const site = await serveProfileSite(page);
    const { cycles, reviews, profiles, archived, walletRequests } =
      await profileRecords(page, { directoryOnly: true });
    archived.login = "alice";
    const wallet = cycles.cycles[0].contributors[0].wallet;
    if (wallet && "sourceCommit" in wallet)
      wallet.sourceUrl = `https://github.com/alice/alice/blob/${wallet.sourceCommit}/README.md`;
    reviews.reviews[0].contributors[0].actor.login = "alice";
    profiles.people = profiles.people.filter(
      (person) => person.id !== archived.id,
    );
    if (scenario !== "reassigned login")
      profiles.people.push({
        ...archived,
        login: "alice2",
        avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
        repositories: [],
      });
    if (scenario === "reassigned login" || scenario === "delayed directory")
      profiles.people.push({
        ...archived,
        id: "MDQ6VXNlcjM=",
        login: "alice",
        avatarUrl: "https://avatars.githubusercontent.com/u/3?v=4",
        repositories: [],
      });
    assertCycleIndex(cycles);
    assertFundingReviewIndex(reviews);
    assertProfiles(profiles);
    const login = scenario === "current member" ? "alice2" : "alice";
    await page.route(`${site}/api/v1/points/**`, (route) =>
      route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith("/member")
          ? {
              actor: { id: archived.id, login },
              joinedAt: "2026-10-17T00:00:00.000Z",
              public: true,
              welcome: 5,
            }
          : null,
      }),
    );
    await page.route("**/api/v1/payments/actors/*/direct-transfers", (route) =>
      route.fulfill({ json: { transfers: [], totalMicro: "0" } }),
    );
    let releaseDirectory = () => {};
    const directoryReady = new Promise<void>((resolve) => {
      releaseDirectory = resolve;
    });
    if (scenario === "delayed directory")
      await page.route("**/data/profiles.json", async (route) => {
        await directoryReady;
        await route.fulfill({ json: profiles });
      });
    try {
      const memberResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname.endsWith("/points/member"),
      );
      await page.goto(`${site}/contributors/${login}`, {
        waitUntil: "domcontentloaded",
      });
      await (await memberResponse).finished();
      if (scenario === "delayed directory") {
        await expect(
          page.getByText("Checking current contributor identity…", {
            exact: true,
          }),
        ).toBeVisible();
        expect(walletRequests).toEqual([]);
        releaseDirectory();
      }
      await page.waitForLoadState("networkidle");
      if (scenario === "current member") {
        await expect(
          page.getByRole("heading", { name: "alice2", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "Past cycles", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "Frozen months", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByTitle(
            "Closed cycles and ledger events outside those cycles",
          ),
        ).toHaveText("7");
        await expect(
          page
            .getByText("Points · recorded history", { exact: true })
            .locator("..")
            .locator("strong"),
        ).toHaveText("5");
        expect(walletRequests).toEqual([
          "/api/v1/wallet-claims/actors/2/current",
        ]);
      } else {
        await expect(
          page.getByRole("heading", { name: "Past cycles" }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("heading", { name: "Frozen months" }),
        ).toHaveCount(0);
        await expect(page.getByText(/Historical payout wallet/)).toHaveCount(0);
        await expect(
          page.getByText("Points · recorded history", { exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByTitle(
            "Closed cycles and ledger events outside those cycles",
          ),
        ).toHaveCount(0);
        expect(walletRequests).toEqual([]);
      }
    } finally {
      releaseDirectory();
    }
  });
}

/** Public-record fixtures exercise profile identity, not OAuth or settlement. */
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { assertCycleIndex } from "../../src/lib/cycle-index";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { assertLeaderboardSnapshot } from "../../src/lib/leaderboard";
import { assertProfiles } from "../../src/lib/profiles";
import { TARGET_REPOSITORIES } from "../../src/lib/repositories.mjs";
import { archivedPaidCycleIndex, snapshotFixture } from "../fixtures";

async function profileRecords(
  page: Page,
  options: {
    reusedHandle?: boolean;
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
    profiles,
    current,
    archived,
    walletRequests,
  };
}

test("a renamed contributor keeps archived cycles", async ({ page }, info) => {
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
  await expect(pastCycle).toContainText("210 points");
  await expect(pastCycle).toContainText("$1");
  // Historical accepted work stays on its archived project record. The
  // separate aggregate score no longer appears beside canonical Points.
  await expect(
    page.getByTitle("Closed cycles and ledger events outside those cycles"),
  ).toHaveCount(0);
  await pastCycle.focus();
  await expect(pastCycle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/cycles\/eliza\/2026-07$/u);
  await page.goBack();
  await expect(pastCycle).toBeVisible();
  await page.reload();
  await expect(pastCycle).toBeVisible();
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
  await expect(
    page.getByTitle("Closed cycles and ledger events outside those cycles"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: current.login, exact: true }),
  ).toBeVisible();
});

test("an inactive new owner does not inherit archived records or wallet lookups", async ({
  page,
}, info) => {
  const { current, archived, walletRequests } = await profileRecords(page);
  // The new owner has no leaderboard, points, census or membership record.
  await page.goto(`/contributors/${archived.login}`, {
    waitUntil: "networkidle",
  });
  await expect(page.getByRole("heading", { name: "Past cycles" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("heading", { name: current.login })).toHaveCount(
    0,
  );
  await expect(page.getByText(/Past wallet/)).toHaveCount(0);
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
  ).toHaveCount(0);
  expect(walletRequests).toEqual(["/api/v1/wallet-claims/actors/1/current"]);
});

test("a directory-verified historical contributor keeps archived links", async ({
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
    page.getByTitle("Closed cycles and ledger events outside those cycles"),
  ).toHaveCount(0);
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
  await expect(page.getByText(/Past wallet/)).toHaveCount(0);
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
  await expect(page.getByText(/Past wallet/)).toHaveCount(0);
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
  await expect(page.getByText(/Past wallet/)).toHaveCount(0);
  expect(walletRequests).toEqual([]);
});

test("a stale activity login cannot override a directory rename", async ({
  page,
}) => {
  const { profiles, current, walletRequests } = await profileRecords(page);
  // The activity snapshot still has actor 1's old login, but the directory
  // shows that actor 1 renamed and actor 2 now owns that login.
  profiles.people[0].login = `${current.login}-renamed`;
  profiles.people.push({
    id: "MDQ6VXNlcjI=",
    login: current.login,
    avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
    repositories: [],
  });
  assertProfiles(profiles);
  await page.goto(`/contributors/${current.login}`, {
    waitUntil: "networkidle",
  });
  await expect(page.getByRole("status")).toContainText(
    "Current contributor identity could not be verified",
  );
  await expect(page.getByRole("heading", { name: "Past cycles" })).toHaveCount(
    0,
  );
  await expect(
    page.getByTitle("Closed cycles and ledger events outside those cycles"),
  ).toHaveCount(0);
  await expect(page.getByText(/Past wallet/)).toHaveCount(0);
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
        await expect(page.getByText(/Past wallet/)).toHaveCount(0);
        await expect(page.getByRole("status")).toContainText(
          "could not be verified",
        );
        await expect(
          page.getByText("total points", { exact: true }),
        ).toHaveCount(0);
        expect(walletRequests).toEqual([]);
        return;
      }
      await expect(
        page
          .getByText("total points", { exact: true })
          .locator("..")
          .locator("strong"),
      ).toHaveText("5");
      await expect(
        page.getByRole("heading", { name: "Past cycles" }),
      ).toHaveCount(0);
      await expect(page.getByText(/Past wallet/)).toHaveCount(0);
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
    const { cycles, profiles, archived, walletRequests } = await profileRecords(
      page,
      { directoryOnly: true },
    );
    archived.login = "alice";
    const wallet = cycles.cycles[0].contributors[0].wallet;
    if (wallet && "sourceCommit" in wallet)
      wallet.sourceUrl = `https://github.com/alice/alice/blob/${wallet.sourceCommit}/README.md`;
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
          page.getByTitle(
            "Closed cycles and ledger events outside those cycles",
          ),
        ).toHaveCount(0);
        await expect(
          page
            .getByText("total points", { exact: true })
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
        await expect(page.getByText(/Past wallet/)).toHaveCount(0);
        await expect(
          page.getByText("total points", { exact: true }),
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

test("contributor profile preserves unavailable payment total on direct-transfer 503 and recovers on retry", async ({
  page,
}, info) => {
  const site = await serveProfileSite(page);
  const { current } = await profileRecords(page);
  let available = false;
  const errors: string[] = [];
  const failures: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400)
      failures.push(`${response.status()} ${response.url()}`);
  });
  await page.route(`${site}/api/v1/points/**`, (route) =>
    route.fulfill({ json: null }),
  );
  await page.route(`${site}/api/v1/project-session`, (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.route("**/api/v1/payments/actors/1/direct-transfers", (route) => {
    if (!available)
      return route.fulfill({
        status: 503,
        body: "Payment source unavailable",
      });
    return route.fulfill({
      json: {
        totalMicro: "222220000",
        transfers: [
          {
            projectId: "slopdotcash",
            githubUserId: "1",
            login: current.login,
            amountMicro: "222220000",
            contributionMonth: "2026-10",
            network: "base-sepolia",
            chain: "base",
            recipient: "synthetic-recipient",
            transactionId: "synthetic-slopdotcash",
            blockTime: "2026-10-16T12:00:00.000Z",
          },
        ],
      },
    });
  });
  await page.goto(`${site}/contributors/${current.login}`);
  const paidStat = page
    .locator(".profile-totals div", {
      has: page.getByText("paid · USDC", { exact: true }),
    })
    .locator("strong");
  await expect(paidStat).toHaveText("Unavailable");
  await expect(
    page.getByText("Payment records unavailable.", { exact: true }),
  ).toBeVisible();
  const retry = page.getByRole("button", {
    name: "Retry payment records",
    exact: true,
  });
  await expect(retry).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Payouts", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Past cycles", exact: true }),
  ).toBeVisible();
  expect(failures.length).toBeGreaterThan(0);
  expect(
    failures.every(
      (failure) =>
        failure.startsWith("503 ") &&
        failure.endsWith("/api/v1/payments/actors/1/direct-transfers"),
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("profile-payments-unavailable.png"),
  });

  available = true;
  failures.length = 0;
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(paidStat).toHaveText("$223.22");
  await expect(page.getByText("Payment records unavailable.")).toHaveCount(0);
  await expect(retry).toHaveCount(0);
  const payouts = page.getByRole("region", { name: "Payouts", exact: true });
  await expect(payouts).toContainText("$223.22 USDC");
  await expect(payouts).toContainText("$222.22");
  await expect(payouts).toContainText("$1");
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
  await page.screenshot({
    path: info.outputPath("profile-payments-recovered.png"),
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

/** Public-record fixtures exercise profile identity, not OAuth or settlement. */
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { assertCycleIndex } from "../../src/lib/cycle-index";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { assertLeaderboardSnapshot } from "../../src/lib/leaderboard";
import { assertProfiles } from "../../src/lib/profiles";
import { TARGET_REPOSITORIES } from "../../src/lib/repositories.mjs";
import { archivedPaidCycleIndex, snapshotFixture } from "../fixtures";
import { expect, expectAccessible, test } from "./fixtures";

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
  await page.goto(`/contributors/${current.login}`);
  await expect(page.locator("main.profile-page")).toBeVisible();
  const history = page.locator(".profile-section", {
    has: page.getByRole("heading", { name: "Past cycles", exact: true }),
  });
  const pastCycle = history.getByRole("link");
  // The points shards finish before each navigation, so none is canceled.
  const pointsLoading = page
    .getByRole("region", { name: "Slop Points" })
    .getByText("Loading points…");
  await expect(pastCycle).toHaveAttribute("href", "/cycles/eliza/2026-07");
  await expect(pointsLoading).toHaveCount(0);
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
  await expect(pointsLoading).toHaveCount(0);
  await page.reload();
  await expect(pastCycle).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({ path: info.outputPath("renamed-profile.png") });
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
  await page.goto(`/contributors/${archived.login}`);
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
  diagnostics,
  page,
}) => {
  diagnostics.allow(
    /^(?:console Failed to load resource: the server responded with a status of 503 \(Service Unavailable\) at |503 GET )http:\/\/[^ ]+\/data\/profiles\.json$/u,
  );
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

test("profile payment totals stay unavailable until direct transfers recover", async ({
  diagnostics,
  page,
}, info) => {
  const site = await serveProfileSite(page);
  const { current } = await profileRecords(page);
  // The one refused payment read, asserted below.
  diagnostics.allow(
    /^console Failed to load resource: the server responded with a status of 503 .* at https:\/\/[^ ]+\/api\/v1\/payments\/actors\/1\/direct-transfers$/u,
  );
  const failures: string[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).origin === site && response.status() >= 400)
      failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  await page.route(`${site}/api/v1/points/**`, (route) =>
    route.fulfill({ json: null }),
  );
  await page.route(`${site}/api/v1/project-session`, (route) =>
    route.fulfill({ json: { session: null } }),
  );
  const paymentPath = "/api/v1/payments/actors/1/direct-transfers";
  let requests = 0;
  let releaseRetry = () => {};
  const retryReady = new Promise<void>((resolve) => {
    releaseRetry = resolve;
  });
  await page.route(`${site}${paymentPath}`, async (route) => {
    requests += 1;
    if (requests === 1)
      return route.fulfill({ status: 503, body: "Payment source unavailable" });
    if (requests === 2) await retryReady;
    return route.fulfill({
      json: {
        totalMicro: requests === 2 ? "2000000" : "0",
        transfers:
          requests === 2
            ? [
                {
                  projectId: "eliza",
                  githubUserId: "1",
                  login: current.login,
                  amountMicro: "2000000",
                  contributionMonth: "2026-08",
                  network: "base-sepolia",
                  chain: "base",
                  recipient: "synthetic-recipient",
                  transactionId: "synthetic-profile-payment",
                  blockTime: "2026-08-17T12:00:00.000Z",
                },
              ]
            : [],
      },
    });
  });
  try {
    await page.goto(`${site}/contributors/${current.login}`, {
      waitUntil: "networkidle",
    });
    const profile = page.getByRole("region", { name: "Contributor profile" });
    const paid = profile
      .getByText("paid · USDC", { exact: true })
      .locator("..")
      .locator("strong");
    const payouts = profile.getByRole("region", {
      name: "Payouts",
      exact: true,
    });
    const payoutTotal = payouts.locator(".profile-card-heading > span");
    const settlement = payouts
      .getByRole("link")
      .filter({ hasText: "Verified settlement" });
    await expect(settlement).toContainText("$1");
    expect(failures).toEqual([`503 ${paymentPath}`]);
    await page.screenshot({
      path: info.outputPath("profile-payments-unavailable.png"),
      fullPage: true,
    });
    await expect(paid).toHaveText("Unavailable");
    await expect(payoutTotal).toHaveText("Unavailable");
    await expect(
      profile.getByText("Payment records unavailable."),
    ).toBeVisible();
    const retry = profile.getByRole("button", {
      name: "Retry payment records",
    });
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(paid).toHaveText("Loading…");
    await expect(payoutTotal).toHaveText("Loading…");
    await expect(settlement).toContainText("$1");
    releaseRetry();
    await expect(paid).toHaveText("$3");
    await expect(payoutTotal).toHaveText("$3 USDC");
    await expect(
      payouts.getByRole("link").filter({ hasText: "Direct transfer" }),
    ).toContainText("$2");
    await expect(retry).toHaveCount(0);
    await expectAccessible(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("profile-payments-recovered.png"),
      fullPage: true,
    });
    // A complete empty direct-transfer result leaves the verified settlement total.
    await page.reload({ waitUntil: "networkidle" });
    await expect(paid).toHaveText("$1");
    await expect(payoutTotal).toHaveText("$1 USDC");
    await expect(settlement).toContainText("$1");
    expect(requests).toBe(3);
    expect(failures).toEqual([`503 ${paymentPath}`]);
  } finally {
    releaseRetry();
  }
});

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

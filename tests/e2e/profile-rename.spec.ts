/** Public-record fixtures exercise profile identity, not OAuth or settlement. */
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { deriveAllocationFundingBasis } from "../../src/lib/allocation-funding";
import { assertCycleIndex } from "../../src/lib/cycle-index";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { assertLeaderboardSnapshot } from "../../src/lib/leaderboard";
import { assertProfiles } from "../../src/lib/profiles";
import { findProject } from "../../src/lib/projects.mjs";
import { TARGET_REPOSITORIES } from "../../src/lib/repositories.mjs";
import { archivedPaidCycleIndex, snapshotFixture } from "../fixtures";
import { enlargeText } from "../text-size";
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
  await page.route("**/api/v1/payments/**vault-payments*", (route) =>
    route.fulfill({ json: { payments: [], through: 0, next: null, total: 0 } }),
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

test("warm profiles reuse public records until expiry and recover a failed refresh", async ({
  diagnostics,
  page,
}, info) => {
  const site = await serveProfileSite(page);
  const { snapshot, current, walletRequests } = await profileRecords(page);
  await page.clock.install({ time: Date.now() });
  diagnostics.allow(
    /^(?:console Failed to load resource: the server responded with a status of 503 .* at |503 GET )https:\/\/[^ ]+\/data\/leaderboard\.json\?attempt=\d+&retry=\d+&at=\d+$/u,
  );
  await page.route(`${site}/api/v1/points/**`, (route) =>
    route.fulfill({ json: null }),
  );
  await page.route(`${site}/api/v1/project-session`, (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.route("**/api/v1/payments/actors/*/direct-transfers", (route) =>
    route.fulfill({ json: { transfers: [], totalMicro: "0" } }),
  );
  const reads = {
    ledger: 0,
    index: 0,
    shards: 0,
    directory: 0,
    session: 0,
    member: 0,
  };
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/data/leaderboard.json") reads.ledger++;
    if (path === "/data/points.json") reads.index++;
    if (/^\/data\/points\/[0-9a-f]\.json$/u.test(path)) reads.shards++;
    if (path === "/data/profiles.json") reads.directory++;
    if (path === "/api/v1/points/me") reads.session++;
    if (path === "/api/v1/points/member") reads.member++;
  });
  let unavailable = false;
  await page.route("**/data/leaderboard.json?**", (route) =>
    unavailable
      ? route.fulfill({ status: 503, body: "Snapshot unavailable" })
      : route.fulfill({ json: snapshot }),
  );
  await page.goto(`${site}/contributors/${current.login}`, {
    waitUntil: "networkidle",
  });
  const history = page
    .getByRole("listitem")
    .filter({ hasText: "Archived cycle" });
  await expect(history).toBeVisible();
  await expect(page.locator(".profile-totals strong").last()).toHaveText(
    /^[\d,]+$/u,
  );
  const initial = { ...reads, wallet: walletRequests.length };
  expect(initial.ledger).toBeGreaterThan(0);
  expect(initial.shards).toBe(16);
  const document = await page.evaluate(() => performance.timeOrigin);
  async function revisit() {
    await page
      .getByRole("banner")
      .getByRole("link", { name: "Slop home", exact: true })
      .click();
    await page
      .getByRole("region", { name: "Top sloperators", exact: true })
      .getByRole("table")
      .waitFor({ state: "visible" });
    await page.waitForLoadState("networkidle");
    await page.goBack({ waitUntil: "networkidle" });
  }
  await revisit();
  await expect(history).toBeVisible();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(document);
  expect(reads.ledger).toBe(initial.ledger);
  expect(reads.index).toBe(initial.index);
  expect(reads.shards).toBe(initial.shards);
  expect(reads.directory).toBeGreaterThan(initial.directory);
  expect(reads.session).toBeGreaterThan(initial.session);
  expect(reads.member).toBeGreaterThan(initial.member);
  expect(walletRequests.length).toBeGreaterThan(initial.wallet);
  const warm = { ...reads };

  await page.clock.fastForward(61_000);
  unavailable = true;
  await revisit();
  const failedRefresh = page
    .locator("main > .data-notice")
    .filter({ hasText: "Points may be outdated" });
  await expect(
    failedRefresh.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  await expect(history).toBeVisible();
  await expect(page.locator(".profile-totals strong").last()).toHaveText(
    /^[\d,]+$/u,
  );
  expect(reads.ledger).toBeGreaterThan(warm.ledger);
  expect(reads.index).toBeGreaterThan(warm.index);
  expect(reads.shards).toBeGreaterThan(warm.shards);
  const expired = { ...reads };
  unavailable = false;
  await failedRefresh
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  await expect(failedRefresh).toHaveCount(0);
  await expect(history).toBeVisible();
  expect(reads.ledger).toBeGreaterThan(expired.ledger);
  await info.attach("public-cache-read-counts", {
    body: JSON.stringify({ initial, warm, expired, recovered: reads }),
    contentType: "application/json",
  });
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("warm-profile-cache-recovered.png"),
    fullPage: true,
  });
});

test("sign-out rejects a delayed session read from profile navigation", async ({
  diagnostics,
  page,
}) => {
  diagnostics.allowCanceledBackgroundReads();
  const site = await serveProfileSite(page);
  const { current } = await profileRecords(page);
  const me = {
    actor: { id: current.id, login: current.login },
    joinedAt: "2026-10-01T00:00:00.000Z",
    public: true,
    welcome: 5,
  };
  let signedIn = true;
  let sessionReads = 0;
  let delayedCompleted = false;
  let releaseSession = () => {};
  const sessionReady = new Promise<void>((resolve) => {
    releaseSession = resolve;
  });
  await page.route(`${site}/api/v1/points/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/signout")) {
      signedIn = false;
      await route.fulfill({ json: { signedOut: true } });
    } else if (path.endsWith("/me")) {
      const json = signedIn ? me : null;
      sessionReads++;
      if (sessionReads === 2) {
        await sessionReady;
        await route.fulfill({ json });
        delayedCompleted = true;
      } else await route.fulfill({ json });
    } else await route.fulfill({ json: null });
  });
  await page.route(`${site}/api/v1/project-session`, (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.route("**/api/v1/payments/actors/*/direct-transfers", (route) =>
    route.fulfill({ json: { transfers: [], totalMicro: "0" } }),
  );
  try {
    await page.goto(`${site}/contributors/${current.login}`, {
      waitUntil: "networkidle",
    });
    const account = page.getByRole("button", {
      name: "Your account",
      exact: true,
    });
    await expect(account).toBeVisible();
    await page
      .getByRole("banner")
      .getByRole("link", { name: "Slop home", exact: true })
      .click();
    await page
      .getByRole("region", { name: "Top sloperators", exact: true })
      .getByRole("table")
      .waitFor({ state: "visible" });
    await page.goBack({ waitUntil: "domcontentloaded" });
    await expect.poll(() => sessionReads).toBe(2);
    await account.click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    const login = page
      .getByRole("banner")
      .getByRole("link", { name: "Log in", exact: true });
    await expect(account).toHaveCount(0);
    releaseSession();
    await expect.poll(() => delayedCompleted).toBe(true);
    await page.waitForLoadState("networkidle");
    await expect(account).toHaveCount(0);
    await expect(login).toBeVisible();
  } finally {
    releaseSession();
  }
});

test("warm reassigned handles wait for fresh identity before wallet and history reads", async ({
  page,
}, info) => {
  const site = await serveProfileSite(page);
  const { profiles, current, walletRequests } = await profileRecords(page);
  let hold = false;
  let releaseDirectory = () => {};
  let releaseMembership = () => {};
  let releaseSession = () => {};
  const directoryReady = new Promise<void>((resolve) => {
    releaseDirectory = resolve;
  });
  const membershipReady = new Promise<void>((resolve) => {
    releaseMembership = resolve;
  });
  const sessionReady = new Promise<void>((resolve) => {
    releaseSession = resolve;
  });
  await page.route("**/data/profiles.json", async (route) => {
    if (hold) await directoryReady;
    await route.fulfill({ json: profiles });
  });
  await page.route(`${site}/api/v1/points/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (hold && path.endsWith("/me")) await sessionReady;
    if (hold && path.endsWith("/member")) await membershipReady;
    await route.fulfill({
      json:
        hold && path.endsWith("/member")
          ? {
              actor: { id: "MDQ6VXNlcjI=", login: current.login },
              joinedAt: "2026-10-17T00:00:00.000Z",
              public: true,
              welcome: 5,
            }
          : null,
    });
  });
  await page.route(`${site}/api/v1/project-session`, (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.route("**/api/v1/payments/actors/*/direct-transfers", (route) =>
    route.fulfill({ json: { transfers: [], totalMicro: "0" } }),
  );
  const actorReads: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/\/api\/v1\/(?:wallet-claims|payments)\/actors\//u.test(path))
      actorReads.push(path);
  });
  try {
    await page.goto(`${site}/contributors/${current.login}`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByRole("listitem").filter({ hasText: "Archived cycle" }),
    ).toBeVisible();
    expect(walletRequests).toEqual(["/api/v1/wallet-claims/actors/1/current"]);
    await page
      .getByRole("banner")
      .getByRole("link", { name: "Slop home", exact: true })
      .click();
    await page
      .getByRole("region", { name: "Top sloperators", exact: true })
      .getByRole("table")
      .waitFor({ state: "visible" });
    await page.waitForLoadState("networkidle");
    actorReads.length = 0;
    walletRequests.length = 0;
    profiles.people[0].login = `${current.login}-renamed`;
    profiles.people.push({
      id: "MDQ6VXNlcjI=",
      login: current.login,
      avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
      repositories: [],
    });
    assertProfiles(profiles);
    hold = true;
    await page.goBack({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByText("Checking contributor…", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Find a contributor", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("listitem").filter({ hasText: "Archived cycle" }),
    ).toHaveCount(0);
    expect(actorReads).toEqual([]);
    const sessionResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/points/me"),
    );
    const memberResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/points/member"),
    );
    releaseSession();
    releaseMembership();
    await (await sessionResponse).finished();
    await (await memberResponse).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(
      page.getByText("Checking contributor…", { exact: true }),
    ).toBeVisible();
    expect(actorReads).toEqual([]);
    releaseDirectory();
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("listitem").filter({ hasText: "Archived cycle" }),
    ).toHaveCount(0);
    await expect(page.getByText(/Past wallet/u)).toHaveCount(0);
    await expect(page.getByText("total points", { exact: true })).toHaveCount(
      0,
    );
    expect(actorReads).toEqual([]);
    expect(walletRequests).toEqual([]);
    await info.attach("warm-reassigned-handle", {
      body: JSON.stringify({ actorReads, walletRequests }),
      contentType: "application/json",
    });
    await page.screenshot({
      path: info.outputPath("warm-reassigned-handle-refused.png"),
      fullPage: true,
    });
  } finally {
    releaseDirectory();
    releaseMembership();
    releaseSession();
  }
});

test("a renamed contributor keeps archived cycles", async ({ page }, info) => {
  const { current } = await profileRecords(page);
  await page.goto(`/contributors/${current.login}`);
  await expect(page.locator("main.profile-page")).toBeVisible();
  const history = page.getByRole("region", {
    name: "Awards and payments",
    exact: true,
  });
  const pastCycle = history.getByRole("link", { name: /July 2026/u });
  const pastRecord = pastCycle.locator("xpath=ancestor::li");
  // The points shards finish before each navigation, so none is canceled.
  const pointsLoading = page
    .getByRole("region", { name: "Slop Points" })
    .getByText("Loading points…");
  await expect(pastCycle).toHaveAttribute("href", "/cycles/eliza/2026-07");
  await expect(pointsLoading).toHaveCount(0);
  await expect(pastRecord).toContainText("210 points");
  await expect(pastRecord).toContainText("$1");
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
  await expect(
    page.getByRole("listitem").filter({ hasText: "Archived cycle" }),
  ).toHaveCount(0);
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
  await expect(
    page.getByRole("listitem").filter({ hasText: "Archived cycle" }),
  ).toHaveCount(0);
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
    page.getByRole("listitem").filter({ hasText: "Archived cycle" }),
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
  await expect(
    page.getByRole("listitem").filter({ hasText: "Archived cycle" }),
  ).toHaveCount(0);
  await expect(page.getByText(/Past wallet/)).toHaveCount(0);
  expect(walletRequests).toEqual([]);
  await expect(
    page.getByText("Contributor records are unavailable.", { exact: true }),
  ).toBeVisible();
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
  await expect(
    page.getByRole("listitem").filter({ hasText: "Archived cycle" }),
  ).toHaveCount(0);
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
  await expect(
    page.getByText("Contributor records are unavailable.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Archived cycle" }),
  ).toHaveCount(0);
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
  await expect(
    page.getByText("Contributor records are unavailable.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Archived cycle" }),
  ).toHaveCount(0);
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
    "Contributor records are unavailable.",
  );
  expect(walletRequests).toEqual([]);
  unavailable = false;
  await page
    .getByRole("button", { name: "Retry profile", exact: true })
    .click();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Archived cycle" }),
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
    // Money received falls back to the shared empty aggregate (fixtures.ts).
    new URL(route.request().url()).pathname === "/api/v1/payments/received"
      ? route.fallback()
      : route.fulfill({
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
    const payouts = profile.getByRole("region", {
      name: "Awards and payments",
      exact: true,
    });
    const paid = payouts.locator(".profile-payments-summary strong");
    const settlement = payouts
      .getByRole("listitem")
      .filter({ hasText: "Archived cycle" });
    await expect(settlement).toContainText("$1");
    expect(failures).toEqual([`503 ${paymentPath}`]);
    await page.screenshot({
      path: info.outputPath("profile-payments-unavailable.png"),
      fullPage: true,
    });
    await expect(paid).toHaveText("Unavailable");
    await expect(
      profile.getByText("Direct payment records unavailable."),
    ).toBeVisible();
    const retry = profile.getByRole("button", {
      name: "Retry payment records",
    });
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(paid).toHaveText("Loading…");
    await expect(settlement).toContainText("$1");
    releaseRetry();
    await expect(paid).toHaveText("$3");
    await expect(
      payouts.getByRole("listitem").filter({ hasText: "Direct transfer" }),
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
      if (staleMembership) {
        await expect(
          page.getByRole("listitem").filter({ hasText: "Archived cycle" }),
        ).toHaveCount(0);
        await expect(page.getByText(/Past wallet/)).toHaveCount(0);
        await expect(
          page.getByRole("heading", {
            name: "No Slop contributor with this login",
          }),
        ).toBeVisible();
        await expect(
          page.getByText("total points", { exact: true }),
        ).toHaveCount(0);
        expect(walletRequests).toEqual([]);
        return;
      }
      await expect(
        page.getByRole("heading", { name: archived.login, exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByText("total points", { exact: true })
          .locator("..")
          .locator("strong"),
      ).toHaveText("5");
      await expect(
        page.getByRole("listitem").filter({ hasText: "Archived cycle" }),
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
  "reassigned login: directory first",
  "reassigned login: membership first",
  "delayed directory",
  "delayed session",
  "current member",
  "absent member",
] as const) {
  test(`directory-only membership identity: ${scenario}`, async ({ page }) => {
    const reassigned = scenario.startsWith("reassigned login:");
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
    if (!reassigned && scenario !== "delayed session")
      profiles.people.push({
        ...archived,
        login: "alice2",
        avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
        repositories: [],
      });
    if (
      reassigned ||
      scenario === "delayed directory" ||
      scenario === "delayed session"
    )
      profiles.people.push({
        ...archived,
        id: "MDQ6VXNlcjM=",
        login: "alice",
        avatarUrl: "https://avatars.githubusercontent.com/u/3?v=4",
        repositories: [],
      });
    assertCycleIndex(cycles);
    assertProfiles(profiles);
    const currentIdentity =
      scenario === "current member" || scenario === "absent member";
    const login = currentIdentity ? "alice2" : "alice";
    let releaseDirectory!: () => void;
    let releaseMembership!: () => void;
    let releaseSession!: () => void;
    const directoryReady = new Promise<void>((resolve) => {
      releaseDirectory = resolve;
    });
    const membershipReady = new Promise<void>((resolve) => {
      releaseMembership = resolve;
    });
    const sessionReady = new Promise<void>((resolve) => {
      releaseSession = resolve;
    });
    await page.route(`${site}/api/v1/points/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      const isMember = path.endsWith("/member");
      if (isMember && reassigned) await membershipReady;
      if (path.endsWith("/me") && scenario === "delayed session")
        await sessionReady;
      const identityPath = scenario === "delayed session" ? "/me" : "/member";
      return route.fulfill({
        json:
          path.endsWith(identityPath) && scenario !== "absent member"
            ? {
                actor: { id: archived.id, login },
                joinedAt: "2026-10-17T00:00:00.000Z",
                public: true,
                welcome: 5,
              }
            : null,
      });
    });
    await page.route("**/api/v1/payments/actors/*/direct-transfers", (route) =>
      route.fulfill({ json: { transfers: [], totalMicro: "0" } }),
    );
    if (scenario === "delayed directory" || reassigned)
      await page.route("**/data/profiles.json", async (route) => {
        await directoryReady;
        await route.fulfill({ json: profiles });
      });
    try {
      const memberResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname.endsWith("/points/member"),
      );
      const directoryResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname.endsWith("/data/profiles.json"),
      );
      const sessionResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname.endsWith("/points/me"),
      );
      await page.goto(`${site}/contributors/${login}`, {
        waitUntil: "domcontentloaded",
      });
      let pendingRequests: string[] = [];
      let pendingIdentity = true;
      if (reassigned || scenario === "delayed session") {
        await expect(
          page.getByText("Checking contributor…", { exact: true }),
        ).toBeVisible();
        if (scenario === "delayed session") {
          await (await directoryResponse).finished();
          await (await memberResponse).finished();
        } else if (scenario.endsWith("directory first")) {
          releaseDirectory();
          await (await directoryResponse).finished();
        } else {
          releaseMembership();
          await (await memberResponse).finished();
        }
        // Response parsing and React's next paint settle while the other source stays held.
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
        pendingRequests = [...walletRequests];
        pendingIdentity = await page
          .getByText("Checking contributor…", { exact: true })
          .isVisible();
        await page.screenshot({
          path: test.info().outputPath("identity-source-pending.png"),
          fullPage: true,
        });
        releaseDirectory();
        releaseMembership();
        releaseSession();
      }
      await (await memberResponse).finished();
      await (await sessionResponse).finished();
      if (scenario === "delayed directory") {
        await expect(
          page.getByText("Checking contributor…", {
            exact: true,
          }),
        ).toBeVisible();
        expect(walletRequests).toEqual([]);
        releaseDirectory();
      }
      await page.waitForLoadState("networkidle");
      await test.info().attach("identity-arrival-order", {
        body: JSON.stringify({
          scenario,
          pendingRequests,
          finalRequests: walletRequests,
          pendingIdentity,
        }),
        contentType: "application/json",
      });
      if (reassigned || scenario === "delayed session") {
        expect(pendingIdentity).toBe(true);
        expect(pendingRequests).toEqual([]);
      }
      if (currentIdentity) {
        await expect(
          page.getByRole("heading", { name: "alice2", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("listitem").filter({ hasText: "Archived cycle" }),
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
        ).toHaveText(scenario === "absent member" ? "0" : "5");
        expect(walletRequests).toEqual([
          "/api/v1/wallet-claims/actors/2/current",
        ]);
      } else {
        await expect(
          page.getByRole("listitem").filter({ hasText: "Archived cycle" }),
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
        if (scenario === "delayed session") {
          await expect(
            page.getByRole("heading", {
              name: "No Slop contributor with this login",
            }),
          ).toBeVisible();
          await expectAccessible(page);
          await page.screenshot({
            path: test.info().outputPath("profile-session-refused.png"),
          });
        }
      }
    } finally {
      releaseDirectory();
      releaseMembership();
      releaseSession();
    }
  });
}

test("a confirmed absent contributor is noindex without invented GitHub links", async ({
  page,
}) => {
  const site = await serveProfileSite(page);
  await profileRecords(page);
  await page.route(`${site}/api/v1/points/**`, (route) =>
    route.fulfill({ json: null }),
  );
  await page.goto(`${site}/contributors/no-such-slop-login-zz9`, {
    waitUntil: "networkidle",
  });
  await expect(
    page.getByRole("heading", { name: "No Slop contributor with this login" }),
  ).toBeVisible();
  await expect(page.locator('main a[href*="github.com"]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex",
  );
});

for (const failedSource of ["member", "me"] as const) {
  test(`an unavailable ${failedSource} lookup does not invent an absent contributor`, async ({
    diagnostics,
    page,
  }) => {
    const site = await serveProfileSite(page);
    await profileRecords(page);
    let unavailable = true;
    diagnostics.allow(
      /^console Failed to load resource: the server responded with a status of 503 .* at https:\/\/[^ ]+\/api\/v1\/points\/(?:me|member)(?:\?[^ ]*)?$/u,
    );
    await page.route(`${site}/api/v1/points/**`, (route) =>
      unavailable &&
      new URL(route.request().url()).pathname.endsWith(`/${failedSource}`)
        ? route.fulfill({ status: 503, json: { error: "unavailable" } })
        : route.fulfill({ json: null }),
    );
    await page.goto(`${site}/contributors/no-such-slop-login-zz9`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByText("Contributor records are unavailable.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "No Slop contributor with this login",
      }),
    ).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    const restoreText = await enlargeText(page.locator("main"));
    await expectAccessible(page);
    await restoreText();
    unavailable = false;
    await page
      .getByRole("button", { name: "Retry profile", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", {
        name: "No Slop contributor with this login",
      }),
    ).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex",
    );
    await expectAccessible(page);
  });
}

test("an unavailable session preserves an unconflicted cached profile", async ({
  diagnostics,
  page,
}) => {
  const site = await serveProfileSite(page);
  const { current, walletRequests } = await profileRecords(page);
  diagnostics.allow(
    /^console Failed to load resource: the server responded with a status of 503 .* at https:\/\/[^ ]+\/api\/v1\/points\/me$/u,
  );
  await page.route(`${site}/api/v1/points/**`, (route) =>
    new URL(route.request().url()).pathname.endsWith("/me")
      ? route.fulfill({ status: 503, json: { error: "session_unavailable" } })
      : route.fulfill({ json: null }),
  );
  await page.route("**/api/v1/payments/actors/*/direct-transfers", (route) =>
    route.fulfill({ json: { transfers: [], totalMicro: "0" } }),
  );
  await page.goto(`${site}/contributors/${current.login}`, {
    waitUntil: "networkidle",
  });
  await expect(page.locator("main.profile-page")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: current.login, exact: true }),
  ).toBeVisible();
  expect(walletRequests).toEqual(["/api/v1/wallet-claims/actors/1/current"]);
});

test(
  "membership lookup terminates at the shared request deadline",
  { tag: "@desktop-only" },
  async ({ page, diagnostics }, info) => {
    const site = await serveProfileSite(page);
    const { archived } = await profileRecords(page, { directoryOnly: true });
    let releaseMember!: () => void;
    const memberGate = new Promise<void>((resolve) => {
      releaseMember = resolve;
    });
    diagnostics.allowCanceledBackgroundReads();
    await page.route(`${site}/api/v1/points/**`, async (route) => {
      if (new URL(route.request().url()).pathname.endsWith("/member"))
        await memberGate;
      await route.fulfill({ json: null });
    });
    await page.route("**/api/v1/payments/actors/*/direct-transfers", (route) =>
      route.fulfill({ json: { transfers: [], totalMicro: "0" } }),
    );
    const start = Date.now();
    try {
      await page.goto(`${site}/contributors/${archived.login}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByText("Checking contributor…", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("listitem").filter({ hasText: "Archived cycle" }),
      ).toBeVisible({ timeout: 17_500 });
    } finally {
      await page.screenshot({
        path: info.outputPath("membership-deadline.png"),
        fullPage: true,
      });
      await info.attach("membership-elapsed-ms", {
        body: String(Date.now() - start),
        contentType: "text/plain",
      });
      releaseMember();
      await page.waitForLoadState("networkidle");
    }
  },
);

test("a long direct transfer history remains readable without enlarging response limits", async ({
  page,
}, info) => {
  const site = await serveProfileSite(page);
  const { current } = await profileRecords(page);
  await page.route(`${site}/api/v1/points/**`, (route) =>
    route.fulfill({ json: null }),
  );
  await page.route(`${site}/api/v1/project-session`, (route) =>
    route.fulfill({ json: { session: null } }),
  );
  const transfers = Array.from({ length: 5000 }, (_, index) => ({
    projectId: "eliza",
    githubUserId: "1",
    login: current.login,
    amountMicro: "1000000",
    contributionMonth: "2026-08",
    network: "base-mainnet",
    chain: "base",
    recipient: `0x${"2".repeat(40)}`,
    transactionId: `0x${index.toString(16).padStart(64, "0")}`,
    blockTime: "2026-09-17T12:00:00.000Z",
  }));
  const legacy = { transfers, totalMicro: "5000000000" };
  expect(Buffer.byteLength(JSON.stringify(legacy))).toBeGreaterThan(1_048_576);
  await page.route(
    `${site}/api/v1/payments/actors/1/direct-transfers*`,
    (route) => {
      const request = route.request();
      if (request.headers()["x-slop-direct-history"] !== "paged")
        return route.fulfill({ json: legacy });
      const after = Number(
        new URL(request.url()).searchParams.get("after") ?? "0",
      );
      const rows = transfers.slice(after, after + 100);
      return route.fulfill({
        json: {
          transfers: rows,
          totalMicro: String(rows.length * 1_000_000),
          through: transfers.length,
          total: transfers.length,
          next:
            after + rows.length < transfers.length ? after + rows.length : null,
        },
      });
    },
  );
  await page.goto(`${site}/contributors/${current.login}`, {
    waitUntil: "networkidle",
  });
  const history = page.getByRole("region", {
    name: "Awards and payments",
    exact: true,
  });
  try {
    await expect(
      history.locator(".profile-payments-summary strong"),
    ).toHaveText("$5,001");
    await expect(
      history.getByRole("button", {
        name: "Show all 5001 records",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      history.getByText("Direct payment records unavailable.", {
        exact: false,
      }),
    ).toHaveCount(0);
  } finally {
    await page.screenshot({
      path: info.outputPath("large-direct-history.png"),
      fullPage: true,
    });
  }
});

test("profile history previews retain every payment and cycle behind keyboard controls", async ({
  page,
}, info) => {
  const site = await serveProfileSite(page);
  const { current, cycles } = await profileRecords(page);
  const original = cycles.cycles[0];
  const project = findProject(original.projectId);
  if (!project) throw new Error("Missing historical project fixture");
  for (const month of [8, 9, 10]) {
    const cycle = structuredClone(original);
    const period = `2026-${String(month).padStart(2, "0")}`;
    const following = `2026-${String(month + 1).padStart(2, "0")}`;
    cycle.cycleId = period;
    cycle.contributionWindow = {
      from: `${period}-01T00:00:00.000Z`,
      to: `${following}-01T00:00:00.000Z`,
    };
    cycle.generatedAt = `${following}-02T00:00:00.000Z`;
    cycle.reviewEndsAt = `${following}-15T00:00:00.000Z`;
    cycle.approvedAt = cycle.settledAt = `${following}-16T00:00:00.000Z`;
    // Retained historical awards can use carried funds; the fixture does not
    // claim a current commitment or invent a new funding route.
    cycle.reward.fundingBasis = deriveAllocationFundingBasis(project, period);
    cycle.reward.capMinor = "0";
    cycle.reward.carriedMinor = cycle.reward.approvedMinor;
    for (const contributor of cycle.contributors)
      if (contributor.wallet)
        contributor.wallet.observedAt = `${following}-01T00:00:00.000Z`;
    for (const file of Object.values(cycle.files))
      if (file) file.url = file.url.replace("/2026-07/", `/${period}/`);
    cycles.cycles.unshift(cycle);
  }
  cycles.generatedAt = "2026-11-17T00:00:00.000Z";
  await page.clock.setFixedTime(new Date(cycles.generatedAt));
  assertCycleIndex(cycles);
  await page.route(`${site}/api/v1/points/**`, (route) =>
    route.fulfill({ json: null }),
  );
  await page.route(`${site}/api/v1/project-session`, (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.route(
    `${site}/api/v1/payments/actors/1/direct-transfers`,
    (route) =>
      route.fulfill({
        json: {
          totalMicro: "10000000",
          transfers: Array.from({ length: 5 }, (_, index) => ({
            projectId: "eliza",
            githubUserId: "1",
            login: current.login,
            amountMicro: "2000000",
            contributionMonth: "2026-08",
            network: "base-sepolia",
            chain: "base",
            recipient: "synthetic-recipient",
            transactionId: `synthetic-profile-payment-${index}`,
            blockTime: `2026-08-${17 + index}T12:00:00.000Z`,
          })),
        },
      }),
  );
  await page.goto(`${site}/contributors/${current.login}`, {
    waitUntil: "networkidle",
  });
  const history = page.getByRole("region", {
    name: "Awards and payments",
    exact: true,
  });
  const total = history.locator(".profile-payments-summary strong");
  await expect(total).toHaveText("$14");
  await expect(history.getByRole("listitem")).toHaveCount(5);
  await page.screenshot({
    path: info.outputPath("profile-history-preview.png"),
    fullPage: true,
  });
  await history
    .getByRole("button", { name: "Show all 9 records", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(history.getByRole("listitem")).toHaveCount(9);
  await expect(
    history.getByRole("listitem").filter({ hasText: "Archived cycle" }),
  ).toHaveCount(4);
  await expect(
    history.getByRole("listitem").filter({ hasText: "Direct transfer" }),
  ).toHaveCount(5);
  await expect(
    history.getByRole("link", { name: /July 2026/u }),
  ).toHaveAttribute("href", "/cycles/eliza/2026-07");
  await expectAccessible(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("profile-history-expanded.png"),
    fullPage: true,
  });
  await history
    .getByRole("button", { name: "Show recent records", exact: true })
    .focus();
  await page.keyboard.press("Space");
  await expect(history.getByRole("listitem")).toHaveCount(5);
  await expect(total).toHaveText("$14");
});

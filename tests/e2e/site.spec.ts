/**
 * Drives the built GitHub-native product through discovery, contribution,
 * wallet, profile, cycle, project-proposal, artifact, failure, responsive, and
 * accessibility paths using the exact generated public data.
 */

import { createHash } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import { assertCycleIndex, type CycleIndex } from "../../src/lib/cycle-index";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { communityProjects } from "../../src/lib/home-projects";
import {
  assertLeaderboardSnapshot,
  assignLeaderboardRanks,
  compareRankedEntries,
  type LeaderboardSnapshot,
} from "../../src/lib/leaderboard";
import { createProjectView } from "../../src/lib/project-view";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { CONTRIBUTION } from "../project-application-manifest";
import { enlargeText } from "../text-size";
import { expect, expectAccessible, test } from "./fixtures";

const deployment = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);

async function openOwnerSettings(page: Page, label: string) {
  const summary = page
    .getByText(label, { exact: true })
    .locator("xpath=self::summary");
  if (
    (await summary.locator("xpath=parent::details").getAttribute("open")) ===
    null
  )
    await summary.click();
}

// Preview serves frozen data; registry.spec.ts exercises these routes on D1.
test.beforeEach(async ({ page }) => {
  await page.route("**/.well-known/slop/projects.json", (route) =>
    route.fulfill({ json: { schemaVersion: "1", projects: [] } }),
  );
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.route("**/api/v1/projects/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    const project = PROJECTS.find((entry) => entry.id === id);
    if (!project) throw new Error(`Unexpected fixture project ${id}`);
    return route.fulfill({ json: { revision: 1, project } });
  });
});

test("funding opens without downloading contribution snapshots", async ({
  page,
}) => {
  const snapshotReads: string[] = [];
  page.on("request", (request) => {
    if (
      /\/data\/(?:leaderboard\.json|cycles\/index\.json)/u.test(request.url())
    )
      snapshotReads.push(request.url());
  });
  await page.goto("/projects/eliza/funding", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "Eliza funding" }),
  ).toBeVisible();
  await expect(page.getByText("This project has no vault yet.")).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("funding-ready.png"),
    fullPage: true,
  });
  await test.info().attach("funding-snapshot-requests", {
    body: JSON.stringify(snapshotReads),
    contentType: "application/json",
  });
  expect(snapshotReads).toEqual([]);
  await expectAccessible(page);
});

test("project setup shares one sign-in read with its owner inventory", async ({
  page,
}) => {
  let reads = 0;
  await page.route("**/api/v1/project-session", (route) => {
    reads++;
    return route.fulfill({
      json: {
        session: { githubId: "4242", githubLogin: "example", admin: false },
      },
    });
  });
  await page.route("**/api/v1/project-setup", (route) =>
    route.fulfill({ json: { projects: [], applications: [] } }),
  );
  await page.route("**/api/v1/project-github/owned-repositories", (route) =>
    route.fulfill({ json: { repositories: [] } }),
  );
  await page.goto("/projects/new", { waitUntil: "networkidle" });
  await page.getByText("Your projects", { exact: true }).click();
  await expect(page.getByText("You have no projects yet.")).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("project-setup.png"),
    fullPage: true,
  });
  await test.info().attach("session-reads", {
    body: String(reads),
    contentType: "text/plain",
  });
  expect(reads).toBe(1);
  await expectAccessible(page);
});

test("project navigation reads an updated published registry", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  let published = false;
  const description =
    "Owner-published project description after this page opened.";
  await page.route(
    /\/(?:api\/v1\/projects|data\/fixture-project-registry\.json)(?:\?.*)?$/u,
    (route) =>
      route.fulfill({
        json: {
          schemaVersion: "1",
          projects: PROJECTS.map((project) =>
            published && project.id === "eliza"
              ? { ...project, description }
              : project,
          ),
        },
      }),
  );
  await page.goto("/projects/eliza/funding", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "Eliza funding", exact: true }),
  ).toBeVisible();
  published = true;
  await page
    .getByRole("navigation", { name: "Project navigation" })
    .getByRole("link", { name: "Overview", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Eliza", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(description, { exact: true })).toBeVisible();
  await expectAccessible(page);
});

test("shared navigation preserves project drafts and account sign-in destinations", async ({
  diagnostics,
  page,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowResponse(401, "GET", "/api/v1/payments/me");
  diagnostics.allowResponse(401, "GET", "/api/v1/notifications");
  await page.route("**/api/v1/payments/me", (route) =>
    route.fulfill({ status: 401, json: { error: "unauthorized" } }),
  );
  await page.route("**/api/v1/notifications", (route) =>
    route.fulfill({ status: 401, json: { error: "unauthorized" } }),
  );
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  const projectNav = page.getByRole("navigation", {
    name: "Project navigation",
  });
  await projectNav.getByRole("link", { name: "Funds & awards" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Eliza funding" }),
  ).toBeVisible();
  await projectNav.getByRole("link", { name: "Settings" }).click();
  const draft = "Draft retained across project navigation";
  await page.getByLabel("Short description").fill(draft);
  await projectNav.getByRole("link", { name: "Security" }).click();
  await expect(page).toHaveURL(/\/projects\/eliza\/security$/u);
  await expect(
    projectNav.getByRole("link", { name: "Security" }),
  ).toHaveAttribute("aria-current", "page");
  await page.waitForLoadState("networkidle");
  await projectNav.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByLabel("Short description")).toHaveValue(draft);
  await page.waitForLoadState("networkidle");

  await page.goto("/account", { waitUntil: "networkidle" });
  const accountNav = page.getByRole("navigation", {
    name: "Account navigation",
  });
  await accountNav.getByRole("link", { name: "Payouts" }).click();
  await expect(page).toHaveURL(/\/earnings$/u);
  await expect(
    page.getByRole("main").getByRole("link", { name: "Sign in with GitHub" }),
  ).toHaveAttribute("href", "/login?next=earnings");
  await accountNav.getByRole("link", { name: "Inbox" }).click();
  await expect(page).toHaveURL(/\/inbox$/u);
  await expect(
    page.getByRole("main").getByRole("link", { name: "Sign in with GitHub" }),
  ).toHaveAttribute("href", /next=%2Finbox$/u);
  await accountNav.getByRole("link", { name: "Settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Account", exact: true }),
  ).toBeVisible();

  await page.goto("/cycles");
  const records = page.getByRole("navigation", { name: "Public records" });
  await records.getByRole("link", { name: "Receipts" }).click();
  await expect(
    page.getByRole("heading", { name: "Run receipts" }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  await records.getByRole("link", { name: "Cycles" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Payment cycles" }),
  ).toBeVisible();
  await enlargeText(page.locator("body"));
  await expectAccessible(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

test("security reports recover a failed list and share one session across submissions", async ({
  page,
  diagnostics,
}) => {
  let reads = 0;
  let lists = 0;
  diagnostics.allowResponse(503, "GET", "/api/v1/security-submissions");
  await page.route("**/api/v1/project-session", (route) => {
    reads++;
    return route.fulfill({
      json: {
        session: { githubId: "4242", githubLogin: "example", admin: false },
      },
    });
  });
  await page.route("**/api/v1/security-cases", (route) =>
    route.fulfill({
      json: {
        viewer: { githubId: "4242", githubLogin: "example" },
        programs: [],
        cases: [],
      },
    }),
  );
  await page.route("**/api/v1/security-submissions", (route) => {
    lists++;
    return lists === 2
      ? route.fulfill({
          status: 503,
          json: {
            error: "unavailable",
            message: "Report list temporarily unavailable.",
          },
        })
      : route.fulfill({
          json: {
            automatic: true,
            submissions: [1, 2, 3].map((number) => ({
              id: `ss_example${number}`,
              projectId: "eliza",
              repository: "elizaOS/eliza",
              origin: "slop",
              state: "submitted",
              revision: 1,
              attempt: 1,
              advisory: null,
              githubCreatedAt: null,
              failureCode: null,
              caseId: null,
              retryAllowed: false,
              reconcileAfter: null,
            })),
          },
        });
  });
  await page.goto("/security", { waitUntil: "networkidle" });
  await expect(page.getByRole("article")).toHaveCount(3);
  const initialSessionReads = reads;
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("alert")).toContainText(
    "Report list temporarily unavailable.",
  );
  await page.getByRole("button", { name: "Retry", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.waitForLoadState("networkidle");
  await page.screenshot({
    path: test.info().outputPath("security-list-retried.png"),
    fullPage: true,
  });
  await expect(
    page.getByRole("heading", { name: "Your private reports" }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(lists).toBe(3);
  expect(initialSessionReads).toBe(1);
  expect(reads).toBe(2);
  await test.info().attach("security-read-counts", {
    body: JSON.stringify({
      lists,
      initialSessionReads,
      sessionsAfterReload: reads,
      submissions: 3,
    }),
    contentType: "application/json",
  });
  await expectAccessible(page);
});

test("security sign-in returns directly to the selected project", async ({
  page,
}) => {
  let reads = 0;
  await page.route("**/api/v1/project-session", (route) => {
    reads++;
    return route.fulfill({ json: { session: null } });
  });
  await page.route("**/api/v1/security-programs/eliza/intake", (route) =>
    route.fulfill({
      json: {
        state: "ready",
        automatic: "ready",
        automaticConfigured: true,
        checkedAt: new Date().toISOString(),
        maxAgeSeconds: 300,
        paidParticipation: "open",
        handoffUrl: "https://github.com/elizaOS/eliza/security/advisories/new",
      },
    }),
  );
  await page.goto("/projects/eliza/security", { waitUntil: "networkidle" });
  const signIn = page.getByRole("link", {
    name: "Sign in with GitHub",
    exact: true,
  });
  await signIn.focus();
  await expect(signIn).toBeFocused();
  await page.screenshot({
    path: test.info().outputPath("security-project-sign-in.png"),
    fullPage: true,
  });
  await expect(signIn).toHaveAttribute(
    "href",
    /\/login\?next=%2Fprojects%2Feliza%2Fsecurity$/u,
  );
  expect(reads).toBe(1);
  await expectAccessible(page);
});

test("token amounts keep asset precision when publishing an unrelated project edit", async ({
  page,
}) => {
  const registered = PROJECTS.find((entry) => entry.id === "eliza");
  if (registered?.reward.kind !== "monthly-pool")
    throw new Error("Eliza monthly fixture is missing");
  const project = {
    ...registered,
    contribution: CONTRIBUTION,
    reward: {
      ...registered.reward,
      chain: "base",
      currency: "TEST",
      monthlyCapMinor: "1000000000000000",
      monthlyCapDisplay: "0.001 TEST",
    },
    rewardAsset: {
      network: "base",
      kind: "token",
      address: "0x1111111111111111111111111111111111111111",
      symbol: "TEST",
      decimals: 18,
      chainId: "8453",
      cluster: null,
      verifiedAt: "2026-10-25T00:00:00.000Z",
    },
  };
  const setup = {
    projectId: "eliza",
    name: project.name,
    slug: project.slug,
    revision: 1,
    status: "active",
    state: "ready",
    nextAction: { kind: "none", message: "Project active.", href: null },
    checks: {
      authority: { state: "verified", message: "Verified." },
      installation: { state: "installed", message: "Installed." },
      scan: { state: "cleared", message: "Cleared." },
    },
    funding: { mode: "none" },
    activatedRevision: 1,
    checkedAt: "2026-10-25T00:00:00.000Z",
  };
  let published:
    | { manifest: typeof project; monthlyAmount?: string }
    | undefined;
  await page.route("**/data/fixture-project-registry.json", (route) =>
    route.fulfill({
      json: {
        schemaVersion: "1",
        projects: PROJECTS.map((entry) =>
          entry.id === project.id ? project : entry,
        ),
      },
    }),
  );
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "4242", githubLogin: "example", admin: false },
      },
    }),
  );
  await page.route("**/api/v1/project-setup/eliza/check", (route) =>
    route.fulfill({ json: { setup } }),
  );
  await page.route("**/api/v1/projects/eliza*", (route) => {
    if (route.request().method() !== "PUT")
      return route.fulfill({ json: { revision: 1, project } });
    published = route.request().postDataJSON();
    return route.fulfill({
      json: {
        project: { id: "eliza", revision: 2, manifest: published?.manifest },
        setup: { ...setup, revision: 2 },
        changes: { presentation: ["headline"], executable: [], financial: [] },
      },
    });
  });
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  await expect(page.getByLabel("Monthly amount (TEST)")).toHaveValue("0.001");
  await page
    .getByLabel("Short description")
    .fill("A focused token project description");
  await page
    .getByRole("button", { name: "Publish changes", exact: true })
    .click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({
    path: test.info().outputPath("token-project-edit.png"),
    fullPage: true,
  });
  await expect(page.getByText("Published revision 2.")).toBeVisible();
  expect(published?.manifest.reward.monthlyCapMinor).toBe("1000000000000000");
  expect(published?.monthlyAmount).toBeUndefined();
  await expect(page.getByLabel("Monthly amount (TEST)")).toHaveValue("0.001");
  await openOwnerSettings(page, "Monthly rewards");
  await page.getByLabel("Monthly amount (TEST)").fill("0.0000000000000000001");
  await page
    .getByRole("button", { name: "Publish changes", exact: true })
    .click();
  await expect(
    page.getByText("amount has more decimal places than the asset's 18"),
  ).toBeVisible();
  await expectAccessible(page);
});

async function loadSnapshot(
  request: APIRequestContext,
): Promise<LeaderboardSnapshot> {
  const response = await request.get("/data/leaderboard.json");
  expect(response.status()).toBe(200);
  const value: unknown = await response.json();
  assertLeaderboardSnapshot(value);
  return value;
}

async function loadCycles(request: APIRequestContext): Promise<CycleIndex> {
  const response = await request.get("/data/cycles/index.json");
  expect(response.status()).toBe(200);
  const value: unknown = await response.json();
  assertCycleIndex(value);
  return value;
}

test("discovers projects and one points-ranked homepage leaderboard", async ({
  page,
}) => {
  await page.route("**/.well-known/slop/projects.json", (route) =>
    route.fulfill({
      json: { schemaVersion: "1", projects: [{ project_id: "eliza" }] },
    }),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });

  const footer = page.locator(".site-footer");
  await expect(footer.getByRole("link", { name: "GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/SlopDotCash/slopdotcash",
  );
  const community = page.locator("section.community-projects");
  const listedCommunity = communityProjects();
  if (listedCommunity.length === 0) {
    await expect(community).toHaveCount(0);
  } else {
    // Community projects list ten per page; every page stays reachable.
    const pages = Math.ceil(listedCommunity.length / 10);
    for (let index = 0; index < pages; index += 1) {
      for (const project of listedCommunity.slice(index * 10, (index + 1) * 10))
        await expect(
          community.locator(`a.project-row[href="/projects/${project.id}"]`),
        ).toBeVisible();
      if (index < pages - 1)
        await community.getByRole("button", { name: "Next page" }).click();
    }
  }
  for (const project of PROJECTS.filter(
    (project) => project.status === "paused",
  )) {
    await expect(
      page.locator(`a.project-card[href="/projects/${project.id}"]`),
    ).toHaveCount(0);
  }
  const elizaCard = page.locator('a.project-card[href="/projects/eliza"]');
  await expect(elizaCard.getByText("$1k", { exact: true })).toBeVisible();
  // The external prize is a community listing that also earns points.
  await expect(
    community.locator('a.project-row[href="/projects/delta-star"]'),
  ).toContainText("$1,000,000");
  await expect(
    page.getByRole("status", { name: "Agent prompt" }),
  ).toContainText(`${new URL(page.url()).origin}/SKILL.md`);
  for (const agent of ["Cursor", "ChatGPT", "Claude"])
    await expect(
      page.getByRole("link", { name: agent, exact: true }),
    ).toHaveAttribute("target", "_blank");
  const leaderboard = page.getByRole("region", {
    name: "Top sloperators",
    exact: true,
  });
  await expect(
    leaderboard.getByRole("columnheader", { name: "Points", exact: true }),
  ).toHaveAttribute("aria-sort", "descending");
  // The home leaderboard has no filter controls; a shared link still selects history.
  await expect(leaderboard.getByRole("group", { name: "Period" })).toHaveCount(
    0,
  );
  await expect(leaderboard.getByLabel("Project")).toHaveCount(0);
  await page.goto("/?period=lifetime#leaderboard");
  await expect(leaderboard.getByRole("table")).toBeVisible();
  const pointValues = await leaderboard
    .locator("tbody tr td:nth-child(3)")
    .allTextContents();
  const totals = pointValues.map((value) =>
    Number.parseInt(value.replaceAll(",", ""), 10),
  );
  expect(totals.length).toBeGreaterThan(0);
  expect(totals).toEqual([...totals].sort((a, b) => b - a));
  const firstLogin = await leaderboard
    .getByRole("table")
    .getByRole("link")
    .first()
    .innerText();
  await expect(leaderboard.getByLabel("Find a contributor")).toHaveCount(0);
  await expect(
    leaderboard.getByRole("link", { name: firstLogin, exact: true }),
  ).toBeVisible();
  // Sizer phrases reserve caret space invisibly; reduced motion hides the live caret.
  await expect(
    page.locator(".hero-typewriter > .hero-typewriter-caret"),
  ).toBeHidden();
  await expect(
    page.locator("#projects").getByRole("link", { name: "Add a project" }),
  ).toHaveAttribute("href", "/projects/new");
  await page.goto("/#leaderboard", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/#leaderboard$/u);
  await expect
    .poll(() =>
      page.locator("#leaderboard").evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.top >= -1 && bounds.top < window.innerHeight;
      }),
    )
    .toBe(true);

  expect(
    await page
      .locator("#leaderboard")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
});

test("shows agent setup and keeps contribution records available", async ({
  context,
  page,
  request,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // This flow exercises the local project and cycle data, not GitHub's image CDN.
  // Serve a real local image while retaining all console and request failure checks.
  await page.route("https://avatars.githubusercontent.com/**", (route) =>
    route.fulfill({ path: "public/slop-mark.svg" }),
  );
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  const homeLink = page.getByRole("link", { name: "Slop home", exact: true });
  await expect(homeLink).toBeVisible();
  await expect(homeLink).toHaveAttribute("href", "/");
  // An unfunded pool shows no funding card.
  await expect(page.locator(".reward-card")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Copy agent prompt" }),
  ).toBeVisible();
  await expect(page.getByLabel("Manual install command")).toHaveCount(0);
  await expect(page.getByLabel("Solana public address")).toHaveCount(0);
  await expect(page.getByText("Cycle allocation details")).toHaveCount(0);
  const view = createProjectView(await loadSnapshot(request), "eliza");
  // The open cycle page carries the allocation table.
  await page.goto(`/cycles/eliza/${view.cycle.id}`);
  await expect(page.locator(".project-leader-row").first()).toBeVisible();
  const shareCells = await page
    .locator(".project-leader-row")
    .evaluateAll((rows) =>
      rows.map((row) => row.querySelectorAll("td")[3]?.textContent ?? ""),
    );
  expect(shareCells).toHaveLength(view.leaders.length);
  // No committed funds: every row is a share of payment weight, never dollars.
  for (const cell of shareCells) {
    expect(cell).toMatch(/^\d+\.\d{2}% of payment weight$/u);
  }
});

test("never presents Delta Star's external prize as platform money", async ({
  page,
}) => {
  await page.goto("/projects/delta-star", { waitUntil: "networkidle" });
  const history = page.locator(".payment-history");
  await expect(history).not.toContainText("$");
  await expect(
    history.getByRole("link", { name: "Manage funding" }),
  ).toHaveCount(0);
  await history
    .getByRole("link", { name: /^\d{4}-\d{2}$/u })
    .first()
    .click();
  await expect(page).toHaveURL(/\/cycles\/delta-star\/\d{4}-\d{2}$/u);
});

test("renders contributor and cycle records from validated public data", {
  tag: ["@pages"],
}, async ({ page, request }) => {
  await page.goto("/cycles/eliza/2026-99", { waitUntil: "networkidle" });
  await page
    .getByRole("link", { name: "See open projects", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/u);
  const snapshot = await loadSnapshot(request);
  const cycles = await loadCycles(request);
  const actor =
    snapshot.leaders[0]?.actor ?? cycles.cycles[0]?.contributors[0]?.actor;
  if (!actor) {
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.getByRole("alert")).toHaveCount(0);
    return;
  }

  await page.route(
    `${deployment.api}/api/v1/wallet-claims/actors/*/current`,
    async (route) => {
      const githubActorId = new URL(route.request().url()).pathname
        .split("/")
        .at(-2);
      expect(githubActorId).toMatch(/^\d+$/u);
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          claimId: "e2e-wallet-claim",
          githubActorId,
          address: "11111111111111111111111111111111",
        }),
      });
    },
  );

  await page.goto(`/contributors/${encodeURIComponent(actor.login)}`, {
    waitUntil: "networkidle",
  });
  await expect(page.getByRole("heading", { name: actor.login })).toBeVisible();
  // The profile shows recorded money only; cap-based estimates stay on project pages.
  await expect(
    page.locator(".profile-totals").getByText(/simulated estimate|pool$/u),
  ).toHaveCount(0);
  await expect(page.locator("li[data-activity-date]")).toHaveCount(0);

  const archived = cycles.cycles.find((cycle) =>
    cycle.contributors.some((entry) => entry.actor.id === actor.id),
  );
  if (archived) {
    await page.goto("/cycles", { waitUntil: "networkidle" });
    const month = new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${archived.cycleId}-01T00:00:00Z`));
    const project = PROJECTS.find((entry) => entry.id === archived.projectId);
    const projectIds = new Set(cycles.cycles.map((cycle) => cycle.projectId));
    if (projectIds.size > 1) {
      // Filters are shareable and keep complete coverage visible.
      await page
        .getByLabel("Project", { exact: true })
        .selectOption(archived.projectId);
      await expect(page).toHaveURL(
        new RegExp(`[?&]project=${archived.projectId}(?:&|$)`, "u"),
      );
      const shown = cycles.cycles.filter(
        (cycle) => cycle.projectId === archived.projectId,
      ).length;
      await expect(
        page.getByText(`${shown} of ${cycles.cycles.length} cycles`, {
          exact: true,
        }),
      ).toBeVisible();
      await page.reload();
      await expect(page.getByLabel("Project", { exact: true })).toHaveValue(
        archived.projectId,
      );
      await expect(page.locator(".cycle-record")).toHaveCount(shown);
    }
    await page
      .getByRole("link", {
        name: `${project?.name ?? archived.projectId} · ${month}`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", {
        name: `${project?.name ?? archived.projectId} · ${month}`,
        exact: true,
      }),
    ).toBeVisible();
    const records = page.getByText("Original records", {
      exact: true,
    });
    await records.focus();
    await page.keyboard.press("Enter");
    const frozen = page.getByRole("link", {
      name: /Source data/u,
    });
    await expect(frozen).toHaveAttribute(
      "href",
      archived.files.sourceSnapshot.url,
    );
    const download = await request.get(archived.files.sourceSnapshot.url);
    expect(download.ok()).toBe(true);
    expect(
      createHash("sha256")
        .update(await download.body())
        .digest("hex"),
    ).toBe(archived.files.sourceSnapshot.sha256);
  } else {
    const view = createProjectView(snapshot, "eliza");
    await page.goto(`/cycles/eliza/${view.cycle.id}`);
    await expect(
      page.getByRole("heading", {
        name: `Eliza · ${new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${view.cycle.id}-01T00:00:00Z`))}`,
      }),
    ).toBeVisible();
  }
});

test("makes the public project draft boundary unmistakable", async ({
  page,
}) => {
  // The form must finish loading before it is edited.
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  await expect(
    page
      .getByRole("navigation", { name: "Project navigation" })
      .getByRole("link", { name: "Funds & awards" }),
  ).toHaveAttribute("href", "/projects/eliza/funding");
  await expect(page.getByLabel("Draft total, USDC")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Sign in to publish changes" }),
  ).toHaveAttribute("href", /\/login\?next=%2Fprojects%2Feliza%2Fmanage$/u);
  await page.getByLabel("Short description").fill("Eliza-only draft");
  await openOwnerSettings(page, "Public revision note (optional)");
  await page
    .getByLabel("Revision note")
    .fill("Clarify the project focus for contributors.");
  const changes = page.getByRole("region", { name: "Changes" });
  await expect(changes).toContainText("Eliza-only draft");
  await expect(changes).toContainText(
    PROJECTS.find((project) => project.id === "eliza")?.headline ?? "",
  );
  await expect(changes).toContainText("Publishes now: Short description.");
  await expect(
    page.getByRole("button", { name: "Publish changes" }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    window.history.pushState({}, "", "/projects/asi/manage");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  const nextProject = PROJECTS.find((project) => project.id === "asi");
  if (!nextProject) throw new Error("ASI project is missing");
  await expect(page.getByLabel("Short description")).toHaveValue(
    nextProject.headline,
  );
  await page.goto("/projects/eliza/manage");
  await expect(page.getByLabel("Short description")).toHaveValue(
    "Eliza-only draft",
  );
  await expectAccessible(page);
});

test("publishes criteria changes directly and stops a stale maintainer draft", async ({
  page,
}) => {
  const registered = PROJECTS.find((entry) => entry.id === "eliza");
  if (!registered) throw new Error("Eliza is missing");
  const project = {
    ...registered,
    contribution: {
      ...CONTRIBUTION,
      approvedScope:
        "Work must improve the primary product and pass three gates: authorized demand, primary mission, and material outcome. Authorized demand means a maintainer request or an approved requirement. The affected workflow must pass end-to-end checks. Keep source, local tests, hosted checks and production acceptance separate. Reuse existing code and preserve review history. Include the exact old and new criteria so the maintainer can review the entire change before submission.",
    },
  };
  await page.route("**/data/fixture-project-registry.json", (route) =>
    route.fulfill({
      json: {
        schemaVersion: "1",
        projects: PROJECTS.map((entry) =>
          entry.id === project.id ? project : entry,
        ),
      },
    }),
  );
  let revision = 1;
  let submission: {
    expectedRevision: number;
    manifest: { contribution: { approvedScope: string } };
  } | null = null;
  const setup = {
    projectId: "eliza",
    name: project.name,
    slug: project.slug,
    revision: 3,
    status: "paused",
    state: "waiting",
    nextAction: {
      kind: "wait_for_scan",
      message: "The security scan is queued. Nothing is needed from you.",
      href: null,
    },
    checks: {
      authority: {
        state: "verified",
        message: "@example has maintain access to elizaOS/eliza.",
      },
      installation: {
        state: "installed",
        message: "Slopbot is installed on elizaOS/eliza.",
      },
      scan: {
        state: "queued",
        message: "The security scan is queued. Nothing is needed from you.",
      },
    },
    funding: { mode: "none" },
    activatedRevision: null,
    checkedAt: "2026-10-23T00:00:00.000Z",
  };
  await page.route("**/api/v1/projects/eliza*", (route) => {
    if (route.request().method() === "PUT") {
      submission = route.request().postDataJSON();
      return route.fulfill({
        json: {
          project: { id: "eliza", revision: 3, status: "paused" },
          changes: {
            presentation: [],
            executable: ["contribution"],
            financial: [],
          },
          setup,
        },
      });
    }
    return route.fulfill({ json: { revision, project } });
  });
  await page.route("**/api/v1/project-setup/eliza/check", (route) =>
    route.fulfill({ json: { setup } }),
  );
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "4242", githubLogin: "example", admin: false },
      },
    }),
  );
  // The form must finish loading before it is edited and published.
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  await expect(page.getByLabel("Acceptance criteria")).toHaveValue(
    project.contribution?.approvedScope ?? "",
  );
  await openOwnerSettings(page, "Contribution rules");
  const instructions = page.locator("details.proposal-skill-rules");
  await instructions.locator("summary").click();
  await page
    .getByLabel("Required tests", { exact: true })
    .fill("x".repeat(2001));
  await page.getByRole("button", { name: "Publish changes" }).click();
  await expect(page.locator("#field-requiredTests-error")).toBeVisible();
  await instructions.locator("summary").click();
  await expect(instructions).not.toHaveAttribute("open", "");
  await page.getByRole("button", { name: "Publish changes" }).click();
  await expect(page.locator("#field-requiredTests-error")).toBeVisible();
  expect(submission).toBeNull();
  await page
    .getByLabel("Required tests", { exact: true })
    .fill(project.contribution?.requiredTests ?? "");
  await expect(instructions).toHaveAttribute("open", "");
  const scope =
    "Fix reproducible defects and provide the affected workflow evidence.";
  await openOwnerSettings(page, "Contribution rules");
  await page.getByLabel("Acceptance criteria").fill(scope);
  await openOwnerSettings(page, "Public revision note (optional)");
  await page
    .getByLabel("Revision note")
    .fill("Clarify acceptance evidence for maintainers.");
  await expect(page.getByRole("region", { name: "Changes" })).toContainText(
    scope,
  );
  await expect(page.getByRole("region", { name: "Changes" })).not.toContainText(
    "No changes yet",
  );
  revision = 2;
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("alert")).toContainText(
    "saved against revision 1",
  );
  await expect(
    page.getByRole("button", { name: "Publish changes" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Acceptance criteria")).toHaveValue(scope);
  await page.getByRole("button", { name: "Use this draft" }).click();
  const review = page.getByRole("region", { name: "Changes" });
  const proposed = review.getByText(scope, { exact: true });
  await review.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: test.info().outputPath("criteria-reviewed-diff.png"),
    fullPage: true,
  });
  async function expectReadableReview() {
    const reviewBox = await review.boundingBox();
    const proposedBox = await proposed.boundingBox();
    if (!reviewBox || !proposedBox)
      throw new Error("Change preview is missing");
    // Long current text must not squeeze the proposal into a word-by-word
    // column or force horizontal page scrolling before the owner can submit.
    expect(proposedBox.width).toBeGreaterThanOrEqual(reviewBox.width * 0.35);
    const geometry = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
    }));
    expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);
  }
  await expectReadableReview();
  await review.evaluate((element) => {
    const sizes = [...element.querySelectorAll<HTMLElement>("*")].map(
      (child) => ({
        child,
        size: Number.parseFloat(getComputedStyle(child).fontSize),
      }),
    );
    for (const { child, size } of sizes) child.style.fontSize = `${size * 2}px`;
  });
  await expectReadableReview();
  await expectAccessible(page);
  await review.screenshot({
    path: test.info().outputPath("criteria-review-200-percent-text.png"),
  });
  await expect(page.getByRole("region", { name: "Changes" })).toContainText(
    "Needs a new security scan: Contribution rules.",
  );
  await page.getByRole("button", { name: "Publish changes" }).click();
  await expect(page.getByText("Published revision 3.")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Setup status: Waiting for the security scan",
    }),
  ).toBeVisible();
  expect(submission).toMatchObject({
    expectedRevision: 2,
    manifest: { contribution: { approvedScope: scope } },
  });
  await page.getByRole("button", { name: "Discard draft" }).click();
  await expect(page.getByLabel("Acceptance criteria")).toHaveValue(
    project.contribution?.approvedScope ?? "",
  );
  await expect(page.getByRole("region", { name: "Changes" })).toHaveCount(0);
  // PRD section 8: an exempt project publishes skill changes without a new
  // scan, so the change list must not say that it needs one.
  Object.assign(setup.checks.scan, {
    state: "cleared",
    exempt: true,
    message: "Existing project, permanently exempt from scan clearance.",
  });
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText("Exempt", { exact: true })).toBeVisible();
  await openOwnerSettings(page, "Contribution rules");
  await page.getByLabel("Acceptance criteria").fill(scope);
  const exemptChanges = page.getByRole("region", { name: "Changes" });
  await expect(exemptChanges).toContainText(
    "Publishes now: Contribution rules.",
  );
  await expect(exemptChanges).not.toContainText("Needs a new security scan");
});

test("reaches and reads older inbox notifications without losing the page", async ({
  page,
}) => {
  const notifications = Array.from({ length: 101 }, (_, i) => ({
    eventKey: `project-revision:sample:${i}`,
    kind: "project_revision",
    subject: `project-${i}`,
    detail: null,
    actionPath: "/projects/eliza",
    sourceAt: "2026-10-22T00:00:00.000Z",
    createdAt: "2026-10-22T00:00:00.000Z",
    readAt: null as string | null,
  }));
  await page.route(/\/api\/v1\/notifications(?:\?.*)?$/u, (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    const offset = cursor
      ? notifications.findIndex((n) => n.eventKey === JSON.parse(cursor)[1]) + 1
      : 0;
    const entries = notifications.slice(offset, offset + 100);
    const last = entries.at(-1);
    return route.fulfill({
      json: {
        notifications: entries,
        unread: notifications.filter((n) => n.readAt === null).length,
        nextCursor:
          offset + entries.length < notifications.length && last
            ? JSON.stringify([last.sourceAt, last.eventKey])
            : null,
      },
    });
  });
  await page.route("**/api/v1/notifications/email", (route) =>
    route.fulfill({ json: { enabled: false, availability: "unavailable" } }),
  );
  await page.route("**/api/v1/notifications/read", (route) => {
    const keys: string[] = route.request().postDataJSON().eventKeys;
    for (const n of notifications)
      if (keys.includes(n.eventKey)) n.readAt = "2026-10-22T01:00:00.000Z";
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/inbox");
  await expect(page.locator(".inbox-item")).toHaveCount(100);
  await page
    .getByRole("button", { name: "Mark shown as read", exact: true })
    .click();
  await expect(page.locator(".inbox-summary")).toContainText("1 unread");
  await page.getByRole("button", { name: "Older notifications" }).click();
  await expect(page.locator(".inbox-item")).toHaveCount(1);
  await expect(page.locator(".inbox-item")).toContainText("project-100");
  await page
    .getByRole("button", { name: "Mark shown as read", exact: true })
    .click();
  await expect(page.locator(".inbox-summary")).toContainText("All read.");
  await expect(page.locator(".inbox-item")).toContainText("project-100");
  await page.screenshot({
    path: test.info().outputPath("older-notification-read.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Newer notifications" }).click();
  await expect(page.locator(".inbox-item")).toHaveCount(100);
});

test("the inbox keeps delivery, read and acknowledgment distinct and links to account email preferences", async ({
  page,
}) => {
  const paymentReads: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/payments/me")
      paymentReads.push(request.url());
  });
  const notice = (
    i: number,
    emailDelivery: string | undefined,
    extra: Record<string, unknown> = {},
  ) => ({
    eventKey: `project-revision:delivery:${i}`,
    kind: "project_revision",
    subject: `delivery-${i}`,
    detail: null,
    actionPath: "/projects/eliza",
    sourceAt: `2026-10-22T0${i}:00:00.000Z`,
    createdAt: `2026-10-22T0${i}:00:00.000Z`,
    readAt: i % 2 === 0 ? null : "2026-10-22T09:00:00.000Z",
    ...(emailDelivery ? { emailDelivery } : {}),
    ...extra,
  });
  const notifications = [
    notice(1, "sent"),
    notice(2, "delivered"),
    notice(3, "failed"),
    notice(4, "uncertain"),
    notice(5, "queued"),
    notice(6, undefined),
    {
      ...notice(7, "sent"),
      eventKey: "security-case:case-0001:triage",
      kind: "security_case",
      subject: "case-0001",
      actionPath: "/security",
      acknowledgedAt: null,
    },
  ];
  await page.route(/\/api\/v1\/notifications(?:\?.*)?$/u, (route) =>
    route.fulfill({
      json: { notifications, unread: 3, nextCursor: null },
    }),
  );
  await page.route("**/api/v1/notifications/email", (route) =>
    route.fulfill({ json: { enabled: false, availability: "unverified" } }),
  );
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "4242", githubLogin: "example", admin: false },
      },
    }),
  );
  await page.route("**/api/v1/project-appeals", (route) =>
    route.fulfill({ json: { appeals: [] } }),
  );
  await page.route("**/api/v1/payments/me", (route) =>
    route.fulfill({
      json: {
        githubUserId: "4242",
        wallets: [],
        payments: [],
        monthlyAwards: [],
        balances: [],
        directTransfers: [],
        walletObservations: [],
      },
    }),
  );
  await page.goto("/inbox", { waitUntil: "networkidle" });
  const item = (subject: string) =>
    page.locator(".inbox-item", { hasText: subject });
  const sent = item("delivery-1");
  await expect(sent.locator(".inbox-state")).toHaveText("Read");
  await expect(
    sent.getByText("Email: sent", { exact: true }),
  ).not.toBeVisible();
  await sent.getByText("Email delivery", { exact: true }).click();
  await expect(sent.getByText("Email: sent", { exact: true })).toBeVisible();
  await expect(sent.getByText("Email: delivered", { exact: true })).toHaveCount(
    0,
  );
  const delivered = item("delivery-2");
  await expect(delivered.locator(".inbox-state")).toHaveText("Unread");
  await delivered.getByText("Email delivery", { exact: true }).click();
  await expect(
    delivered.getByText("Email: delivered", { exact: true }),
  ).toBeVisible();
  await expect(
    item("delivery-3").getByText("Email: failed", { exact: true }),
  ).toBeVisible();
  await expect(
    item("delivery-4").getByText("Email: uncertain", { exact: true }),
  ).toBeVisible();
  const queued = item("delivery-5");
  await expect(
    queued.getByText("Email: queued", { exact: true }),
  ).not.toBeVisible();
  await queued.getByText("Email delivery", { exact: true }).click();
  await expect(
    queued.getByText("Email: queued", { exact: true }),
  ).toBeVisible();
  await expect(item("delivery-6").locator(".inbox-delivery")).toHaveCount(0);
  // Reading a private notice or accepting its email does not acknowledge it.
  const security = item("case-0001");
  await expect(security.locator(".inbox-state")).toHaveText("Read");
  await security.getByText("Email delivery", { exact: true }).click();
  await expect(
    security.getByText("Email: sent", { exact: true }),
  ).toBeVisible();
  await expect(
    security.getByRole("button", { name: /^Acknowledge:/u }),
  ).toBeVisible();
  await expect(security.getByText("Acknowledged", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("region", { name: "Email preferences" }),
  ).toHaveCount(0);
  await expectAccessible(page);
  await page.screenshot({
    path: test.info().outputPath("inbox-delivery-states.png"),
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Email preferences", exact: true })
    .click();
  await expect(page).toHaveURL(/\/account#notifications$/u);
  const preferences = page.getByRole("region", { name: "Email preferences" });
  await expect(preferences).toContainText(
    "No verified email address is on file.",
  );
  await expect(
    preferences.getByRole("button", { name: "Retry email preferences" }),
  ).toHaveCount(0);
  await page.unroute("**/api/v1/notifications/email");
  await page.route("**/api/v1/notifications/email", (route) =>
    route.fulfill({ json: { enabled: false, availability: "unavailable" } }),
  );
  await page.reload();
  const retry = preferences.getByRole("button", {
    name: "Retry email preferences",
  });
  await expect(retry).toBeVisible();
  await page.unroute("**/api/v1/notifications/email");
  await page.route("**/api/v1/notifications/email", (route) =>
    route.fulfill({
      json: {
        enabled: false,
        availability: "verified",
        email: "example@example.com",
        destinationVersion: "a".repeat(64),
      },
    }),
  );
  await retry.click();
  await expect(preferences).toContainText("example@example.com");
  await expect(
    preferences.getByRole("button", { name: "Turn on activity email" }),
  ).toBeVisible();
  await expectAccessible(page);
  expect(paymentReads).toEqual([]);
});

test("an admin leaves an unset reward asset unchanged until choosing it", async ({
  page,
}) => {
  const project = PROJECTS.find((entry) => entry.id === "asi");
  if (!project) throw new Error("ASI is missing");
  const { rewardAsset: _asset, ...manifest } = project;
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "4242", githubLogin: "example", admin: true },
      },
    }),
  );
  await page.route("**/api/v1/admin/projects", (route) =>
    route.fulfill({
      json: {
        projects: [
          {
            id: project.id,
            status: project.status,
            revision: 1,
            manifest,
            manifestSha256: "a".repeat(64),
            createdAt: "2026-10-22T00:00:00.000Z",
            updatedAt: "2026-10-22T00:00:00.000Z",
            sourceApplicationId: null,
            enforcement: {
              state: "clear",
              appeal: "none",
              since: null,
              restrictedBy: [],
              nextSequence: 1,
              revisionPending: false,
              moderation: "unconfigured",
              decisionRequired: false,
              bannedMaintainers: [],
              records: [],
            },
          },
        ],
      },
    }),
  );
  await page.route("**/api/v1/admin/vetting*", (route) =>
    route.fulfill({
      json: {
        service: {
          state: "unavailable",
          reason: "Test service is not configured",
          queueRegistrationAvailable: false,
        },
        projects: [],
      },
    }),
  );
  // The admin project list also reads the private fee report (PRD section 6).
  await page.route("**/api/v1/admin/fee-conversions", (route) =>
    route.fulfill({
      json: {
        schemaVersion: "1",
        recent: [],
        routes: [
          { network: "robinhood", targetToken: null, status: "not_converted" },
        ],
        totals: [],
        last24Hours: [],
      },
    }),
  );
  await page.goto("/admin", { waitUntil: "networkidle" });
  await page.getByRole("searchbox", { name: "Find a project" }).fill("ASI");
  await page.getByRole("button", { name: "Open ASI", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\?project=asi$/u);
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  const changes = page.getByRole("region", { name: "Revision changes" });
  await expect(changes).toContainText("No changes.");
  await page
    .getByRole("textbox", { name: "Short description", exact: true })
    .fill("An updated description without a financial configuration change.");
  await expect(changes).toContainText("headline");
  await expect(changes).not.toContainText("rewardAsset");
  await page.getByRole("button", { name: "Close and keep draft" }).click();
  await page.getByRole("button", { name: "All projects", exact: true }).click();
  await page.getByRole("button", { name: "Open ASI", exact: true }).click();
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await expect(changes).not.toContainText("rewardAsset");
  await page.screenshot({
    path: test.info().outputPath("admin-no-implicit-asset.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Use this reward asset" }).click();
  await expect(changes).toContainText("rewardAsset");
  await page.getByLabel("Discovery placement").selectOption("community");
  await expect(page.getByLabel("Project status")).toHaveValue("paused");
  await expect(changes).toContainText("listingTier");
});

test("serves byte-consistent bootstrap and read-only site artifacts", {
  tag: ["@pages", "@pages-only"],
}, async ({ baseURL, request }) => {
  const documentResponse = await request.get("/");
  const policy = documentResponse.headers()["content-security-policy"];
  expect(policy).toBeDefined();
  const connectSources = policy
    .split(";")
    .map((directive) => directive.trim().split(/\s+/u))
    .find(([name]) => name === "connect-src");
  expect(connectSources).toEqual([
    "connect-src",
    "'self'",
    deployment.api,
    deployment.identity,
    "https://api.github.com",
  ]);

  const siteOrigin = baseURL ?? "http://127.0.0.1:4466";
  const originProtocol = new URL(siteOrigin).protocol;
  if (originProtocol !== "http:" && originProtocol !== "https:") {
    throw new Error(`unsupported test origin protocol: ${originProtocol}`);
  }
  // Production clients use the API authority, not a website-host alias.
  // Local Pages checks still exercise the local function's HTTPS rejection.
  const privateApiOrigin =
    originProtocol === "https:" ? deployment.api : siteOrigin;
  const privateApiResponse = await request.post(
    new URL("/api/v1/runs", privateApiOrigin).href,
    { data: {} },
  );
  const privateApiExpectation =
    originProtocol === "https:"
      ? { status: 401, error: "unauthorized" }
      : { status: 400, error: "https_required" };
  expect(privateApiResponse.status()).toBe(privateApiExpectation.status);
  expect(await privateApiResponse.json()).toMatchObject({
    error: privateApiExpectation.error,
  });

  const legacySkillResponse = await request.get("/skill.md", {
    maxRedirects: 0,
  });
  expect(legacySkillResponse.status()).toBe(301);
  // The legacy lowercase path names no project; it reaches the bootstrap skill.
  expect(legacySkillResponse.headers().location).toBe("/SKILL.md");
  const fundingRouteResponse = await request.get("/projects/eliza/funding", {
    maxRedirects: 0,
  });
  expect(fundingRouteResponse.status()).toBe(200);
  expect(await fundingRouteResponse.text()).toContain('<div id="root"></div>');
  const trailingFundingRouteResponse = await request.get(
    "/projects/eliza/funding/",
    { maxRedirects: 0 },
  );
  expect(trailingFundingRouteResponse.status()).toBe(200);
  expect(await trailingFundingRouteResponse.text()).toContain(
    '<div id="root"></div>',
  );
  // Monthly awards moved to the funding page. Saved Inbox notices and
  // bookmarks still open the old path; the preview server would conceal a
  // missing Pages rule.
  for (const path of ["/projects/eliza/awards", "/projects/eliza/awards/"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(301);
    expect(response.headers().location, path).toBe("/projects/eliza/funding");
  }
  for (const path of [
    "/models",
    "/models/",
    "/operator/traces",
    "/operator/traces/",
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(404);
    expect(await response.text(), path).not.toContain('<div id="root"></div>');
  }

  const [
    bootstrapResponse,
    discoveryResponse,
    discoverySkillResponse,
    identityResponse,
    privateTraceContractResponse,
    llmsResponse,
  ] = await Promise.all([
    request.get("/SKILL.md"),
    request.get("/.well-known/agent-skills/index.json"),
    request.get("/.well-known/agent-skills/slop/SKILL.md"),
    request.get("/protocol/identity-v1.json"),
    request.get("/protocol/private-trace-v1.md"),
    request.get("/llms.txt"),
  ]);
  for (const response of [
    bootstrapResponse,
    discoveryResponse,
    discoverySkillResponse,
    identityResponse,
    privateTraceContractResponse,
    llmsResponse,
  ]) {
    expect(response.status()).toBe(200);
  }
  // Project skills, terms and the project discovery index are rendered from
  // D1 by a Pages Function; the registry lane covers them.
  const missingDiscovery = await request.get("/.well-known/slop/missing.json");
  expect(missingDiscovery.status()).toBe(404);
  expect(await missingDiscovery.text()).not.toContain('<div id="root"></div>');
  expect(bootstrapResponse.headers()["content-type"]).toContain(
    "text/markdown",
  );
  expect(bootstrapResponse.headers()["access-control-allow-origin"]).toBe("*");
  expect(bootstrapResponse.headers()["cache-control"]).toContain("max-age=300");
  expect(discoveryResponse.headers()["content-type"]).toContain(
    "application/json",
  );
  expect(discoverySkillResponse.headers()["content-type"]).toContain(
    "text/markdown",
  );
  expect(identityResponse.headers()["content-type"]).toContain(
    "application/json",
  );
  expect(privateTraceContractResponse.headers()["content-type"]).toContain(
    "text/markdown",
  );
  expect(identityResponse.headers()["access-control-allow-origin"]).toBe("*");
  expect(identityResponse.headers()["cache-control"]).toContain("max-age=300");
  expect(await identityResponse.json()).toMatchObject({
    identityVersion: "slop-identity-v1",
    paymentMode: "disabled",
  });
  expect(llmsResponse.headers()["content-type"]).toContain("text/plain");
  const bootstrap = await bootstrapResponse.body();
  const bootstrapDigest = createHash("sha256").update(bootstrap).digest("hex");
  const discovery = (await discoveryResponse.json()) as {
    $schema: string;
    skills: Array<{
      digest: string;
      name: string;
      type: string;
      url: string;
    }>;
  };
  expect(discovery).toEqual({
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [
      expect.objectContaining({
        digest: `sha256:${bootstrapDigest}`,
        name: "slop",
        type: "skill-md",
        url: "https://slop.cash/SKILL.md",
      }),
    ],
  });
  expect(await discoverySkillResponse.body()).toEqual(bootstrap);
  expect(await llmsResponse.text()).toContain(`SHA-256: ${bootstrapDigest}`);
  expect(bootstrap.toString()).toContain(
    "separate informed consent and inspection; failure never blocks submission.",
  );
});

test("shows an explicit error for invalid data and retries", async ({
  page,
}) => {
  let attempts = 0;
  let failSnapshot = true;
  await page.route("**/data/leaderboard.json?**", async (route) => {
    attempts += 1;
    if (failSnapshot) {
      await route.fulfill({
        body: JSON.stringify({ schemaVersion: "forged" }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    await route.fallback();
  });
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator(".project-state-summary")).toContainText(
    "$1,000 monthly target",
  );
  await expect(page.locator(".project-state-summary")).not.toContainText("$0");
  await expectAccessible(page);
  const failedAttempts = attempts;
  expect(failedAttempts).toBeGreaterThan(1);
  failSnapshot = false;
  await page.getByRole("button", { name: /Retry/u }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  // The frozen fixture is older than eight hours: a retained snapshot shows
  // its stale label instead of passing as current (owner decision D2).
  await expect(
    page.getByRole("status").filter({ hasText: "Points may be outdated" }),
  ).toBeVisible();
  // Clearing the error starts loading; wait for the loaded snapshot before
  // checking that the retry made exactly one additional request.
  expect(attempts).toBe(failedAttempts + 1);
});

// 320 CSS px covers reflow; 200% text enlargement is a deterministic
// typography fixture, not native browser zoom. The combined case is extra stress.
for (const scenario of [
  { name: "320 CSS px reflow", width: 320, textScale: 1 },
  { name: "200% text enlargement", width: 1280, textScale: 2 },
  { name: "combined narrow enlarged-text stress", width: 320, textScale: 2 },
]) {
  // Each scenario and route is its own test, so every registered route keeps
  // its own timeout and the matrix runs across workers.
  test.describe(`reflow ${scenario.name}`, { tag: "@desktop-only" }, () => {
    for (const path of [
      "/how-it-works",
      "/",
      "/projects/eliza",
      "/projects/new",
      "/projects/eliza/funding",
    ]) {
      test(`reflows ${path} with ${scenario.name}`, async ({ page }) => {
        await page.setViewportSize({ width: scenario.width, height: 1000 });
        await page.goto(path, { waitUntil: "networkidle" });
        if (scenario.textScale === 2) {
          await enlargeText(page.locator("body"));
        }
        // The skip link is the first stop; it hands keyboard users the content.
        await page.keyboard.press("Tab");
        await expect(page.locator(":focus")).toHaveAttribute("href", "#main");
        await page.keyboard.press("Tab");
        await expect(page.locator(":focus")).toHaveAttribute("href", "/");
        await expectAccessible(page);
        const geometry = await page.evaluate(() => ({
          viewport: innerWidth,
          page: document.documentElement.scrollWidth,
        }));
        expect(
          geometry.page,
          `${scenario.name} ${path} horizontal overflow`,
        ).toBeLessThanOrEqual(geometry.viewport);
        const obscuredFooterLinks = await page.evaluate(() => {
          const brand = document.querySelector(".footer-brand-row .slop-mark");
          if (!brand) throw new Error("Footer brand is missing");
          const mark = brand.getBoundingClientRect();
          return [...document.querySelectorAll(".footer-links a")]
            .filter((link) => {
              const box = link.getBoundingClientRect();
              return (
                box.left < mark.right &&
                box.right > mark.left &&
                box.top < mark.bottom &&
                box.bottom > mark.top
              );
            })
            .map((link) => link.textContent);
        });
        expect(obscuredFooterLinks, "footer links covered by the logo").toEqual(
          [],
        );
      });
    }
  });
}

test("finds a receipt and opens its full evidence and GitHub contribution", async ({
  page,
  request,
}) => {
  const snapshot = await loadSnapshot(request);
  const entry = snapshot.attributions.find((entry) => entry.run !== null);
  await page.goto("/receipts", { waitUntil: "networkidle" });
  if (!entry?.run) {
    await expect(page.locator(".receipt-record")).toHaveCount(0);
    return;
  }
  await page
    .getByRole("searchbox", { name: "Find a receipt" })
    .fill(entry.run.runId);
  const record = page.locator(".receipt-record");
  await expect(record).toHaveCount(1);
  await record.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(
    record.getByText(entry.run.runId, { exact: true }),
  ).toBeVisible();
  await expect(
    record.getByText(entry.run.skillRevision, { exact: true }),
  ).toBeVisible();
  await expect(
    record.getByRole("link", {
      name: new URL(entry.sourceUrl).pathname
        .slice(1)
        .replace(/\/(?:pull|issues)\//u, " #"),
    }),
  ).toHaveAttribute("href", entry.sourceUrl);
  await expect(
    record.getByRole("link", {
      name: new URL(entry.sourceUrl).pathname
        .slice(1)
        .replace(/\/(?:pull|issues)\//u, " #"),
    }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Find a receipt" })
    .fill("no-matching-receipt-000000");
  await expect(page.locator(".receipt-record")).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Find a receipt" }).fill("");
  // Receipts show 25 per page; the count names every receipt.
  const total = snapshot.attributions.filter(
    (entry) => entry.run !== null,
  ).length;
  await expect(page.locator(".receipt-count")).toHaveText(
    `${total} of ${total} receipts`,
  );
  await expect(page.locator(".receipt-record")).toHaveCount(
    Math.min(total, 25),
  );
  if (total > 25) {
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.locator(".receipt-record")).toHaveCount(
      Math.min(total - 25, 25),
    );
  }
});

// All routes retain desktop/mobile checks. Extra widths cover each shared
// layout family instead of repeating each project's identical layout.
const breakpointRoutes = new Set([
  "/",
  "/account",
  "/projects/eliza",
  "/projects/eliza/funding",
  "/projects/new",
]);
for (const route of [
  "latest cycle",
  "/receipts",
  "/sponsors",
  "/how-it-works",
  "/account",
  "/",
  ...PROJECTS.map((project) => `/projects/${project.id}`),
  "/projects/eliza/funding",
  "/projects/eliza/manage",
  "/projects/new",
]) {
  test(`keeps ${route} accessible and inside the viewport`, {
    tag: breakpointRoutes.has(route) ? ["@layout", "@breakpoint"] : "@layout",
  }, async ({ page, request }) => {
    let path = route;
    if (route === "latest cycle") {
      const [cycle] = (await loadCycles(request)).cycles;
      test.skip(!cycle, "No closed cycle is published");
      path = `/cycles/${cycle.projectId}/${cycle.cycleId}`;
    }
    await page.goto(path, { waitUntil: "networkidle" });
    const project = PROJECTS.find(
      (candidate) => path === `/projects/${candidate.id}`,
    );
    if (project?.status === "paused") {
      await expect(page.getByLabel("Manual install command")).toHaveCount(0);
      await expect(page.locator(".reward-card")).toHaveCount(0);
      if (project.participation?.state === "archived") {
        const successorId = project.participation.successorProjectId;
        const successor = PROJECTS.find((entry) => entry.id === successorId);
        await expect(
          page
            .locator("#start")
            .getByRole("link", { name: successor?.name, exact: true }),
        ).toHaveAttribute(
          "href",
          `/projects/${project.participation.successorProjectId}`,
        );
      }

      await test.info().attach(`${project.id}-paused-project`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    }
    if (project) {
      const snapshot = await loadSnapshot(request);
      if (
        project.repositories.some(
          (repository) =>
            !snapshot.repositories.some(
              (collected) => collected.id === repository.id,
            ),
        )
      ) {
        await expect(page.getByRole("alert")).toHaveCount(0);
      }
    }
    await expectAccessible(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `${path} horizontal page overflow`).toBeLessThanOrEqual(1);
    if (project?.participation?.state === "archived") {
      const successorId = project.participation.successorProjectId;
      const successor = PROJECTS.find((entry) => entry.id === successorId);
      await page.locator("#start").getByRole("link").focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        successor?.name ?? "",
      );
      if (successor?.participation?.state === "permission-required") {
        await expect(page.locator("#start").getByRole("link")).toHaveAttribute(
          "href",
          successor.steward.github.profileUrl,
        );
      }
    }
  });
}

test("opens the sponsors page directly and through keyboard navigation", async ({
  page,
}, testInfo) => {
  await page.goto("/sponsors", { waitUntil: "networkidle" });
  // The page's records must finish loading before keyboard navigation
  // leaves it, or the move cancels the read.
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText("$4,900", { exact: true })).toBeVisible();
  const audience = page
    .locator("summary")
    .filter({ hasText: "Audience report ·" });
  await audience.focus();
  await page.keyboard.press("Enter");
  await expect(audience.locator("..")).toHaveAttribute("open", "");
  const rules = page.getByText("Funding rules", {
    exact: true,
  });
  await rules.focus();
  await page.keyboard.press("Enter");
  await expect(rules.locator("..")).toHaveAttribute("open", "");
  const pools = page.getByRole("list", {
    name: "Project funding pools",
    exact: true,
  });
  await expect(pools).toBeVisible();
  expect(
    await pools.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  const fundingLink = pools.getByRole("link").first();
  await expect(fundingLink).toHaveAttribute(
    "href",
    /^\/projects\/[^/]+\/funding$/u,
  );
  const fundingPath = await fundingLink.getAttribute("href");
  if (!fundingPath)
    throw new Error("The funding pool must link to its project");
  const fundingUrl = new URL(fundingPath, page.url()).href;
  await fundingLink.focus();
  await expect(fundingLink).toBeFocused();
  await testInfo.attach("sponsors-page", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(fundingUrl);
  await page.waitForLoadState("networkidle");
  const poolReturnSnapshot = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/data/leaderboard.json",
  );
  await page.goBack({ waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/sponsors$/u);
  expect(await (await poolReturnSnapshot).finished()).toBeNull();
  await expect(pools).toBeVisible();
  const home = page.getByRole("link", { name: "Slop home", exact: true });
  await home.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
  // Let the home records finish loading so going back aborts no request.
  await expect(page.locator("#leaderboard").getByRole("table")).toBeVisible({
    timeout: 60_000,
  });
  await page.waitForLoadState("networkidle");
  const homeReturnSnapshot = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/data/leaderboard.json",
  );
  await page.goBack({ waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/sponsors$/u);
  expect(await (await homeReturnSnapshot).finished()).toBeNull();
});

test("lands direct and lazy cross-route hash links on their section", async ({
  page,
  request,
}, info) => {
  const snapshot = await loadSnapshot(request);
  const actor = snapshot.leaders[0]?.actor;
  const event = snapshot.ledger.find(
    (entry) =>
      entry.actor.id === actor?.id && entry.source.kind === "pull-request",
  );
  if (!actor || !event)
    throw new Error(
      "The profile fixture needs a contributor with accepted work",
    );
  snapshot.penalties = [
    {
      id: `${event.source.id}:penalty`,
      actor,
      repository: event.repository,
      occurredAt: event.occurredAt,
      category: "spam",
      tableVersion: "slopbot-penalties-v1",
      debitThirds: 3,
      source: { ...event.source, kind: "pull-request" },
    },
  ];
  snapshot.leaders[0].scoreThirds -= 3;
  snapshot.leaders[0].score = Math.floor(snapshot.leaders[0].scoreThirds / 3);
  snapshot.leaders[0].penaltyThirds = 3;
  snapshot.leaders.sort(compareRankedEntries);
  assignLeaderboardRanks(snapshot.leaders);
  assertLeaderboardSnapshot(snapshot);
  await page.route("**/data/leaderboard.json?**", (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.route("**/api/v1/wallet-claims/actors/*/current", (route) =>
    route.fulfill({ json: null }),
  );
  let releaseChunk!: () => void;
  const chunkReady = new Promise<void>((resolve) => {
    releaseChunk = resolve;
  });
  await page.route(/\/assets\/PublicPages-[^/]+\.js$/u, async (route) => {
    await chunkReady;
    await route.continue();
  });
  try {
    await page.goto(`/contributors/${encodeURIComponent(actor.login)}`, {
      waitUntil: "networkidle",
    });
    await page.getByText("Penalty history · 1", { exact: true }).click();
    await page
      .getByRole("link", { name: "How penalties work", exact: true })
      .click();
    await expect(
      page.getByText("Loading page…", { exact: true }),
    ).toBeVisible();
    releaseChunk();
    await expect(page.locator("#points")).toBeInViewport();
    await expect
      .poll(() =>
        page
          .locator("#points")
          .evaluate((element) => Math.abs(element.getBoundingClientRect().top)),
      )
      .toBeLessThan(1);
    await page.screenshot({
      path: info.outputPath("lazy-fragment-target.png"),
    });
  } finally {
    releaseChunk();
  }
  for (const [path, id] of [
    ["/how-it-works#faq", "faq"],
    ["/#leaderboard", "leaderboard"],
  ] as const) {
    await page.goto(path);
    await expect(page.locator(`#${id}`)).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  }
});

test("refuses retired and unknown paths and recovers to projects", async ({
  page,
}) => {
  for (const path of ["/models", "/models/", "/constructor", "/__proto__"]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "Page not found", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveTitle("Page not found · Slop");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await page
      .getByRole("link", { name: "See open projects", exact: true })
      .click();
    await expect(page).toHaveURL(/\/$/u);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://slop.cash/",
    );
  }
});

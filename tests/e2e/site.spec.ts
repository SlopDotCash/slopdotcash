/**
 * Drives the built GitHub-native product through discovery, contribution,
 * wallet, profile, cycle, project-proposal, artifact, failure, responsive, and
 * accessibility paths using the exact generated public data.
 */

import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, test as base, expect } from "@playwright/test";
import { preparePullRequestLedger } from "../../scripts/prepare-pr-ledger";
import { assertCycleIndex, type CycleIndex } from "../../src/lib/cycle-index";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { createGlobalLeaders } from "../../src/lib/global-leaderboard";
import { communityProjects } from "../../src/lib/home-projects";
import {
  assertLeaderboardSnapshot,
  assertPublishableLeaderboardSnapshot,
  type LeaderboardSnapshot,
} from "../../src/lib/leaderboard";
import {
  createProjectView,
  projectCycleHasOpened,
} from "../../src/lib/project-view";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { CONTRIBUTION } from "../project-application-manifest";

const deployment = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);

const test = base.extend<{ browserDiagnostics: undefined }>({
  browserDiagnostics: [
    async ({ baseURL, page }, use, testInfo) => {
      const failures: string[] = [];
      const origin = new URL(baseURL ?? "http://127.0.0.1:4466").origin;
      page.on("console", (message) => {
        if (message.type() === "error") failures.push(message.text());
      });
      page.on("pageerror", (error) => failures.push(error.message));
      page.on("requestfailed", (request) => {
        if (new URL(request.url()).origin === origin) {
          failures.push(
            `${request.failure()?.errorText ?? "failed"} ${request.url()}`,
          );
        }
      });
      page.on("response", (response) => {
        if (
          new URL(response.url()).origin === origin &&
          response.status() >= 400
        ) {
          failures.push(`${response.status()} ${response.url()}`);
        }
      });
      await use(undefined);
      await testInfo.attach("browser-diagnostics", {
        body: JSON.stringify({
          sourceRevision: testInfo.config.metadata.sourceRevision,
          url: page.url(),
          failures,
        }),
        contentType: "application/json",
      });
      expect(
        failures,
        "browser console, request, and response failures",
      ).toEqual([]);
    },
    { auto: true },
  ],
});

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

test("equal contributors share cycle and profile ranks", async ({
  page,
  request,
}) => {
  // The local preview is not an allowed origin for the unrelated wallet API.
  await page.route(
    `${deployment.api}/api/v1/wallet-claims/actors/*/current`,
    (route) => route.fulfill({ json: null }),
  );
  const snapshot = await loadSnapshot(request);
  const cycles = await loadCycles(request);
  const publishedTie = snapshot.leaders.findIndex(
    (leader, index) =>
      index > 0 &&
      leader.scoreThirds === snapshot.leaders[index - 1].scoreThirds,
  );
  if (publishedTie < 0)
    throw new Error("Public snapshot has no tied contributor scores");
  for (const leader of snapshot.leaders) {
    expect(leader.rank).toBe(
      snapshot.leaders.filter((entry) => entry.scoreThirds > leader.scoreThirds)
        .length + 1,
    );
  }
  const publishedIds = snapshot.leaders.map((leader) => leader.actor.id);
  const scoreGroups = [
    ...new Set(snapshot.leaders.map((leader) => leader.scoreThirds)),
  ];
  expect(publishedIds).toEqual(
    scoreGroups.flatMap((score) =>
      snapshot.leaders
        .filter((leader) => leader.scoreThirds === score)
        .map((leader) => leader.actor.id)
        .sort(),
    ),
  );

  const renamed = structuredClone(snapshot);
  const tiedIds = snapshot.leaders
    .slice(publishedTie - 1, publishedTie + 1)
    .map((leader) => leader.actor.id)
    .sort();
  const logins = new Map([
    [tiedIds[0], "rank-order-z"],
    [tiedIds[1], "rank-order-a"],
  ]);
  const objects: unknown[] = [renamed];
  while (objects.length > 0) {
    const value = objects.pop();
    if (value === null || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const login =
      typeof record.id === "string" ? logins.get(record.id) : undefined;
    if (login && typeof record.login === "string") {
      record.login = login;
      record.url = `https://github.com/${login}`;
    }
    objects.push(...Object.values(record));
  }
  const compareStrings = (left: string, right: string) =>
    left < right ? -1 : left > right ? 1 : 0;
  renamed.leaders.sort(
    (left, right) =>
      right.scoreThirds - left.scoreThirds ||
      compareStrings(
        left.actor.login.toLowerCase(),
        right.actor.login.toLowerCase(),
      ) ||
      compareStrings(left.actor.login, right.actor.login) ||
      compareStrings(left.actor.id, right.actor.id),
  );
  renamed.leaders.forEach((leader, index) => {
    leader.rank = index + 1;
  });
  const originalRenamed = structuredClone(renamed);
  assertLeaderboardSnapshot(renamed);
  expect(() => assertPublishableLeaderboardSnapshot(renamed)).toThrow(
    "actor ID ordering",
  );
  const adapted = preparePullRequestLedger(renamed);
  assertPublishableLeaderboardSnapshot(adapted);
  expect(adapted.leaders.map((leader) => leader.actor.id)).toEqual(
    publishedIds,
  );
  expect(adapted.leaders.map((leader) => leader.rank)).toEqual(
    snapshot.leaders.map((leader) => leader.rank),
  );
  expect(renamed).toEqual(originalRenamed);
  const views = PROJECTS.filter(
    (project) =>
      projectCycleHasOpened(snapshot, project.id) &&
      project.repositories.every((repository) =>
        snapshot.repositories.some((entry) => entry.id === repository.id),
      ),
  ).map((project) => createProjectView(snapshot, project.id));
  // The following row proves that ranks skip past the tie, so the selected
  // tie must have a lower-scored contributor after it in the same view.
  const tie = views
    .flatMap((entry) =>
      entry.leaders.map((leader, index) => ({ view: entry, leader, index })),
    )
    .find(
      ({ view: entry, leader, index }) =>
        index > 0 &&
        leader.scoreThirds === entry.leaders[index - 1].scoreThirds &&
        leader.adjustedWeight !== entry.leaders[index - 1].adjustedWeight &&
        entry.leaders.some(
          (candidate) => candidate.scoreThirds < leader.scoreThirds,
        ),
    );
  if (!tie)
    throw new Error(
      "Public snapshot has no weighted score tie above another contributor",
    );
  const { view } = tie;
  const tiedScore = tie.leader.scoreThirds;
  const expectedRank =
    view.leaders.filter((leader) => leader.scoreThirds > tiedScore).length + 1;
  const tiedLeaders = view.leaders.filter(
    (leader) => leader.scoreThirds === tiedScore,
  );
  // The open cycle page carries the allocation table.
  await page.goto(`/cycles/${view.project.id}/${view.cycle.id}`);
  await expect(page.locator(".project-leader-row .rank-cell")).toHaveText(
    [...view.leaders]
      .sort(
        (left, right) =>
          right.scoreThirds - left.scoreThirds ||
          left.actor.id.localeCompare(right.actor.id),
      )
      .map(
        (leader) =>
          `#${view.leaders.filter((entry) => entry.scoreThirds > leader.scoreThirds).length + 1}`,
      ),
  );
  for (const leader of tiedLeaders) {
    const row = page.locator(".project-leader-row").filter({
      has: page.locator(
        `a[href="/contributors/${encodeURIComponent(leader.actor.login)}"]`,
      ),
    });
    await expect(row).toBeVisible();
    await expect(row.locator(".rank-cell")).toHaveText(`#${expectedRank}`);
  }
  const followingLeader = view.leaders
    .filter((leader) => leader.scoreThirds < tiedScore)
    .sort((left, right) => right.scoreThirds - left.scoreThirds)[0];
  if (!followingLeader)
    throw new Error("Public snapshot has no contributor after the score tie");
  const followingRow = page.locator(".project-leader-row").filter({
    has: page.locator(
      `a[href="/contributors/${encodeURIComponent(followingLeader.actor.login)}"]`,
    ),
  });
  await expect(followingRow.locator(".rank-cell")).toHaveText(
    `#${expectedRank + tiedLeaders.length}`,
  );

  const leaders = createGlobalLeaders(snapshot, views, cycles);
  const profileIndex = leaders.findIndex(
    (leader, index) => index > 0 && leader.score === leaders[index - 1].score,
  );
  if (profileIndex < 0)
    throw new Error("Public snapshot has no tied overall contributors");
  for (const leader of leaders.slice(profileIndex - 1, profileIndex + 1)) {
    await page.goto(`/contributors/${encodeURIComponent(leader.actor.login)}`);
    const rank = page.getByText("overall rank", { exact: true }).locator("..");
    await expect(rank).toBeVisible();
    await expect(rank.locator("strong")).toHaveText(`#${profileIndex}`);
  }
});

test("discovers projects and one score-ranked homepage leaderboard", async ({
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
    leaderboard.getByRole("columnheader", { name: "Score", exact: true }),
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
  const totals = pointValues.map((value) => Number(value.replaceAll(",", "")));
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
  await expect(page.locator(".hero-typewriter-caret")).toBeHidden();
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

test("blocks uncleared agent setup and keeps contribution records available", async ({
  context,
  page,
  request,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  const homeLink = page.getByRole("link", { name: "Slop home", exact: true });
  await expect(homeLink).toBeVisible();
  await expect(homeLink).toHaveAttribute("href", "/");
  // An unfunded pool shows no funding card.
  await expect(page.locator(".reward-card")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Agent setup awaiting security review" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy agent prompt" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Project owner: review setup" }),
  ).toHaveAttribute("href", "/projects/eliza/manage");
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
  expect(view.leaders.every((leader) => leader.projectedMinor === "0")).toBe(
    true,
  );
});

test("links each project's website and X account from its page", async ({
  page,
}) => {
  await page.goto("/projects/thenetwork", { waitUntil: "networkidle" });
  const network = page.getByRole("navigation", { name: "Project links" });
  await expect(
    network.getByRole("link", { name: "ntwrk.party" }),
  ).toHaveAttribute("href", "https://ntwrk.party");
  await expect(network.getByRole("link", { name: "GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/eliza-research/thenetwork",
  );
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  await expect(
    page
      .getByRole("navigation", { name: "Project links" })
      .getByRole("link", { name: "@elizaOS on X" }),
  ).toHaveAttribute("href", "https://x.com/elizaOS");
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

test("shows the frozen record for a cycle the live window still covers", {
  tag: ["@pages"],
}, async ({ page, request }) => {
  const snapshot = await loadSnapshot(request);
  const cycles = await loadCycles(request);
  // A month with a frozen record that the rolling window also reaches is the
  // case where a live recompute could replace what is under review.
  const overlapping = cycles.cycles.find((cycle) => {
    if (cycle.contributors.length === 0) return false;
    try {
      createProjectView(snapshot, cycle.projectId, cycle.cycleId);
      return true;
    } catch {
      return false;
    }
  });
  const cycle = overlapping ?? cycles.cycles.find((c) => c.contributors.length);
  if (cycle) {
    await page.goto(`/cycles/${cycle.projectId}/${cycle.cycleId}`, {
      waitUntil: "networkidle",
    });
    const rows = page.locator(".archived-leader-row");
    await expect(rows).toHaveCount(cycle.contributors.length);
    await expect(rows.first().getByRole("link")).toHaveText(
      cycle.contributors[0].actor.login,
    );
    await expect(
      page.locator(
        ".leader-row:not(.archived-leader-row, .archived-leader-head)",
      ),
    ).toHaveCount(0);
  }

  const project = PROJECTS.find(
    (candidate) => candidate.reward.kind === "monthly-pool",
  );
  if (!project) throw new Error("Monthly project fixture is unavailable");
  await page.goto(`/cycles/${project.id}/2025-01`, {
    waitUntil: "networkidle",
  });
  await expect(
    page.getByRole("link", { name: "project page" }),
  ).toHaveAttribute("href", `/projects/${project.slug}`);
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
  const acceptedRecords = snapshot.ledger.filter(
    (event) => event.actor.id === actor.id,
  );
  const activity = page.getByRole("region", { name: "Contribution activity" });
  await expect(activity).toBeVisible();
  const dates = await activity
    .locator("li[data-activity-date]")
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-activity-date") ?? ""),
    );
  expect(dates).toEqual([...dates].sort((a, b) => b.localeCompare(a)));
  if (acceptedRecords.length > 10) {
    await expect(activity.locator("li[data-activity-date]")).toHaveCount(10);
    const expand = activity.getByRole("button", {
      name: /View all .* activity records/u,
    });
    await expand.scrollIntoViewIfNeeded();
    await expand.focus();
    await page.keyboard.press("Enter");
    const collapse = activity.getByRole("button", {
      name: "Show recent activity",
    });
    await expect(collapse).toBeFocused();
    await expect(collapse).toBeInViewport();
    const fullDates = await activity
      .locator("li[data-activity-date]")
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-activity-date") ?? ""),
      );
    expect(fullDates.length).toBeGreaterThanOrEqual(acceptedRecords.length);
    expect(fullDates).toEqual(
      [...fullDates].sort((a, b) => b.localeCompare(a)),
    );
    const latest = [...acceptedRecords].sort((a, b) =>
      b.occurredAt.localeCompare(a.occurredAt),
    )[0];
    await expect(
      activity
        .getByRole("link", { name: latest.source.title, exact: true })
        .first(),
    ).toBeVisible();
    await expect(
      activity.getByRole("button", { name: "Show recent activity" }),
    ).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Enter");
    await expect(expand).toBeFocused();
    await expect(expand).toBeInViewport();
    await expect(activity.locator("li[data-activity-date]")).toHaveCount(10);
  }

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
        page.getByText(
          `Showing ${shown} of ${cycles.cycles.length} published cycles`,
        ),
      ).toBeVisible();
      await page.reload({ waitUntil: "networkidle" });
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
    const records = page.getByText("Original records and checksums", {
      exact: true,
    });
    await records.focus();
    await page.keyboard.press("Enter");
    const frozen = page.getByRole("link", {
      name: /Frozen source/u,
    });
    await expect(frozen).toHaveAttribute(
      "href",
      archived.files.sourceSnapshot.url,
    );
    await expect(frozen).toContainText(archived.files.sourceSnapshot.sha256);
    const download = await request.get(archived.files.sourceSnapshot.url);
    expect(download.ok()).toBe(true);
    expect(
      createHash("sha256")
        .update(await download.body())
        .digest("hex"),
    ).toBe(archived.files.sourceSnapshot.sha256);
  } else {
    const view = createProjectView(snapshot, "eliza");
    await page.goto(`/cycles/eliza/${view.cycle.id}`, {
      waitUntil: "networkidle",
    });
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
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("link", { name: "Funding setup" }),
  ).toHaveAttribute("href", "/projects/eliza/funding");
  await expect(page.getByLabel("Draft total, USDC")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Sign in to publish changes" }),
  ).toHaveAttribute("href", /\/login\?next=%2Fprojects%2Feliza%2Fmanage$/u);
  await page.getByLabel("Short description").fill("Eliza-only draft");
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
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  await expect(page.getByLabel("Short description")).toHaveValue(
    "Eliza-only draft",
  );
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
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
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  await expect(page.getByLabel("Acceptance criteria")).toHaveValue(
    project.contribution?.approvedScope ?? "",
  );
  const scope =
    "Fix reproducible defects and provide the affected workflow evidence.";
  await page.getByLabel("Acceptance criteria").fill(scope);
  await page
    .getByLabel("Revision note")
    .fill("Clarify acceptance evidence for maintainers.");
  await expect(page.getByRole("region", { name: "Changes" })).toContainText(
    scope,
  );
  await expect(page.getByRole("region", { name: "Changes" })).not.toContainText(
    "No manifest field has changed",
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
  await page
    .getByRole("button", { name: "Use this draft with the current revision" })
    .click();
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
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
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
  await expect(page.getByRole("region", { name: "Changes" })).toContainText(
    "No manifest field has changed",
  );
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
  await page.goto("/inbox", { waitUntil: "networkidle" });
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
  await expect(page.locator(".inbox-summary")).toContainText(
    "All notifications are read.",
  );
  await expect(page.locator(".inbox-item")).toContainText("project-100");
  await page.screenshot({
    path: test.info().outputPath("older-notification-read.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Newer notifications" }).click();
  await expect(page.locator(".inbox-item")).toHaveCount(100);
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
  await page.goto("/admin", { waitUntil: "networkidle" });
  await page.getByRole("searchbox", { name: "Find a project" }).fill("ASI");
  await page.getByRole("button", { name: "Open ASI", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\?project=asi$/u);
  await page
    .getByRole("button", { name: "Edit manifest", exact: true })
    .click();
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
  await page
    .getByRole("button", { name: "Edit manifest", exact: true })
    .click();
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

test("project standings and sponsor links keep the intended destination", async ({
  page,
}) => {
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  const standings = page.getByRole("link", {
    name: "Full standings",
    exact: true,
  });
  await expect(standings).toHaveAttribute("href", /project=eliza/u);
  await standings.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Leaderboard",
  );
  await expect(page.getByLabel("Project", { exact: true })).toHaveValue(
    "eliza",
  );
  await page.goto("/sponsors", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("link", { name: "Eliza", exact: true }),
  ).toHaveAttribute("href", "/projects/eliza/funding");
  await expect(
    page.getByRole("link", { name: "Reviewed project revisions", exact: true }),
  ).toHaveAttribute("href", "/api/v1/project-revisions");
  await page.screenshot({
    path: test.info().outputPath("direct-sponsor-handoffs.png"),
    fullPage: true,
  });
});

test("current payment guidance separates award approval from vault payment", async ({
  page,
}) => {
  await page.goto("/how-it-works", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("list", { name: "Award review stages" }),
  ).toBeVisible();
  await expect(
    page.getByText("Funded, awaiting wallet", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Funded, ready", { exact: true })).toBeVisible();
  await expect(
    page.getByText("An unsigned transfer plan exists.", { exact: false }),
  ).toHaveCount(0);
  await page.getByText("How do I get paid?", { exact: true }).click();
  await expect(
    page.getByText("Wallet confirmation requires your signature.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("current-vault-payment-states.png"),
    fullPage: true,
  });
  await page.goto("/sponsors", { waitUntil: "networkidle" });
  await page
    .getByText("Funding rules and payment stages", { exact: true })
    .click();
  await expect(
    page.getByRole("list", { name: "Award review stages" }),
  ).toBeVisible();
  await expect(page.getByText("Funded, ready", { exact: true })).toBeVisible();
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
  await expect(page.locator(".reward-card")).not.toContainText("$0");
  const errorAccessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    errorAccessibility.violations,
    "data error state accessibility violations",
  ).toEqual([]);
  const failedAttempts = attempts;
  expect(failedAttempts).toBeGreaterThan(1);
  failSnapshot = false;
  await page.getByRole("button", { name: /Retry/u }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(attempts).toBe(failedAttempts + 1);
  // The frozen fixture is older than eight hours: a retained snapshot shows
  // its stale label instead of passing as current (owner decision D2).
  await expect(
    page.getByRole("status").filter({ hasText: "Scores may be outdated" }),
  ).toBeVisible();
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
  test.describe(`reflow ${scenario.name}`, () => {
    // A describe-level condition skips before any page fixture is created.
    // The wide desktop project is the only 1440 px viewport.
    test.skip(
      ({ viewport }) => viewport?.width !== 1440,
      "Runs once on wide-desktop-chromium",
    );
    for (const path of [
      "/models",
      "/sponsors",
      "/how-it-works",
      "/",
      ...PROJECTS.map((project) => `/projects/${project.id}`),
      "/projects/new",
      "/projects/eliza/funding",
    ]) {
      test(`reflows ${path} with ${scenario.name}`, async ({ page }) => {
        await page.setViewportSize({ width: scenario.width, height: 1000 });
        await page.goto(path, { waitUntil: "networkidle" });
        if (scenario.textScale === 2) {
          await page.evaluate(() => {
            // Capture every original computed size before changing any ancestor,
            // so nested text receives exactly 200%, not compounded enlargement.
            const typography = [
              ...document.querySelectorAll<HTMLElement>("body *"),
            ]
              .filter((element) => element instanceof HTMLElement)
              .map((element) => ({
                element,
                font: getComputedStyle(element).fontSize,
                line: getComputedStyle(element).lineHeight,
              }));
            for (const { element, font, line } of typography) {
              element.style.setProperty(
                "font-size",
                `${Number.parseFloat(font) * 2}px`,
              );
              if (line !== "normal")
                element.style.setProperty(
                  "line-height",
                  `${Number.parseFloat(line) * 2}px`,
                );
            }
          });
        }
        // The skip link is the first stop; it hands keyboard users the content.
        await page.keyboard.press("Tab");
        await expect(page.locator(":focus")).toHaveAttribute("href", "#main");
        await page.keyboard.press("Tab");
        await expect(page.locator(":focus")).toHaveAttribute("href", "/");
        const accessibility = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        expect(
          accessibility.violations,
          `${scenario.name} ${path} accessibility`,
        ).toEqual([]);
        const geometry = await page.evaluate(() => ({
          viewport: innerWidth,
          page: document.documentElement.scrollWidth,
        }));
        expect(
          geometry.page,
          `${scenario.name} ${path} horizontal overflow`,
        ).toBeLessThanOrEqual(geometry.viewport);
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
  await page.goto("/models", { waitUntil: "networkidle" });
  const modelReceipts = page
    .locator('.model-outcome-details a[href^="/receipts?q="]')
    .first();
  if (await modelReceipts.count()) {
    await modelReceipts
      .locator("xpath=ancestor::details")
      .locator("summary")
      .focus();
    await page.keyboard.press("Enter");
    await modelReceipts.click();
    await expect(page).toHaveURL(/\/receipts\?q=/u);
    await expect(
      page.getByRole("searchbox", { name: "Find a receipt" }),
    ).not.toHaveValue("");
    expect(await page.locator(".receipt-record").count()).toBeGreaterThan(0);
  } else {
    await page.goto("/receipts", { waitUntil: "networkidle" });
  }
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
    record.getByText(entry.run.skillSha256, { exact: true }),
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
  await expect(page.locator(".receipt-record")).toHaveCount(
    snapshot.attributions.filter((entry) => entry.run !== null).length,
  );
});

// One test per route keeps each axe and overflow check independent, so the
// routes run on separate workers instead of one long serial test.
for (const route of [
  "latest cycle",
  "/models",
  "/receipts",
  "/sponsors",
  "/how-it-works",
  "/account",
  "/",
  ...PROJECTS.map((project) => `/projects/${project.id}`),
  "/projects/eliza/funding",
  "/projects/eliza/funding/",
  "/projects/eliza/manage",
  "/projects/new",
]) {
  test(`keeps ${route} accessible and inside the viewport`, async ({
    page,
    request,
  }) => {
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
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations, `${path} accessibility violations`).toEqual([]);
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

test("opens the models page directly and through keyboard navigation", async ({
  page,
}, testInfo) => {
  await page.goto("/models", { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
  const outcomes = page.getByRole("list", {
    name: "Accepted outcomes by model",
    exact: true,
  });
  const firstModel = outcomes.locator(":scope > li").first();
  await expect(firstModel).toBeVisible();
  const disclosure = firstModel.locator("summary");
  await disclosure.focus();
  await page.keyboard.press("Enter");
  await expect(firstModel.locator("details")).toHaveAttribute("open", "");
  await expect(
    firstModel
      .locator("dd")
      .filter({ hasText: /\d[\d,]* of \d[\d,]* outcomes/ }),
  ).toBeVisible();
  const clients = page.locator(".model-clients > summary");
  await clients.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("list", { name: "Client outcomes", exact: true }),
  ).toBeVisible();
  const client = page
    .locator(".model-clients .model-outcome-list > li")
    .first();
  await client.locator("summary").press("Enter");
  await expect(client.locator("details")).toHaveAttribute("open", "");
  await testInfo.attach("models-page", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  const home = page.getByRole("link", { name: "Slop home", exact: true });
  await home.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
  // Let the home records finish loading so going back aborts no request.
  await expect(page.locator("#leaderboard").getByRole("table")).toBeVisible({
    timeout: 60_000,
  });
  await page.waitForLoadState("networkidle");
  await page.goBack({ waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/models$/u);
});

test("opens the sponsors page directly and through keyboard navigation", async ({
  page,
}, testInfo) => {
  await page.goto("/sponsors", { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText("$4,900", { exact: true })).toBeVisible();
  const audience = page
    .locator("summary")
    .filter({ hasText: "Audience report ·" });
  await audience.focus();
  await page.keyboard.press("Enter");
  await expect(audience.locator("..")).toHaveAttribute("open", "");
  const rules = page.getByText("Funding rules and payment stages", {
    exact: true,
  });
  await rules.focus();
  await page.keyboard.press("Enter");
  await expect(rules.locator("..")).toHaveAttribute("open", "");
  const tableRegion = page.getByRole("region", {
    name: "Project funding pools",
    exact: true,
  });
  await tableRegion.focus();
  await expect(tableRegion).toBeFocused();
  if (
    await tableRegion.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    )
  ) {
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => tableRegion.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
  }
  await testInfo.attach("sponsors-page", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  const home = page.getByRole("link", { name: "Slop home", exact: true });
  await home.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
  // Let the home records finish loading so going back aborts no request.
  await expect(page.locator("#leaderboard").getByRole("table")).toBeVisible({
    timeout: 60_000,
  });
  await page.waitForLoadState("networkidle");
  await page.goBack({ waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/sponsors$/u);
});

test("lands direct hash links on their section", async ({ page }) => {
  for (const [path, id] of [
    ["/how-it-works#faq", "faq"],
    ["/#leaderboard", "leaderboard"],
  ] as const) {
    await page.goto(path, { waitUntil: "networkidle" });
    await expect(page.locator(`#${id}`)).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  }
});

test("refuses prototype paths", async ({ page }) => {
  for (const path of ["/constructor", "/__proto__"]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "Page not found", exact: true }),
    ).toBeVisible();
  }
});

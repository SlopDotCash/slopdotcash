/**
 * Drives the built GitHub-native product through discovery, contribution,
 * wallet, profile, cycle, project-proposal, artifact, failure, responsive, and
 * accessibility paths using the exact generated public data.
 */

import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, test as base, expect } from "@playwright/test";
import { assertCycleIndex, type CycleIndex } from "../../src/lib/cycle-index";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { homeProjects } from "../../src/lib/home-projects";
import {
  assertLeaderboardSnapshot,
  type LeaderboardSnapshot,
} from "../../src/lib/leaderboard";
import {
  createProjectView,
  projectCycleHasOpened,
} from "../../src/lib/project-view";
import { PROJECTS } from "../../src/lib/projects.mjs";

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

test("shows signer loss and expired capability without payout availability", async ({
  page,
}, testInfo) => {
  const project = PROJECTS.find(
    (candidate) => candidate.reward.kind === "monthly-pool",
  );
  if (!project) throw new Error("Monthly project fixture is unavailable");
  const reportedAt = new Date(Date.now() - 3600000).toISOString();
  const expiresAt = new Date(Date.now() - 1800000).toISOString();
  const report = {
    projectId: project.id,
    cycleId: reportedAt.slice(0, 7),
    instrumentId:
      "squads-v4-vault:solana:11111111111111111111111111111111:0:Vote111111111111111111111111111111111111111",
    role: "funder",
    member: "11111111111111111111111111111111",
    capability: "lost-access",
    reportedAt,
    expiresAt: null,
    reason: "Synthetic browser fixture: signing capability was lost.",
    sourceRepository: "example/evidence",
    sourceCommit: "a".repeat(40),
  };
  await page.route("**/data/funding.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: "1",
        generatedAt: reportedAt,
        records: [],
        commitments: [],
        signerReports: [
          report,
          {
            ...report,
            role: "steward",
            capability: "can-sign",
            expiresAt,
            sourceCommit: "b".repeat(40),
          },
        ],
      }),
    }),
  );
  await page.goto(`/projects/${project.slug}/funding`, {
    waitUntil: "networkidle",
  });
  const section = page.getByRole("region", {
    name: "Signer capability reports",
  });
  await expect(
    section.getByRole("heading", { name: /Inaccessible/u }),
  ).toBeVisible();
  await expect(section.getByText(/capability report expired/u)).toBeVisible();
  await expect(section.getByText(/Payments remain disabled/u)).toBeVisible();
  const source = section.getByRole("link", { name: "Signed report" }).first();
  await expect(source).toHaveAttribute(
    "href",
    `https://github.com/example/evidence/commit/${"a".repeat(40)}`,
  );
  await source.focus();
  await expect(source).toBeFocused();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  if (testInfo.project.name === "wide-desktop-chromium") {
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: testInfo.outputPath("signer-loss.png"),
    fullPage: true,
  });
});

test("discovers projects and one score-ranked homepage leaderboard", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });

  await expect(
    page.getByRole("heading", {
      exact: true,
      name: "MAKE MONEY SHIPPING OPEN SOURCE.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Slop home" })).toHaveText(
    "slop.cash",
  );
  const header = page.locator(".site-header");
  await expect(header.getByRole("link", { name: "Slop Git" })).toHaveCount(0);
  await expect(header.getByRole("link", { name: "Source" })).toHaveCount(0);
  const footer = page.locator(".site-footer");
  await expect(footer.getByRole("link", { name: "GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/SlopDotCash/slopdotcash",
  );
  await expect(footer.getByRole("link", { name: "Slop Git" })).toHaveCount(0);
  await expect(page.locator(".footer-wordmark")).toHaveText("slop.cash");
  await expect(page.getByRole("link", { name: "Protocol" })).toHaveCount(0);
  await expect(
    page.getByText(`© ${new Date().getUTCFullYear()} slop.cash.`),
  ).toBeVisible();
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://slop.cash/og-open-source.png",
  );
  await expect(
    page.getByRole("heading", {
      exact: true,
      name: "Projects",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      exact: true,
      name: "Eliza",
    }),
  ).toBeVisible();
  // The carousel announces each promoted project once; moving copies are
  // hidden from assistive technology and removed from the tab order.
  const carouselCards = page.locator(
    ".project-carousel-group:not([aria-hidden]) > .project-carousel-slot:not([aria-hidden]) > a.project-card",
  );
  await expect(carouselCards).toHaveCount(homeProjects().length);
  for (const project of homeProjects())
    await expect(
      carouselCards.and(page.locator(`[href="/projects/${project.id}"]`)),
    ).toContainText(
      project.listingTier === "featured" ? "Featured" : "Community",
    );
  for (const copy of await page
    .locator(
      ".project-carousel-group[aria-hidden] a.project-card, .project-carousel-slot[aria-hidden] a.project-card",
    )
    .all())
    await expect(copy).toHaveAttribute("tabindex", "-1");
  for (const project of PROJECTS.filter(
    (project) => project.status === "paused",
  )) {
    await expect(
      page.locator(`a.project-card[href="/projects/${project.id}"]`),
    ).toHaveCount(0);
  }
  await expect(
    page.getByRole("heading", { exact: true, name: "Delta Star" }),
  ).toBeVisible();
  const elizaCard = carouselCards.and(page.locator('[href="/projects/eliza"]'));
  await expect(
    elizaCard.getByText("Not funded yet", { exact: true }),
  ).toHaveCount(0);
  await expect(elizaCard.getByText("$5k", { exact: true })).toBeVisible();
  await expect(
    elizaCard.getByText("/mo target", { exact: true }),
  ).toBeVisible();
  await expect(
    elizaCard.getByText("Vault: Unavailable", { exact: true }),
  ).toBeVisible();
  await expect(elizaCard.getByText("$5,000", { exact: true })).toHaveCount(0);
  await expect(
    elizaCard.getByText(/Build and verify the elizaOS framework/u),
  ).toBeVisible();
  const deltaCard = carouselCards.and(
    page.locator('[href="/projects/delta-star"]'),
  );
  await expect(
    deltaCard.getByText("$1,000,000", { exact: true }),
  ).toBeVisible();
  await expect(
    deltaCard.getByText("External sponsor prize", { exact: true }),
  ).toHaveCount(0);
  await expect(
    deltaCard.getByText(/Advance machine-checked Reed–Solomon/u),
  ).toBeVisible();
  // A visible control stops the moving carousel (WCAG 2.2.2).
  const motion = page.getByRole("button", { name: "Pause motion" });
  await expect(motion).toHaveAttribute("aria-pressed", "false");
  await motion.click();
  await expect(
    page.getByRole("button", { name: "Play motion" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(0, 0);
  await expect(page.locator(".project-carousel-track")).toHaveCSS(
    "animation-play-state",
    "paused",
  );
  await expect(page.getByText("Public beta.")).toHaveCount(0);
  await expect(
    page.getByText(/Rankings are live. Payouts are off/u),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Contribute to Eliza." }),
  ).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Agent prompt" })).toHaveText(
    `Read ${new URL(page.url()).origin}/SKILL.md and follow it.`,
  );
  for (const agent of ["Cursor", "ChatGPT", "Claude"])
    await expect(
      page.getByRole("link", { name: agent, exact: true }),
    ).toHaveAttribute("target", "_blank");
  await expect(
    page.getByRole("heading", { name: "Top sloperators" }),
  ).toBeVisible();
  const leaderboard = page.getByRole("region", {
    name: "Top sloperators",
    exact: true,
  });
  await expect(leaderboard.getByLabel("Sort by")).toHaveValue("score");
  await expect(
    page.getByRole("heading", { name: "Contribution points", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("columnheader", { name: "Simulated share" }),
  ).toHaveCount(0);
  await expect(leaderboard.getByLabel("Period", { exact: true })).toHaveValue(
    "month",
  );
  await leaderboard
    .getByLabel("Period", { exact: true })
    .selectOption("lifetime");
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
  await leaderboard.getByLabel("Find a contributor").fill(firstLogin);
  await expect(
    leaderboard.getByRole("link", { name: firstLogin, exact: true }),
  ).toBeVisible();
  await leaderboard.getByLabel("Find a contributor").fill("");
  await expect(page.locator(".hero-action")).toHaveText(
    "SHIPPING OPEN SOURCE.",
  );
  await expect(
    page.locator("#projects").getByRole("link", { name: "Add a project" }),
  ).toHaveAttribute("href", "/projects/new");
  await page
    .locator(".site-footer")
    .getByRole("link", { name: "Leaderboard" })
    .click();
  await expect(page).toHaveURL(/\/#leaderboard$/u);
  await expect
    .poll(() =>
      page.locator("#leaderboard").evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.top >= -1 && bounds.top < window.innerHeight;
      }),
    )
    .toBe(true);
  await expect(
    page.getByText(/GitHub ledger \+ reward records live/u),
  ).toHaveCount(0);
  await expect(page.getByText("THE GITARMY NETWORK")).toHaveCount(0);
  await expect(page.getByText("Work in. Money out.")).toHaveCount(0);

  expect(
    await page
      .locator("#leaderboard")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
});

test("starts Eliza with one prompt and no separate payout form", async ({
  context,
  page,
  request,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  const homeLink = page.getByRole("link", { name: "Slop home", exact: true });
  await expect(homeLink).toBeVisible();
  await expect(homeLink).toHaveAttribute("href", "/");
  const projectLink = page.locator(".site-footer").getByRole("link", {
    name: "Projects",
    exact: true,
  });
  await expect(projectLink).toHaveAttribute("href", "/projects");
  await expect(
    page.getByRole("heading", { name: "Make money building agents." }),
  ).toBeVisible();
  await expect(page.locator(".project-headline-action")).toHaveText(
    "building agents.",
  );
  await expect(
    page.getByRole("link", { name: /Start in one command/u }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: /View cycle/u })).toHaveCount(0);
  await expect(
    page.locator(".project-identity-text").getByRole("link"),
  ).toHaveAttribute("href", "https://github.com/elizaOS/eliza");
  await expect(
    page.getByRole("link", { name: /View in SlopHub/u }),
  ).toHaveCount(0);
  await expect(page.getByText("1% platform fee · Solana")).toHaveCount(0);
  // Eliza is pledged, so the headline is the funding state, never the cap.
  await expect(page.locator(".project-reward-status > strong")).toHaveText(
    "Not funded yet",
  );
  const projectGaps = await page.evaluate(() => {
    const breadcrumb = document.querySelector(".breadcrumb");
    const heading = document.querySelector(".project-hero h1");
    const hero = document.querySelector(".project-hero");
    const install = document.querySelector(".install-panel");
    if (!breadcrumb || !heading || !hero || !install) return null;
    return {
      breadcrumbToHeading: Math.round(
        heading.getBoundingClientRect().top -
          breadcrumb.getBoundingClientRect().bottom,
      ),
      heroToInstall: Math.round(
        install.getBoundingClientRect().top -
          hero.getBoundingClientRect().bottom,
      ),
    };
  });
  expect(projectGaps).not.toBeNull();
  expect(projectGaps?.breadcrumbToHeading ?? 100).toBeLessThanOrEqual(48);
  expect(projectGaps?.heroToInstall ?? 100).toBeLessThanOrEqual(64);
  const prompt = page.getByRole("status", { name: "Agent prompt" });
  await expect(prompt).toContainText(/\/SKILL\.md/u);
  await expect(prompt).toContainText(
    /contribute to github\.com\/elizaOS\/eliza/u,
  );
  await expect(prompt).not.toContainText(
    /Before installing anything or reading local usage/u,
  );
  await page.getByRole("button", { name: "Copy agent prompt" }).click();
  await expect(page.getByRole("button", { name: /Copied/u })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "/SKILL.md",
  );
  await page.getByText("Installation, disclosures & optional receipts").click();
  const command = page.getByRole("textbox", {
    name: "Manual install command",
  });
  await expect(command).toHaveValue(/skills\/contribute-to-eliza/u);
  await expect(command).toHaveValue(/\/projects\/eliza/u);
  await expect(command).toHaveValue(
    /SKILLS_ROOT="\$\{HOME\}\/\.agents\/skills"/u,
  );
  await expect(command).not.toHaveValue(/CODEX_HOME/u);
  await page
    .getByRole("button", { name: "Copy manual install command" })
    .click();
  await expect(
    page.getByRole("button", { name: "Copied manual install command" }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "skills/contribute-to-eliza",
  );
  await expect(
    page.getByRole("link", { name: /Preview the complete workflow/u }),
  ).toHaveAttribute("href", /\/projects\/eliza\/mission\.md$/u);
  await expect(
    page.getByText(/One prompt handles the contribution/u),
  ).toHaveCount(0);
  await expect(page.getByText("simulated monthly pool")).toHaveCount(0);
  await expect(page.getByText("scored contributors")).toHaveCount(0);
  await expect(page.locator(".project-stat-strip")).toHaveCount(0);
  await expect(page.getByLabel("Solana public address")).toHaveCount(0);
  await expect(page.getByText(/GitHub profile README/u)).toHaveCount(0);
  await expect(page.getByText(/Outcome score leads/u)).toHaveCount(0);
  await expect(
    page.getByText(/GitHub ledger \+ reward records live/u),
  ).toHaveCount(0);
  await page.getByText("Cycle allocation details", { exact: true }).click();
  await expect(page.getByText(/^Updated /u)).toBeVisible();
  await expect(page.getByText(/receipt-linked tokens/u)).toHaveCount(0);
  const shareCells = await page
    .locator(".project-leader-row")
    .evaluateAll((rows) =>
      rows.map((row) => row.querySelectorAll("td")[3]?.textContent ?? ""),
    );
  const view = createProjectView(await loadSnapshot(request), "eliza");
  expect(shareCells).toHaveLength(view.leaders.length);
  // No committed funds: every row is a share of the score, never dollars.
  for (const cell of shareCells) {
    expect(cell).toMatch(/^\d+\.\d{2}% of score$/u);
  }
  expect(view.leaders.every((leader) => leader.projectedMinor === "0")).toBe(
    true,
  );
  await expect(
    page.getByRole("columnheader", { name: "Share of score" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Not funded yet\. Not approved payouts\./u),
  ).toBeVisible();
  await expect(page.getByText("Live from GitHub")).toHaveCount(0);
  await expect(page.getByText("How credit survives review")).toHaveCount(0);
});

test("never presents Delta Star's external prize as platform money", async ({
  page,
}) => {
  await page.goto("/projects/delta-star", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "Make money solving math." }),
  ).toBeVisible();
  await expect(
    page.getByText("No platform pool · no dollar projection"),
  ).toBeVisible();
  await expect(
    page.getByText("Organizer rules decide eligibility, amount, and payment."),
  ).toBeVisible();
  const history = page.locator(".payment-history");
  await expect(
    history.getByRole("heading", { name: "Cycle history" }),
  ).toBeVisible();
  await expect(history).not.toContainText("$");
  await expect(
    history.getByRole("link", { name: "Manage payouts" }),
  ).toHaveCount(0);
  await history
    .getByRole("link", { name: /^\d{4}-\d{2}$/u })
    .first()
    .click();
  await expect(
    page.getByText(
      "External prize shares; this cycle does not enter Slop settlement.",
    ),
  ).toBeVisible();
});

test("renders contributor and cycle records from validated public data", {
  tag: ["@pages"],
}, async ({ page, request }) => {
  await page.goto("/cycles/eliza/2026-99", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "Cycle unavailable", exact: true }),
  ).toBeVisible();
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
    await expect(
      page.getByText("No accepted outcomes in this project cycle yet."),
    ).toBeVisible();
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
  await expect(
    page
      .locator(".profile-totals")
      .getByText("verified payments received · USDC", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".profile-totals")
      .getByText("recorded score", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".profile-totals")
      .getByText(/^[A-Z][a-z]+ \d{4} simulated estimate/u),
  ).toBeVisible();
  const simulated = PROJECTS.reduce((total, project) => {
    if (
      !projectCycleHasOpened(snapshot, project.id) ||
      !project.repositories.every((repository) =>
        snapshot.repositories.some(
          (collected) => collected.id === repository.id,
        ),
      )
    )
      return total;
    const view = createProjectView(snapshot, project.id);
    const leader = view.leaders.find((entry) => entry.actor.id === actor.id);
    return total + BigInt(leader?.simulatedMinor ?? "0");
  }, 0n);
  const estimate = page.locator(".profile-score-summary > div").filter({
    hasText: /simulated estimate/u,
  });
  await expect(estimate.locator("strong")).toHaveText(
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: simulated % 1_000_000n === 0n ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(Number(simulated) / 1_000_000),
  );
  await expect(
    page.getByText(/14-day review applies to monthly proposals/u),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Progress" })).toHaveCount(0);
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
    const total = activity.locator(".profile-activity-count");
    const count = Number(
      (await total.textContent())?.replace(/[^0-9]/gu, "") ?? "0",
    );
    expect(count).toBeGreaterThanOrEqual(acceptedRecords.length);
    const pages = activity.getByRole("navigation", { name: "Activity pages" });
    await expect(pages.getByRole("status")).toHaveText(
      `1–10 of ${count.toLocaleString("en-US")}`,
    );
    const previous = pages.getByRole("button", { name: "Previous" });
    const next = pages.getByRole("button", { name: "Next" });
    await expect(previous).toBeDisabled();
    const firstPage = await activity
      .locator("li[data-activity-date]")
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-activity-date") ?? ""),
      );
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(pages.getByRole("status")).toHaveText(
      `11–${Math.min(20, count).toLocaleString("en-US")} of ${count.toLocaleString("en-US")}`,
    );
    const secondPage = await activity
      .locator("li[data-activity-date]")
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-activity-date") ?? ""),
      );
    // Pages continue the same newest-first order without repeating records.
    expect(
      secondPage[0].localeCompare(firstPage.at(-1) ?? ""),
    ).toBeLessThanOrEqual(0);
    await expect(previous.or(next).and(page.locator(":focus"))).toHaveCount(1);
    await previous.focus();
    await page.keyboard.press("Enter");
    await expect(pages.getByRole("status")).toHaveText(
      `1–10 of ${count.toLocaleString("en-US")}`,
    );
    await expect(next).toBeFocused();
    await expect(activity.locator("li[data-activity-date]")).toHaveCount(10);
  }

  const archived = cycles.cycles.find((cycle) =>
    cycle.contributors.some((entry) => entry.actor.id === actor.id),
  );
  if (archived) {
    await page.goto("/cycles", { waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", { name: "Payment cycles", exact: true }),
    ).toBeVisible();
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
    await expect(
      page.getByRole("heading", { name: "Evidence", exact: true }),
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
    await expect(page.getByText("Review", { exact: true })).toBeVisible();
    await expect(page.getByText("Cycle evidence.")).toHaveCount(0);
    await expect(page.getByText(/score events ·/u)).toHaveCount(0);
  }
});

test("keeps a frozen-month contributor reachable after the rolling window moves on", async ({
  page,
  request,
}) => {
  const snapshot = await loadSnapshot(request);
  const cycles = await loadCycles(request);
  const response = await request.get("/data/funding-reviews.json");
  expect(response.ok()).toBe(true);
  const reviews = (await response.json()) as {
    reviews: Array<{
      projectId: string;
      cycleId: string;
      contributors: Array<{ actor: { id: string; login: string } }>;
    }>;
  };
  const known = new Set(
    [
      ...snapshot.leaders.map((leader) => leader.actor.login),
      ...snapshot.opportunities.map((opportunity) => opportunity.actor.login),
      ...cycles.cycles.flatMap((cycle) =>
        cycle.contributors.map((entry) => entry.actor.login),
      ),
    ].map((login) => login.toLowerCase()),
  );
  const frozenOnly = reviews.reviews
    .filter(
      (review) =>
        !cycles.cycles.some(
          (cycle) =>
            cycle.projectId === review.projectId &&
            cycle.cycleId === review.cycleId,
        ),
    )
    .flatMap((review) => review.contributors)
    .find((entry) => !known.has(entry.actor.login.toLowerCase()));
  test.skip(!frozenOnly, "every frozen-month contributor is still in window");
  if (!frozenOnly) return;

  await page.route(
    `${deployment.api}/api/v1/wallet-claims/actors/*/current`,
    (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "not_found" }),
      }),
  );
  await page.goto(
    `/contributors/${encodeURIComponent(frozenOnly.actor.login)}`,
    { waitUntil: "networkidle" },
  );
  await expect(
    page.getByRole("heading", { name: frozenOnly.actor.login }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Frozen months" }),
  ).toBeVisible();
  await expect(page.getByText("Contributor not found")).toHaveCount(0);
});

test("makes the public project draft boundary unmistakable", async ({
  page,
}) => {
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: /Edit project proposal/u }),
  ).toBeVisible();
  await expect(page.locator(".manage-intro .draft-badge")).toHaveText("Draft");
  await expect(
    page.getByText(/does not save or publish changes/u),
  ).toBeVisible();
  await expect(
    page.getByText("Payouts are disabled in the project manifest."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Manage payouts" }),
  ).toHaveAttribute("href", "/projects/eliza/funding#payouts");
  await expect(page.getByLabel("Draft total, USDC")).toHaveCount(0);
  await expect(page.getByText(/mainnet USDC transfers/u)).toHaveCount(0);
  await page.getByRole("button", { name: /Continue on GitHub/u }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Change at least one field before you continue.",
  );
  await page.getByLabel("Short description").fill("Eliza-only draft");
  await page
    .getByLabel("Reason for the change")
    .fill("Clarify the project focus for contributors.");
  const changes = page.getByRole("region", { name: "Changes" });
  await expect(changes).toContainText("Eliza-only draft");
  await expect(changes).toContainText(
    PROJECTS.find((project) => project.id === "eliza")?.headline ?? "",
  );
  await expect(
    page.getByRole("link", { name: /Continue on GitHub/u }),
  ).toHaveAttribute(
    "href",
    "https://github.com/SlopDotCash/slopdotcash/edit/development/projects/eliza/project.json",
  );
  await expect(
    page.getByText(/Draft saved on this device only/u),
  ).toBeVisible();
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

test("serves byte-consistent install and read-only artifacts for every project", {
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
  expect(legacySkillResponse.headers().location).toBe(
    "/projects/eliza/skill.md",
  );
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
    projectDiscoveryResponse,
    llmsResponse,
  ] = await Promise.all([
    request.get("/SKILL.md"),
    request.get("/.well-known/agent-skills/index.json"),
    request.get("/.well-known/agent-skills/slop/SKILL.md"),
    request.get("/protocol/identity-v1.json"),
    request.get("/protocol/private-trace-v1.md"),
    request.get("/.well-known/slop/projects.json"),
    request.get("/llms.txt"),
  ]);
  for (const response of [
    bootstrapResponse,
    discoveryResponse,
    discoverySkillResponse,
    identityResponse,
    privateTraceContractResponse,
    projectDiscoveryResponse,
    llmsResponse,
  ]) {
    expect(response.status()).toBe(200);
  }
  const [missingDiscovery, missingProjectArtifact] = await Promise.all([
    request.get("/.well-known/slop/missing.json"),
    request.get("/projects/not-a-project/skill-manifest.json"),
  ]);
  for (const response of [missingDiscovery, missingProjectArtifact]) {
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain('<div id="root"></div>');
  }
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
  expect(await privateTraceContractResponse.text()).toContain(
    "Neither the receipt CLI nor the trace API automatically redacts",
  );
  expect(identityResponse.headers()["access-control-allow-origin"]).toBe("*");
  expect(identityResponse.headers()["cache-control"]).toContain("max-age=300");
  expect(await identityResponse.json()).toMatchObject({
    identityVersion: "slop-identity-v1",
    paymentMode: "disabled",
  });
  expect(projectDiscoveryResponse.headers()["content-type"]).toContain(
    "application/json",
  );
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
    "optional permanent minimized trace upload",
  );
  const projectDiscovery = await projectDiscoveryResponse.json();
  expect(projectDiscovery).toEqual({
    schemaVersion: "1",
    projects: PROJECTS.flatMap((project) =>
      project.repositories.map((repository) => ({
        project_id: project.id,
        project_url: `https://slop.cash/projects/${project.id}/`,
        repository: repository.aliases?.at(-1) ?? repository.id,
        review_skill: project.reviewSkill.id,
        review_skill_manifest: `https://slop.cash/projects/${project.id}/review-skill-manifest.json`,
        skill: project.skill.id,
        skill_source: project.skill.sourcePath,
      })),
    ),
  });

  expect(
    projectDiscovery.projects.find(
      (project: { project_id: string }) => project.project_id === "asi",
    )?.repository,
  ).toBe("SlopDotCash/asi");

  for (const project of PROJECTS) {
    const root = `/projects/${project.id}`;
    const [
      skillResponse,
      manifestResponse,
      missionResponse,
      codexResponse,
      claudeResponse,
      claudeCodeResponse,
      termsResponse,
    ] = await Promise.all([
      request.get(`${root}/skill.md`),
      request.get(`${root}/skill-manifest.json`),
      request.get(`${root}/mission.md`),
      request.get(`${root}/codex.md`),
      request.get(`${root}/claude.md`),
      request.get(`${root}/claude-code.md`),
      request.get(`${root}/terms.json`),
    ]);
    for (const response of [
      skillResponse,
      manifestResponse,
      missionResponse,
      codexResponse,
      claudeResponse,
      claudeCodeResponse,
      termsResponse,
    ]) {
      expect(response.status()).toBe(200);
    }
    for (const response of [
      skillResponse,
      missionResponse,
      codexResponse,
      claudeResponse,
      claudeCodeResponse,
    ]) {
      expect(response.headers()["content-type"]).toContain("text/markdown");
      expect(response.headers()["access-control-allow-origin"]).toBe("*");
      expect(response.headers()["cache-control"]).toContain("max-age=300");
    }
    expect(manifestResponse.headers()["content-type"]).toContain(
      "application/json",
    );
    expect(manifestResponse.headers()["access-control-allow-origin"]).toBe("*");
    expect(manifestResponse.headers()["cache-control"]).toContain(
      "max-age=300",
    );
    expect(termsResponse.headers()["content-type"]).toContain(
      "application/json",
    );
    expect(await termsResponse.json()).toEqual({
      schemaVersion: "1",
      projectId: project.id,
      status: project.status,
      steward: project.steward,
      authority: project.authority,
      terms: project.terms,
    });
    const skillBytes = await skillResponse.body();
    const manifest = (await manifestResponse.json()) as {
      archive: { sha256: string; url: string; checksumUrl: string };
      name: string;
      source: { sha256: string };
    };
    expect(manifest.name).toBe(project.skill.id);
    expect(manifest.source.sha256).toBe(
      createHash("sha256").update(skillBytes).digest("hex"),
    );

    const [archiveResponse, checksumResponse] = await Promise.all([
      request.get(new URL(manifest.archive.url).pathname),
      request.get(new URL(manifest.archive.checksumUrl).pathname),
    ]);
    expect(archiveResponse.status()).toBe(200);
    expect(checksumResponse.status()).toBe(200);
    expect(archiveResponse.headers()["content-type"]).toContain(
      "application/octet-stream",
    );
    expect(archiveResponse.headers()["content-disposition"]).toBe("attachment");
    expect(archiveResponse.headers()["access-control-allow-origin"]).toBe("*");
    const archive = await archiveResponse.body();
    expect(createHash("sha256").update(archive).digest("hex")).toBe(
      manifest.archive.sha256,
    );
    expect(await checksumResponse.text()).toContain(manifest.archive.sha256);
    expect(await missionResponse.text()).toContain(`name: ${project.skill.id}`);
    expect(await codexResponse.text()).toContain(
      `SKILLS_ROOT="\${HOME}/.agents/skills"`,
    );
    const claudeGuide = await claudeResponse.text();
    expect(claudeGuide).toContain("CLAUDE_CONFIG_DIR");
    expect(await claudeCodeResponse.text()).toBe(claudeGuide);
  }
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
  await expect(page.getByRole("alert")).toContainText(
    "Live totals unavailable",
  );
  await expect(page.locator(".project-reward-status")).toContainText(
    "Funding history unavailable",
  );
  await expect(page.locator(".project-reward-status")).not.toContainText("$0");
  await expect(page.locator(".project-reward-status")).not.toContainText(
    "Funding promotion paused",
  );
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
  await expect(
    page.getByRole("heading", { name: "Contributor standings", exact: true }),
  ).toBeVisible();
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
      "/projects/eliza/funding#payouts",
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
  await expect(
    page.getByRole("heading", { name: "Run receipts", exact: true }),
  ).toBeVisible();
  if (!entry?.run) {
    await expect(
      page.getByText("No publishable signed receipts in this snapshot."),
    ).toBeVisible();
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
  await expect(page.getByText("No receipts match this search.")).toBeVisible();
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
  "/verification",
  "/how-it-works",
  "/account",
  "/",
  ...PROJECTS.map((project) => `/projects/${project.id}`),
  "/projects/eliza/funding",
  "/projects/eliza/funding/",
  "/projects/eliza/funding#payouts",
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
    if (path === "/") {
      await expect(
        page.getByRole("heading", {
          exact: true,
          name: "MAKE MONEY SHIPPING OPEN SOURCE.",
        }),
      ).toBeVisible();
    }
    if (path.startsWith("/projects/eliza/funding")) {
      await expect(
        page.getByRole("heading", { exact: true, name: "Eliza funding" }),
      ).toBeVisible();
      if (path.endsWith("#payouts"))
        await expect(page.locator(".funding-workbench")).toBeVisible();
      else
        await expect(
          page.getByText(/A balance does not prove signer capability/u),
        ).toBeVisible();
    }
    const project = PROJECTS.find(
      (candidate) => path === `/projects/${candidate.id}`,
    );
    if (project?.status === "paused") {
      await expect(
        page.getByRole("heading", {
          name:
            project.participation?.state === "archived"
              ? "Archived"
              : project.participation?.state === "permission-required"
                ? "Permission required"
                : "Project paused",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByText(/after two unfunded cycles/u)).toHaveCount(0);
      await expect(page.getByLabel("Manual install command")).toHaveCount(0);
      await expect(page.locator(".project-reward-status")).toHaveCount(0);
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
        await expect(
          page.getByText(
            "Activity for this project has not been collected yet.",
          ),
        ).toBeVisible();
        await expect(page.getByText(/Live totals unavailable/u)).toHaveCount(0);
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
        await expect(
          page.getByRole("heading", {
            name: "Permission required",
            exact: true,
          }),
        ).toBeVisible();
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
  await expect(
    page.getByRole("heading", {
      name: "Models",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", {
      name: "Models",
      exact: true,
    }),
  ).toBeVisible();
  const outcomes = page.getByRole("list", {
    name: "Accepted outcomes by model",
    exact: true,
  });
  const firstModel = outcomes.locator(":scope > li").first();
  await expect(firstModel).toBeVisible();
  const metrics = firstModel.locator(".model-outcome-metrics");
  await expect(metrics).toContainText("merged PRs");
  await expect(metrics).toContainText("of all merged PRs");
  await expect(metrics).toContainText("accepted reviews");
  const bounds = await metrics.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(
    page.viewportSize()?.width ?? 0,
  );
  const disclosure = firstModel.locator("summary");
  await disclosure.focus();
  await page.keyboard.press("Enter");
  await expect(
    firstModel.getByText("Exact declarations", { exact: true }),
  ).toBeVisible();
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
  await expect(
    client.getByText("Median output tokens", { exact: true }),
  ).toBeVisible();
  await testInfo.attach("models-page", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  const addProject = page
    .locator("footer")
    .getByRole("link", { name: "Add a project", exact: true });
  await addProject.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/projects\/new$/);
  await page.goBack({ waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", {
      name: "Models",
      exact: true,
    }),
  ).toBeVisible();
});

test("opens the sponsors page directly and through keyboard navigation", async ({
  page,
}, testInfo) => {
  await page.goto("/sponsors", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", {
      name: "Fund a project.",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", {
      name: "Fund a project.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByText("$5,050", { exact: true })).toBeVisible();
  const audience = page
    .locator("summary")
    .filter({ hasText: "Audience report ·" });
  await audience.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Who builds on Slop.", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Method and caveats" }),
  ).toBeVisible();
  const rules = page.getByText("Funding rules and payment stages", {
    exact: true,
  });
  await rules.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Your money has exact states." }),
  ).toBeVisible();
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
  const addProject = page
    .locator("footer")
    .getByRole("link", { name: "Add a project", exact: true });
  await addProject.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/projects\/new$/);
  await page.goBack({ waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", {
      name: "Fund a project.",
      exact: true,
    }),
  ).toBeVisible();
});

test("lands direct hash links on their section", async ({ page }) => {
  for (const [path, id] of [
    ["/how-it-works#faq", "faq"],
    ["/#leaderboard", "leaderboard"],
  ] as const) {
    await page.goto(path, { waitUntil: "networkidle" });
    // The section top lands just under the sticky header, not at page top.
    await expect
      .poll(() =>
        page
          .locator(`#${id}`)
          .evaluate((section) =>
            Math.round(section.getBoundingClientRect().top),
          ),
      )
      .toBeLessThanOrEqual(80);
    expect(
      await page
        .locator(`#${id}`)
        .evaluate((section) => section.getBoundingClientRect().top),
    ).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  }
});

test("legacy verification links open the How it works payment section", async ({
  page,
}) => {
  for (const path of ["/constructor", "/__proto__"]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "Page not found", exact: true }),
    ).toBeVisible();
  }
  for (const path of ["/verification", "/verification/"]) {
    await page.goto(path, { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/how-it-works#verification$/u);
    await expect(
      page.getByRole("heading", { exact: true, name: "How Slop works" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        exact: true,
        name: "Settlement verification",
      }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Derive addresses" }),
    ).toBeHidden();
  }
  const stages = page.getByRole("list", { name: "Payment stages" });
  await expect(stages.getByRole("listitem")).toHaveText([
    /^Projected/u,
    /Under review/u,
    /Approved/u,
    /Scheduled/u,
    /Paid/u,
  ]);
  const branches = page.getByRole("region", {
    name: "Unresolved outcomes: not steps toward payment",
  });
  for (const state of ["Held", "Unclaimed", "Excluded"]) {
    await expect(branches.getByText(state, { exact: true })).toBeVisible();
    await expect(stages.getByText(state, { exact: true })).toHaveCount(0);
  }
  await expect(
    page.getByRole("heading", { exact: true, name: "For contributors" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { exact: true, name: "For maintainers" }),
  ).toBeVisible();
});

test("derives Solana addresses on the settlement verification page", async ({
  page,
}, testInfo) => {
  await page.goto("/how-it-works", { waitUntil: "networkidle" });
  const verification = page.getByRole("heading", {
    exact: true,
    name: "Settlement verification",
  });
  await expect(verification).not.toBeVisible();
  await page
    .getByRole("link", { name: "Verification", exact: true })
    .first()
    .focus();
  await page.keyboard.press("Enter");
  await expect(verification).toBeVisible();
  await page.goto("/how-it-works#verification", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { exact: true, name: "Settlement verification" }),
  ).toBeVisible();
  // No cycle has ever reached an approved allocation, so the honest state is an
  // empty ledger rather than a fabricated binding.
  await expect(
    page.getByText("No execution has been bound yet.", { exact: false }),
  ).toBeVisible();

  await page.getByText("Advanced verification", { exact: true }).click();
  // A real August 2026 recipient. Its canonical USDC associated token account
  // is fixed by the Solana address derivation, so the value below is checkable
  // against any explorer and pins the in-repo derivation to mainnet reality.
  await page
    .getByLabel("Solana address", { exact: true })
    .fill("8UeRuQdqVCVwxERmajGkLon92Y8Ax3oJbDZQPGENzJkf");
  await page.getByRole("button", { name: "Derive addresses" }).click();
  await expect(
    page.getByText("FqfuZQ5KKqRA6V2MQcRwgwVtSR8Jsfe2cU8UuPbsr3d", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("4wxQ2tM9SWqDnds9LvZ7yL32TSPP41iwkedKZZdQJBbH", {
      exact: true,
    }),
  ).toBeVisible();

  // A known Squads v4 multisig and vault pair, so the browser derivation is
  // checked against a fixed vector.
  await page
    .getByLabel("Squads v4 multisig", { exact: true })
    .fill("xmWqhNJwNL4z4BcDo1Yh7BbStLU7omVafZNmg91y2Vg");
  await page.getByRole("button", { name: "Derive vault accounts" }).click();
  await expect(
    page.getByText("FTK6ckiPWbe1jAiRtcPCz9sCrvCV6Y6hAJhAU5b9S3nv", {
      exact: true,
    }),
  ).toBeVisible();

  await page.getByLabel("Solana address", { exact: true }).fill("not-a-key");
  await page.getByRole("button", { name: "Derive addresses" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Enter a valid Solana public address",
  );

  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await testInfo.attach("settlement-verification", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("lists every manifest project by tier on the projects directory", async ({
  page,
}) => {
  const response = await page.goto("/projects");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "All projects" }),
  ).toBeVisible();
  for (const [tier, label] of [
    ["featured", "Featured"],
    ["community", "Community"],
  ] as const) {
    const section = page.getByRole("region", { name: label, exact: true });
    for (const project of PROJECTS.filter(
      (project) => project.listingTier === tier,
    )) {
      const card = section.locator(
        `a.project-card[href="/projects/${project.slug}"]`,
      );
      await expect(card).toBeVisible();
      await expect(card.locator("xpath=..")).toContainText(
        project.status === "paused" ? "Paused · listed only" : "Active",
      );
    }
  }
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

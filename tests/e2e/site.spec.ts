/**
 * Drives the built GitHub-native product through discovery, contribution,
 * wallet, profile, cycle, project-proposal, artifact, failure, responsive, and
 * accessibility paths using the exact generated public data.
 */

import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, test as base, expect } from "@playwright/test";
import { assertCycleIndex, type CycleIndex } from "../../src/lib/cycle-index";
import {
  assertLeaderboardSnapshot,
  type LeaderboardSnapshot,
} from "../../src/lib/leaderboard";
import { createProjectView } from "../../src/lib/project-view";
import { PROJECTS } from "../../src/lib/projects.mjs";

const test = base.extend<{ browserDiagnostics: undefined }>({
  browserDiagnostics: [
    async ({ baseURL, page }, use) => {
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

test.beforeEach(async ({ page }, testInfo) => {
  if (
    testInfo.title.includes("fundraising slide") ||
    testInfo.title.includes("byte-consistent install")
  ) {
    return;
  }
  await page.goto("/", { waitUntil: "networkidle" });
});

test("discovers both reward models and a score-ranked global ledger", async ({
  page,
  request,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload({ waitUntil: "networkidle" });
  const snapshot = await loadSnapshot(request);
  await loadCycles(request);

  await expect(
    page.getByRole("heading", {
      exact: true,
      name: "MAKE MONEY SHIPPING SLOP.",
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
    "https://github.com/elizaOS/slopdotcash",
  );
  await expect(footer.getByRole("link", { name: "Slop Git" })).toHaveCount(0);
  await expect(page.locator(".footer-wordmark")).toHaveText("slop.cash");
  await expect(page.getByRole("link", { name: "Protocol" })).toHaveCount(0);
  await expect(page.getByText("© 2026 slop.cash.")).toBeVisible();
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://slop.cash/og-shipping-slop.png",
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
  await expect(
    page.getByRole("heading", { exact: true, name: "Delta Star" }),
  ).toBeVisible();
  const elizaCard = page.locator('a.project-card[href="/projects/eliza"]');
  await expect(elizaCard.getByText("$10,000", { exact: true })).toBeVisible();
  await expect(elizaCard.getByText("/ month", { exact: true })).toBeVisible();
  await expect(
    elizaCard.getByText(/Build and verify the elizaOS framework/u),
  ).toBeVisible();
  const deltaCard = page.locator('a.project-card[href="/projects/delta-star"]');
  await expect(
    deltaCard.getByText("$1,000,000", { exact: true }),
  ).toBeVisible();
  await expect(
    deltaCard.getByText("external prize", { exact: true }),
  ).toBeVisible();
  await expect(
    deltaCard.getByText(/Advance machine-checked Reed–Solomon/u),
  ).toBeVisible();
  const [gridBox, elizaBox, deltaBox] = await Promise.all([
    page.locator(".project-grid").boundingBox(),
    elizaCard.boundingBox(),
    deltaCard.boundingBox(),
  ]);
  expect(gridBox).not.toBeNull();
  expect(elizaBox).not.toBeNull();
  expect(deltaBox).not.toBeNull();
  expect(elizaBox?.width).toBeGreaterThan((gridBox?.width ?? 0) - 2);
  expect(deltaBox?.width).toBeGreaterThan((gridBox?.width ?? 0) - 2);
  expect(deltaBox?.y).toBeGreaterThan((elizaBox?.y ?? 0) + 1);
  await expect(page.getByText("Public beta.")).toHaveCount(0);
  await expect(
    page.getByText(/Rankings are live. Payouts are off/u),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Contribute to Eliza." }),
  ).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Agent prompt" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "Leaderboard" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "This month" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("tab", { name: "Eliza, $10,000 monthly pool" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("columnheader", { name: "Accepted score" }),
  ).toBeAttached();
  await expect(
    page.getByRole("columnheader", { name: "Simulated share" }),
  ).toBeAttached();
  await page.getByText("How it works").click();
  await expect(page.getByText(/Payouts are off during beta/u)).toBeVisible();
  await expect(page.getByRole("link", { name: "View more" })).toHaveAttribute(
    "href",
    "/projects/eliza",
  );
  await expect(page.locator(".hero-action")).toHaveText("SHIPPING SLOP.");
  const menuButton = page.getByRole("button", { name: "Open navigation" });
  if (await menuButton.isVisible()) await menuButton.click();
  await page.getByRole("link", { name: "Leaderboard" }).click();
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

  const rows = page.locator("#leaderboard tbody .leader-row");
  if (snapshot.leaders.length === 0) await expect(rows).toHaveCount(0);
  else {
    expect(await rows.count()).toBeGreaterThan(0);
    const viewport = page.viewportSize();
    if (viewport && viewport.width <= 680) {
      const projection = rows.first().locator("td").nth(3);
      await expect(projection).toBeVisible();
      const projectionBounds = await projection.boundingBox();
      expect(projectionBounds).not.toBeNull();
      expect(projectionBounds?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect(
        (projectionBounds?.x ?? 0) + (projectionBounds?.width ?? 0),
      ).toBeLessThanOrEqual(viewport.width + 1);
      expect(
        await page
          .locator("#leaderboard")
          .evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
      ).toBe(true);
    }
  }
  const leaderboardBottomSpace = await page.evaluate(() => {
    const panel = document.querySelector("#leaderboard-current-panel");
    const footer = document.querySelector(".site-footer");
    if (!panel || !footer) return null;
    return Math.round(
      footer.getBoundingClientRect().top - panel.getBoundingClientRect().bottom,
    );
  });
  expect(leaderboardBottomSpace).not.toBeNull();
  expect(leaderboardBottomSpace ?? 0).toBeGreaterThanOrEqual(
    (page.viewportSize()?.width ?? 0) <= 680 ? 64 : 80,
  );
  await page.getByRole("tab", { name: "All-time record" }).click();
  await expect(
    page.getByRole("table", { name: "All-time accepted-work record" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Paid to date" }),
  ).toBeAttached();
  await expect(
    page.getByRole("columnheader", { name: "Simulated share" }),
  ).toHaveCount(0);
});

test("starts Eliza with one prompt and no separate payout form", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  const homeLink = page.getByRole("link", { name: "Home", exact: true });
  if ((page.viewportSize()?.width ?? 0) <= 680) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(homeLink).toBeVisible();
    await expect(homeLink).toHaveAttribute("href", "/");
    await page.getByRole("button", { name: "Close navigation" }).click();
  } else {
    await expect(homeLink).toBeVisible();
    await expect(homeLink).toHaveAttribute("href", "/");
  }
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
    page.getByRole("link", { name: /View in GitHub/u }),
  ).toHaveAttribute("href", "https://github.com/elizaOS/eliza");
  await expect(
    page.getByRole("link", { name: /View in SlopHub/u }),
  ).toHaveCount(0);
  await expect(page.getByText("1% platform fee · Solana")).toHaveCount(0);
  const rewardStyle = await page.locator(".reward-card").evaluate((card) => {
    const amount = card.querySelector<HTMLElement>(".reward-amount-monthly");
    const actions = card.querySelector<HTMLElement>(":scope > div");
    if (!amount || !actions) return null;
    return {
      amountFontSize: Number.parseFloat(getComputedStyle(amount).fontSize),
      actionBorderTopWidth: getComputedStyle(actions).borderTopWidth,
    };
  });
  expect(rewardStyle).not.toBeNull();
  expect(rewardStyle?.amountFontSize ?? 0).toBeGreaterThanOrEqual(48);
  expect(rewardStyle?.actionBorderTopWidth).toBe("0px");
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
  if ((page.viewportSize()?.width ?? 0) <= 900) {
    const rewardLayout = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>(".reward-card");
      const shell = card?.closest<HTMLElement>(".shell");
      const actions = Array.from(
        card?.querySelectorAll<HTMLElement>(".reward-actions a") ?? [],
      );
      if (!card || !shell) return null;
      const cardBounds = card.getBoundingClientRect();
      const shellBounds = shell.getBoundingClientRect();
      return {
        centerOffset: Math.abs(
          cardBounds.left +
            cardBounds.width / 2 -
            (shellBounds.left + shellBounds.width / 2),
        ),
        minimumActionHeight: Math.min(
          ...actions.map((action) => action.getBoundingClientRect().height),
        ),
        textAlign: getComputedStyle(card).textAlign,
      };
    });
    expect(rewardLayout).not.toBeNull();
    expect(rewardLayout?.centerOffset ?? 100).toBeLessThanOrEqual(1);
    expect(rewardLayout?.minimumActionHeight ?? 0).toBeGreaterThanOrEqual(44);
    expect(rewardLayout?.textAlign).toBe("center");
  }
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
  await page.getByText("Advanced options").click();
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
  await expect(page.getByText(/^Updated /u)).toBeVisible();
  await expect(page.getByText(/receipt-linked tokens/u)).toHaveCount(0);
  const displayedProjectionCents = await page
    .locator(".project-leader-row")
    .evaluateAll((rows) =>
      rows.reduce((total, row) => {
        const projection = row.querySelectorAll("td")[3]?.textContent ?? "";
        return (
          total + Math.round(Number(projection.replace(/[^0-9.-]/gu, "")) * 100)
        );
      }, 0),
    );
  expect(displayedProjectionCents).toBe(1_000_000);
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
  await expect(page.getByText("EXTERNAL OPPORTUNITY")).toBeVisible();
  await expect(
    page.getByText("No platform pool · no dollar projection"),
  ).toBeVisible();
  await expect(
    page.getByText(/prize sponsor controls eligibility and payment/u),
  ).toBeVisible();
});

test("renders contributor and cycle records from validated public data", async ({
  page,
  request,
}) => {
  const snapshot = await loadSnapshot(request);
  const cycles = await loadCycles(request);
  const actor =
    snapshot.leaders[0]?.actor ?? cycles.cycles[0]?.contributors[0]?.actor;
  if (!actor) {
    test.skip(true, "The live ledger has no recorded contributor yet.");
    return;
  }

  await page.goto(`/contributors/${encodeURIComponent(actor.login)}`, {
    waitUntil: "networkidle",
  });
  await expect(page.getByRole("heading", { name: actor.login })).toBeVisible();
  await expect(
    page.locator(".profile-totals").getByText("paid", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("all-time score", { exact: true })).toBeVisible();
  await expect(
    page.getByText("monthly estimate", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Progress" })).toHaveCount(0);
  const acceptedRecordCount = snapshot.ledger.filter(
    (event) => event.actor.id === actor.id,
  ).length;
  if (acceptedRecordCount > 10) {
    const acceptedSection = page
      .locator(".profile-section")
      .filter({ has: page.getByRole("heading", { name: "Accepted work" }) });
    await expect(
      acceptedSection.locator(":scope > .event-list > a"),
    ).toHaveCount(10);
    await expect(
      acceptedSection.getByText(`View all ${acceptedRecordCount} records`),
    ).toBeVisible();
  }

  const archived = cycles.cycles.find((cycle) =>
    cycle.contributors.some((entry) => entry.actor.id === actor.id),
  );
  if (archived) {
    await page.goto(`/cycles/${archived.projectId}/${archived.cycleId}`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByRole("heading", {
        name: new RegExp(`${archived.cycleId}$`, "u"),
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Public files" }),
    ).toBeVisible();
  } else {
    const view = createProjectView(snapshot, "eliza");
    await page.goto(`/cycles/eliza/${view.cycle.id}`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByRole("heading", { name: `Eliza · ${view.cycle.id}` }),
    ).toBeVisible();
    await expect(page.getByText("Review")).toBeVisible();
    await expect(page.getByText("Cycle evidence.")).toHaveCount(0);
    await expect(page.getByText(/score events ·/u)).toHaveCount(0);
  }
});

test("makes the public project draft boundary unmistakable", async ({
  page,
}) => {
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "Propose changes to Eliza." }),
  ).toBeVisible();
  await expect(
    page.getByText(/does not save or publish changes/u),
  ).toBeVisible();
  await expect(
    page.getByText("Payouts disabled", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Draft total, USDC")).toHaveCount(0);
  await expect(page.locator(".allocation-rows")).toHaveCount(0);
  await expect(page.getByText(/mainnet USDC transfers/u)).toHaveCount(0);
});

test("creates a valid GitHub-native project handoff", async ({ page }) => {
  await page.goto("/projects/new", { waitUntil: "networkidle" });
  await page.getByLabel("Project name").fill("Open Protein");
  await page
    .getByLabel("Public GitHub repository")
    .fill("example/open-protein");
  await page
    .getByLabel("Money-forward headline")
    .fill("Make money proving proteins fold.");
  await page.getByLabel("Goal").fill("Make protein research reproducible.");
  await page
    .getByLabel("Acceptance criteria")
    .fill("Accepted pull requests with verified tests.");
  await page.getByLabel("Maximum monthly pool, digital dollars").fill("2500");

  const handoff = page.getByRole("link", { name: /Continue on GitHub/u });
  await expect(handoff).toHaveAttribute(
    "href",
    /github\.com\/elizaOS\/slopdotcash\/new\/develop/u,
  );
  await expect(page.locator(".manifest-preview")).toContainText(
    '"monthlyCapMinor": "2500000000"',
  );
  await expect(page.locator(".manifest-preview")).toContainText(
    '"mode": "open-declared"',
  );
  await expect(
    page.getByRole("button", { name: "Copy agent brief" }),
  ).toBeVisible();
});

test("serves byte-consistent install and read-only artifacts for every project", async ({
  request,
}) => {
  const privateApiResponse = await request.post("/api/v1/runs", {
    data: {},
  });
  // The local Pages origin is intentionally plain HTTP, so reaching the
  // Function must fail at its HTTPS boundary rather than Cloudflare's static
  // file handler (405) or the SPA fallback (200).
  expect(privateApiResponse.status()).toBe(400);
  expect(await privateApiResponse.json()).toEqual({ error: "https_required" });

  const legacySkillResponse = await request.get("/skill.md", {
    maxRedirects: 0,
  });
  expect(legacySkillResponse.status()).toBe(301);
  expect(legacySkillResponse.headers().location).toBe(
    "/projects/eliza/skill.md",
  );

  const [
    bootstrapResponse,
    discoveryResponse,
    discoverySkillResponse,
    identityResponse,
    projectDiscoveryResponse,
    llmsResponse,
  ] = await Promise.all([
    request.get("/SKILL.md"),
    request.get("/.well-known/agent-skills/index.json"),
    request.get("/.well-known/agent-skills/slop/SKILL.md"),
    request.get("/protocol/identity-v1.json"),
    request.get("/.well-known/slop/projects.json"),
    request.get("/llms.txt"),
  ]);
  for (const response of [
    bootstrapResponse,
    discoveryResponse,
    discoverySkillResponse,
    identityResponse,
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
    "mandatory permanent raw-trace upload",
  );
  expect(await projectDiscoveryResponse.json()).toEqual({
    schemaVersion: "1",
    projects: PROJECTS.flatMap((project) =>
      project.repositories.map((repository) => ({
        project_id: project.id,
        project_url: `https://slop.cash/projects/${project.id}/`,
        repository: repository.id,
        review_skill: project.reviewSkill.id,
        review_skill_manifest: `https://slop.cash/projects/${project.id}/review-skill-manifest.json`,
        skill: project.skill.id,
        skill_source: project.skill.sourcePath,
      })),
    ),
  });

  for (const project of PROJECTS) {
    const root = `/projects/${project.id}`;
    const [
      skillResponse,
      manifestResponse,
      missionResponse,
      codexResponse,
      claudeResponse,
      claudeCodeResponse,
    ] = await Promise.all([
      request.get(`${root}/skill.md`),
      request.get(`${root}/skill-manifest.json`),
      request.get(`${root}/mission.md`),
      request.get(`${root}/codex.md`),
      request.get(`${root}/claude.md`),
      request.get(`${root}/claude-code.md`),
    ]);
    for (const response of [
      skillResponse,
      manifestResponse,
      missionResponse,
      codexResponse,
      claudeResponse,
      claudeCodeResponse,
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
  await page.route("**/data/leaderboard.json?**", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ schemaVersion: "forged" }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("alert")).toContainText(
    "Live totals unavailable",
  );
  await page.getByRole("button", { name: /Retry/u }).click();
  await expect(page.getByRole("alert")).toBeVisible();
});

test("keeps primary routes accessible and inside the viewport", async ({
  page,
}) => {
  for (const path of [
    "/",
    ...PROJECTS.map((project) => `/projects/${project.id}`),
    "/projects/eliza/manage",
    "/projects/new",
  ]) {
    await page.goto(path, { waitUntil: "networkidle" });
    if (path === "/") {
      await expect(
        page.getByRole("heading", {
          exact: true,
          name: "MAKE MONEY SHIPPING SLOP.",
        }),
      ).toBeVisible();
    }
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations, `${path} accessibility violations`).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `${path} horizontal page overflow`).toBeLessThanOrEqual(1);
  }
});

test("presents every fundraising slide without viewport or accessibility failures", async ({
  page,
}) => {
  await page.goto("/deck#1", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", {
      name: /^MAKE MONEY/,
    }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Slop — make money shipping slop");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://deck.slop.cash/og-shipping-slop.png",
  );

  for (let slide = 1; slide <= 10; slide += 1) {
    await expect(
      page.getByText(`${slide} / 10`, { exact: true }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(
      overflow,
      `deck slide ${slide} horizontal overflow`,
    ).toBeLessThanOrEqual(1);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations,
      `deck slide ${slide} accessibility violations`,
    ).toEqual([]);
    if (slide < 10) {
      await page.getByRole("button", { name: "Next slide" }).click();
    }
  }

  await expect(page.getByRole("button", { name: "Next slide" })).toBeDisabled();
  await page.keyboard.press("Home");
  await expect(page.getByText("1 / 10", { exact: true })).toBeVisible();
});

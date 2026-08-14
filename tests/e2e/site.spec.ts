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

test.beforeEach(async ({ page }) => {
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
  await expect(page.locator(".footer-wordmark")).toHaveText("slop.cash");
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
    deltaCard.getByText(/Advance ArkLib's machine-checked/u),
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
  const visibleHeroGap = await page.evaluate(() => {
    const typewriter = document.querySelector(".hero-typewriter");
    const projectHeading = document.querySelector("#projects h2");
    const textNode = typewriter?.firstChild;
    if (!textNode || !projectHeading) return null;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const textRects = Array.from(range.getClientRects());
    const lastTextRect = textRects.at(-1);
    if (!lastTextRect) return null;
    return Math.round(
      projectHeading.getBoundingClientRect().top - lastTextRect.bottom,
    );
  });
  expect(visibleHeroGap).not.toBeNull();
  expect(visibleHeroGap ?? 0).toBeGreaterThanOrEqual(16);
  expect(visibleHeroGap ?? 0).toBeLessThanOrEqual(72);
  await expect(
    page.getByRole("heading", { name: "Leaderboard" }),
  ).toBeVisible();
  await expect(page.getByText(/This month is the default/u)).toBeVisible();
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
    page.getByRole("columnheader", { name: "Current estimate" }),
  ).toBeAttached();
  await expect(
    page.getByText("How score and compute affect rewards"),
  ).toBeVisible();
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
      const projection = rows.first().locator("td").nth(4);
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
  await page.getByRole("tab", { name: "All-time record" }).click();
  await expect(
    page.getByRole("table", { name: "All-time accepted-work record" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Paid to date" }),
  ).toBeAttached();
  await expect(
    page.getByRole("columnheader", { name: "Current estimate" }),
  ).toHaveCount(0);
});

test("starts Eliza in one command and generates a public payout marker", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "Make money building agents." }),
  ).toBeVisible();
  const prompt = page.getByRole("textbox", { name: "Agent prompt" });
  await expect(prompt).toHaveValue(/\/SKILL\.md/u);
  await expect(prompt).toHaveValue(/contribute to elizaOS\/eliza/u);
  await expect(prompt).toHaveValue(
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

  const address = "11111111111111111111111111111111";
  await page.getByLabel("Solana public address").fill(address);
  await page.getByRole("button", { name: "Copy marker" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `<!-- gitarmy-wallet:v1 {"chain":"solana","address":"${address}"} -->`,
  );
  await expect(page.getByText(/Never paste a seed phrase/u)).toBeVisible();
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
  await expect(page.getByText("total paid")).toBeVisible();

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
      page.getByRole("heading", { name: "Public cycle files." }),
    ).toBeVisible();
  } else {
    const view = createProjectView(snapshot, "eliza");
    await page.goto(`/cycles/eliza/${view.cycle.id}`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByRole("heading", { name: `Eliza · ${view.cycle.id}` }),
    ).toBeVisible();
    await expect(page.getByText("14-day review")).toBeVisible();
  }
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
  await page.getByLabel("Maximum monthly pool, digital dollars").fill("2500");

  const handoff = page.getByRole("link", { name: /Continue on GitHub/u });
  await expect(handoff).toHaveAttribute(
    "href",
    /github\.com\/elizaOS\/slopdotcash\/new\/develop/u,
  );
  await expect(page.locator(".manifest-preview")).toContainText(
    '"monthlyCapMinor": "2500000000"',
  );
  await expect(
    page.getByText(/New projects pass automated safety checks/u),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy agent brief" }),
  ).toBeVisible();
});

test("serves byte-consistent install and read-only artifacts for every project", async ({
  request,
}) => {
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
    projectDiscoveryResponse,
    llmsResponse,
  ] = await Promise.all([
    request.get("/SKILL.md"),
    request.get("/.well-known/agent-skills/index.json"),
    request.get("/.well-known/agent-skills/slop/SKILL.md"),
    request.get("/.well-known/slop/projects.json"),
    request.get("/llms.txt"),
  ]);
  for (const response of [
    bootstrapResponse,
    discoveryResponse,
    discoverySkillResponse,
    projectDiscoveryResponse,
    llmsResponse,
  ]) {
    expect(response.status()).toBe(200);
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
  expect(bootstrap.toString()).toContain("No CLI upload");
  expect(await projectDiscoveryResponse.json()).toEqual({
    schemaVersion: "1",
    projects: PROJECTS.flatMap((project) =>
      project.repositories.map((repository) => ({
        project_id: project.id,
        project_url: `https://slop.cash/projects/${project.id}/`,
        repository: repository.id,
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
    "/projects/new",
  ]) {
    if (path === "/") {
      await page.emulateMedia({ reducedMotion: "no-preference" });
    }
    await page.goto(path, { waitUntil: "networkidle" });
    if (path === "/") {
      await expect(
        page.getByRole("heading", {
          exact: true,
          name: "MAKE MONEY DISCOVERING DRUGS.",
        }),
      ).toBeVisible({ timeout: 8_000 });
      await expect(page.locator(".hero-typewriter")).toHaveText(
        "DISCOVERING DRUGS.",
        { timeout: 8_000 },
      );
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

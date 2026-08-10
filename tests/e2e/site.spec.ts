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
  const snapshot = await loadSnapshot(request);
  await loadCycles(request);

  await expect(
    page.getByRole("heading", {
      exact: true,
      name: "MAKE MONEY BUILDING AGENTS.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/GitHub ledger \+ reward records live|Snapshot stale/u),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      exact: true,
      name: "Make money building agents.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      exact: true,
      name: "Make money solving math.",
    }),
  ).toBeVisible();
  await expect(page.getByText("$10,000 / month")).toBeVisible();
  await expect(page.getByText("$1,000,000 opportunity")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "People shipping work." }),
  ).toBeVisible();

  const rows = page.locator("#leaderboard tbody .leader-row");
  if (snapshot.leaders.length === 0) await expect(rows).toHaveCount(0);
  else expect(await rows.count()).toBeGreaterThan(0);
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
  const command = page.getByRole("textbox", { name: "Install command" });
  await expect(command).toHaveValue(/skills\/contribute-to-eliza/u);
  await expect(command).toHaveValue(/\/projects\/eliza/u);
  await page.getByRole("button", { name: "Copy install command" }).click();
  await expect(page.getByRole("button", { name: /Copied/u })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "skills/contribute-to-eliza",
  );

  const address = "11111111111111111111111111111111";
  await page.getByLabel("Solana public address").fill(address);
  await page.getByRole("button", { name: "Copy marker" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `<!-- gitarmy-wallet:v1 {"chain":"solana","address":"${address}"} -->`,
  );
  await expect(page.getByText(/Never paste a seed phrase/u)).toBeVisible();
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
    /github\.com\/elizaOS\/army\/new\/develop/u,
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

test("serves byte-consistent contributor skill artifacts for both projects", async ({
  request,
}) => {
  for (const project of [
    { id: "eliza", skill: "contribute-to-eliza" },
    { id: "delta-star", skill: "contribute-to-delta-star" },
  ]) {
    const root = `/projects/${project.id}`;
    const [skillResponse, manifestResponse] = await Promise.all([
      request.get(`${root}/skill.md`),
      request.get(`${root}/skill-manifest.json`),
    ]);
    expect(skillResponse.status()).toBe(200);
    expect(manifestResponse.status()).toBe(200);
    const skillBytes = await skillResponse.body();
    const manifest = (await manifestResponse.json()) as {
      archive: { sha256: string; url: string; checksumUrl: string };
      name: string;
      source: { sha256: string };
    };
    expect(manifest.name).toBe(project.skill);
    expect(manifest.source.sha256).toBe(
      createHash("sha256").update(skillBytes).digest("hex"),
    );

    const [archiveResponse, checksumResponse] = await Promise.all([
      request.get(new URL(manifest.archive.url).pathname),
      request.get(new URL(manifest.archive.checksumUrl).pathname),
    ]);
    expect(archiveResponse.status()).toBe(200);
    expect(checksumResponse.status()).toBe(200);
    const archive = await archiveResponse.body();
    expect(createHash("sha256").update(archive).digest("hex")).toBe(
      manifest.archive.sha256,
    );
    expect(await checksumResponse.text()).toContain(manifest.archive.sha256);
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
    "/projects/eliza",
    "/projects/delta-star",
    "/projects/new",
  ]) {
    await page.goto(path, { waitUntil: "networkidle" });
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

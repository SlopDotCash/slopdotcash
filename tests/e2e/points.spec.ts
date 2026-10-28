import { join } from "node:path";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { archivedPaidCycleIndex, snapshotFixture } from "../fixtures";
import { expect, expectAccessible, test } from "./fixtures";

test("switching contributor views preserves a pending ranking read and the shared search", async ({
  page,
}) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let observed: () => void = () => {};
  const requested = new Promise<void>((resolve) => {
    observed = resolve;
  });
  let rankingReads = 0;
  await page.route("**/data/leaderboard.json?**", async (route) => {
    rankingReads++;
    observed();
    await held;
    await route.continue();
  });
  try {
    await page.goto("/points", { waitUntil: "domcontentloaded" });
    await requested;
    const search = page.getByLabel("Find a contributor");
    await search.fill("profile");
    await page.getByRole("button", { name: "People", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "People", exact: true }),
    ).toBeVisible();
    await expect(search).toHaveValue("profile");
    await page.getByRole("button", { name: "Rankings", exact: true }).click();
    release();
    await expect(
      page.locator(".points-coverage-details > summary"),
    ).toBeVisible();
    await expect(search).toHaveValue("profile");
    expect(rankingReads).toBe(1);
  } finally {
    release();
  }
});

test(
  "points history is usable, accessible and independent of payments",
  { tag: ["@pages"] },
  async ({ page }, info) => {
    const response = await page.goto("/points");
    expect(response?.status()).toBe(200);
    const reloaded = await page.reload();
    expect(reloaded?.status()).toBe(200);
    await expect(
      page.getByRole("columnheader", { name: "Points", exact: true }),
    ).toHaveAttribute("aria-sort", "descending");
    // The period states the snapshot's exact bounds and source coverage.
    await page.locator(".points-coverage-details > summary").click();
    const coverage = page.locator(".points-coverage");
    await expect(coverage).toHaveText(
      /^(This month ranks .+ UTC to .+ UTC\. )?Snapshot window: .+ UTC to .+ UTC\. Source: [\d,]+ merged pull requests and [\d,]+ closed issues across [\d,]+ repositories\.$/u,
    );
    await page
      .getByRole("button", { name: "Recorded history", exact: true })
      .click();
    await expect(coverage).toContainText(/Includes [\d,]+ closed cycles?\.$/u);
    await expect(page.getByRole("table")).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByRole("columnheader", { name: "Points", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Money received", exact: true })
      .click();
    await expect(page).toHaveURL(/sort=money/);
    await page.reload();
    await expect(
      page.getByRole("columnheader", { name: "Money received", exact: true }),
    ).toHaveAttribute("aria-sort", "descending");
    await expect(
      page.getByRole("button", { name: "Recorded history", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Points", exact: true }).click();
    await expect(page.getByLabel("Cohort", { exact: true })).toHaveCount(0);
    // The earlier combined link still opens recorded history.
    await page.goto("/points?period=new");
    await expect(
      page.getByRole("button", { name: "Recorded history", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.goto("/points?sort=points&period=lifetime");
    await expect(
      page.getByRole("region", { name: "People", exact: true }),
    ).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    if ((page.viewportSize()?.width ?? 0) <= 390) {
      const scroller = page.getByRole("region", {
        name: "Contributor standings table",
        exact: true,
      });
      expect(
        await scroller.evaluate((el) => el.scrollWidth > el.clientWidth),
      ).toBe(true);
      await scroller.focus();
      await page.keyboard.press("ArrowRight");
      await expect
        .poll(() => scroller.evaluate((el) => el.scrollLeft))
        .toBeGreaterThan(0);
      await scroller.evaluate((el) => {
        el.scrollLeft = 0;
      });
    }

    await page
      .getByRole("button", { name: "Recorded history", exact: true })
      .click();
    const first = page.getByRole("table").getByRole("row").nth(1);
    const login = await first.getByRole("link").innerText();
    await page.getByLabel("Find a contributor").fill(login);
    await expect(
      page.getByRole("table").getByRole("link", { name: login, exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Find a contributor")
      .fill("no-such-contributor-987654321");
    await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(0);
    await page.getByLabel("Find a contributor").fill("");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText(/Page 2 of/)).toBeVisible();
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => document.activeElement !== document.body),
    ).toBe(true);
    await expectAccessible(page);
    await page.screenshot({
      path: info.outputPath("points.png"),
      fullPage: true,
    });
    // Match the repository's 200% text-enlargement fixture without reducing
    // a 320px viewport below the supported reflow width through CSS zoom.
    await page.evaluate(() => {
      const typography = [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((el) => el instanceof HTMLElement)
        .map((el) => ({
          el,
          font: getComputedStyle(el).fontSize,
          line: getComputedStyle(el).lineHeight,
        }));
      for (const { el, font, line } of typography) {
        el.style.fontSize = `${Number.parseFloat(font) * 2}px`;
        if (line !== "normal")
          el.style.lineHeight = `${Number.parseFloat(line) * 2}px`;
      }
    });
    expect(
      await page.evaluate(() => {
        const overflow =
          document.documentElement.scrollWidth > window.innerWidth + 1;
        return {
          overflow,
          elements: !overflow
            ? []
            : [...document.querySelectorAll("main *")]
                .filter(
                  (el) =>
                    el.getBoundingClientRect().right > window.innerWidth + 1,
                )
                .map((el) => ({
                  tag: el.tagName,
                  class: el.className,
                  text: el.textContent?.slice(0, 80),
                  right: el.getBoundingClientRect().right,
                })),
        };
      }),
    ).toEqual({ overflow: false, elements: [] });
    await page.screenshot({
      path: info.outputPath("points-zoom.png"),
      fullPage: true,
    });
  },
);

test("shows archived payments as all-time money received independently of points", async ({
  page,
}) => {
  // Local public-record fixtures exercise the browser projection, not chain verification.
  // Serve the checked bundle on its allowed origin so the payment reader runs.
  const site = deploymentOrigins(
    deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
  ).site;
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
  await page.route("**/api/v1/payments/received", (route) =>
    route.fulfill({
      json: {
        schemaVersion: "1",
        generatedAt: "2026-08-17T12:00:00.000Z",
        contributors: [],
        totals: {
          usdMicro: "0",
          directMicro: "0",
          vaultUsdMicro: "0",
          directTransfers: 0,
          vaultPayments: 0,
          contributors: 0,
        },
      },
    }),
  );
  await page.route("**/api/v1/points/**", (route) =>
    route.fulfill({ json: null }),
  );
  await page.route("**/api/v1/slopbot/summary", (route) =>
    route.fulfill({ json: { repositories: [] } }),
  );
  await page.route("**/.well-known/slop/projects.json", (route) =>
    route.fulfill({ json: { schemaVersion: "1", projects: [] } }),
  );
  await page.clock.setFixedTime(new Date("2026-08-17T12:00:00.000Z"));
  await page.route("**/data/leaderboard.json?**", (route) =>
    route.fulfill({ json: snapshotFixture() }),
  );
  const history = archivedPaidCycleIndex();
  await page.route("**/data/cycles/index.json?**", (route) =>
    route.fulfill({ json: history }),
  );
  // The home table ranks all-time money received, so the archived payment
  // appears whatever the current month is.
  await page.goto(`${site}/#leaderboard`);
  const home = page.getByRole("region", {
    name: "Top sloperators",
    exact: true,
  });
  await home
    .getByRole("button", { name: "Money received", exact: true })
    .click();
  const homeRecipient = home.getByRole("row").filter({
    has: page.getByRole("link", { name: "archive-only", exact: true }),
  });
  await expect(homeRecipient.locator("td").nth(3)).toHaveText("$1");

  // Search keeps this zero-points actor visible after all points rows load.
  await page.goto(`${site}/points?sort=money&q=archive-only`);
  const standings = page.getByRole("region", {
    name: "Contributor standings",
    exact: true,
  });
  const recipient = standings.getByRole("row").filter({
    has: page.getByRole("link", { name: "archive-only", exact: true }),
  });
  await expect(recipient.locator("td").nth(3)).toHaveText("$1");
  await page.goto(`${site}/points?sort=money&period=lifetime&q=archive-only`);
  await expect(recipient.locator("td").nth(3)).toHaveText("$1");
  // The points period never narrows money received to one month.
  await page.clock.setFixedTime(new Date("2026-09-30T12:00:00.000Z"));
  await page.goto(`${site}/points?sort=money&q=archive-only`);
  await expect(recipient.locator("td").nth(3)).toHaveText("$1");

  // A current identity must also win when only an older payment creates the row.
  history.cycles[0].contributors[0].actor.id =
    snapshotFixture().leaders[0].actor.id;
  await page.clock.setFixedTime(new Date("2026-08-17T12:00:00.000Z"));
  await page.goto(`${site}/points?sort=money&identity=renamed`);
  const currentLink = standings.getByRole("link", {
    name: "finish-line",
    exact: true,
  });
  await expect(currentLink).toHaveAttribute(
    "href",
    "/contributors/finish-line",
  );
  await expect(currentLink.locator("../..").locator("td").nth(3)).toHaveText(
    "$1",
  );
  await expect(
    standings.getByRole("link", { name: "archive-only", exact: true }),
  ).toHaveCount(0);
});

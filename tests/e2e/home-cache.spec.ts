/** First-visit discovery must not wait for any API or public data response. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { homeProjects } from "../../src/lib/home-projects";

test.use({ video: "on" });

test("renders bundled projects with data stalled and GitHub blocked", async ({
  page,
}) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/(?:data|api)\//, async (route) => {
    await held;
    await route.fallback();
  });
  await page.route(/https:\/\/[^/]*github[^/]*\//, (route) => route.abort());
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const expected = homeProjects();
    expect(expected.length).toBeGreaterThan(0);
    await expect(page.locator(".project-card")).toHaveCount(expected.length);
    for (const project of expected.filter(
      (project) => project.listingTier === "featured",
    )) {
      await expect(
        page.getByRole("heading", { name: project.name, exact: true }),
      ).toBeVisible();
    }
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("cached-projects.png"),
      fullPage: true,
    });
    // Keep at least 320 CSS pixels for reflow. Doubling the 320px viewport
    // tests a 160px layout, below the site's supported minimum.
    if ((page.viewportSize()?.width ?? 0) >= 640) {
      await page.evaluate(() => {
        document.documentElement.style.zoom = "2";
      });
    }
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    expect(
      requests.filter((url) =>
        /github|\/data\/leaderboard\.json|\/data\/cycles\//.test(url),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await test.info().attach("homepage-network-and-console", {
      body: JSON.stringify({ requests, errors }, null, 2),
      contentType: "application/json",
    });
    release();
  }
});

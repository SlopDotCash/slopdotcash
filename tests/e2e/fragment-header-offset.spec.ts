import { expect, test } from "./fixtures";

/**
 * Fragment links on public pages. Each target, or the heading it starts
 * with, must land below the sticky site header instead of under it.
 */
const FRAGMENTS = [
  // Cycle, profile, sponsor and project-nav links open project funding.
  { path: "/projects/eliza", id: "funding", heading: null },
  { path: "/how-it-works", id: "points", heading: "Points" },
  { path: "/how-it-works", id: "faq", heading: "Questions" },
  // The sponsors page links its "Live leaderboard" record here.
  { path: "/", id: "leaderboard", heading: "Top sloperators" },
] as const;

test.beforeEach(async ({ page }) => {
  await page.route("https://avatars.githubusercontent.com/**", (route) =>
    route.fulfill({ path: "public/slop-mark.svg" }),
  );
});

for (const { path, id, heading } of FRAGMENTS) {
  test(`${path}#${id} lands below the sticky header`, async ({
    page,
    diagnostics,
  }, info) => {
    diagnostics.allowPreviewApiMisses();
    diagnostics.allowCanceledBackgroundReads();
    await page.goto(`${path}#${id}`, { waitUntil: "networkidle" });
    const target = page.locator(`#${id}`);
    await expect(target).toBeInViewport();
    if (heading)
      await expect(
        target.getByRole("heading", { name: heading, exact: true }).first(),
      ).toBeVisible();
    await expect
      .poll(
        () =>
          page.evaluate(
            ({ id, heading }) => {
              const element = document.getElementById(id);
              const header = document.querySelector(".site-header");
              if (!element || !header) return -1_000;
              const start = heading
                ? ([...element.querySelectorAll("h1, h2, h3")].find(
                    (node) => node.textContent?.trim() === heading,
                  ) ?? element)
                : element;
              return (
                start.getBoundingClientRect().top -
                header.getBoundingClientRect().bottom
              );
            },
            { id, heading },
          ),
        { timeout: 15_000 },
      )
      .toBeGreaterThanOrEqual(0);
    await page.screenshot({
      path: info.outputPath(`${id}-fragment.png`),
    });
  });
}

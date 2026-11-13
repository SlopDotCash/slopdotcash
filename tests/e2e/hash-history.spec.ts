/** Preserve the visitor's reading position across native history (PRD 7). */
import type { Page } from "@playwright/test";
import { expect, expectAccessible, test } from "./fixtures";

test.use({ video: "on" });

async function afterPaint(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function scrollPage(page: Page, deltaY: number) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("The browser test needs a viewport");
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  // Control+End does not scroll to the bottom on macOS. A real wheel event
  // works on each platform and also exercises reader-input cancellation.
  const before = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, deltaY);
  await expect.poll(() => page.evaluate(() => scrollY)).not.toBe(before);
  let previous: number | undefined;
  let stableReads = 0;
  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() => scrollY);
        stableReads = current === previous ? stableReads + 1 : 0;
        previous = current;
        return stableReads;
      },
      { intervals: [50] },
    )
    .toBeGreaterThanOrEqual(3);
  await afterPaint(page);
}

for (const pendingDestination of [false, true]) {
  test(`Back and Forward restore fragment reading after ${pendingDestination ? "a loading page" : "immediate navigation"}`, async ({
    page,
    diagnostics,
  }, info) => {
    diagnostics.allowPreviewApiMisses();
    diagnostics.allowCanceledBackgroundReads();
    // The page ends soon after the section. A short window keeps the bottom
    // reading position more than 100px past the section's own position.
    const size = page.viewportSize();
    if (size && size.height > 560)
      await page.setViewportSize({ width: size.width, height: 560 });
    await page.goto("/how-it-works", { waitUntil: "networkidle" });
    // A plain anchor creates a fresh native history entry, unlike Link's
    // synthetic popstate. It must still land on the requested section.
    await page
      .getByRole("link", { name: "4. Automatic payment", exact: true })
      .click();
    await expect(page).toHaveURL(/\/how-it-works#payments$/u);
    await expect
      .poll(() =>
        page
          .locator("#payments")
          .evaluate((element) => Math.abs(element.getBoundingClientRect().top)),
      )
      .toBeLessThan(1);

    const distanceFromBottom = () =>
      page.evaluate(() =>
        Math.abs(
          scrollY - (document.documentElement.scrollHeight - innerHeight),
        ),
      );
    // Use at most one viewport per gesture. A huge synthetic wheel delta can
    // keep the browser's native scroll animation active through Back and undo
    // the next gesture, even after its reported offset reaches the bottom.
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("The browser test needs a viewport");
    while ((await distanceFromBottom()) >= 2)
      await scrollPage(
        page,
        Math.min(viewport.height, await distanceFromBottom()),
      );
    await expect
      .poll(() =>
        page.evaluate(() =>
          Math.abs(
            window.scrollY -
              (document.documentElement.scrollHeight - window.innerHeight),
          ),
        ),
      )
      .toBeLessThan(2);
    const readingPosition = await page.evaluate(() => window.scrollY);
    const anchorPosition = await page
      .locator("#payments")
      .evaluate(
        (element) => element.getBoundingClientRect().top + window.scrollY,
      );
    expect(readingPosition - anchorPosition).toBeGreaterThan(100);
    await page.evaluate(() =>
      history.replaceState({ ...history.state, readerState: "retained" }, ""),
    );

    let releaseDestination = () => {};
    if (pendingDestination) {
      const destinationReady = new Promise<void>((resolve) => {
        releaseDestination = resolve;
      });
      await page.route(/\/assets\/Earnings-[^/]+\.js$/u, async (route) => {
        await destinationReady;
        await route.continue();
      });
    }
    try {
      await page.locator('a[href="/earnings"]').last().click();
      await expect(page).toHaveURL(/\/earnings$/u);
      if (pendingDestination)
        await expect(
          page.getByRole("status").filter({ hasText: /^Loading page$/u }),
        ).toBeVisible();
      // The immediate case deliberately returns before the destination has
      // finished rendering, as a reader can do with the browser Back button.
      await page.goBack();
      releaseDestination();
      await expect(page).toHaveURL(/\/how-it-works#payments$/u);
      await expect(page.locator("#payments")).toBeAttached();
      await page.waitForLoadState("networkidle");
      await afterPaint(page);
      await expect
        .poll(() =>
          page.evaluate(
            (position) => Math.abs(scrollY - position),
            readingPosition,
          ),
        )
        .toBeLessThan(2);
      expect(await page.evaluate(() => history.state.readerState)).toBe(
        "retained",
      );
      await page.screenshot({
        path: info.outputPath("back-reading-position.png"),
      });

      // Keep the latest reading position, rather than the first departure's offset.
      await scrollPage(page, -120);
      const continuedReading = await page.evaluate(() => scrollY);
      await page.goBack();
      await expect(page).toHaveURL(/\/how-it-works$/u);
      await page.goForward();
      await expect(page).toHaveURL(/\/how-it-works#payments$/u);
      await expect(page.locator("#payments")).toBeAttached();
      await page.waitForLoadState("networkidle");
      await afterPaint(page);
      await expect
        .poll(() =>
          page.evaluate(
            (position) => Math.abs(scrollY - position),
            continuedReading,
          ),
        )
        .toBeLessThan(2);
      await page.screenshot({
        path: info.outputPath("forward-reading-position.png"),
      });
      await expectAccessible(page);
    } finally {
      releaseDestination();
    }
  });
}

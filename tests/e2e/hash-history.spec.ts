/** Preserve the visitor's reading position across native history (PRD 7). */
import { expect, expectAccessible, test } from "./fixtures";

test.use({ video: "on" });

test("Back and Forward restore reading below a previously visited fragment", async ({
  page,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowCanceledBackgroundReads();
  await page.goto("/how-it-works", { waitUntil: "networkidle" });
  // A plain anchor creates a fresh native history entry, unlike Link's
  // synthetic popstate. It must still land on the requested section.
  await page
    .getByRole("link", { name: "Payment stages and timing", exact: true })
    .click();
  await expect(page).toHaveURL(/\/how-it-works#payments$/u);
  await expect
    .poll(() =>
      page
        .locator("#payments")
        .evaluate((element) => Math.abs(element.getBoundingClientRect().top)),
    )
    .toBeLessThan(1);

  await page.keyboard.press("Control+End");
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

  await page.locator('a[href="/earnings"]').last().click();
  await expect(page).toHaveURL(/\/earnings$/u);
  await page.waitForLoadState("networkidle");
  await page.goBack();
  await expect(page).toHaveURL(/\/how-it-works#payments$/u);
  await expect(page.locator("#payments")).toBeAttached();
  await page.waitForLoadState("networkidle");
  await expect
    .poll(() =>
      page.evaluate(
        (position) => Math.abs(scrollY - position),
        readingPosition,
      ),
    )
    .toBeLessThan(2);
  expect(await page.evaluate(() => history.state.readerState)).toBe("retained");
  await page.screenshot({ path: info.outputPath("back-reading-position.png") });

  // Keep the latest reading position, rather than the first departure's offset.
  await page.mouse.wheel(0, -120);
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeLessThan(readingPosition - 50);
  const continuedReading = await page.evaluate(() => scrollY);
  await page.goBack();
  await expect(page).toHaveURL(/\/how-it-works$/u);
  await page.goForward();
  await expect(page).toHaveURL(/\/how-it-works#payments$/u);
  await expect(page.locator("#payments")).toBeAttached();
  await page.waitForLoadState("networkidle");
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
});

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("points history is usable, accessible and independent of payments", async ({
  page,
}, info) => {
  const errors: string[] = [];
  const failures: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("response", (r) => {
    if (
      new URL(r.url()).origin === new URL(page.url()).origin &&
      r.status() >= 400
    )
      failures.push(`${r.status()} ${r.url()}`);
  });
  await page.goto("/points");
  await expect(
    page.getByRole("heading", { name: "Slop Points", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/Points have no monetary value/)).toBeVisible();
  await page.getByLabel("Period", { exact: true }).selectOption("lifetime");
  const first = page.getByRole("table").getByRole("row").nth(1);
  const login = await first.getByRole("link").innerText();
  await page.getByLabel("Find a contributor").fill(login);
  await expect(
    page.getByRole("table").getByRole("link", { name: login, exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Find a contributor")
    .fill("no-such-contributor-987654321");
  await expect(
    page.getByText("No recorded contributions match this view."),
  ).toBeVisible();
  await page.getByLabel("Find a contributor").fill("");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText(/Page 2 of/)).toBeVisible();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement !== document.body),
  ).toBe(true);
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath("points.png"),
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("points-zoom.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
});

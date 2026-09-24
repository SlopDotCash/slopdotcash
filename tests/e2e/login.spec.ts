import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("serves GitHub login on direct navigation and reload", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  expect((await page.goto("/login"))?.status()).toBe(200);
  expect((await page.reload())?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Log in", exact: true }),
  ).toBeVisible();
  const header = page.getByRole("banner");
  const menu = header.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await expect(
    header.getByRole("link", { name: "Receipts", exact: true }),
  ).toHaveCount(0);
  await expect(
    header.getByRole("link", { name: "Cycles", exact: true }),
  ).toHaveCount(0);
  await expect(
    header.getByRole("link", { name: "Log in", exact: true }),
  ).toHaveAttribute("href", "/login");
  await expect(
    page.getByRole("link", { name: "Continue with GitHub on slop.cash" }),
  ).toHaveAttribute("href", "https://slop.cash/login");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement !== document.body),
  ).toBe(true);
  await page.evaluate(() => document.fonts.ready);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath("login.png"), fullPage: true });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

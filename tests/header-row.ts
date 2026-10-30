import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Checks the site header: one row with the S mark, the "How It Works" link,
 * and the account or login control at the right edge. The logotype shows from
 * 480px up. No width scrolls the page sideways.
 */
export async function expectHeaderRow(page: Page, account: Locator) {
  const header = page.getByRole("banner");
  const home = header.getByRole("link", { name: "Slop home", exact: true });
  const help = header.getByRole("link", { name: "How it works", exact: true });
  await expect(home).toBeVisible();
  await expect(help).toHaveAttribute("href", "/how-it-works");
  await expect(account).toBeVisible();
  const width = await page.evaluate(() => window.innerWidth);
  const [homeBox, helpBox, accountBox] = await Promise.all(
    [home, help, account].map((item) => item.boundingBox()),
  );
  if (!homeBox || !helpBox || !accountBox)
    throw new Error("A header control has no layout box");
  const middle = (box: { y: number; height: number }) => box.y + box.height / 2;
  expect(Math.abs(middle(helpBox) - middle(homeBox))).toBeLessThanOrEqual(4);
  expect(Math.abs(middle(accountBox) - middle(homeBox))).toBeLessThanOrEqual(4);
  expect(helpBox.width).toBeGreaterThanOrEqual(44);
  expect(helpBox.height).toBeGreaterThanOrEqual(40);
  if (width <= 680) expect(helpBox.height).toBeGreaterThanOrEqual(44);
  expect(helpBox.x).toBeGreaterThan(homeBox.x + homeBox.width);
  expect(accountBox.x).toBeGreaterThan(helpBox.x + helpBox.width);
  expect(accountBox.x + accountBox.width).toBeLessThanOrEqual(width);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

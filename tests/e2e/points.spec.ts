import { expect, expectAccessibleReflow, test } from "./fixtures";

// /points is a contributor directory, never a ranking (operator decision,
// 18 November 2026). Points stay only where they explain a payout.
test(
  "the contributor directory lists people without points or rankings",
  { tag: ["@pages"] },
  async ({ page }, info) => {
    await page.route(
      "https://avatars.githubusercontent.com/**",
      async (route) =>
        route.fulfill({ response: await page.request.get("/slop-mark.svg") }),
    );
    const response = await page.goto("/points");
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Contributors" }),
    ).toBeVisible();
    await expect(page).toHaveTitle(/^Contributors · Slop$/u);
    const people = page.locator(".points-people li");
    await expect(people.first()).toBeVisible({ timeout: 30_000 });
    // No ranking table, no period switch and no Points figure anywhere.
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(
      page.getByRole("columnheader", { name: "Points", exact: true }),
    ).toHaveCount(0);
    for (const label of ["This month", "All time"])
      await expect(
        page.getByRole("button", { name: label, exact: true }),
      ).toHaveCount(0);
    await expect(page.locator(".points-people")).not.toContainText(/\bpts\b/u);
    // Every row links to the contributor's profile.
    const first = people.first().getByRole("link").first();
    const login = (await first.innerText()).trim();
    await expect(first).toHaveAttribute(
      "href",
      `/contributors/${encodeURIComponent(login)}`,
    );
    // A shared query narrows the directory to matching logins.
    await page.goto(`/points?q=${encodeURIComponent(login)}`);
    await expect(people.first()).toBeVisible({ timeout: 30_000 });
    for (const row of await people.getByRole("link").allInnerTexts())
      if (!/^Project maintainer/u.test(row))
        expect(row.toLowerCase()).toContain(login.toLowerCase());
    await page.goto("/points?q=no-such-contributor-987654321");
    await expect(page.getByText("No matches.", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await page.goto("/points");
    await expect(people.first()).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => document.activeElement !== document.body),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("contributors.png"),
      fullPage: true,
    });
    await expectAccessibleReflow(page, "contributors");
  },
);

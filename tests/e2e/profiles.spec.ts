import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { TARGET_REPOSITORIES } from "../../src/lib/repositories.mjs";

test("a contributor with only open and closed PRs has a searchable individual profile", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const failures: string[] = [];
  page.on("response", (r) => {
    if (
      new URL(r.url()).origin === new URL(page.url()).origin &&
      r.status() >= 400
    )
      failures.push(r.url());
  });
  const now = new Date().toISOString();
  await page.route("**/data/profiles.json", (r) =>
    r.fulfill({
      json: {
        schemaVersion: "1",
        startedAt: now,
        generatedAt: now,
        repositories: TARGET_REPOSITORIES.map((v, i) => ({
          repository: v.id,
          count: i === 0 ? 5 : 0,
          excluded: 0,
        })),
        people: [
          {
            id: "U_profile_only",
            login: "profile-only-contributor",
            avatarUrl: "https://avatars.githubusercontent.com/u/1234567",
            repositories: [
              {
                repository: TARGET_REPOSITORIES[0].id,
                merged: 0,
                open: 3,
                closed: 2,
              },
            ],
          },
        ],
      },
    }),
  );
  await page.goto("/points");
  const directory = page.getByRole("region", { name: "Contributor directory" });
  await directory.getByLabel("GitHub username").fill("profile-only");
  await directory
    .getByRole("link", { name: "profile-only-contributor", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "profile-only-contributor",
      exact: true,
    }),
  ).toBeVisible();
  const profile = page.getByRole("region", { name: "Contributor profile" });
  await expect(profile.locator(".profile-totals").first()).toContainText(
    "3PRs open",
  );
  await expect(profile.locator(".profile-totals").first()).toContainText(
    "2PRs closed without merging",
  );
  await expect(page.locator(".points-total")).toHaveText("0 pts");
  await expect(
    profile.getByRole("link", { name: "GitHub · @profile-only-contributor" }),
  ).toHaveAttribute("href", "https://github.com/profile-only-contributor");
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement !== document.body),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("individual-profile.png"),
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
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("individual-profile-zoom.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
});

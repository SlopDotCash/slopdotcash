import { assertProfiles } from "../../src/lib/profiles";
import { TARGET_REPOSITORIES } from "../../src/lib/repositories.mjs";
import { enlargeText } from "../text-size";
import { expect, expectAccessible, test } from "./fixtures";

test("profiles preserve legacy coverage and a valid census", async ({
  page,
}, info) => {
  const failures: string[] = [];
  page.on("response", (r) => {
    if (
      new URL(r.url()).origin === new URL(page.url()).origin &&
      r.status() >= 400
    )
      failures.push(r.url());
  });
  const walletRequests: string[] = [];
  const expectedWalletRequests = [
    "/api/v1/wallet-claims/actors/1234567/current",
  ];
  // This census check must not depend on a remote payout service.
  await page.route("**/api/v1/wallet-claims/actors/*/current", (route) => {
    walletRequests.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: null });
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
            id: "MDQ6VXNlcjEyMzQ1Njc=",
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
  const directory = page.getByRole("region", { name: "People", exact: true });
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
  await expect(profile.locator(".pr-legend")).toContainText("3 PRs open");
  await expect(profile.locator(".pr-legend")).toContainText(
    "2 PRs closed without merging",
  );
  await expect(
    page
      .getByText("total points", { exact: true })
      .locator("..")
      .locator("strong"),
  ).toHaveText("0");
  await expect(
    profile.getByRole("link", { name: "GitHub · @profile-only-contributor" }),
  ).toHaveAttribute("href", "https://github.com/profile-only-contributor");
  await expect(
    profile.locator("summary", { hasText: /^Penalty history$/ }),
  ).toHaveCount(0);
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("individual-profile.png"),
    fullPage: true,
  });
  // Match the repository's 200% text-enlargement fixture without reducing
  // a 320px viewport below the supported reflow width through CSS zoom.
  await enlargeText(page.locator("body"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("individual-profile-zoom.png"),
    fullPage: true,
  });
  await page.unroute("**/data/profiles.json");
  const response = await page.request.get("/data/profiles.json");
  expect(response.ok()).toBe(true);
  const census = await response.json();
  assertProfiles(census);
  expect(walletRequests).toEqual(expectedWalletRequests);
  expect(failures).toEqual([]);
});

import { expect, expectAccessible, test } from "./fixtures";

/**
 * A render failure stays an observable page error, and its reload control
 * loads the page again with fresh responses.
 */
test("a render failure shows the page error and Reload the page recovers", async ({
  page,
  diagnostics,
}, info) => {
  // The boundary reports the failure it contains; nothing else may fail.
  diagnostics.allow(
    /^console \[Slop\] render boundary caught an error /u,
    /^console (?:TypeError: )?Cannot read properties of undefined \(reading 'map'\)/u,
  );
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "4242", githubLogin: "operator", admin: true },
      },
    }),
  );
  let reads = 0;
  await page.route("**/api/v1/admin/fee-conversions", (route) => {
    reads += 1;
    // The first answer omits the route list the page renders.
    return route.fulfill({
      json:
        reads === 1
          ? { totals: [] }
          : {
              routes: [{ network: "base", targetToken: null, status: "usdc" }],
              totals: [],
            },
    });
  });
  await page.goto("/admin?section=fees", { waitUntil: "networkidle" });
  const failure = page.getByRole("alert").filter({
    has: page.getByRole("heading", {
      name: "Slop could not load.",
      exact: true,
    }),
  });
  await expect(failure).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Fee conversions", exact: true }),
  ).toHaveCount(0);
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("render-failure.png"),
    fullPage: true,
  });

  const reloaded = page.waitForEvent("load");
  await failure
    .getByRole("button", { name: "Reload the page", exact: true })
    .click();
  await reloaded;
  await expect(
    page.getByRole("heading", { name: "Fee conversions", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Slop could not load.", { exact: true }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(/\/admin\?section=fees$/u);
  expect(reads).toBe(2);
  await expectAccessible(page);
});

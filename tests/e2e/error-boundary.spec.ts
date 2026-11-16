import { REWARD_ASSET_NETWORKS } from "../../src/lib/reward-asset.mjs";
import { expect, expectAccessible, test } from "./fixtures";

const USDC = REWARD_ASSET_NETWORKS.base.stablecoin.address;
const BASE_ROUTE = { network: "base", targetToken: USDC, status: "usdc" };
/** Converted output whose conversion the injected browser fault rejects. */
const FAULTY_AMOUNT = "4242424242";

const report = (amountOut: string) => ({
  routes: [BASE_ROUTE],
  totals: [
    {
      network: "base",
      token: `0x${"1".repeat(40)}`,
      targetToken: USDC,
      conversions: 1,
      amountIn: "2500000000000000000",
      amountOut,
    },
  ],
});

const routeAdminSession = (page: import("@playwright/test").Page) =>
  page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "4242", githubLogin: "operator", admin: true },
      },
    }),
  );

/**
 * A malformed report is a section load error with its retry; it never
 * reaches rendering and never takes down the page.
 */
test("a malformed fee report shows the section error and Retry recovers", async ({
  page,
}) => {
  await routeAdminSession(page);
  let reads = 0;
  await page.route("**/api/v1/admin/fee-conversions", (route) => {
    reads += 1;
    // The first answer omits the route list the page renders.
    return route.fulfill({
      json: reads === 1 ? { totals: [] } : report("12500000"),
    });
  });
  await page.goto("/admin?section=fees", { waitUntil: "networkidle" });
  const section = page.getByRole("region", { name: "Fee conversions" });
  const failure = section.getByRole("alert");
  await expect(failure).toHaveText(/The fee conversion report is invalid\./u);
  await expect(
    page.getByText("Slop could not load.", { exact: true }),
  ).toHaveCount(0);
  await expectAccessible(page);

  await failure.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(section.getByRole("alert")).toHaveCount(0);
  await expect(section).toContainText("12.5 USDC");
  expect(reads).toBe(2);
});

/**
 * The boundary contains render faults that valid data cannot rule out, such
 * as a browser built-in failing. The test injects that fault into BigInt so
 * the trigger does not depend on any product defect, and checks that
 * "Reload the page" loads the page again with fresh responses.
 */
test("a render failure shows the page error and Reload the page recovers", async ({
  page,
  diagnostics,
}, info) => {
  // The boundary reports the failure it contains; nothing else may fail.
  diagnostics.allow(
    /^console \[Slop\] render boundary caught an error /u,
    /^console (?:TypeError: )?Injected BigInt fault/u,
  );
  await page.addInitScript((faulty) => {
    const native = globalThis.BigInt;
    const injected = function faultyBigInt(value: string | number | bigint) {
      if (value === faulty) throw new TypeError("Injected BigInt fault");
      return native(value);
    };
    Object.setPrototypeOf(injected, native);
    injected.prototype = native.prototype;
    globalThis.BigInt = injected as BigIntConstructor;
  }, FAULTY_AMOUNT);
  await routeAdminSession(page);
  let reads = 0;
  await page.route("**/api/v1/admin/fee-conversions", (route) => {
    reads += 1;
    return route.fulfill({
      json: report(reads === 1 ? FAULTY_AMOUNT : "12500000"),
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
  await expect(page.getByText("12.5 USDC")).toBeVisible();
  await expect(page).toHaveURL(/\/admin\?section=fees$/u);
  expect(reads).toBe(2);
  await expectAccessible(page);
});

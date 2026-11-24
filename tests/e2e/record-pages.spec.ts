/** Browser contract for /record, /receipts, the program terms pages and /privacy. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { expect, expectAccessibleReflow, test } from "./fixtures";

const { site } = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);
const RECORD = JSON.parse(
  readFileSync(
    join(process.cwd(), "tests/fixtures/public-record.json"),
    "utf8",
  ),
);

type Diagnostics = { allow(...patterns: RegExp[]): void };

/**
 * Serves the build under the site origin, answers /data/record.json and a
 * signed-out session (the header asks for it; the browser reports the 401).
 */
async function serve(
  page: Page,
  diagnostics: Diagnostics,
  record: () => Promise<unknown> | unknown,
) {
  diagnostics.allow(
    /^console Failed to load resource: the server responded with a status of 401 \(Unauthorized\) at .+\/api\/v1\/points\/me$/u,
  );
  await page.route(`${site}/**`, (route) =>
    route.fulfill({
      path: join(
        process.cwd(),
        "dist",
        route.request().resourceType() === "document"
          ? "index.html"
          : new URL(route.request().url()).pathname,
      ),
    }),
  );
  await page.route(`${site}/api/v1/points/me`, (route) =>
    route.fulfill({ status: 401, json: { error: "not_signed_in" } }),
  );
  await page.route(`${site}/data/record.json`, async (route) => {
    const answer = await record();
    return answer === null
      ? route.fulfill({ status: 404, body: "Not found" })
      : route.fulfill({ json: answer });
  });
}

async function noSidewaysScrollAt320(page: Page, name: string) {
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    `${name} scrolls sideways at 320 px`,
  ).toBe(true);
}

test("the record shows money, cycles and pools from /data/record.json", async ({
  page,
  diagnostics,
}) => {
  await serve(page, diagnostics, () => RECORD);
  await page.goto(`${site}/record`, { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", {
      name: "Slop Cash, by the public record.",
      level: 1,
    }),
  ).toBeVisible();
  await expect(page.getByText("Rebuilt Nov 23, 2026")).toBeVisible();
  const money = page.getByRole("table", {
    name: "Money that has reached contributors",
  });
  await expect(money.getByRole("row").last()).toContainText("Total");
  await expect(money).toContainText("$6,004.98");
  await expect(
    page.getByRole("heading", { name: /monthly cycles scored since July/u }),
  ).toBeVisible();
  await expect(page.getByRole("table", { name: "Pools" })).toContainText(
    RECORD.projects[0].name,
  );
  await expect(
    page.getByRole("link", { name: "slop.cash/receipts" }),
  ).toHaveAttribute("href", "/receipts");
  await expect(page.getByText(/models?\b/iu)).toHaveCount(0);
  await expectAccessibleReflow(page, "record");
  await noSidewaysScrollAt320(page, "/record");
  await expect(
    page.getByRole("contentinfo").getByRole("link", { name: "Record" }),
  ).toHaveAttribute("href", "/record");
});

test("a receipt keeps its anchor and links every transaction", async ({
  page,
  diagnostics,
}) => {
  await serve(page, diagnostics, () => RECORD);
  const receipt = RECORD.receipts.items[0];
  await page.goto(`${site}/receipts#${receipt.anchor}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: "Receipts", level: 1 }),
  ).toBeVisible();
  const section = page.locator(`section#${receipt.anchor}`);
  await expect(section).toBeVisible();
  await expect(section.getByRole("heading", { level: 2 })).toHaveText(
    "Feed, October 2026",
  );
  await expect(section).toContainText(`${receipt.total} ${receipt.asset}`);
  await expect(
    section.getByRole("link", { name: receipt.recipients[0].login }),
  ).toHaveAttribute(
    "href",
    `https://github.com/${receipt.recipients[0].login}`,
  );
  await expect(section.getByRole("link", { name: /…/u })).toHaveAttribute(
    "href",
    receipt.recipients[0].transactions[0].url,
  );
  await expectAccessibleReflow(page, "receipts");
  await noSidewaysScrollAt320(page, "/receipts");
});

test("receipts say so when there are none, and when the record cannot load", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allow(
    /^console Failed to load resource: the server responded with a status of 404 \(.+\) at .+\/data\/record\.json$/u,
  );
  let answer: unknown = { ...RECORD, receipts: { builtAt: null, items: [] } };
  await serve(page, diagnostics, () => answer);
  await page.goto(`${site}/receipts`, { waitUntil: "domcontentloaded" });
  await expect(
    page.getByText(
      "The first receipt appears here when a project pays an outside contributor.",
    ),
  ).toBeVisible();
  answer = null;
  await page.goto(`${site}/receipts`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("alert")).toContainText(
    "The receipts could not be loaded. Please try again shortly.",
  );
  answer = RECORD;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.locator(`section#${RECORD.receipts.items[0].anchor}`),
  ).toBeVisible();
});

for (const [path, heading] of [
  ["/referrals", "Project referral program"],
  ["/buyback", "SLOP buyback"],
  ["/october-allocation", "October contributor allocation"],
  ["/sponsored-pools", "Sponsored pools"],
  ["/privacy", "Privacy policy"],
] as const) {
  test(`${path} renders its terms`, async ({ page, diagnostics }) => {
    await serve(page, diagnostics, () => RECORD);
    await page.goto(`${site}${path}`, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: heading, level: 1 }),
    ).toBeVisible();
    await expect(page.locator(".record-stamp")).toContainText("2026");
    await expect(
      page.locator(".record-links").getByRole("link", {
        name: "Slop Cash live record",
      }),
    ).toHaveAttribute("href", "/record");
    await expectAccessibleReflow(page, path.slice(1));
    await noSidewaysScrollAt320(page, path);
  });
}

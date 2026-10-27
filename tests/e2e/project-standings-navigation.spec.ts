/** A fixed project route must win over filters retained by a reused standings view. */
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { cycleIndexFixture } from "../fixtures";
import { expect, expectAccessible, test } from "./fixtures";

const site = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
).site;
const instant = "2026-10-16T12:00:00.000Z";
const contributors = {
  eliza: { id: "101", login: "synthetic-eliza", amount: "111110000" },
  slopdotcash: { id: "202", login: "synthetic-slop", amount: "222220000" },
};

async function fixtures(page: Page, paymentsAvailable = () => true) {
  await page.clock.setFixedTime(new Date(instant));
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
  // Preview has no executable agent discovery; D1 coverage is in registry.spec.ts.
  await page.route("**/.well-known/slop/projects.json", (route) =>
    route.fulfill({ json: { schemaVersion: "1", projects: [] } }),
  );
  await page.route("**/data/cycles/index.json*", (route) =>
    route.fulfill({ json: cycleIndexFixture() }),
  );
  await page.route("**/api/v1/points/**", (route) =>
    route.fulfill({ json: null }),
  );
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  await page.route("**/api/v1/slopbot/summary", (route) =>
    route.fulfill({ json: { repositories: [] } }),
  );
  await page.route("https://avatars.githubusercontent.com/**", (route) =>
    route.fulfill({ path: join(process.cwd(), "public/slop-mark.svg") }),
  );
  await page.route(
    "**/api/v1/payments/projects/*/direct-transfers",
    (route) => {
      if (!paymentsAvailable())
        return route.fulfill({
          status: 503,
          body: "Payment source unavailable",
        });
      const projectId = new URL(route.request().url()).pathname.split("/")[5];
      const actor = contributors[projectId as keyof typeof contributors];
      return route.fulfill({
        json: {
          totalMicro: actor?.amount ?? "0",
          transfers: actor
            ? [
                {
                  projectId,
                  githubUserId: actor.id,
                  login: actor.login,
                  amountMicro: actor.amount,
                  contributionMonth: "2026-10",
                  network: "base-sepolia",
                  chain: "base",
                  recipient: "synthetic-recipient",
                  transactionId: `synthetic-${projectId}`,
                  blockTime: instant,
                },
              ]
            : [],
        },
      });
    },
  );
}

test("Money received standings preserve unavailable data and recover on retry", async ({
  diagnostics,
  page,
}, info) => {
  // The payment source outage asserted below.
  diagnostics.allow(
    /^console Failed to load resource: the server responded with a status of 503 .*\/direct-transfers$/u,
  );
  let available = false;
  const failures: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400)
      failures.push(`${response.status()} ${response.url()}`);
  });
  await fixtures(page, () => available);
  await page.goto(`${site}/points?sort=money&period=lifetime`);
  const standings = page.getByRole("region", {
    name: "Contributor standings",
    exact: true,
  });
  await expect(
    standings.getByText("Payment records unavailable."),
  ).toBeVisible();
  await expect(standings.locator("tbody tr")).toHaveCount(0);
  await expect(
    standings.getByText("No contributors match this view."),
  ).toHaveCount(0);
  expect(failures.length).toBeGreaterThan(0);
  expect(
    failures.every(
      (failure) =>
        failure.startsWith("503 ") && failure.endsWith("/direct-transfers"),
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("payments-unavailable.png") });
  // Other metrics remain usable while the independent payment source fails.
  await standings.getByRole("button", { name: "Points", exact: true }).click();
  await expect(standings.locator("tbody tr").first()).toBeVisible();
  await expect(
    standings.locator("tbody tr").first().locator("td").last(),
  ).toHaveText("Unavailable");
  await standings
    .getByRole("button", { name: "Money received", exact: true })
    .click();
  available = true;
  failures.length = 0;
  const retry = standings.getByRole("button", {
    name: "Retry payment records",
  });
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(
    standings.getByRole("row").filter({ hasText: "synthetic-slop" }),
  ).toContainText("$222.22");
  await expect(
    standings.getByRole("row").filter({ hasText: "synthetic-eliza" }),
  ).toContainText("$111.11");
  await expect(standings.locator("tbody tr").first()).toContainText(
    "synthetic-slop",
  );
  await expect(retry).toHaveCount(0);
  expect(failures).toEqual([]);
  await page.screenshot({ path: info.outputPath("payments-recovered.png") });
  await expectAccessible(page);
});

test("history navigation keeps contributor standings scoped to the current project", async ({
  page,
}, info) => {
  await fixtures(page);
  await page.goto(`${site}/projects/slopdotcash?sort=money&period=lifetime`);
  const standings = page.getByRole("region", {
    name: "Contributor standings",
    exact: true,
  });
  const slop = standings.getByRole("row").filter({ hasText: "synthetic-slop" });
  const eliza = standings
    .getByRole("row")
    .filter({ hasText: "synthetic-eliza" });
  await expect(slop).toContainText("$222.22");
  await expect(eliza).toHaveCount(0);
  await standings.scrollIntoViewIfNeeded();
  const document = await page.evaluate(() => performance.timeOrigin);
  await page
    .getByRole("main")
    .getByRole("link", { name: "Projects", exact: true })
    .click();
  await page.locator('a.project-card[href="/projects/eliza"]').click();
  await standings
    .getByRole("button", { name: "Money received", exact: true })
    .click();
  await expect(eliza).toContainText("$111.11");
  await page.evaluate(() => history.go(-2));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Slop");
  await standings.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("returned-to-slop.png"),
    fullPage: true,
  });
  await info.attach("returned-project-standings", {
    body: JSON.stringify({
      route: page.url(),
      text: await standings.innerText(),
    }),
    contentType: "application/json",
  });
  await expect(slop).toContainText("$222.22");
  await expect(eliza).toHaveCount(0);
  await expectAccessible(page);
  await page.evaluate(() => history.go(2));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Eliza");
  await expect(eliza).toContainText("$111.11");
  await expect(slop).toHaveCount(0);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(document);
});

test("global standings still accept project, sort and contributor filters", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto(`${site}/points?sort=money&period=lifetime&project=eliza`);
  const standings = page.getByRole("region", {
    name: "Contributor standings",
    exact: true,
  });
  const project = standings.getByLabel("Project", { exact: true });
  await expect(project).toHaveValue("eliza");
  await expect(
    standings.getByRole("row").filter({ hasText: "synthetic-eliza" }),
  ).toContainText("$111.11");
  await expect(
    standings.getByRole("row").filter({ hasText: "synthetic-slop" }),
  ).toHaveCount(0);
  await project.selectOption("slopdotcash");
  await expect(
    standings.getByRole("row").filter({ hasText: "synthetic-slop" }),
  ).toContainText("$222.22");
  await expect(
    standings.getByRole("row").filter({ hasText: "synthetic-eliza" }),
  ).toHaveCount(0);
  await project.selectOption("");
  await expect(
    standings.getByRole("row").filter({ hasText: "synthetic-eliza" }),
  ).toBeVisible();
  await page.getByLabel("Find a contributor").fill("synthetic-slop");
  await expect(
    standings.getByRole("row").filter({ hasText: "synthetic-eliza" }),
  ).toHaveCount(0);
  await expect(
    standings.getByRole("row").filter({ hasText: "synthetic-slop" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/q=synthetic-slop/);
  await standings.getByRole("button", { name: "Points", exact: true }).click();
  await expect(
    standings.getByRole("columnheader", { name: "Points", exact: true }),
  ).toHaveAttribute("aria-sort", "descending");
  await standings
    .getByRole("button", { name: "Money received", exact: true })
    .click();
  await expect(
    standings.getByRole("columnheader", {
      name: "Money received",
      exact: true,
    }),
  ).toHaveAttribute("aria-sort", "descending");
  await expect(page).toHaveURL(/sort=money/);
  await expectAccessible(page);
});

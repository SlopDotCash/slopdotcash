/** Route identity must hold even between the render and passive effects. */
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import type { DirectTransfer } from "../../src/lib/payments/contracts";
import { cycleIndexFixture, snapshotFixture } from "../fixtures";
import { expect, expectAccessible, test } from "./fixtures";

const site = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
).site;
const firstProject = "eliza";
const nextProject = "slopdotcash";
const firstAmount = "$111.11 paid directly";
const nextAmount = "$222.22 paid directly";

function payments(projectId: string) {
  const transfer: DirectTransfer = {
    projectId,
    contributionMonth: projectId === firstProject ? "2026-07" : "2026-08",
    githubUserId: "1",
    login: "synthetic-contributor",
    network: "base-sepolia",
    chain: "base",
    recipient: "synthetic-recipient",
    amountMicro: projectId === firstProject ? "111110000" : "222220000",
    transactionId: `synthetic-${projectId}-transfer`,
    blockTime: "2026-09-01T00:00:00.000Z",
  };
  return { transfers: [transfer], totalMicro: transfer.amountMicro };
}

function gate() {
  let release = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release };
}

async function fixtures(page: Page) {
  await page.route(`${site}/**`, (route) =>
    // Money received falls back to the shared empty aggregate (fixtures.ts).
    new URL(route.request().url()).pathname === "/api/v1/payments/received"
      ? route.fallback()
      : route.fulfill({
          path: join(
            process.cwd(),
            "dist",
            route.request().resourceType() === "document"
              ? "index.html"
              : new URL(route.request().url()).pathname,
          ),
        }),
  );
  await page.route("**/data/leaderboard.json?**", (route) =>
    route.fulfill({ json: snapshotFixture() }),
  );
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
}

test("project history previews recent payments and retains every older record", async ({
  page,
}, info) => {
  await fixtures(page);
  const transfers = ["02", "03", "04", "05", "06"].map((month, index) => ({
    ...payments(firstProject).transfers[0],
    contributionMonth: `2026-${month}`,
    amountMicro: String((index + 1) * 1000000),
    transactionId: `synthetic-history-${month}`,
    blockTime: `2026-${month}-28T00:00:00.000Z`,
  }));
  await page.route("**/api/v1/payments/projects/*/direct-transfers", (route) =>
    route.fulfill({ json: { transfers, totalMicro: "15000000" } }),
  );
  await page.goto(`${site}/projects/${firstProject}`);
  const history = page.locator(".payment-history");
  const rows = history.locator(".money-summary");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText("$5 paid directly");
  const expand = history.getByRole("button", {
    name: "Show complete payment history",
  });
  await expand.focus();
  await page.keyboard.press("Enter");
  await expect(rows).toHaveCount(5);
  await expect(rows.last()).toContainText("$1 paid directly");
  await expect(
    rows.last().getByRole("link", { name: "Disclosure" }),
  ).toHaveAttribute(
    "href",
    `${site}/api/v1/payments/projects/${firstProject}/direct-transfers`,
  );
  await expectAccessible(page, { include: ".payment-history" });
  await page.screenshot({
    path: info.outputPath("project-history-expanded.png"),
    fullPage: true,
  });
  await history.getByRole("button", { name: "Show recent history" }).click();
  await expect(rows).toHaveCount(3);
});

async function watchPaymentIdentity(page: Page) {
  await page.evaluate(
    ({ firstAmount, nextProject }) => {
      const observations: object[] = [];
      const leaks: object[] = [];
      const observer = new MutationObserver((records) => {
        const history = document.querySelector(".payment-history");
        const projectName = document.querySelector("main h1")?.textContent;
        const text = history?.textContent ?? "";
        const sample = {
          at: performance.now(),
          path: location.pathname,
          projectName,
          text,
          disclosures: [...(history?.querySelectorAll("a") ?? [])]
            .filter((a) => a.textContent === "Disclosure")
            .map((a) => a.href),
        };
        observations.push(sample);
        if (projectName === "Slop" && text.includes(firstAmount))
          leaks.push(sample);
        // A passive-effect update can remove the wrong row before this
        // callback. Mutation records still retain that actual DOM node.
        for (const record of records) {
          if (!(record.target instanceof HTMLAnchorElement)) continue;
          const link = record.target;
          const row = link.closest(".money-summary");
          if (
            link.textContent === "Disclosure" &&
            link.href.endsWith(
              `/api/v1/payments/projects/${nextProject}/direct-transfers`,
            ) &&
            row?.textContent?.includes(firstAmount)
          )
            leaks.push({ ...sample, mutatedRow: row.outerHTML });
        }
      });
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["href"],
      });
      Object.assign(window, {
        paymentNavigation: { observations, leaks, observer },
      });
    },
    { firstAmount, nextProject },
  );
}

for (const navigation of ["project links", "browser history"] as const) {
  test(`direct payments keep project identity through ${navigation}`, async ({
    context,
    page,
  }, info) => {
    await fixtures(page);
    const nextResponse = gate();
    let nextRequests = 0;
    let holdNext = false;
    await page.route(
      "**/api/v1/payments/projects/*/direct-transfers",
      async (route) => {
        const project = new URL(route.request().url()).pathname.split("/")[5];
        if (project === nextProject) {
          nextRequests++;
          if (holdNext) await nextResponse.ready;
        }
        await route.fulfill({ json: payments(project) });
      },
    );
    try {
      if (navigation === "browser history") {
        await page.goto(`${site}/projects/${nextProject}`);
        await expect(page.getByText(nextAmount, { exact: true })).toBeVisible();
        await page
          .getByRole("banner")
          .getByRole("link", { name: "Slop home", exact: true })
          .click();
        await page
          .locator(`a.project-card[href="/projects/${firstProject}"]`)
          .click();
      } else await page.goto(`${site}/projects/${firstProject}`);
      await expect(page.getByText(firstAmount, { exact: true })).toBeVisible();
      await expect(
        page
          .locator(".payment-history")
          .getByRole("link", { name: "Disclosure" }),
      ).toHaveAttribute(
        "href",
        `${site}/api/v1/payments/projects/${firstProject}/direct-transfers`,
      );
      await watchPaymentIdentity(page);
      const documentToken = await page.evaluate(() => performance.timeOrigin);
      const beforeNavigation = nextRequests;
      holdNext = true;
      if (navigation === "browser history")
        await page.evaluate(() => window.history.go(-2));
      else {
        await page
          .getByRole("banner")
          .getByRole("link", { name: "Slop home", exact: true })
          .click();
        await page
          .locator(`a.project-card[href="/projects/${nextProject}"]`)
          .click();
      }
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Slop");
      await expect.poll(() => nextRequests).toBeGreaterThan(beforeNavigation);
      await expect(page.getByText(firstAmount, { exact: true })).toHaveCount(0);
      await page.screenshot({
        path: info.outputPath("next-project-pending.png"),
      });
      nextResponse.release();
      await expect(page.getByText(nextAmount, { exact: true })).toBeVisible();
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(
        documentToken,
      );
      const observed = await page.evaluate(() => {
        const value = (
          window as unknown as {
            paymentNavigation: {
              observations: object[];
              leaks: object[];
              observer: MutationObserver;
            };
          }
        ).paymentNavigation;
        value.observer.disconnect();
        return { observations: value.observations, leaks: value.leaks };
      });
      await info.attach("payment-dom-observations", {
        body: JSON.stringify(observed, null, 2),
        contentType: "application/json",
      });
      expect(
        observed.leaks,
        "A's amount must never acquire B's route or disclosure identity",
      ).toEqual([]);
      const disclosure = page
        .locator(".payment-history")
        .getByRole("link", { name: "Disclosure" });
      const disclosureUrl = `${site}/api/v1/payments/projects/${nextProject}/direct-transfers`;
      await expect(disclosure).toHaveAttribute("href", disclosureUrl);
      const summary = page.locator(".payment-history .money-summary");
      await expect(summary.locator("strong")).toHaveText(nextAmount);
      await expect(summary.locator("span")).toContainText(
        /Sep 1, 2026.*August 2026/u,
      );
      await page.screenshot({
        path: info.outputPath("direct-payment-disclosure.png"),
        fullPage: true,
      });
      // The first popup navigation is routed at context scope, unlike the
      // original page's API fixtures. Follow the actual keyboard-opened link.
      await context.route(disclosureUrl, (route) =>
        route.fulfill({ json: payments(nextProject) }),
      );
      await disclosure.focus();
      const [popup, response] = await Promise.all([
        page.waitForEvent("popup"),
        context.waitForEvent("response", {
          predicate: (response) => response.url() === disclosureUrl,
        }),
        page.keyboard.press("Enter"),
      ]);
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual(payments(nextProject));
      await expect(popup).toHaveURL(disclosureUrl);
      await popup.close();
    } finally {
      nextResponse.release();
    }
  });
}

test("a late previous payment request cannot overwrite a retried project", async ({
  diagnostics,
  page,
}, info) => {
  // The synthetic outage below is the only failure the browser reports.
  const outageReport =
    /^console Failed to load resource: the server responded with a status of 503 \(Service Unavailable\) at https:\/\/[^ ]+\/api\/v1\/payments\/projects\/[^/ ]+\/direct-transfers$/u;
  diagnostics.allow(outageReport);
  await fixtures(page);
  const previousResponse = gate();
  const previousFulfilled = gate();
  let previousRequests = 0;
  let nextRequests = 0;
  let outage = false;
  await page.route(
    "**/api/v1/payments/projects/*/direct-transfers",
    async (route) => {
      const project = new URL(route.request().url()).pathname.split("/")[5];
      if (project === firstProject) {
        previousRequests++;
        await previousResponse.ready;
        await route.fulfill({ json: payments(project) });
        previousFulfilled.release();
      } else if (project === nextProject && outage) {
        nextRequests++;
        await route.fulfill({
          status: 503,
          json: { error: "Synthetic outage" },
        });
      } else {
        if (project === nextProject) nextRequests++;
        await route.fulfill({ json: payments(project) });
      }
    },
  );
  try {
    await page.goto(`${site}/projects/${nextProject}`);
    await expect(page.getByText(nextAmount, { exact: true })).toBeVisible();
    await page
      .getByRole("banner")
      .getByRole("link", { name: "Slop home", exact: true })
      .click();
    await page
      .locator(`a.project-card[href="/projects/${firstProject}"]`)
      .click();
    await expect.poll(() => previousRequests).toBeGreaterThan(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Eliza");
    await watchPaymentIdentity(page);
    const canceled = page.waitForEvent("requestfailed", (request) =>
      request.url().endsWith(`/projects/${firstProject}/direct-transfers`),
    );
    outage = true;
    await page.evaluate(() => window.history.go(-2));
    await canceled;
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Slop");
    const retry = page.getByRole("button", { name: "Retry direct payments" });
    await expect(retry).toBeVisible();
    await expect(page.getByText(nextAmount, { exact: true })).toHaveCount(0);
    await expect(page.getByText(firstAmount, { exact: true })).toHaveCount(0);
    outage = false;
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(nextAmount, { exact: true })).toBeVisible();
    await expect(retry).toHaveCount(0);
    previousResponse.release();
    await previousFulfilled.ready;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page.getByText(firstAmount, { exact: true })).toHaveCount(0);
    await expect(page.getByText(nextAmount, { exact: true })).toBeVisible();
    await expect(
      page.locator(".payment-history a").filter({ hasText: "Disclosure" }),
    ).toHaveAttribute(
      "href",
      `${site}/api/v1/payments/projects/${nextProject}/direct-transfers`,
    );
    const observed = await page.evaluate(() => {
      const value = (
        window as unknown as {
          paymentNavigation: {
            observations: object[];
            leaks: object[];
            observer: MutationObserver;
          };
        }
      ).paymentNavigation;
      value.observer.disconnect();
      return { observations: value.observations, leaks: value.leaks };
    });
    await info.attach("payment-dom-observations", {
      body: JSON.stringify(observed, null, 2),
      contentType: "application/json",
    });
    expect(observed.leaks).toEqual([]);
    expect(previousRequests).toBeGreaterThan(0);
    expect(nextRequests).toBeGreaterThanOrEqual(3);
    expect(diagnostics.count(outageReport)).toBeGreaterThan(0);
  } finally {
    previousResponse.release();
  }
});

test("public project navigation does not load an agent-only flag form", async ({
  page,
}) => {
  await fixtures(page);
  await page.route("**/api/v1/payments/projects/*/direct-transfers", (route) =>
    route.fulfill({ json: { transfers: [], totalMicro: "0" } }),
  );
  const flagReads: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/project-flags/"))
      flagReads.push(request.url());
  });
  await page.goto(`${site}/projects/${nextProject}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Slop");
  await expect(page.locator(".project-risk-flag")).toHaveCount(0);
  await page
    .getByRole("banner")
    .getByRole("link", { name: "Slop home", exact: true })
    .click();
  await page
    .locator(`a.project-card[href="/projects/${firstProject}"]`)
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Eliza");
  await expect(page.locator(".project-risk-flag")).toHaveCount(0);
  expect(flagReads).toEqual([]);
});

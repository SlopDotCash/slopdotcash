/** Route identity must hold even between the render and passive effects. */
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import type { DirectTransfer } from "../../src/lib/payments/contracts";
import { cycleIndexFixture, snapshotFixture } from "../fixtures";
import { expect, test } from "./fixtures";

const site = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
).site;
const firstProject = "eliza";
const nextProject = "asi";
const firstAmount = "$111.11 paid directly";
const nextAmount = "$222.22 paid directly";

function payments(projectId: string) {
  const transfer: DirectTransfer = {
    projectId,
    // Both fixtures use retained August 2026 disclosure months so the
    // Disclosure link stays present for identity-leak observations.
    contributionMonth: "2026-08",
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

async function watchPaymentIdentity(page: Page) {
  await page.evaluate(
    ({ firstAmount, nextProject }) => {
      const observations: object[] = [];
      const leaks: object[] = [];
      const observer = new MutationObserver((records) => {
        const history = document.querySelector(".payment-history");
        const breadcrumb = document.querySelector(".breadcrumb")?.textContent;
        const text = history?.textContent ?? "";
        const sample = {
          at: performance.now(),
          path: location.pathname,
          breadcrumb,
          text,
          disclosures: [...(history?.querySelectorAll("a") ?? [])]
            .filter((a) => a.textContent === "Disclosure")
            .map((a) => a.href),
        };
        observations.push(sample);
        if (breadcrumb?.endsWith("Slop") && text.includes(firstAmount))
          leaks.push(sample);
        // A passive-effect update can remove the wrong row before this
        // callback. Mutation records still retain that actual DOM node.
        for (const record of records) {
          if (!(record.target instanceof HTMLAnchorElement)) continue;
          const link = record.target;
          const row = link.closest(".money-summary");
          if (
            link.textContent === "Disclosure" &&
            link.href.includes(`/disclosures/${nextProject}-2026-08-`) &&
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
          .locator(".breadcrumb")
          .getByRole("link", { name: "Projects", exact: true })
          .click();
        await page
          .locator(`a.project-card[href="/projects/${firstProject}"]`)
          .click();
      } else await page.goto(`${site}/projects/${firstProject}`);
      await expect(page.getByText(firstAmount, { exact: true })).toBeVisible();
      await watchPaymentIdentity(page);
      const documentToken = await page.evaluate(() => performance.timeOrigin);
      const beforeNavigation = nextRequests;
      holdNext = true;
      if (navigation === "browser history")
        await page.evaluate(() => window.history.go(-2));
      else {
        await page
          .locator(".breadcrumb")
          .getByRole("link", { name: "Projects", exact: true })
          .click();
        await page
          .locator(`a.project-card[href="/projects/${nextProject}"]`)
          .click();
      }
      await expect(page.locator(".breadcrumb")).toHaveText("Projects/ASI");
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
      .locator(".breadcrumb")
      .getByRole("link", { name: "Projects", exact: true })
      .click();
    await page
      .locator(`a.project-card[href="/projects/${firstProject}"]`)
      .click();
    await expect.poll(() => previousRequests).toBeGreaterThan(0);
    await expect(page.locator(".breadcrumb")).toHaveText("Projects/Eliza");
    await watchPaymentIdentity(page);
    const canceled = page.waitForEvent("requestfailed", (request) =>
      request.url().endsWith(`/projects/${firstProject}/direct-transfers`),
    );
    outage = true;
    await page.evaluate(() => window.history.go(-2));
    await canceled;
    await expect(page.locator(".breadcrumb")).toHaveText("Projects/ASI");
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
      /\/blob\/eae9fbab8403ec70d79c5397d16afb4928050b1d\/disclosures\/asi-2026-08-direct-payments\.json$/,
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

test("a flag draft does not follow browser history to another project", async ({
  page,
}) => {
  await fixtures(page);
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "4242", githubLogin: "member", admin: false },
      },
    }),
  );
  await page.route("**/api/v1/payments/projects/*/direct-transfers", (route) =>
    route.fulfill({ json: { transfers: [], totalMicro: "0" } }),
  );
  const pending = gate();
  let hold = false;
  let held = false;
  await page.route("**/api/v1/project-flags/*", async (route) => {
    if (
      hold &&
      new URL(route.request().url()).pathname.endsWith(`/${nextProject}`)
    ) {
      held = true;
      await pending.ready;
    }
    await route.fulfill({
      json: { flag: null, restriction: "clear", pausedByFlags: false },
    });
  });
  try {
    await page.goto(`${site}/projects/${nextProject}`);
    await page
      .locator(".breadcrumb")
      .getByRole("link", { name: "Projects", exact: true })
      .click();
    await page
      .locator(`a.project-card[href="/projects/${firstProject}"]`)
      .click();
    await page
      .getByText("Report malicious code in this project", { exact: true })
      .click();
    await page
      .getByRole("textbox", { name: /^Evidence/u })
      .fill("Evidence for the first project only");
    hold = true;
    await page.evaluate(() => window.history.go(-2));
    await expect(page.locator(".breadcrumb")).toHaveText("Projects/ASI");
    await expect.poll(() => held).toBe(true);
    await expect(page.getByRole("textbox", { name: /^Evidence/u })).toHaveCount(
      0,
    );
    pending.release();
    await page
      .getByText("Report malicious code in this project", { exact: true })
      .click();
    await expect(page.getByRole("textbox", { name: /^Evidence/u })).toHaveValue(
      "",
    );
  } finally {
    pending.release();
  }
});

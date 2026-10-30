import { join } from "node:path";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { expectHeaderRow } from "../header-row";
import { expect, expectAccessible, test } from "./fixtures";

const deployment = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);

test(
  "serves GitHub login on direct navigation and reload",
  { tag: ["@pages"] },
  async ({ page }, info) => {
    expect((await page.goto("/login"))?.status()).toBe(200);
    expect((await page.reload())?.status()).toBe(200);
    await expect(page.locator("main h1, main h2")).toHaveCount(1);
    const header = page.getByRole("banner");
    await expect(
      header.getByRole("link", { name: "Log in", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", {
        name: `Continue with GitHub on ${new URL(deployment.site).hostname}`,
      }),
    ).toHaveAttribute("href", `${deployment.site}/login`);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => document.activeElement !== document.body),
    ).toBe(true);
    await page.evaluate(() => document.fonts.ready);
    await expectAccessible(page);
    await page.screenshot({
      path: info.outputPath("login.png"),
      fullPage: true,
    });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  },
);

// Explicit identity and membership doubles; this proves the browser return
// route, not live GitHub OAuth.
for (const [next, expected] of [
  [
    "/projects/new?step=2#draft",
    `${deployment.site}/projects/new?step=2#draft`,
  ],
  ["//evil.example/steal", `${deployment.site}/contributors/return-member`],
  ["/.//evil.example/steal", `${deployment.site}/contributors/return-member`],
  [
    "/foo/..//evil.example/steal",
    `${deployment.site}/contributors/return-member`,
  ],
  [
    "/%2e%2e//evil.example/steal",
    `${deployment.site}/contributors/return-member`,
  ],
  ["earnings", `${deployment.site}/earnings`],
]) {
  test(`login returns ${next} to a safe destination`, async ({
    diagnostics,
    page,
  }) => {
    diagnostics.allowPreviewApiMisses();
    // The signed-out membership read before sign-in.
    diagnostics.allow(
      /^console Failed to load resource: the server responded with a status of 401 \(Unauthorized\) at https:\/\/[^ ]+\/api\/v1\/points\/me$/u,
    );
    // The signed-in identity is synthetic; keep its avatar local as well.
    await page.route("https://avatars.githubusercontent.com/**", (route) =>
      route.fulfill({ path: join(process.cwd(), "public/slop-mark.svg") }),
    );
    const expiresAt = new Date(
      Math.floor(Date.now() / 1000) * 1000 + 240_000,
    ).toISOString();
    const flowId = `flow_${"f".repeat(24)}`;
    let signedIn = false;
    let starts = 0;
    const member = {
      actor: { id: "U_return_member", login: "return-member" },
      joinedAt: "2026-10-01T00:00:00.000Z",
      public: true,
      welcome: 5,
      socialPoints: 0,
    };
    await page.context().route(`${deployment.identity}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/v1/oauth/start") {
        starts += 1;
        await route.fulfill({
          json: {
            flowId,
            pollCapability: "p".repeat(48),
            expiresAt,
            pollAfterSeconds: 1,
            authorizationUrl: `${deployment.identity}/v1/oauth/authorize?flow_id=${flowId}&state=${"s".repeat(48)}`,
          },
        });
      } else if (path === "/v1/oauth/authorize")
        await route.fulfill({
          contentType: "text/html",
          body: "<title>Synthetic OAuth fixture</title>",
        });
      else
        await route.fulfill({
          json: {
            status: "complete",
            assertionType: "SlopIdentity",
            assertion: `slop_assert_v1_${"a".repeat(48)}`,
            expiresAt,
          },
        });
    });
    await page.route(`${deployment.site}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/v1/points/me") {
        if (signedIn) await route.fulfill({ json: member });
        else await route.fulfill({ status: 401, json: {} });
        return;
      }
      if (url.pathname === "/api/v1/points/join") {
        expect(route.request().postDataJSON().public).toBe(true);
        signedIn = true;
        await route.fulfill({ json: member });
        return;
      }
      if (url.pathname === "/api/v1/notifications/email") {
        await route.fulfill({
          json: {
            enabled: false,
            securityEnabled: false,
            enrollmentAvailable: false,
            pending: null,
            availability: "unverified",
          },
        });
        return;
      }
      if (url.pathname === "/api/v1/payments/me") {
        await route.fulfill({
          json: {
            githubUserId: "123",
            wallets: [],
            payments: [],
            monthlyAwards: [],
            balances: [],
            directTransfers: [],
            walletObservations: [],
          },
        });
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        await route.fulfill({ status: 404, json: {} });
        return;
      }
      await route.fulfill({
        path: join(
          process.cwd(),
          "dist",
          route.request().resourceType() === "document"
            ? "index.html"
            : url.pathname,
        ),
      });
    });
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await page
      .getByRole("link", {
        name: `Continue with GitHub on ${new URL(deployment.site).hostname}`,
      })
      .click();
    const main = page.getByRole("main");
    await expect(main.locator("h1, h2")).toHaveCount(1);
    const action = main.getByRole("button", { name: "Continue with GitHub" });
    await expect(main.getByRole("checkbox")).toHaveCount(0);
    await expect(
      main.getByText(
        "Signing in makes your Slop membership and any connected X profile link public.",
        { exact: true },
      ),
    ).toBeVisible();
    const popup = page.waitForEvent("popup");
    await action.click();
    await (await popup).close();
    await expect(page).toHaveURL(expected);
    await page.goto(`${deployment.site}/account`);
    // Signed in, Settings contains wallets and email without a sign-in or
    // Connections panel.
    const wallets = page.getByRole("region", { name: "Wallets", exact: true });
    const email = page.getByRole("region", {
      name: "Email preferences",
      exact: true,
    });
    await expect(wallets).toBeVisible();
    await expect(email).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Connections", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator("#profile")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Continue with GitHub", exact: true }),
    ).toHaveCount(0);
    // Membership is always public, so the account page offers no visibility choice.
    await expect(page.getByRole("main").getByRole("checkbox")).toHaveCount(0);
    await page.reload();
    await expect(wallets).toBeVisible();
    await expect(email).toBeVisible();
    await expect(page.locator("#profile")).toHaveCount(0);
    await page.goto(
      `${deployment.site}/login?next=${encodeURIComponent(next)}`,
    );
    await expect(page).toHaveURL(expected);
    expect(starts).toBe(1);
    // The destination keeps loading public data after the assertion. Let it
    // finish through the local routes, then leave it, so no request reaches
    // the deployed site.
    await page.waitForLoadState("networkidle");
    await page.goto("about:blank");
  });
}

test("the header login link keeps the current page as the return route", async ({
  page,
}) => {
  await page.goto("/how-it-works#faq");
  const link = page
    .getByRole("banner")
    .getByRole("link", { name: "Log in", exact: true });
  await expectHeaderRow(page, link);
  await expect(link).toHaveAttribute(
    "href",
    `${deployment.site}/login?next=${encodeURIComponent("/how-it-works#faq")}`,
  );
  await page.evaluate(() => {
    window.location.hash = "verification";
  });
  await expect(link).toHaveAttribute(
    "href",
    `${deployment.site}/login?next=${encodeURIComponent("/how-it-works#verification")}`,
  );
  await page.evaluate(() => {
    window.location.hash = "faq";
  });
  await expect(link).toHaveAttribute(
    "href",
    `${deployment.site}/login?next=${encodeURIComponent("/how-it-works#faq")}`,
  );
  await page.route(`${deployment.site}/login?**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Public login destination fixture</title>",
    }),
  );
  await link.click();
  await expect(page).toHaveURL(
    `${deployment.site}/login?next=${encodeURIComponent("/how-it-works#faq")}`,
  );
});

test("a cancelled pending sign-in lets the user start again", async ({
  diagnostics,
  page,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allow(
    /^console Failed to load resource: the server responded with a status of 401 \(Unauthorized\) at https:\/\/[^ ]+\/api\/v1\/points\/me$/u,
  );
  const expiresAt = new Date(Date.now() + 240_000).toISOString();
  const flowId = `flow_${"f".repeat(24)}`;
  let starts = 0;
  let joins = 0;
  await page.context().route(`${deployment.identity}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/oauth/start") {
      starts += 1;
      await route.fulfill({
        json: {
          flowId,
          pollCapability: "p".repeat(48),
          expiresAt,
          pollAfterSeconds: 1,
          authorizationUrl: `${deployment.identity}/v1/oauth/authorize?flow_id=${flowId}&state=${"s".repeat(48)}`,
        },
      });
    } else if (path === "/v1/oauth/authorize") {
      await route.fulfill({
        contentType: "text/html",
        body: "<title>Pending OAuth fixture</title>",
      });
    } else {
      await route.fulfill({
        status: 202,
        json: { status: "pending", retryAfterSeconds: 1 },
      });
    }
  });
  await page.route(`${deployment.site}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/points/join") joins += 1;
    if (url.pathname.startsWith("/api/")) {
      await route.fulfill({ status: 401, json: {} });
      return;
    }
    await route.fulfill({
      path: join(
        process.cwd(),
        "dist",
        route.request().resourceType() === "document"
          ? "index.html"
          : url.pathname,
      ),
    });
  });
  await page.goto(`${deployment.site}/login`);
  for (const attempt of [1, 2]) {
    const popupEvent = page.waitForEvent("popup");
    await page
      .getByRole("button", { name: "Continue with GitHub", exact: true })
      .click();
    const popup = await popupEvent;
    await expect(popup).toHaveURL(/\/v1\/oauth\/authorize\?/u);
    await popup.close();
    const cancel = page.getByRole("button", {
      name: "Cancel sign-in",
      exact: true,
    });
    await cancel.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue with GitHub", exact: true }),
    ).toBeEnabled();
    expect(starts).toBe(attempt);
    expect(joins).toBe(0);
  }
  await expect(
    page.getByRole("button", { name: "Cancel sign-in", exact: true }),
  ).toHaveCount(0);
  await page.goto("about:blank");
});

test("a refused sign-in names its next action and closes the blank popup", async ({
  diagnostics,
  page,
  baseURL,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allow(
    /^console Failed to load resource: the server responded with a status of 401 \(Unauthorized\) at https:\/\/[^ ]+\/api\/v1\/points\/me$/u,
    /^console Failed to load resource: the server responded with a status of (?:410|429|503) \([^)]*\) at https:\/\/[^ ]+\/v1\/oauth\/(?:start|poll)$/u,
  );
  const expiresAt = new Date(
    Math.floor(Date.now() / 1000) * 1000 + 240_000,
  ).toISOString();
  const flowId = `flow_${"f".repeat(24)}`;
  const starts = [429, 503, 201, 201];
  let polls = 0;
  await page.context().route(`${deployment.identity}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/oauth/start") {
      const status = starts.shift();
      if (status === 429)
        await route.fulfill({
          status,
          headers: { "retry-after": "60" },
          json: {
            error: "rate_limited",
            message: "Too many requests. Try again later.",
          },
        });
      else if (status === 503)
        await route.fulfill({
          status,
          headers: { "retry-after": "60" },
          json: {
            error: "service_unavailable",
            message: "Identity service is temporarily unavailable.",
          },
        });
      else
        await route.fulfill({
          status,
          json: {
            flowId,
            pollCapability: "p".repeat(48),
            expiresAt,
            pollAfterSeconds: 1,
            authorizationUrl: `${deployment.identity}/v1/oauth/authorize?flow_id=${flowId}&state=${"s".repeat(48)}`,
          },
        });
    } else if (path === "/v1/oauth/authorize")
      await route.fulfill({
        contentType: "text/html",
        body: "<title>Synthetic OAuth fixture</title>",
      });
    else {
      polls += 1;
      await route.fulfill({
        status: 410,
        json: {
          error: polls === 1 ? "flow_unavailable" : "callback_failed",
          message: "Identity flow is unavailable",
        },
      });
    }
  });
  await page.route(`${deployment.site}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/points/me") {
      await route.fulfill({ status: 401, json: {} });
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await route.fulfill({ status: 404, json: {} });
      return;
    }
    const response = await route.fetch({
      url: `${baseURL}${url.pathname}${url.search}`,
    });
    await route.fulfill({ response });
  });
  await page.goto(`${deployment.site}/login`);
  const main = page.getByRole("main");
  const action = main.getByRole("button", { name: "Continue with GitHub" });
  const status = main.getByRole("status");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const popup = page.waitForEvent("popup");
    await action.click();
    const opened = await popup;
    await expect(status).toBeVisible();
    await expect.poll(() => opened.isClosed()).toBe(true);
    await expect(action).toBeEnabled();
    await expectAccessible(page);
  }
  // Ended flows keep GitHub's page and distinguish expiry from callback failure.
  for (const reason of ["expired", "failed"]) {
    const popup = page.waitForEvent("popup");
    await action.click();
    const authorizing = await popup;
    await expect(status).toHaveText(`Sign-in ${reason}. Please start again.`);
    await expect(action).toBeEnabled();
    await expectAccessible(page);
    await page.screenshot({
      path: test.info().outputPath(`signin-refusal-${reason}.png`),
      fullPage: true,
    });
    expect(authorizing.isClosed()).toBe(false);
    await authorizing.close();
  }
  expect(starts).toEqual([]);
  expect(polls).toBe(2);
});

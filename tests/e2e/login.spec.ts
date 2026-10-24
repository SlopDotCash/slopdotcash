import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";

const deployment = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);

test(
  "serves GitHub login on direct navigation and reload",
  { tag: ["@pages"] },
  async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
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
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
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
    expect(errors).toEqual([]);
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
  ["earnings", `${deployment.site}/earnings`],
]) {
  test(`login returns ${next} to a safe destination`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const expiresAt = new Date(
      Math.floor(Date.now() / 1000) * 1000 + 240_000,
    ).toISOString();
    const flowId = `flow_${"f".repeat(24)}`;
    let signedIn = false;
    let starts = 0;
    const member = {
      actor: { id: "U_return_member", login: "return-member" },
      joinedAt: "2026-10-01T00:00:00.000Z",
      public: false,
      welcome: 0,
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
        expect(route.request().postDataJSON().public).toBe(false);
        signedIn = true;
        await route.fulfill({ json: member });
        return;
      }
      if (url.pathname === "/api/v1/points/visibility") {
        expect(signedIn).toBe(true);
        member.public = route.request().postDataJSON().public;
        await route.fulfill({ json: member });
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        await route.fulfill({ status: 404, json: {} });
        return;
      }
      // Serve the same built bytes directly. An extra HTTP proxy can reset
      // asset requests that remain in flight when the return route navigates.
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
    const popup = page.waitForEvent("popup");
    await action.click();
    await (await popup).close();
    await expect(page).toHaveURL(expected);
    await page.goto(`${deployment.site}/account#profile`);
    const visibility = page.getByLabel("Show my membership publicly", {
      exact: true,
    });
    await expect(visibility).not.toBeChecked();
    // The controlled checkbox changes after the API acknowledges the save.
    await visibility.click();
    await expect(visibility).toBeChecked();
    await page.reload();
    await expect(visibility).toBeChecked();
    await page.goto(
      `${deployment.site}/login?next=${encodeURIComponent(next)}`,
    );
    await expect(page).toHaveURL(expected);
    expect(starts).toBe(1);
    expect(errors).toEqual([]);
    // The destination keeps loading public data after the assertion.
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });
}

test("the header login link keeps the current page as the return route", async ({
  page,
}) => {
  await page.goto("/how-it-works#faq");
  const link = page
    .getByRole("banner")
    .getByRole("link", { name: "Log in", exact: true });
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

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
    await expect(
      page.getByRole("heading", { name: "Log in", exact: true }),
    ).toBeVisible();
    await expect(page.locator("main h1, main h2")).toHaveCount(1);
    const header = page.getByRole("banner");
    await expect(
      header.getByRole("link", { name: "Receipts", exact: true }),
    ).toHaveCount(0);
    await expect(
      header.getByRole("link", { name: "Cycles", exact: true }),
    ).toHaveCount(0);
    await expect(
      header.getByRole("link", { name: "Log in", exact: true }),
    ).toHaveAttribute("href", "/login");
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
  test(`login returns ${next} to a safe destination`, async ({
    page,
    baseURL,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const expiresAt = new Date(
      Math.floor(Date.now() / 1000) * 1000 + 240_000,
    ).toISOString();
    const flowId = `flow_${"f".repeat(24)}`;
    let signedIn = false;
    const member = {
      actor: { id: "U_return_member", login: "return-member" },
      joinedAt: "2026-10-01T00:00:00.000Z",
      public: false,
      welcome: 5,
      socialPoints: 0,
    };
    await page.context().route(`${deployment.identity}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/v1/oauth/start")
        await route.fulfill({
          json: {
            flowId,
            pollCapability: "p".repeat(48),
            expiresAt,
            pollAfterSeconds: 1,
            authorizationUrl: `${deployment.identity}/v1/oauth/authorize?flow_id=${flowId}&state=${"s".repeat(48)}`,
          },
        });
      else if (path === "/v1/oauth/authorize")
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
      if (url.pathname.startsWith("/api/")) {
        await route.fulfill({ status: 404, json: {} });
        return;
      }
      const response = await route.fetch({
        url: `${baseURL}${url.pathname}${url.search}`,
      });
      await route.fulfill({ response });
    });
    await page.goto(
      `${deployment.site}/login?next=${encodeURIComponent(next)}`,
    );
    const main = page.getByRole("main");
    await expect(main.locator("h1, h2")).toHaveCount(1);
    const action = main.getByRole("button", { name: "Continue with GitHub" });
    const consent = main.getByLabel(/Optional: show my membership publicly/u);
    // The optional public-membership choice follows the one GitHub action.
    expect(
      await action.evaluate(
        (button, label) =>
          !!(
            button.compareDocumentPosition(label as Node) &
            Node.DOCUMENT_POSITION_FOLLOWING
          ),
        await consent.elementHandle(),
      ),
    ).toBe(true);
    await expect(consent).not.toBeChecked();
    const popup = page.waitForEvent("popup");
    await action.click();
    await (await popup).close();
    await expect(page).toHaveURL(expected);
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
    `/login?next=${encodeURIComponent("/how-it-works#faq")}`,
  );
  await page.evaluate(() => {
    window.location.hash = "verification";
  });
  await expect(link).toHaveAttribute(
    "href",
    `/login?next=${encodeURIComponent("/how-it-works#verification")}`,
  );
  await page.evaluate(() => {
    window.location.hash = "faq";
  });
  await expect(link).toHaveAttribute(
    "href",
    `/login?next=${encodeURIComponent("/how-it-works#faq")}`,
  );
  await link.click();
  await expect(page).toHaveURL(
    `/login?next=${encodeURIComponent("/how-it-works#faq")}`,
  );
});

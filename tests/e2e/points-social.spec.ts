import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";

const { site } = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);

test("social membership shows connection points, respects privacy and survives disconnect", async ({
  page,
}, info) => {
  const errors: string[] = [];
  const failures: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("response", (r) => {
    if (new URL(r.url()).origin === site && r.status() >= 400)
      failures.push(`${r.status()} ${r.url()}`);
  });
  const me = {
    actor: { id: "U_social_member", login: "social-member" },
    joinedAt: "2026-09-21T12:00:00.000Z",
    public: true,
    welcome: 5,
    socialPoints: 10,
  };
  let account: {
    id: string;
    username: string;
    verifiedAt: string;
    public: number;
  } | null = {
    id: "123456789",
    username: "social_member",
    verifiedAt: me.joinedAt,
    public: 0,
  };
  // Serve the built bytes at the product origin without a second HTTP proxy.
  // Proxy requests can outlive navigation and reset reused localhost sockets.
  // Provider and membership responses below remain explicit doubles.
  await page.route(`${site}/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    await route.fulfill({
      path: join(
        process.cwd(),
        "dist",
        route.request().resourceType() === "document" ? "index.html" : pathname,
      ),
    });
  });
  await page.route(`${site}/api/v1/points/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    let value: unknown;
    if (path.endsWith("/x/me"))
      value = {
        configured: true,
        account,
        award: { points: 10, awardedAt: me.joinedAt },
      };
    else if (path.endsWith("/x/visibility")) {
      expect(route.request().method()).toBe("POST");
      account = {
        ...account!,
        public: route.request().postDataJSON().public ? 1 : 0,
      };
      value = { updated: true };
    } else if (path.endsWith("/x/disconnect")) {
      expect(route.request().method()).toBe("POST");
      account = null;
      value = { disconnected: true };
    } else if (path.endsWith("/x/profile"))
      value = account?.public ? account : null;
    else if (path.endsWith("/people"))
      value = {
        people: [{ ...me, x: account?.public ? account : null }],
        next: null,
      };
    else if (path.endsWith("/me") || path.endsWith("/member")) value = me;
    else throw new Error(`Unexpected social request ${path}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(value),
    });
  });
  await page.route(
    "https://avatars.githubusercontent.com/**",
    async (route) => {
      await route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#4f4a41"/></svg>',
      });
    },
  );
  await page.goto(`${site}/points`);
  const accountButton = page.getByRole("button", {
    name: "Your account",
    exact: true,
  });
  await expect(accountButton).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Your account details" }),
  ).toHaveCount(0);
  const header = page.getByRole("banner");
  const accountBounds = await accountButton.boundingBox();
  const brandBounds = await header
    .getByRole("link", { name: "Slop home" })
    .boundingBox();
  expect(accountBounds!.x).toBeGreaterThan(brandBounds!.x + brandBounds!.width);
  await accountButton.click();
  const accountPanel = page.getByRole("region", {
    name: "Your account details",
  });
  await expect(
    accountPanel.getByText("@social-member", { exact: true }),
  ).toBeVisible();
  await expect(accountPanel.getByText("15 pts", { exact: true })).toBeVisible();
  await expect(
    accountPanel.getByRole("link", { name: "View profile" }),
  ).toHaveAttribute("href", "/contributors/social-member");
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath("account-menu.png") });
  await page.keyboard.press("Escape");
  await expect(accountButton).toBeFocused();
  await expect(accountPanel).toHaveCount(0);
  await accountButton.click();
  // The dropdown overlays the page heading on narrow screens; use the
  // uncovered header edge to exercise a real outside pointer interaction.
  await header.click({ position: { x: 1, y: 1 } });
  await expect(accountPanel).toHaveCount(0);
  await accountButton.click();
  await accountPanel.getByRole("link", { name: "Account settings" }).click();
  await expect(page).toHaveURL(`${site}/account`);
  await expect(
    page.getByRole("heading", { name: "Account", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "People", exact: true }),
  ).toHaveCount(0);
  const social = page.getByRole("region", { name: "Connect X" });
  await expect(social.getByRole("checkbox")).toHaveCount(1);
  const community = page.getByRole("region", { name: "People", exact: true });
  await social
    .getByLabel("Show my X account with my public membership", { exact: true })
    .click();
  await expect(social.getByText("X visibility updated.")).toBeVisible();
  await page.goto(`${site}/points#people`);
  await community.getByLabel("GitHub username").fill("social-member");
  await expect(
    community.getByRole("link", { name: "X · @social_member" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Account settings", exact: true })
    .click();
  await expect(social.getByRole("checkbox")).toHaveCount(1);
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath("social-points.png"),
    fullPage: true,
  });
  await social
    .getByRole("button", { name: "Disconnect X", exact: true })
    .click();
  await expect(
    social.getByText("X disconnected. Your earned points are retained."),
  ).toBeVisible();
  await page.goto(`${site}/points#people`);
  await community.getByLabel("GitHub username").fill("social-member");
  await expect(
    community.getByRole("link", { name: "X · @social_member" }),
  ).toHaveCount(0);
  await expect(community.getByText("15 pts", { exact: true })).toBeVisible();
  await community
    .getByRole("link", { name: "social-member", exact: true })
    .click();
  await expect(
    page
      .getByText("Points · recorded history", { exact: true })
      .locator("..")
      .locator("strong"),
  ).toHaveText("15");
  await expect(page.getByText(/10 X connection points/)).toBeVisible();
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
});

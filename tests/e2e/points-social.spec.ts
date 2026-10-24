import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";

const { site } = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);

test("social membership keeps discontinued participation awards out of totals and preserves connection privacy", async ({
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
    // Discontinued participation awards (D2) stay recorded but never count.
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
  await page.route(`${site}/api/v1/project-appeals`, (route) =>
    route.fulfill({ json: { appeals: [] } }),
  );
  await page.route(`${site}/api/v1/project-session`, (route) =>
    route.fulfill({
      json: {
        session: { githubId: "123", githubLogin: me.actor.login, admin: false },
      },
    }),
  );
  await page.route(`${site}/api/v1/payments/me`, (route) =>
    route.fulfill({
      json: {
        githubUserId: "123",
        wallets: [],
        payments: [],
        monthlyAwards: [],
        balances: [],
        directTransfers: [],
        walletObservations: [],
      },
    }),
  );
  await page.route(`${site}/api/v1/payments/**/direct-transfers`, (route) =>
    route.fulfill({ json: { transfers: [], totalMicro: "0" } }),
  );
  let telegram: {
    id: string;
    username: string | null;
    verifiedAt: string;
    public: number;
  } | null = {
    id: "987654321",
    username: "social_member_tg",
    verifiedAt: me.joinedAt,
    public: 0,
  };
  const publicTelegram = () =>
    telegram?.public
      ? { username: telegram.username, verifiedAt: telegram.verifiedAt }
      : null;
  await page.route(`${site}/api/v1/points/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    let value: unknown;
    if (path.endsWith("/sessions")) value = { sessions: [] };
    else if (path.endsWith("/telegram/me"))
      value = { configured: true, account: telegram, flow: null };
    else if (path.endsWith("/telegram/visibility")) {
      expect(route.request().method()).toBe("POST");
      telegram = {
        ...telegram!,
        public: route.request().postDataJSON().public ? 1 : 0,
      };
      value = { updated: true };
    } else if (path.endsWith("/telegram/disconnect")) {
      expect(route.request().method()).toBe("POST");
      telegram = null;
      value = { disconnected: true };
    } else if (path.endsWith("/telegram/profile")) value = publicTelegram();
    else if (path.endsWith("/x/me"))
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
        people: [
          {
            ...me,
            x: account?.public ? account : null,
            telegram: publicTelegram(),
          },
        ],
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
  // Joining and connecting accounts earn nothing; only work categories remain.
  const rules = page.getByRole("list", { name: "Point categories" });
  await expect(rules.getByRole("listitem")).toHaveCount(4);
  await expect(rules).not.toContainText("Join with GitHub");
  await expect(rules).not.toContainText("First X connection");
  const accountButton = page.getByRole("button", {
    name: "Your account",
    exact: true,
  });
  await expect(accountButton).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Your account details" }),
  ).toHaveCount(0);
  const header = page.getByRole("banner");
  await accountButton.click();
  const accountPanel = page.getByRole("region", {
    name: "Your account details",
  });
  await expect(
    accountPanel.getByText("@social-member", { exact: true }),
  ).toBeVisible();
  await expect(accountPanel.getByText("0 pts", { exact: true })).toBeVisible();
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
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "People", exact: true }),
  ).toHaveCount(0);
  const social = page.getByRole("region", { name: "Connections" });
  await expect(social.getByRole("checkbox")).toHaveCount(2);
  await expect(social).toContainText("Connections grant no authority.");
  await expect(social).not.toContainText("+10 points");
  await page.screenshot({
    path: info.outputPath("account-connections.png"),
    fullPage: true,
  });
  const community = page.getByRole("region", { name: "People", exact: true });
  const visibilitySaved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith("/api/v1/points/x/") &&
      response.request().method() === "POST",
  );
  await social
    .getByLabel("Show my X account with my public membership", { exact: true })
    .click();
  await visibilitySaved;
  const telegramVisibilitySaved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        "/api/v1/points/telegram/visibility" &&
      response.request().method() === "POST",
  );
  await social
    .getByLabel("Show my Telegram account with my public membership", {
      exact: true,
    })
    .click();
  await telegramVisibilitySaved;
  await page.goto(`${site}/points#people`);
  await community.getByLabel("GitHub username").fill("social-member");
  await expect(
    community.getByRole("link", { name: "X · @social_member" }),
  ).toBeVisible();
  await expect(
    community.getByRole("link", { name: "Telegram · @social_member_tg" }),
  ).toHaveAttribute("href", "https://t.me/social_member_tg");
  await page
    .getByRole("link", { name: "Account settings", exact: true })
    .click();
  await expect(social.getByRole("checkbox")).toHaveCount(2);
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath("social-points.png"),
    fullPage: true,
  });
  const disconnected = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/points/x/disconnect" &&
      response.request().method() === "POST",
  );
  await social
    .getByRole("button", { name: "Disconnect X", exact: true })
    .click();
  await disconnected;
  const telegramDisconnected = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        "/api/v1/points/telegram/disconnect" &&
      response.request().method() === "POST",
  );
  await social
    .getByRole("button", { name: "Disconnect Telegram", exact: true })
    .click();
  await telegramDisconnected;
  await page.goto(`${site}/points#people`);
  await community.getByLabel("GitHub username").fill("social-member");
  await expect(
    community.getByRole("link", { name: "X · @social_member" }),
  ).toHaveCount(0);
  await expect(
    community.getByRole("link", { name: "Telegram · @social_member_tg" }),
  ).toHaveCount(0);
  await expect(community.getByText("0 pts", { exact: true })).toBeVisible();
  await community
    .getByRole("link", { name: "social-member", exact: true })
    .click();
  await expect(
    page
      .getByText("total points", { exact: true })
      .locator("..")
      .locator("strong"),
  ).toHaveText("0");
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
});

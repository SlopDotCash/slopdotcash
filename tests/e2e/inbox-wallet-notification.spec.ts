import { expect, test } from "./fixtures";

const ACTOR = "42";
// wallet_changed rows carry the wallet claim's stored chain id as `subject`.
const CHAINS = ["base", "ethereum", "robinhood", "solana"] as const;

test("a wallet notification names the payout network", async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/projects")
      return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
    if (path === "/api/v1/project-session")
      return route.fulfill({
        json: { session: { githubId: ACTOR, githubLogin: "viewer" } },
      });
    if (path === "/api/v1/notifications")
      return route.fulfill({
        json: {
          recipientGithubId: ACTOR,
          unread: CHAINS.length,
          nextCursor: null,
          notifications: CHAINS.map((chain, index) => ({
            eventKey: `wallet-claim:${chain}`,
            kind: "wallet_changed",
            subject: chain,
            detail: null,
            actionPath: "/account#wallets",
            sourceAt: `2026-10-27T12:0${index}:00.000Z`,
            createdAt: `2026-10-27T12:0${index}:00.000Z`,
            readAt: null,
          })),
        },
      });
    if (path === "/api/v1/security-cases")
      return route.fulfill({
        json: {
          viewer: { githubId: ACTOR, githubLogin: "viewer" },
          programs: [],
          cases: [],
        },
      });
    if (path === "/api/v1/security-submissions")
      return route.fulfill({
        json: { recipientGithubId: ACTOR, automatic: false, submissions: [] },
      });
    throw new Error(`Unexpected request: ${path}`);
  });
  await page.goto("/inbox?view=reports", { waitUntil: "networkidle" });
  const notifications = page.getByRole("list", { name: "Notifications" });
  for (const title of [
    "A Base payout wallet was added to your account.",
    "An Ethereum payout wallet was added to your account.",
    "A Robinhood Chain payout wallet was added to your account.",
    "A Solana payout wallet was added to your account.",
  ])
    await expect(notifications.getByText(title, { exact: true })).toBeVisible();
});

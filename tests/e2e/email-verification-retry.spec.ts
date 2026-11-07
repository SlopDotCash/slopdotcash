import { expect, test } from "./fixtures";

const ACTOR = "900000097";

// The server allows one verification request per account per minute, so a
// second request soon after the first is refused with up to 60 seconds left.
for (const [retryAfter, message] of [
  [60, "Try again in 1 minute."],
  [1, "Try again in 1 second."],
  [45, "Try again in 45 seconds."],
] as const) {
  test(`a refused verification request names the wait (${retryAfter} s)`, async ({
    page,
    diagnostics,
  }) => {
    diagnostics.allowResponse(
      429,
      "POST",
      "/api/v1/notifications/email/verification",
    );
    diagnostics.allow(
      /^console Failed to load resource: the server responded with a status of 429 \(.+\) at .+\/api\/v1\/notifications\/email\/verification$/u,
    );
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/v1/project-session")
        return route.fulfill({
          json: {
            session: { githubId: ACTOR, githubLogin: "viewer", admin: false },
          },
        });
      if (path === "/api/v1/notifications/email/verification")
        return route.fulfill({
          status: 429,
          json: { error: "verification_rate_limited", retryAfter },
        });
      if (path === "/api/v1/notifications/email")
        return route.fulfill({
          json: {
            enabled: false,
            securityEnabled: false,
            enrollmentAvailable: true,
            pending: null,
            availability: "unverified",
          },
        });
      if (path === "/api/v1/points/me")
        return route.fulfill({
          json: {
            actor: { id: "U_viewer", login: "viewer" },
            joinedAt: "2026-10-01T00:00:00Z",
            public: false,
            welcome: 5,
          },
        });
      if (path === "/api/v1/points/x/me")
        return route.fulfill({
          json: { configured: false, account: null, award: null },
        });
      if (path === "/api/v1/payments/me")
        return route.fulfill({
          json: {
            githubUserId: ACTOR,
            wallets: [],
            payments: [],
            monthlyAwards: [],
            balances: [],
            directTransfers: [],
            walletObservations: [],
          },
        });
      if (path === "/api/v1/project-appeals")
        return route.fulfill({ json: { appeals: [] } });
      if (path === "/api/v1/referrals/me")
        return route.fulfill({ json: { enabled: false } });
      return route.fallback();
    });
    await page.goto("/account#notifications", { waitUntil: "networkidle" });
    const email = page.getByRole("region", {
      name: "Email preferences",
      exact: true,
    });
    await email.getByLabel("Email address").fill("viewer@example.com");
    await email
      .getByRole("button", { name: "Send verification", exact: true })
      .click();
    await expect(email.getByText(message, { exact: true })).toBeVisible();
  });
}

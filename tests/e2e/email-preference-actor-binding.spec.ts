/** Browser counterexample for the email-preference actor binding.
 *
 * A failed identity preflight must not leave a usable switch behind: with
 * no bound actor, a later save would omit the expected-actor header and the
 * server would write to whoever is signed in at POST time. This spec runs
 * the exact sequence — failed preflight, successful preference load, then
 * an account switch before the save — and proves no write lands on the
 * switched-to account.
 */
import { join } from "node:path";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { escapeRegExp, expect, test } from "./fixtures";

const { site } = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);

const DESTINATION_VERSION = "a".repeat(64);

test("failed preflight never enables an email switch that writes to a new account", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowResponse(503, "GET", "/api/v1/project-session");
  diagnostics.allow(
    new RegExp(
      `^console Failed to load resource: the server responded with a status of (?:503 \\(.+\\) at ${escapeRegExp(site)}/api/v1/project-session|403 \\(.+\\) at ${escapeRegExp(site)}/api/v1/notifications/email)$`,
      "u",
    ),
  );
  diagnostics.allowPreviewApiMisses();
  let sessionFail = true;
  let actor = "900000098";
  const enabledByActor: Record<string, boolean> = {};
  const posts: { header: string | null }[] = [];
  await page.route(`${site}/**`, (route) =>
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
  await page.route(`${site}/api/v1/project-session`, (route) =>
    route.fulfill({
      status: sessionFail ? 503 : 200,
      json: sessionFail
        ? { error: "unavailable" }
        : {
            session: {
              githubId: actor,
              githubLogin: `account-${actor}`,
              admin: false,
            },
          },
    }),
  );
  await page.route(`${site}/api/v1/project-appeals`, (route) =>
    route.fulfill({ json: { appeals: [] } }),
  );
  await page.route(`${site}/api/v1/points/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/x/me"))
      return route.fulfill({
        json: { configured: false, account: null, award: null },
      });
    if (path.endsWith("/me"))
      return route.fulfill({
        json: {
          actor: { id: "U_session_test", login: "session-test" },
          joinedAt: "2026-10-01T00:00:00Z",
          public: false,
          welcome: 5,
        },
      });
    throw new Error(`Unexpected account route: ${path}`);
  });
  await page.route(`${site}/api/v1/payments/me`, (route) =>
    route.fulfill({
      json: {
        githubUserId: actor,
        wallets: [],
        payments: [],
        monthlyAwards: [],
        balances: [],
        directTransfers: [],
        walletObservations: [],
      },
    }),
  );
  await page.route(`${site}/api/v1/notifications/email`, (route) => {
    if (route.request().method() === "POST") {
      const header =
        route.request().headers()["x-slop-expected-github-id"] ?? null;
      posts.push({ header });
      const requested = route.request().postDataJSON() as { enabled: boolean };
      if (header === actor) enabledByActor[actor] = requested.enabled;
      // The server binds the write to the currently signed-in account: a
      // header for any other actor is refused, never rewritten.
      return route.fulfill({
        status: header === actor ? 200 : 403,
        json:
          header === actor
            ? { enabled: requested.enabled, securityEnabled: false }
            : { error: "actor_changed" },
      });
    }
    return route.fulfill({
      json: {
        enabled: enabledByActor[actor] ?? false,
        securityEnabled: false,
        enrollmentAvailable: false,
        pending: null,
        availability: "verified",
        email: "applicant@example.com",
        destinationVersion: DESTINATION_VERSION,
      },
    });
  });
  await page.route(`${site}/api/v1/notifications`, (route) =>
    route.fulfill({
      json: {
        recipientGithubId: actor,
        notifications: [],
        unread: 0,
        nextCursor: null,
      },
    }),
  );
  await page.route(`${site}/api/v1/security-cases`, (route) =>
    route.fulfill({
      json: {
        viewer: { githubId: actor, githubLogin: `account-${actor}` },
        programs: [],
        cases: [],
      },
    }),
  );
  await page.route(`${site}/api/v1/security-submissions`, (route) =>
    route.fulfill({
      json: {
        recipientGithubId: actor,
        automatic: false,
        submissions: [],
      },
    }),
  );
  await page.route(`${site}/api/v1/referrals/me`, (route) =>
    route.fulfill({ json: { enabled: false } }),
  );

  await page.goto(`${site}/account`, { waitUntil: "domcontentloaded" });
  const email = page.getByRole("region", {
    name: "Email preferences",
    exact: true,
  });
  await expect(email).toHaveCount(1);
  // Step 1: the identity preflight fails. The control stays unavailable
  // and retryable; its existing switch stays disabled and nothing is posted.
  await expect(email.getByText(/The account check failed/)).toBeVisible();
  await expect(
    email.getByRole("switch", { name: "Activity email", exact: true }),
  ).toBeDisabled();
  expect(posts).toHaveLength(0);

  // Step 2: retry with a working preflight. The preference loads for the
  // bound actor and the switch becomes usable.
  sessionFail = false;
  await email
    .getByRole("button", { name: "Retry email preferences", exact: true })
    .click();
  const toggle = email.getByRole("switch", {
    name: "Activity email",
    exact: true,
  });
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();

  // A permitted save remains bound to the rendered actor.
  await toggle.click();
  await expect(toggle).toBeChecked();
  expect(posts).toEqual([{ header: "900000098" }]);

  // Step 3: the account switches before another save. The current-session
  // preflight refuses it before any POST reaches the newly signed-in account.
  actor = "900000099";
  await toggle.click();
  await expect(
    email.getByText("The inbox account changed. Retry.", { exact: true }),
  ).toBeVisible();
  await expect(toggle).not.toBeChecked();
  expect(posts).toHaveLength(1);
  expect(enabledByActor[actor] ?? false).toBe(false);
});

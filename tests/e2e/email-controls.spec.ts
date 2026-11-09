/**
 * Email preference and email-link controls against the built app. Sessions,
 * tokens and mail responses are synthetic; no real address or provider is used.
 */
import { join } from "node:path";
import type { Page, Route } from "@playwright/test";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { expect, expectAccessible, test } from "./fixtures";

const origins = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);
const ACTOR = "900000097";

test("a failed account check retries before verification, and Dismiss drops the link unused", async ({
  page,
  diagnostics,
}, info) => {
  const token = "e".repeat(64);
  let sessionFailure = true;
  const posts: string[] = [];
  diagnostics.allowResponse(503, "GET", "/api/v1/project-session");
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowCanceledBackgroundReads();
  await page.route("**/api/v1/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice("/api/v1/".length);
    if (request.method() !== "GET") posts.push(path);
    if (path === "project-session")
      return route.fulfill(
        sessionFailure
          ? { status: 503, json: { error: "unavailable" } }
          : {
              json: {
                session: { githubId: ACTOR, githubLogin: "fixture-member" },
              },
            },
      );
    if (path === "projects")
      return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
    if (path === "notifications")
      return route.fulfill({
        json: { recipientGithubId: ACTOR, notifications: [], unread: 0 },
      });
    if (path === "security-cases")
      return route.fulfill({
        json: {
          viewer: { githubId: ACTOR, githubLogin: "fixture-member" },
          programs: [],
          cases: [],
        },
      });
    if (path === "security-submissions")
      return route.fulfill({
        json: { recipientGithubId: ACTOR, automatic: false, submissions: [] },
      });
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
  await page.goto(`/inbox#verify-email=${token}`, {
    waitUntil: "networkidle",
  });
  const action = page.getByRole("region", {
    name: "Verify email",
    exact: true,
  });
  await expect(action.getByRole("alert")).toHaveText(
    "Your account could not be checked. Reload to retry.",
  );
  const verify = action.getByRole("button", {
    name: "Verify email",
    exact: true,
  });
  await expect(verify).toHaveCount(0);
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("account-check-failed.png"),
    fullPage: true,
  });

  sessionFailure = false;
  await action
    .getByRole("button", { name: "Retry account check", exact: true })
    .click();
  await expect(verify).toBeEnabled();
  await expect(action.getByRole("alert")).toHaveCount(0);
  // The link is now bound to the checked account for this tab.
  expect(
    await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("slop:email-action:v1") ?? "null"),
    ),
  ).toMatchObject({ kind: "verify", token, actor: ACTOR });

  await action.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(action).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("slop:email-action:v1")),
  ).toBeNull();
  // A reload does not bring the dismissed link back, and nothing was sent.
  await page.reload({ waitUntil: "networkidle" });
  await expect(action).toHaveCount(0);
  expect(posts).toEqual([]);
  await expectAccessible(page);
});

/** Serves the built account page on the site origin with synthetic APIs. */
async function serveAccount(page: Page) {
  const state = {
    pending: {
      email: "first@example.test",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      state: "sent",
    } as { email: string; expiresAt: string; state: string } | null,
    verificationStatus: 202 as 202 | 429 | 503,
    requests: [] as { body: Record<string, unknown>; actor?: string }[],
  };
  const preference = () => ({
    enabled: false,
    securityEnabled: false,
    enrollmentAvailable: true,
    pending: state.pending,
    availability: "unverified",
  });
  await page.route(`${origins.site}/**`, async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/"))
      return route.fulfill({
        path: join(
          process.cwd(),
          "dist",
          request.resourceType() === "document" ? "index.html" : path,
        ),
      });
    if (path === "/api/v1/payments/received") return route.fallback();
    if (path === "/api/v1/projects")
      return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
    if (path === "/api/v1/project-session")
      return route.fulfill({
        json: {
          session: {
            githubId: ACTOR,
            githubLogin: `member-${ACTOR}`,
            admin: false,
          },
        },
      });
    if (path === "/api/v1/points/me")
      return route.fulfill({
        json: {
          actor: { id: btoa(`04:User${ACTOR}`), login: `member-${ACTOR}` },
          joinedAt: "2026-10-01T00:00:00Z",
          public: true,
          welcome: 5,
        },
      });
    if (path === "/api/v1/notifications/email/verification") {
      state.requests.push({
        body: request.postDataJSON(),
        actor: request.headers()["x-slop-expected-github-id"],
      });
      if (state.verificationStatus !== 202)
        return route.fulfill({
          status: state.verificationStatus,
          json:
            state.verificationStatus === 429
              ? { retryAfter: 1 }
              : { error: "temporarily_unavailable" },
        });
      state.pending = {
        email: request.postDataJSON().email,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        state: "queued",
      };
      return route.fulfill({ status: 202, json: preference() });
    }
    if (path === "/api/v1/notifications/email")
      return route.fulfill({ json: preference() });
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
    if (path === "/api/v1/notifications")
      return route.fulfill({
        json: {
          recipientGithubId: ACTOR,
          notifications: [],
          unread: 0,
          nextCursor: null,
        },
      });
    if (path === "/api/v1/project-appeals")
      return route.fulfill({ json: { appeals: [] } });
    if (path === "/api/v1/referrals/me")
      return route.fulfill({ json: { enabled: false } });
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
  return state;
}

test("Change email replaces a pending verification address", async ({
  page,
  diagnostics,
}, info) => {
  diagnostics.allowCanceledBackgroundReads();
  const state = await serveAccount(page);
  await page.goto(`${origins.site}/account#notifications`, {
    waitUntil: "networkidle",
  });
  const preferences = page.getByRole("region", {
    name: "Email preferences",
    exact: true,
  });
  await expect(preferences.getByRole("status")).toContainText(
    "Verification sent: first@example.test",
  );
  const input = preferences.getByRole("textbox", {
    name: "Email address",
    exact: true,
  });
  await expect(input).toHaveCount(0);
  await preferences
    .getByRole("button", { name: "Change email", exact: true })
    .click();
  // The editor starts from the pending address.
  await expect(input).toHaveValue("first@example.test");
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("change-email-editor.png"),
    fullPage: true,
  });
  // Cancel keeps the pending verification and sends nothing.
  await preferences
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(input).toHaveCount(0);
  expect(state.requests).toHaveLength(0);

  await preferences
    .getByRole("button", { name: "Change email", exact: true })
    .click();
  await input.fill("second@example.test");
  await preferences
    .getByRole("checkbox", { name: "Activity email", exact: true })
    .check();
  await preferences
    .getByRole("button", { name: "Send verification", exact: true })
    .click();
  await expect(preferences.getByRole("status")).toContainText(
    "Verification requested: second@example.test",
  );
  await expect(input).toHaveCount(0);
  expect(state.requests).toHaveLength(1);
  expect(state.requests[0]).toMatchObject({
    actor: ACTOR,
    body: {
      email: "second@example.test",
      enabled: true,
      securityEnabled: false,
    },
  });
  expect(state.requests[0].body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/u);
  await expect(
    preferences.getByRole("button", { name: "Change email", exact: true }),
  ).toBeVisible();
  await expectAccessible(page);
});

test("verification retries reuse an unchanged request key and edited choices start a new request", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowCanceledBackgroundReads();
  diagnostics.allowResponse(
    429, "POST", "/api/v1/notifications/email/verification",
  );
  diagnostics.allowResponse(
    503, "POST", "/api/v1/notifications/email/verification",
  );
  const state = await serveAccount(page);
  await page.goto(`${origins.site}/account#notifications`, {
    waitUntil: "networkidle",
  });
  const preferences = page.getByRole("region", {
    name: "Email preferences", exact: true,
  });
  await preferences
    .getByRole("button", { name: "Change email", exact: true }).click();
  await preferences
    .getByRole("textbox", { name: "Email address", exact: true })
    .fill("retry@example.test");
  const send = preferences.getByRole("button", {
    name: "Send verification", exact: true,
  });
  state.verificationStatus = 429;
  await send.click();
  await expect(preferences.getByRole("alert")).toHaveText(
    "Try again in 1 seconds.",
  );
  state.verificationStatus = 503;
  await send.click();
  await expect(preferences.getByRole("alert")).toHaveText(
    "The verification email could not be requested. Retry.",
  );
  expect(state.requests).toHaveLength(2);
  expect(state.requests[1].body).toEqual(state.requests[0].body);
  expect(state.pending?.email).toBe("first@example.test");
  await preferences
    .getByRole("checkbox", { name: "Security email", exact: true }).check();
  state.verificationStatus = 202;
  await send.click();
  await expect(preferences.getByRole("status")).toContainText(
    "Verification requested: retry@example.test",
  );
  expect(state.requests).toHaveLength(3);
  expect(state.requests[2].body.idempotencyKey).not.toBe(
    state.requests[0].body.idempotencyKey,
  );
  expect(state.requests[2]).toMatchObject({
    actor: ACTOR,
    body: { email: "retry@example.test", enabled: false, securityEnabled: true },
  });
  await expect(
    preferences.getByRole("switch", { name: "Activity email", exact: true }),
  ).not.toBeChecked();
  await expect(
    preferences.getByRole("switch", { name: "Security email", exact: true }),
  ).not.toBeChecked();
});

for (const [stateName, label] of [
  ["unknown", "Verification delivery not confirmed"],
  ["expired", "Verification expired"],
] as const)
  test(`${stateName} verification remains editable without implying a verified destination`, async ({ page, diagnostics }) => {
    diagnostics.allowCanceledBackgroundReads();
    const state = await serveAccount(page);
    if (!state.pending) throw new Error("Missing pending fixture");
    state.pending.state = stateName;
    if (stateName === "expired")
      state.pending.expiresAt = new Date(Date.now() - 1000).toISOString();
    await page.goto(`${origins.site}/account#notifications`, { waitUntil: "networkidle" });
    const preferences = page.getByRole("region", { name: "Email preferences", exact: true });
    await expect(preferences.getByRole("status")).toContainText(`${label}: first@example.test`);
    await expect(preferences.getByRole("switch", { name: "Activity email", exact: true })).toBeDisabled();
    await preferences.getByRole("button", { name: "Change email", exact: true }).click();
    await expect(preferences.getByRole("textbox", { name: "Email address", exact: true })).toHaveValue("first@example.test");
    await preferences.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(preferences.getByRole("status")).toContainText(`${label}: first@example.test`);
    expect(state.requests).toEqual([]);
  });

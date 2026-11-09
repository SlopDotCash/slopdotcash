/** Account page + email editor composition. Only the HTTP authorities are fixtures. */
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import {
  assemblePoints,
  emptyPointsJournal,
  type PointsIndex,
} from "../../src/lib/points";
import { escapeRegExp, expect, expectAccessible, test } from "./fixtures";
import {
  holdProjectSessionUntilUnmount,
  leaveEditorWithHeldSession,
  releaseHeldEditorSession,
} from "./project-draft-fixture";

const origins = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);
const FIRST = "900000098";
const SECOND = "900000099";
// These cases isolate identity and request ordering. Keep the real Points
// assembler, without making a sign-in parse the complete historical journal.
const journal = emptyPointsJournal("2026-10-31T23:59:30.000Z");
const emptyPart = "[]";
const pointsIndex: PointsIndex = {
  schemaVersion: "1",
  ruleVersion: journal.ruleVersion,
  generatedAt: journal.generatedAt,
  coverage: [],
  revisionCount: 0,
  shards: Array.from({ length: 16 }, (_, i) => ({
    path: `/data/points/${i.toString(16)}.json`,
    count: 0,
    sha256: createHash("sha256").update(emptyPart).digest("hex"),
  })),
};
assemblePoints(pointsIndex, Array(16).fill(emptyPart));
function gate() {
  let release!: () => void;
  let started!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  return { promise, release, requested, started: () => started() };
}
async function serveAccount(
  page: Page,
  context: BrowserContext,
  memberInitially = false,
  verifiedDestination = false,
  enterFromOverview = false,
) {
  const state = {
    actor: FIRST as string | null,
    member: memberInitially ? FIRST : (null as string | null),
    joinAs: SECOND,
    sessionGate: null as ReturnType<typeof gate> | null,
    emailGate: null as ReturnType<typeof gate> | null,
    sessionFailure: false,
    refuseVerification: false,
    verifiedDestination,
    preferenceReads: 0,
    enabled: false,
    securityEnabled: false,
    verifiedEmail: "verified@example.test",
    destinationVersion: "a".repeat(64),
    posts: [] as { path: string; actor: string | undefined }[],
  };
  const membership = (actor: string) => ({
    actor: { id: btoa(`04:User${actor}`), login: `member-${actor}` },
    joinedAt: "2026-10-01T00:00:00Z",
    public: true,
    welcome: 5,
  });
  await context.route("https://avatars.githubusercontent.com/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#f65b22"/></svg>',
    }),
  );
  await context.route(`${origins.identity}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const expiresAt = new Date(Date.now() + 240_000).toISOString();
    if (path === "/v1/oauth/start")
      return route.fulfill({
        json: {
          flowId: `flow_${"f".repeat(24)}`,
          pollCapability: "p".repeat(48),
          expiresAt,
          pollAfterSeconds: 1,
          authorizationUrl: `${origins.identity}/v1/oauth/authorize?flow_id=flow_${"f".repeat(24)}&state=${"s".repeat(48)}`,
        },
      });
    if (path === "/v1/oauth/authorize")
      return route.fulfill({
        contentType: "text/html",
        body: "<title>Synthetic identity authority</title>",
      });
    return route.fulfill({
      json: {
        status: "complete",
        assertionType: "SlopIdentity",
        assertion: `slop_assert_v1_${"a".repeat(48)}`,
        expiresAt,
      },
    });
  });
  await context.route(`${origins.site}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/data/points.json")
      return route.fulfill({ json: pointsIndex });
    if (/^\/data\/points\/[0-9a-f]\.json$/u.test(path))
      return route.fulfill({
        contentType: "application/json",
        body: emptyPart,
      });
    if (!path.startsWith("/api/"))
      return route.fulfill({
        path: join(
          process.cwd(),
          "dist",
          request.resourceType() === "document" ? "index.html" : path,
        ),
      });
    if (path === "/api/v1/payments/received") return route.fallback();
    if (path === "/api/v1/project-session") {
      await state.sessionGate?.promise;
      return route.fulfill({
        status: state.sessionFailure ? 503 : 200,
        json: state.sessionFailure
          ? { error: "unavailable" }
          : {
              session: state.actor
                ? {
                    githubId: state.actor,
                    githubLogin: `member-${state.actor}`,
                    admin: false,
                  }
                : null,
            },
      });
    }
    if (path === "/api/v1/points/me")
      return route.fulfill({
        json: state.member ? membership(state.member) : null,
      });
    if (path === "/api/v1/points/signout") {
      state.member = null;
      state.actor = null;
      return route.fulfill({ json: { signedOut: true } });
    }
    if (path === "/api/v1/points/join") {
      state.member = state.joinAs;
      state.actor = state.joinAs;
      return route.fulfill({ json: membership(state.member) });
    }
    if (
      path === "/api/v1/notifications/email/verification" &&
      state.refuseVerification
    ) {
      state.posts.push({
        path,
        actor: request.headers()["x-slop-expected-github-id"],
      });
      return route.fulfill({ status: 401, json: { error: "unauthenticated" } });
    }
    if (path === "/api/v1/notifications/email") {
      if (request.method() !== "GET") {
        state.posts.push({
          path,
          actor: request.headers()["x-slop-expected-github-id"],
        });
        const body = request.postDataJSON();
        state.enabled = body.enabled;
        state.securityEnabled = body.securityEnabled;
      } else state.preferenceReads++;
      await state.emailGate?.promise;
      return route.fulfill({
        json: {
          enabled: state.enabled,
          securityEnabled: state.securityEnabled,
          enrollmentAvailable: true,
          pending: null,
          ...(state.verifiedDestination
            ? {
                availability: "verified",
                email: state.verifiedEmail,
                destinationVersion: state.destinationVersion,
              }
            : { availability: "unverified" }),
        },
      });
    }
    if (path === "/api/v1/payments/me")
      return route.fulfill({
        json: {
          githubUserId: state.actor ?? FIRST,
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
          recipientGithubId: state.actor ?? FIRST,
          notifications: [],
          unread: 0,
          nextCursor: null,
        },
      });
    if (path === "/api/v1/project-appeals")
      return route.fulfill({ json: { appeals: [] } });
    if (path === "/api/v1/referrals/me")
      return route.fulfill({ json: { enabled: false } });
    throw new Error(
      `Unexpected account API in fixture: ${request.method()} ${path}`,
    );
  });
  await page.goto(
    `${origins.site}${enterFromOverview ? "/how-it-works" : "/account#notifications"}`,
    {
      waitUntil: "networkidle",
    },
  );
  if (enterFromOverview)
    await page.evaluate(() => {
      window.history.pushState(null, "", "/account#notifications");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
  const preferences = page.getByRole("region", {
    name: "Email preferences",
    exact: true,
  });
  const input = preferences.getByRole("textbox", {
    name: "Email address",
    exact: true,
  });
  if (verifiedDestination)
    await preferences
      .getByRole("button", { name: "Add or change email", exact: true })
      .click();
  await expect(input).toBeVisible();
  await input.fill("retained-before-check@example.test");
  await preferences
    .getByRole("checkbox", { name: "Security email", exact: true })
    .check();
  return { state, preferences, input };
}

test.use({ video: "on" });

test("same-account focus keeps the email draft editable while send is blocked", async ({
  page,
  context,
}, info) => {
  const { state, preferences, input } = await serveAccount(page, context);
  const held = gate();
  state.emailGate = held;
  const requested = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/v1/notifications/email",
  );
  try {
    await input.focus();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await requested;
    await expect(input).toBeFocused();
    await expect(input).toBeEditable();
    await expect(input).toHaveValue("retained-before-check@example.test");
    await input.fill("edited-during-check@example.test");
    await expect(
      preferences.getByRole("button", {
        name: "Send verification",
        exact: true,
      }),
    ).toBeDisabled();
    await page.screenshot({
      path: info.outputPath("email-draft-pending.png"),
      fullPage: true,
    });
  } finally {
    held.release();
    state.emailGate = null;
  }
  await expect(input).toHaveValue("edited-during-check@example.test");
  await expect(
    preferences.getByRole("checkbox", { name: "Security email", exact: true }),
  ).toBeChecked();
  await expect(
    preferences.getByRole("button", { name: "Send verification", exact: true }),
  ).toBeEnabled();
  expect(state.posts).toHaveLength(0);
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("email-draft-rechecked.png"),
    fullPage: true,
  });
});

for (const actor of [SECOND, null])
  test(`a confirmed ${actor ? "different account" : "sign-out"} removes the old email draft`, async ({
    page,
    context,
  }) => {
    const { state, preferences, input } = await serveAccount(page, context);
    state.actor = actor;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    if (actor) {
      await expect(input).toBeVisible();
      await expect(input).toHaveValue("");
      await expect(
        preferences.getByRole("checkbox", {
          name: "Security email",
          exact: true,
        }),
      ).not.toBeChecked();
    } else await expect(preferences).toHaveCount(0);
    expect(state.posts).toHaveLength(0);
  });

for (const actor of [FIRST, SECOND])
  test(`a Points identity ${actor === FIRST ? "match retains" : "change removes"} the draft before its project-session recheck`, async ({
    page,
    context,
  }) => {
    const { state, preferences, input } = await serveAccount(page, context);
    state.joinAs = actor;
    const held = gate();
    state.sessionGate = held;
    const joined = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/v1/points/join",
    );
    try {
      await page
        .getByRole("button", { name: "Continue with GitHub", exact: true })
        .click();
      await joined;
      // The synthetic OAuth page stays open; return to the account window
      // before asserting its post-sign-in render (especially in Firefox).
      await page.bringToFront();
      if (actor === FIRST) {
        await expect(input).toHaveValue("retained-before-check@example.test");
        await expect(
          preferences.getByRole("button", {
            name: "Send verification",
            exact: true,
          }),
        ).toBeDisabled();
      } else await expect(input).toHaveCount(0);
    } finally {
      held.release();
      state.sessionGate = null;
    }
    await expect(input).toBeVisible();
    await expect(input).toHaveValue(
      actor === FIRST ? "retained-before-check@example.test" : "",
    );
    expect(state.posts).toHaveLength(0);
  });

for (const actor of [FIRST, SECOND])
  test(`email session error retries as ${actor === FIRST ? "the same actor without losing its draft" : "a different actor without the old draft"}`, async ({
    page,
    context,
    diagnostics,
  }, info) => {
    diagnostics.allowResponse(503, "GET", "/api/v1/project-session");
    diagnostics.allow(
      new RegExp(
        `^console Failed to load resource: the server responded with a status of 503 (.+) at ${escapeRegExp(origins.site)}/api/v1/project-session$`,
        "u",
      ),
    );
    const { state, preferences, input } = await serveAccount(
      page,
      context,
      actor === FIRST,
    );
    state.sessionFailure = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(input).toHaveCount(0);
    await expect(preferences.getByRole("alert")).toContainText(
      "Email preferences could not be loaded",
    );
    await expectAccessible(page);
    await page.screenshot({
      path: info.outputPath("email-parent-check-error.png"),
      fullPage: true,
    });
    state.sessionFailure = false;
    state.actor = actor;
    await preferences
      .getByRole("button", { name: "Retry email preferences", exact: true })
      .click();
    await expect(input).toBeVisible();
    await expect(input).toHaveValue(
      actor === FIRST ? "retained-before-check@example.test" : "",
    );
    expect(state.posts).toHaveLength(0);
    await page.screenshot({
      path: info.outputPath("email-parent-check-retried.png"),
      fullPage: true,
    });
  });

test("successful local sign-out removes the draft before a held session read", async ({
  page,
  context,
}, info) => {
  const { state, preferences, input } = await serveAccount(page, context, true);
  const held = gate();
  state.sessionGate = held;
  try {
    await page
      .getByRole("button", { name: "Your account", exact: true })
      .click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Your account", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("after-local-signout-before-session.png"),
      fullPage: true,
    });
    await expect(input).toHaveCount(0);
    await expect(preferences).toHaveCount(0);
  } finally {
    held.release();
    state.sessionGate = null;
  }
  await expect(preferences).toHaveCount(0);
  expect(state.posts).toHaveLength(0);
});

test("a child-observed account change waits for parent binding before another draft", async ({
  page,
  context,
}) => {
  const { state, preferences, input } = await serveAccount(page, context);
  state.actor = SECOND;
  await preferences
    .getByRole("button", { name: "Send verification", exact: true })
    .click();
  await expect(
    preferences.getByText("The inbox account changed. Retry.", { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveCount(0);
  await preferences
    .getByRole("button", { name: "Retry email preferences", exact: true })
    .click();
  await expect(input).toHaveValue("");
  await input.fill("new-account-draft@example.test");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(input).toHaveValue("new-account-draft@example.test");
  expect(state.posts).toHaveLength(0);
});

test("a child-observed sign-out does not restore its draft on same-account return", async ({
  page,
  context,
}) => {
  const { state, preferences, input } = await serveAccount(page, context);
  state.actor = null;
  await preferences
    .getByRole("button", { name: "Send verification", exact: true })
    .click();
  await expect(
    preferences.getByText("Your session expired.", { exact: false }).first(),
  ).toBeVisible();
  state.actor = FIRST;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(input).toHaveValue("");
  expect(state.posts).toHaveLength(0);
});

test("an unauthorized verification response clears the old draft", async ({
  page,
  context,
  diagnostics,
}) => {
  diagnostics.allowResponse(
    401,
    "POST",
    "/api/v1/notifications/email/verification",
  );
  diagnostics.allow(
    new RegExp(
      `^console Failed to load resource: the server responded with a status of 401 (.+) at ${escapeRegExp(origins.site)}/api/v1/notifications/email/verification$`,
      "u",
    ),
  );
  const { state, preferences, input } = await serveAccount(page, context);
  state.refuseVerification = true;
  await preferences
    .getByRole("button", { name: "Send verification", exact: true })
    .click();
  await expect(
    preferences.getByText("Your session expired.", { exact: false }).first(),
  ).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(input).toHaveValue("");
  expect(state.posts).toEqual([
    { path: "/api/v1/notifications/email/verification", actor: FIRST },
  ]);
});

test("a departed verification preflight cannot reload preferences for a mismatched actor", async ({
  page,
  context,
}) => {
  const { state, preferences } = await serveAccount(page, context);
  const held = gate();
  state.actor = SECOND;
  await page.route(`${origins.site}/api/v1/project-session`, async (route) => {
    held.started();
    await held.promise;
    await route.fulfill({
      json: { session: { githubId: SECOND, githubLogin: "second" } },
    });
  });
  try {
    await preferences
      .getByRole("button", { name: "Send verification", exact: true })
      .click();
    await held.requested;
    await page.getByRole("link", { name: "Slop home", exact: true }).click();
    await expect(preferences).toHaveCount(0);
    const reads = state.preferenceReads;
    const response = page.waitForResponse(
      (reply) => new URL(reply.url()).pathname === "/api/v1/project-session",
    );
    held.release();
    await response;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    expect(state.preferenceReads).toBe(reads);
    expect(state.posts).toEqual([]);
  } finally {
    held.release();
  }
});

for (const status of [403, 409]) {
  test(`a departed preference ${status} response cannot start a new preference read`, async ({
    page,
    context,
    diagnostics,
  }) => {
    const { state, preferences } = await serveAccount(
      page,
      context,
      true,
      true,
    );
    await preferences
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    const held = gate();
    diagnostics.allow(
      new RegExp(
        `^console Failed to load resource: the server responded with a status of ${status} (.+) at ${escapeRegExp(origins.site)}/api/v1/notifications/email$`,
        "u",
      ),
    );
    await page.route(
      `${origins.site}/api/v1/notifications/email`,
      async (route) => {
        if (route.request().method() === "GET") return route.fallback();
        state.posts.push({
          path: "/api/v1/notifications/email",
          actor: route.request().headers()["x-slop-expected-github-id"],
        });
        held.started();
        await held.promise;
        await route.fulfill({ status, json: { error: "fixture_refusal" } });
      },
    );
    try {
      await preferences
        .getByRole("switch", { name: "Activity email", exact: true })
        .click();
      await held.requested;
      await page.getByRole("link", { name: "Slop home", exact: true }).click();
      const reads = state.preferenceReads;
      const response = page.waitForResponse(
        (reply) =>
          new URL(reply.url()).pathname === "/api/v1/notifications/email" &&
          reply.request().method() === "POST",
      );
      held.release();
      await response;
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );
      expect(state.preferenceReads).toBe(reads);
      expect(state.posts).toEqual([
        { path: "/api/v1/notifications/email", actor: FIRST },
      ]);
      await expect(preferences).toHaveCount(0);
    } finally {
      held.release();
    }
  });
}

test("an old preference postflight cannot reset a remounted actor's new draft", async ({
  page,
  context,
}) => {
  const { state, preferences, input } = await serveAccount(
    page,
    context,
    true,
    true,
  );
  await preferences
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  const held = gate();
  let delivered!: () => void;
  const finished = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  let postflight = false;
  await page.route(
    `${origins.site}/api/v1/notifications/email`,
    async (route) => {
      if (route.request().method() === "GET") return route.fallback();
      state.posts.push({
        path: "/api/v1/notifications/email",
        actor: route.request().headers()["x-slop-expected-github-id"],
      });
      state.enabled = true;
      state.actor = SECOND;
      postflight = true;
      await route.fulfill({ json: { enabled: true, securityEnabled: false } });
    },
  );
  await page.route(`${origins.site}/api/v1/project-session`, async (route) => {
    if (!postflight) return route.fallback();
    postflight = false;
    held.started();
    await held.promise;
    await route.fulfill({
      json: { session: { githubId: SECOND, githubLogin: "second" } },
    });
    delivered();
  });
  try {
    await preferences
      .getByRole("switch", { name: "Activity email", exact: true })
      .click();
    await held.requested;
    await page.getByRole("link", { name: "Slop home", exact: true }).click();
    state.actor = FIRST;
    await page
      .getByRole("button", { name: "Your account", exact: true })
      .click();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await preferences
      .getByRole("button", { name: "Add or change email", exact: true })
      .click();
    await input.fill("new-mounted-draft@example.test");
    const reads = state.preferenceReads;
    // Departure can abort the old request before a browser response event.
    // Wait for the held authority to finish, then inspect the remounted view.
    held.release();
    await finished;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    expect(state.preferenceReads).toBe(reads);
    await expect(input).toHaveValue("new-mounted-draft@example.test");
    await expect(
      preferences.getByRole("checkbox", {
        name: "Activity email",
        exact: true,
      }),
    ).toBeChecked();
  } finally {
    held.release();
  }
});

for (const changed of [false, true]) {
  test(`a preference failure ${changed ? "refuses a changed actor" : "retains usable preferences for the same actor"}`, async ({
    page,
    context,
    diagnostics,
  }) => {
    const { state, preferences, input } = await serveAccount(
      page,
      context,
      true,
      true,
    );
    await preferences
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    diagnostics.allow(
      new RegExp(
        `^console Failed to load resource: the server responded with a status of 503 (.+) at ${escapeRegExp(origins.site)}/api/v1/notifications/email$`,
        "u",
      ),
    );
    await page.route(
      `${origins.site}/api/v1/notifications/email`,
      async (route) => {
        if (route.request().method() === "GET") return route.fallback();
        if (changed) state.actor = SECOND;
        await route.fulfill({ status: 503, json: { error: "unavailable" } });
      },
    );
    await preferences
      .getByRole("switch", { name: "Activity email", exact: true })
      .click();
    if (changed) {
      await expect(input).toHaveCount(0);
      await expect(preferences).toContainText("The inbox account changed");
    } else {
      await expect(preferences).toContainText(
        "Your preference could not be saved",
      );
      const toggle = preferences.getByRole("switch", {
        name: "Activity email",
        exact: true,
      });
      await expect(toggle).not.toBeChecked();
      await expect(toggle).toBeEnabled();
    }
  });
}

test("a current destination conflict refreshes the destination before retry", async ({
  page,
  context,
  diagnostics,
}) => {
  const { state, preferences } = await serveAccount(page, context, true, true);
  await preferences
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  diagnostics.allow(
    new RegExp(
      `^console Failed to load resource: the server responded with a status of 409 (.+) at ${escapeRegExp(origins.site)}/api/v1/notifications/email$`,
      "u",
    ),
  );
  let conflict = true;
  const versions: string[] = [];
  await page.route(
    `${origins.site}/api/v1/notifications/email`,
    async (route) => {
      if (route.request().method() === "GET") return route.fallback();
      versions.push(route.request().postDataJSON().destinationVersion);
      if (!conflict) return route.fallback();
      conflict = false;
      state.destinationVersion = "b".repeat(64);
      state.verifiedEmail = "changed-destination@example.test";
      await route.fulfill({
        status: 409,
        json: { error: "destination_changed" },
      });
    },
  );
  await preferences
    .getByRole("switch", { name: "Activity email", exact: true })
    .click();
  await expect(preferences).toContainText(
    "Your verified destination changed. Review it before turning on email.",
  );
  await expect(preferences).toContainText("changed-destination@example.test");
  await preferences
    .getByRole("switch", { name: "Activity email", exact: true })
    .click();
  await expect(
    preferences.getByRole("switch", { name: "Activity email", exact: true }),
  ).toBeChecked();
  expect(versions).toEqual(["a".repeat(64), "b".repeat(64)]);
});

for (const operation of ["save", "verify"] as const) {
  test(`committed email departure cancels a resolved ${operation} preflight before POST`, async ({
    page,
    context,
  }) => {
    const { state, preferences } = await serveAccount(
      page,
      context,
      true,
      operation === "save",
      true,
    );
    if (operation === "save")
      await preferences
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
    await page.waitForLoadState("networkidle");
    await holdProjectSessionUntilUnmount(page, ".email-card");
    try {
      if (operation === "save")
        await preferences
          .getByRole("switch", { name: "Activity email", exact: true })
          .click();
      else
        await preferences
          .getByRole("button", { name: "Send verification", exact: true })
          .click();
      await leaveEditorWithHeldSession(page);
      expect(state.posts).toEqual([]);
      await expect(preferences).toHaveCount(0);
    } finally {
      await releaseHeldEditorSession(page);
    }
  });
}

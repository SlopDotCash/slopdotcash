/** An older email action must not complete or erase a newer mail link. */
import type { Page } from "@playwright/test";
import { enlargeText } from "../text-size";
import { expect, expectAccessible, test } from "./fixtures";
import {
  holdProjectSessionUntilUnmount,
  leaveEditorWithHeldSession,
  releaseHeldEditorSession,
} from "./project-draft-fixture";

/** Real Inbox component with synthetic mail/session authorities, no mail sent. */
async function serveDepartingEmailAction(page: Page) {
  const posts: { path: string; token: string }[] = [];
  await page.route("**/api/v1/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice("/api/v1/".length);
    if (path === "project-session")
      return route.fulfill({
        json: { session: { githubId: "42", githubLogin: "fixture-member" } },
      });
    if (path === "points/me") return route.fulfill({ json: null });
    if (path === "projects")
      return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
    if (path === "notifications")
      return route.fulfill({
        json: { recipientGithubId: "42", notifications: [], unread: 0 },
      });
    if (path === "security-cases")
      return route.fulfill({
        json: {
          viewer: { githubId: "42", githubLogin: "fixture-member" },
          programs: [],
          cases: [],
        },
      });
    if (path === "security-submissions")
      return route.fulfill({
        json: { recipientGithubId: "42", automatic: false, submissions: [] },
      });
    if (path === "notifications/email/verify") {
      posts.push({ path, token: request.postDataJSON().token });
      return route.fulfill({
        json: {
          enabled: true,
          securityEnabled: true,
          enrollmentAvailable: true,
          pending: null,
          availability: "verified",
          email: "fixture@example.com",
          destinationVersion: "d".repeat(64),
        },
      });
    }
    throw new Error(`Unexpected email-link fixture request: ${path}`);
  });
  await page.goto("/how-it-works", { waitUntil: "networkidle" });
  // Keep traversal within one document, so removal and the held continuation
  // meet at a React commit rather than a destroyed JavaScript context.
  await page.evaluate(() => {
    window.history.pushState(null, "", "/inbox");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(
    page.getByRole("heading", { name: "Inbox", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".inbox-empty")).toBeVisible();
  await expect(
    page.getByText("You have no private reports yet.", { exact: true }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  return posts;
}

async function openSyntheticVerification(page: Page, token: string) {
  await page.evaluate((token) => {
    window.history.replaceState(
      window.history.state,
      "",
      `/inbox#verify-email=${token}`,
    );
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, token);
}

test("committed email-action removal refuses a decoded verification preflight", async ({
  page,
}) => {
  const posts = await serveDepartingEmailAction(page);
  const token = "a".repeat(64);
  await openSyntheticVerification(page, token);
  const verify = page.getByRole("region", {
    name: "Verify email",
    exact: true,
  });
  await expect(
    verify.getByRole("button", { name: "Verify email", exact: true }),
  ).toBeEnabled();
  await page.waitForLoadState("networkidle");
  await holdProjectSessionUntilUnmount(page, ".email-link-action");
  try {
    await verify
      .getByRole("button", { name: "Verify email", exact: true })
      .click();
    await leaveEditorWithHeldSession(page);
    expect(posts).toEqual([]);
    expect(
      await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("slop:email-action:v1") ?? "null"),
      ),
    ).toMatchObject({ kind: "verify", token, actor: "42" });
  } finally {
    await releaseHeldEditorSession(page);
  }
});

test("a departed initial account check cannot overwrite a retained replacement email token", async ({
  page,
}) => {
  const posts = await serveDepartingEmailAction(page);
  const token = "a".repeat(64);
  const replacement = `${"b".repeat(64)}.${"c".repeat(64)}`;
  await holdProjectSessionUntilUnmount(page, ".email-link-action");
  try {
    await openSyntheticVerification(page, token);
    await page.waitForFunction(
      () =>
        (
          window as typeof window & {
            heldEditorSession: { waiting: boolean };
          }
        ).heldEditorSession.waiting,
    );
    // Model a newer retained link without notifying the departing component.
    // Only its committed lifetime fence prevents A's initial callback from
    // binding and writing the old token over this stored replacement.
    const saved = {
      kind: "unsubscribe",
      token: replacement,
      actor: null,
      createdAt: Date.now(),
    };
    await page.evaluate(
      (saved) =>
        sessionStorage.setItem("slop:email-action:v1", JSON.stringify(saved)),
      saved,
    );
    await leaveEditorWithHeldSession(page);
    expect(posts).toEqual([]);
    expect(
      await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("slop:email-action:v1") ?? "null"),
      ),
    ).toEqual(saved);
    await page.goForward();
    await expect(
      page
        .getByRole("region", { name: "Unsubscribe", exact: true })
        .getByRole("button", { name: "Unsubscribe", exact: true }),
    ).toBeEnabled();
    expect(posts).toEqual([]);
  } finally {
    await releaseHeldEditorSession(page);
  }
});

test("a removed email action cannot capture a hash before passive listener cleanup", async ({
  page,
}) => {
  const posts = await serveDepartingEmailAction(page);
  const verification = "a".repeat(64);
  const unsubscribe = `${"b".repeat(64)}.${"c".repeat(64)}`;
  await openSyntheticVerification(page, verification);
  await expect(
    page
      .getByRole("region", { name: "Verify email", exact: true })
      .getByRole("button", { name: "Verify email", exact: true }),
  ).toBeEnabled();
  const retained = await page.evaluate(() =>
    sessionStorage.getItem("slop:email-action:v1"),
  );
  await page.evaluate((token) => {
    const state = { removed: false };
    const observer = new MutationObserver(() => {
      if (document.querySelector(".email-link-action")) return;
      observer.disconnect();
      state.removed = true;
      // Run while the old passive hash listener is still attached. Its
      // committed mounted guard must prevent both URL scrubbing and capture.
      window.history.replaceState(
        window.history.state,
        "",
        `/how-it-works#unsubscribe-email=${token}`,
      );
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    observer.observe(document.body, { childList: true, subtree: true });
    Object.assign(window, { removedEmailHash: state });
  }, unsubscribe);
  await page.goBack();
  await page.waitForFunction(
    () =>
      (
        window as typeof window & {
          removedEmailHash: { removed: boolean };
        }
      ).removedEmailHash.removed,
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  expect(new URL(page.url()).pathname).toBe("/how-it-works");
  expect(new URL(page.url()).hash).toBe(`#unsubscribe-email=${unsubscribe}`);
  expect(
    await page.evaluate(() => sessionStorage.getItem("slop:email-action:v1")),
  ).toBe(retained);
  expect(posts).toEqual([]);
});

for (const oldFails of [false, true]) {
  test(
    oldFails
      ? "an older failed email action leaves the new link available"
      : "an older successful email action cannot confirm a new unsubscribe link",
    async ({ page, diagnostics }, info) => {
      // The built app runs with synthetic sessions, tokens and mail responses.
      // No real email address, provider, account or preference is changed.
      const verification = "a".repeat(64);
      const unsubscribe = `${"b".repeat(64)}.${"c".repeat(64)}`;
      const preference = {
        enabled: true,
        securityEnabled: true,
        enrollmentAvailable: true,
        pending: null,
        availability: "verified",
        email: "fixture@example.com",
        destinationVersion: "d".repeat(64),
      };
      let release: (() => void) | undefined;
      let documentRequests = 0;
      const posts: { path: string; token: string }[] = [];
      page.on("request", (request) => {
        if (request.resourceType() === "document") documentRequests += 1;
      });
      diagnostics.allowResponse(
        503,
        "POST",
        "/api/v1/notifications/email/unsubscribe",
      );
      if (oldFails)
        diagnostics.allowResponse(
          503,
          "POST",
          "/api/v1/notifications/email/verify",
        );
      await page.route("**/api/v1/**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname.slice("/api/v1/".length);
        if (path === "project-session")
          return route.fulfill({
            json: {
              session: { githubId: "42", githubLogin: "fixture-member" },
            },
          });
        if (path === "projects")
          return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
        if (path === "notifications")
          return route.fulfill({
            json: { recipientGithubId: "42", notifications: [], unread: 0 },
          });
        if (path === "security-cases")
          return route.fulfill({
            json: {
              viewer: { githubId: "42", githubLogin: "fixture-member" },
              programs: [],
              cases: [],
            },
          });
        if (path === "security-submissions")
          return route.fulfill({
            json: {
              recipientGithubId: "42",
              automatic: false,
              submissions: [],
            },
          });
        if (path === "notifications/email/verify") {
          expect(request.headers()["x-slop-expected-github-id"]).toBe("42");
          posts.push({ path, token: request.postDataJSON().token });
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return route.fulfill(
            oldFails
              ? { status: 503, json: { error: "fixture_unavailable" } }
              : { json: preference },
          );
        }
        if (path === "notifications/email/unsubscribe") {
          posts.push({ path, token: request.postDataJSON().token });
          return route.fulfill(
            posts.filter((post) => post.path === path).length === 1
              ? { status: 503, json: { error: "fixture_unavailable" } }
              : { json: { enabled: false, securityEnabled: false } },
          );
        }
        throw new Error(`Unexpected email-link fixture request: ${path}`);
      });
      try {
        await page.goto(`/inbox#verify-email=${verification}`, {
          waitUntil: "networkidle",
        });
        const verify = page.getByRole("region", {
          name: "Verify email",
          exact: true,
        });
        await verify
          .getByRole("button", { name: "Verify email", exact: true })
          .focus();
        await page.keyboard.press("Enter");
        await expect.poll(() => posts.length).toBe(1);
        expect(posts[0]).toEqual({
          path: "notifications/email/verify",
          token: verification,
        });

        // Opening another fragment is an ordinary same-document navigation.
        // The first request remains in flight while the new action is shown.
        await page.goto(`/inbox#unsubscribe-email=${unsubscribe}`, {
          waitUntil: "commit",
        });
        const action = page.getByRole("region", {
          name: "Unsubscribe",
          exact: true,
        });
        await expect(action).toBeVisible();
        expect(documentRequests).toBe(1);
        expect(posts).toHaveLength(1);
        const oldResponse = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname.endsWith("/email/verify") &&
            response.request().method() === "POST",
        );
        release?.();
        await (await oldResponse).finished();
        await expect(action.getByText("Saving…", { exact: true })).toHaveCount(
          0,
        );
        await page.screenshot({
          path: info.outputPath("new-link-after-old-response.png"),
          fullPage: true,
        });

        // A completed verification says nothing about the new unsubscribe.
        // Its token must survive so reload and an explicit retry still work.
        await expect(action.getByRole("status")).toHaveCount(0);
        await expect(action.getByRole("alert")).toHaveCount(0);
        await expect(
          action.getByRole("button", { name: "Unsubscribe", exact: true }),
        ).toBeEnabled();
        const saved = await page.evaluate(() =>
          JSON.parse(sessionStorage.getItem("slop:email-action:v1") ?? "null"),
        );
        expect(saved).toMatchObject({
          kind: "unsubscribe",
          token: unsubscribe,
        });
        expect(posts).toHaveLength(1);
        await expectAccessible(page);
        await page.reload({ waitUntil: "networkidle" });
        await expect(
          action.getByRole("button", { name: "Unsubscribe", exact: true }),
        ).toBeEnabled();
        await enlargeText(page.locator("html"));
        await page.screenshot({
          path: info.outputPath("new-link-text-200.png"),
          fullPage: true,
        });
        await expectAccessible(page);
        const button = action.getByRole("button", {
          name: "Unsubscribe",
          exact: true,
        });
        await button.focus();
        await page.keyboard.press("Enter");
        await expect(action.getByRole("alert")).toBeVisible();
        await expect(action.getByRole("status")).toHaveCount(0);
        await expect(button).toBeEnabled();
        await button.focus();
        await page.keyboard.press("Enter");
        await expect(action.getByRole("status")).toHaveText(
          "Email notifications stopped.",
        );
        expect(
          posts.filter((post) => post.path.endsWith("/unsubscribe")),
        ).toEqual([
          { path: "notifications/email/unsubscribe", token: unsubscribe },
          { path: "notifications/email/unsubscribe", token: unsubscribe },
        ]);
        expect(
          await page.evaluate(() =>
            sessionStorage.getItem("slop:email-action:v1"),
          ),
        ).toBeNull();
        await page.screenshot({
          path: info.outputPath("new-link-explicitly-completed.png"),
          fullPage: true,
        });
        await expectAccessible(page);
      } finally {
        release?.();
      }
    },
  );
}

/** Browser -> Pages -> SQLite -> identity handlers; external GitHub is synthetic. */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { escapeRegExp, expect, expectAccessible, test } from "./fixtures";

// Keep the real browser isolation policy when serving the built static files.
function readBuiltSiteHeaders() {
  return Object.fromEntries(
    readFileSync("dist/_headers", "utf8")
      .split("\n\n")[0]
      .split("\n")
      .slice(1)
      .map((line) => {
        const colon = line.indexOf(":");
        return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
      }),
  );
}
const { site: SITE, identity: IDENTITY } = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);

for (const withObligations of [false, true])
  test(`account closure ${withObligations ? "with unpaid awards and a private case" : "without awards"} requires an explicit authenticated reopen`, async ({
    context,
    diagnostics,
    page,
  }, info) => {
    const staticHeaders = readBuiltSiteHeaders();
    const droppedClosure = new RegExp(
      `^console Failed to load resource: net::ERR_FAILED at ${escapeRegExp(SITE)}/api/v1/points/account/close$`,
      "u",
    );
    if (withObligations) diagnostics.allow(droppedClosure);
    // Explicit reopening is refused until authorized; closed-account read
    // authorization is checked directly below without loading a hidden panel.
    diagnostics.allow(
      /^console Failed to load resource: the server responded with a status of 40[19] .* at https:\/\/[^ ]+\/api\/v1\/(payments\/me|points\/join)$/u,
    );
    const child = spawn(
      "bun",
      [
        "scripts/account-closure-server.ts",
        ...(withObligations ? [] : ["--no-obligations"]),
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const lines = createInterface({ input: child.stdout });
    let releaseJoin = () => {};
    let releasePoll = () => {};
    try {
      const started = await new Promise<{
        url: string;
        token: string;
        otherToken: string;
        login: string;
      }>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Account fixture did not start: ${stderr}`)),
          10_000,
        );
        lines.once("line", (line) => {
          clearTimeout(timer);
          try {
            resolve(JSON.parse(line));
          } catch (error) {
            reject(error);
          }
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(new Error(`Account fixture stopped: ${stderr}`));
        });
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      let dropClosureResponse = withObligations;
      let interactiveGitHub = false;
      let otherIdentity = false;
      let pendingReplies = 0;
      let joins = 0;
      let holdJoin = false;
      let holdCompletedPoll = false;
      let completedPollHeld = false;
      const pollReleased = new Promise<void>((resolve) => {
        releasePoll = resolve;
      });
      const joinReleased = new Promise<void>((resolve) => {
        releaseJoin = resolve;
      });
      const completedCallbacks: string[] = [];
      const failures: string[] = [];
      const retiredRequests: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith("/api/v1/points/telegram/"))
          retiredRequests.push(url.pathname);
      });
      page.on("response", (response) => {
        if (response.url().startsWith(SITE) && response.status() >= 400)
          failures.push(
            `${response.status()} ${new URL(response.url()).pathname}`,
          );
      });
      const readState = async () =>
        (await fetch(`${started.url}/__fixture/state`)).json();
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (
          url.origin === "https://github.com" &&
          url.pathname === "/login/oauth/authorize"
        ) {
          const callback = new URL("/v1/oauth/callback", IDENTITY);
          callback.searchParams.set(
            "state",
            url.searchParams.get("state") ?? "",
          );
          callback.searchParams.set(
            "code",
            otherIdentity ? "local-other-code" : "local-identity-code",
          );
          await route.fulfill({
            contentType: "text/html",
            body: interactiveGitHub
              ? `<button onclick='location.replace(${JSON.stringify(callback.href)})'>Authorize synthetic GitHub</button>`
              : `<script>location.replace(${JSON.stringify(callback.href)})</script>`,
          });
          return;
        }
        if (url.origin === "https://avatars.githubusercontent.com") {
          await route.fulfill({
            contentType: "image/svg+xml",
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#777"/></svg>',
          });
          return;
        }
        if (url.origin !== SITE && url.origin !== IDENTITY)
          throw new Error(`Unexpected network origin: ${url.origin}`);
        if (url.origin === SITE && !url.pathname.startsWith("/api/")) {
          const path = join(
            process.cwd(),
            "dist",
            url.pathname === "/" ? "index.html" : url.pathname,
          );
          await route.fulfill({
            path: existsSync(path)
              ? path
              : join(process.cwd(), "dist/index.html"),
            headers: staticHeaders,
          });
          return;
        }
        if (url.pathname === "/api/v1/points/join") joins++;
        const response = await route.fetch({
          url: `${started.url}/${url.origin === SITE ? "site" : "identity"}${url.pathname}${url.search}`,
          maxRedirects: 0,
        });
        if (
          url.pathname === "/v1/oauth/poll" &&
          response.status() === 200 &&
          holdCompletedPoll
        ) {
          completedPollHeld = true;
          await pollReleased;
        }
        if (url.pathname === "/api/v1/points/join" && holdJoin)
          await joinReleased;
        if (url.pathname === "/v1/oauth/poll" && response.status() === 202)
          pendingReplies++;
        if (url.pathname === "/v1/oauth/callback" && response.status() === 200)
          completedCallbacks.push(await response.text());
        if (
          dropClosureResponse &&
          url.pathname === "/api/v1/points/account/close"
        ) {
          dropClosureResponse = false;
          await route.abort("failed");
          return;
        }
        // Browser redirect chains skip route interception. Start a new local
        // navigation for each redirect so external OAuth stays in this fixture.
        const location = response.headers().location;
        if (response.status() === 302 && location) {
          await route.fulfill({
            response,
            status: 200,
            headers: { ...response.headers(), "content-type": "text/html" },
            body: `<script>location.replace(${JSON.stringify(location)})</script>`,
          });
        } else await route.fulfill({ response });
      });
      await context.addCookies([
        {
          name: "__Host-slop_points",
          value: started.token,
          url: SITE,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ]);
      const before = await readState();
      expect(before.retained.payment_obligations).toHaveLength(
        withObligations ? 1 : 0,
      );
      expect(before.retained.security_cases).toHaveLength(
        withObligations ? 1 : 0,
      );
      const loaded = await page.goto(`${SITE}/account`);
      expect(loaded?.headers()["cross-origin-opener-policy"]).toBe(
        "same-origin",
      );
      expect(loaded?.headers()["content-security-policy"]).toContain(
        "script-src 'self'",
      );
      await expect(
        page.getByRole("region", { name: "Connections", exact: true }),
      ).toHaveCount(0);
      await expect(page.locator("#profile")).toHaveCount(0);
      await expect(
        page.getByRole("region", { name: "Wallets", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("region", { name: "Email preferences", exact: true }),
      ).toBeVisible();
      await expect(page.getByText(/Telegram/i)).toHaveCount(0);
      await expect(page.locator('a[href^="https://t.me/"]')).toHaveCount(0);
      await page.screenshot({
        path: info.outputPath("account-settings.png"),
        fullPage: true,
      });
      await page.goto(
        `${SITE}/points?q=${encodeURIComponent(started.login)}#people`,
      );
      const people = page.getByRole("region", { name: "People", exact: true });
      await expect(
        people.getByRole("link", { name: "X · @closing_x" }),
      ).toBeVisible();
      await expect(page.getByText(/Telegram/i)).toHaveCount(0);
      await expect(page.locator('a[href^="https://t.me/"]')).toHaveCount(0);
      expect((await readState()).connections).toEqual(before.connections);
      expect((await readState()).retained).toEqual(before.retained);
      await page.goto(`${SITE}/account`);
      await expect(
        page.locator("#security, #recovery, #close-account"),
      ).toHaveCount(0);
      await expect(
        page.getByRole("form", { name: "Close account", exact: true }),
      ).toHaveCount(0);
      await page.waitForLoadState("networkidle");
      // The Settings control was removed. Exercise the retained authenticated
      // API against this isolated real database without adding another UI path.
      const closure = await page.evaluate(async (login) => {
        try {
          const response = await fetch("/api/v1/points/account/close", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ login }),
          });
          return {
            status: response.status,
            body: await response.json(),
            networkError: false,
          };
        } catch {
          return { status: null, body: null, networkError: true };
        }
      }, started.login);
      if (withObligations) {
        expect(closure.networkError).toBe(true);
      } else {
        expect(closure.status).toBe(200);
        expect(closure.body.closed).toBe(true);
      }
      await page.reload({ waitUntil: "networkidle" });
      const closed = await readState();
      expect(closed.retained).toEqual(before.retained);
      expect(closed.member.public).toBe(0);
      expect(closed.member.closed_at).not.toBeNull();
      expect(closed.preferences.enabled).toBe(0);
      expect(closed.connections).toEqual([]);
      for (const token of [started.token, started.otherToken]) {
        const response = await fetch(
          `${started.url}/site/api/v1/points/sessions`,
          { headers: { cookie: `__Host-slop_points=${token}` } },
        );
        expect(response.status).toBe(401);
        const payments = await fetch(`${started.url}/site/api/v1/payments/me`, {
          headers: { cookie: `__Host-slop_points=${token}` },
        });
        expect(payments.status).toBe(401);
      }
      await page.screenshot({
        path: info.outputPath("account-closed.png"),
        fullPage: true,
      });
      const profile = page.locator("#profile");
      const signInPopup = page.waitForEvent("popup");
      await profile
        .getByRole("button", { name: "Continue with GitHub", exact: true })
        .click();
      const signInWindow = await signInPopup;
      await expect(profile).toContainText("You closed this account.");
      await expect.poll(() => signInWindow.isClosed()).toBe(true);
      expect(page.isClosed()).toBe(false);
      expect((await readState()).member.closed_at).not.toBeNull();
      const reopenPopup = page.waitForEvent("popup");
      await profile
        .getByRole("button", {
          name: "Reopen account with GitHub",
          exact: true,
        })
        .click();
      const reopenWindow = await reopenPopup;
      await expect(profile).toHaveCount(0);
      await expect(
        profile.getByRole("button", { name: /with GitHub$/u }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("region", { name: "Connections", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("region", { name: "Wallets", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("region", { name: "Email preferences", exact: true }),
      ).toBeVisible();
      await expect.poll(() => reopenWindow.isClosed()).toBe(true);
      expect(page.isClosed()).toBe(false);
      const reopened = await readState();
      expect(reopened.retained).toEqual(before.retained);
      expect(reopened.member).toEqual({ public: 1, closed_at: null });
      expect(reopened.connections).toEqual([]);
      expect(reopened.preferences.enabled).toBe(0);
      await expectAccessible(page);
      expect(retiredRequests).toEqual([]);
      expect(diagnostics.count(droppedClosure)).toBe(withObligations ? 1 : 0);
      expect(failures).toEqual(["409 /api/v1/points/join"]);
      await page.screenshot({
        path: info.outputPath("account-reopened.png"),
        fullPage: true,
      });
      // Exercise the real identity callback and session exchange from /login.
      // The original tab must keep the full return path while the popup closes.
      await page
        .getByRole("button", { name: "Your account", exact: true })
        .click();
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(
        page.getByRole("link", { name: "Log in", exact: true }),
      ).toBeVisible();
      const destination = "/account?source=github-login#connections";
      await page.goto(`${SITE}/login?next=${encodeURIComponent(destination)}`);
      interactiveGitHub = true;
      otherIdentity = true;
      holdCompletedPoll = true;
      const initialPendingReplies = pendingReplies;
      const initialJoins = joins;
      const cancelledPopup = page.waitForEvent("popup");
      await page
        .getByRole("button", { name: "Continue with GitHub", exact: true })
        .click();
      const cancelledWindow = await cancelledPopup;
      await expect(
        cancelledWindow.getByRole("button", {
          name: "Authorize synthetic GitHub",
        }),
      ).toBeVisible();
      expect(await cancelledWindow.evaluate(() => window.opener)).toBeNull();
      await expect
        .poll(() => pendingReplies)
        .toBeGreaterThan(initialPendingReplies);
      await cancelledWindow
        .getByRole("button", { name: "Authorize synthetic GitHub" })
        .click();
      await expect.poll(() => completedPollHeld).toBe(true);
      const cancel = page.getByRole("button", {
        name: "Cancel sign-in",
        exact: true,
      });
      await cancel.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("status")).toBeVisible();
      holdCompletedPoll = false;
      releasePoll();
      await expect.poll(() => cancelledWindow.isClosed()).toBe(true);
      expect(joins).toBe(initialJoins);
      expect((await readState()).assertions).toContainEqual({
        github_actor_id: "4200",
        consumed_at: null,
      });
      otherIdentity = false;
      const retryPendingReplies = pendingReplies;
      const returnPopup = page.waitForEvent("popup");
      await page
        .getByRole("button", { name: "Continue with GitHub", exact: true })
        .click();
      const returnWindow = await returnPopup;
      await expect(
        returnWindow.getByRole("button", {
          name: "Authorize synthetic GitHub",
        }),
      ).toBeVisible();
      await expect
        .poll(() => pendingReplies)
        .toBeGreaterThan(retryPendingReplies);
      await expect(
        page.getByRole("button", { name: "Waiting for GitHub…" }),
      ).toBeVisible();
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      await expectAccessible(page);
      await page.screenshot({
        path: info.outputPath("isolated-popup-pending-200.png"),
        fullPage: true,
      });
      holdJoin = true;
      await returnWindow
        .getByRole("button", { name: "Authorize synthetic GitHub" })
        .click();
      await expect(
        page.getByRole("button", { name: "Signing in…", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Cancel sign-in", exact: true }),
      ).toHaveCount(0);
      releaseJoin();
      await expect.poll(() => returnWindow.isClosed()).toBe(true);
      await expect(page).toHaveURL(`${SITE}${destination}`);
      await expect(
        page.getByRole("button", { name: "Your account", exact: true }),
      ).toBeVisible();
      expect(completedCallbacks).toHaveLength(4);
      expect(joins).toBe(initialJoins + 1);
      await page
        .getByRole("button", { name: "Your account", exact: true })
        .click();
      await expect(
        page.getByRole("region", { name: "Your account details", exact: true }),
      ).toContainText(`@${started.login}`);
      await page.keyboard.press("Escape");
      for (const body of completedCallbacks) {
        expect(body).toContain("window.close();");
        expect(body).not.toContain("<button");
        expect(body).not.toContain("<a ");
        expect(body).not.toContain("<h1");
      }
      await page.screenshot({
        path: info.outputPath("popup-closed-return-preserved.png"),
        fullPage: true,
      });
      await page.waitForLoadState("networkidle");
      if (!withObligations) {
        // A tab opened outside script may refuse window.close after navigation.
        // It stays blank when the browser refuses closing, with the CSP intact.
        const manual = await context.newPage();
        await manual.route(`${SITE}/__fixture/history`, (route) =>
          route.fulfill({
            contentType: "text/html",
            headers: staticHeaders,
            body: "<title>Previous page</title><p>Previous page</p>",
          }),
        );
        await manual.goto(`${SITE}/__fixture/history`);
        const startedFlow = await fetch(
          `${started.url}/identity/v1/oauth/start`,
          {
            method: "POST",
            headers: { origin: SITE, "content-type": "application/json" },
            body: JSON.stringify({ audience: "slop-points-web" }),
          },
        );
        expect(startedFlow.status).toBe(201);
        const flow = (await startedFlow.json()) as { authorizationUrl: string };
        interactiveGitHub = false;
        const callback = manual.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/v1/oauth/callback",
        );
        await manual.goto(flow.authorizationUrl);
        const completed = await callback;
        expect(completed.headers()["content-security-policy"]).toMatch(
          /script-src 'nonce-[^']+'/u,
        );
        await expect(manual.locator("body")).toHaveText("", {
          useInnerText: true,
        });
        await expect(manual.locator("a, button")).toHaveCount(0);
        expect(await manual.evaluate(() => window.opener)).toBeNull();
        await manual.screenshot({
          path: info.outputPath("standalone-completion-blank.png"),
          fullPage: true,
        });
        await manual.close();
      }
      await page.goto("about:blank");
    } finally {
      releasePoll();
      releaseJoin();
      await context.unrouteAll({ behavior: "wait" });
      lines.close();
      child.kill("SIGTERM");
    }
  });

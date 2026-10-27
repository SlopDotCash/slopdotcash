/** Browser -> Pages -> SQLite -> identity handlers; external GitHub is synthetic. */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { escapeRegExp, expect, expectAccessible, test } from "./fixtures";

const { site: SITE, identity: IDENTITY } = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);

for (const withObligations of [false, true])
  test(`account closure ${withObligations ? "with unpaid awards and a private case" : "without awards"} requires an explicit authenticated reopen`, async ({
    context,
    diagnostics,
    page,
  }, info) => {
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
          callback.searchParams.set("code", "local-identity-code");
          await route.fulfill({
            contentType: "text/html",
            body: `<script>location.replace(${JSON.stringify(callback.href)})</script>`,
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
        const response = await route.fetch({
          url: `${started.url}/${url.origin === SITE ? "site" : "identity"}${url.pathname}${url.search}`,
          maxRedirects: 0,
        });
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
      await page.goto(`${SITE}/account`);
      const connections = page.getByRole("region", { name: "Connections" });
      await expect(connections.getByRole("checkbox")).toHaveCount(0);
      await expect(page.getByText(/Telegram/i)).toHaveCount(0);
      await expect(page.locator('a[href^="https://t.me/"]')).toHaveCount(0);
      await page.screenshot({
        path: info.outputPath("account-connections.png"),
        fullPage: true,
      });
      await page.goto(`${SITE}/points#people`);
      const people = page.getByRole("region", { name: "People", exact: true });
      await page.getByLabel("Find a contributor").fill(started.login);
      await expect(
        people.getByRole("link", { name: "X · @closing_x" }),
      ).toBeVisible();
      await expect(page.getByText(/Telegram/i)).toHaveCount(0);
      await expect(page.locator('a[href^="https://t.me/"]')).toHaveCount(0);
      expect((await readState()).connections).toEqual(before.connections);
      expect((await readState()).retained).toEqual(before.retained);
      await page.goto(`${SITE}/account`);
      const recovery = page.locator("#recovery");
      await page.locator("#close-account > summary").click();
      await expect(
        recovery.getByRole("button", { name: "Close account", exact: true }),
      ).toBeDisabled();
      await recovery
        .getByLabel(/Type your GitHub username/u)
        .fill(started.login);
      await recovery
        .getByRole("button", { name: "Close account", exact: true })
        .click();
      if (withObligations) {
        await expect(recovery.getByRole("alert")).toContainText(
          "Could not confirm whether your account closed.",
        );
        await page.reload();
      } else {
        await expect(recovery).toContainText("Your account is closed");
      }
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
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "Your account is open again." }),
      ).toBeVisible();
      await expect(
        profile.getByRole("button", { name: /with GitHub$/u }),
      ).toHaveCount(0);
      await expect(
        profile.getByRole("region", { name: "Connections", exact: true }),
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
    } finally {
      lines.close();
      child.kill("SIGTERM");
    }
  });

/**
 * Real Vite local-mode regression for blocked-popup sign-in return paths.
 * Run: SLOP_PYTHON=<PyYAML interpreter> bun run test:local-signin
 * CI runs this once in the preview-1 browser lane after installing Chromium.
 * OAuth is the same explicit protocol double used by login.spec.ts; no real
 * GitHub credentials or production service is used. The ordinary E2E suite
 * separately covers production popup behavior.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { prepareE2eFixture } from "../scripts/prepare-e2e-fixture.mjs";

const output = resolve(
  process.env.SLOP_LOCAL_SIGNIN_OUTPUT ?? "test-results/local-signin",
);
await mkdir(output, { recursive: true });
const workspace = await prepareE2eFixture();
// The copied fixture symlinks its dependencies. Permit only that exact
// dependency directory in this test server so self-hosted fonts can load.
const config = join(workspace, "vite.local-signin.config.mjs");
await writeFile(
  config,
  `import base from "./vite.config.ts";
import { mergeConfig } from "vite";
export default (env) => mergeConfig(base(env), { server: { fs: { allow: ${JSON.stringify([await realpath(workspace), await realpath(join(workspace, "node_modules"))])} } } });
`,
);
const listener = createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((done) => listener.close(done));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--config",
    config,
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  {
    cwd: workspace,
    env: { ...process.env, SLOP_DEV_BACKEND: "http://127.0.0.1:1" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverLog = "";
server.stdout.on("data", (chunk) => {
  serverLog += chunk;
});
server.stderr.on("data", (chunk) => {
  serverLog += chunk;
});
const results = [];
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      ready = (await fetch(origin)).ok;
    } catch {}
    if (ready) break;
    if (server.exitCode !== null)
      throw new Error("Local Vite exited before becoming ready");
    await delay(100);
  }
  assert.ok(ready, "Local Vite must become ready");
  const registry = JSON.parse(
    await readFile(
      join(workspace, "public/data/fixture-project-registry.json"),
      "utf8",
    ),
  );
  browser = await chromium.launch();
  for (const width of [1440, 320]) {
    for (const [name, start, destination] of [
      ["inline-account", "/account#profile", "/account#profile"],
      ["explicit-next", "/login?next=%2Faccount%23wallets", "/account#wallets"],
    ]) {
      const directory = join(output, `${name}-${width}`);
      await mkdir(directory, { recursive: true });
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        recordVideo: { dir: directory },
      });
      await context.addInitScript(() => {
        window.open = () => null;
      });
      let signedIn = false;
      const unexpectedRequests = [];
      const failures = [];
      const firstParty = (url) => new URL(url).origin === origin;
      context.on("response", (response) => {
        if (
          firstParty(response.url()) &&
          response.status() >= 400 &&
          !(
            response.status() === 401 &&
            response.request().method() === "GET" &&
            new URL(response.url()).pathname === "/api/v1/payments/me"
          )
        )
          failures.push(`${response.status()} ${response.url()}`);
      });
      context.on("requestfailed", (request) => {
        if (
          firstParty(request.url()) &&
          !(
            request.failure()?.errorText === "net::ERR_ABORTED" &&
            request.method() === "GET" &&
            /^\/api\/v1\/(?:project-session|points\/(?:me|sessions)|payments\/me|notifications\/email)$/.test(
              new URL(request.url()).pathname,
            )
          )
        )
          failures.push(`${request.failure()?.errorText} ${request.url()}`);
      });
      context.on("weberror", (error) =>
        failures.push(`page error ${error.error().message}`),
      );
      context.on("console", (message) => {
        if (
          message.type() === "error" &&
          !(
            message.location().url === `${origin}/api/v1/payments/me` &&
            /^Failed to load resource: the server responded with a status of 401 /.test(
              message.text(),
            )
          )
        )
          failures.push(`console ${message.text()}`);
      });
      const member = {
        actor: { id: "U_local_return", login: "local-return" },
        joinedAt: "2026-10-01T00:00:00Z",
        public: true,
        welcome: 0,
      };
      await context.route(`${origin}/api/v1/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        const method = route.request().method();
        if (path === "/api/v1/payments/me" && method === "GET")
          return route.fulfill({
            status: 401,
            json: { error: "unauthorized" },
          });
        const allowed = new Set([
          "GET /api/v1/projects",
          "GET /api/v1/project-session",
          "GET /api/v1/project-appeals",
          "GET /api/v1/notifications/email",
          "POST /api/v1/points/join",
          "GET /api/v1/points/me",
          "GET /api/v1/points/sessions",
        ]);
        if (!allowed.has(`${method} ${path}`)) {
          unexpectedRequests.push(`${method} ${path}`);
          return route.fulfill({
            status: 501,
            json: { error: "unexpected_fixture_route" },
          });
        }
        let json;
        if (path === "/api/v1/projects") json = registry;
        else if (path === "/api/v1/project-session")
          json = {
            session: signedIn
              ? { githubId: "98765", githubLogin: "local-return", admin: false }
              : null,
          };
        else if (path === "/api/v1/project-appeals") json = { appeals: [] };
        else if (path === "/api/v1/notifications/email")
          json = { enabled: false, availability: "unverified" };
        else if (path === "/api/v1/points/join") {
          signedIn = true;
          json = member;
        } else if (path === "/api/v1/points/me")
          json = signedIn ? member : null;
        else if (path === "/api/v1/points/sessions") json = { sessions: [] };
        return route.fulfill({ json });
      });
      const flow = {
        flowId: `flow_${"f".repeat(24)}`,
        pollCapability: "p".repeat(48),
        expiresAt: new Date(Date.now() + 240_000).toISOString(),
        pollAfterSeconds: 1,
        authorizationUrl: `${origin}/v1/oauth/authorize?flow_id=flow_${"f".repeat(24)}&state=${"s".repeat(48)}`,
      };
      await context.route(`${origin}/v1/oauth/**`, (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/v1/oauth/start" && route.request().method() === "POST")
          return route.fulfill({ json: flow });
        if (
          path === "/v1/oauth/authorize" &&
          route.request().method() === "GET"
        )
          return route.fulfill({
            contentType: "text/html",
            body: '<title>Local OAuth fixture</title><a href="/login">Return to Slop</a>',
          });
        if (path !== "/v1/oauth/poll" || route.request().method() !== "POST") {
          unexpectedRequests.push(`${route.request().method()} ${path}`);
          return route.fulfill({
            status: 501,
            json: { error: "unexpected_fixture_route" },
          });
        }
        return route.fulfill({
          json: {
            status: "complete",
            assertionType: "SlopIdentity",
            assertion: `slop_assert_v1_${"a".repeat(48)}`,
            expiresAt: flow.expiresAt,
          },
        });
      });
      const page = await context.newPage();
      let actual = "";
      let error = "";
      try {
        await page.goto(`${origin}${start}`);
        await page
          .getByRole("button", { name: "Continue with GitHub", exact: true })
          .waitFor();
        await page.screenshot({
          path: join(directory, "before-signin.png"),
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "Continue with GitHub", exact: true })
          .click();
        const joined = page.waitForResponse(
          (response) =>
            response.url() === `${origin}/api/v1/points/join` &&
            response.request().method() === "POST" &&
            response.status() === 200,
        );
        await page.getByRole("link", { name: "Return to Slop" }).click();
        await (await joined).finished();
        await page.waitForURL((url) => url.pathname !== "/login", {
          timeout: 15_000,
        });
        await page
          .getByRole("heading", { level: 1 })
          .waitFor({ state: "visible" });
        actual = `${new URL(page.url()).pathname}${new URL(page.url()).search}${new URL(page.url()).hash}`;
        assert.equal(
          signedIn,
          true,
          "The local flow must complete the session exchange",
        );
        assert.equal(
          actual,
          destination,
          "Sign-in must retain its originating destination",
        );
        await page
          .getByRole("heading", { name: "Settings", exact: true })
          .waitFor({ state: "visible" });
        await page.locator("#profile").waitFor({ state: "detached" });
        assert.equal(
          await page
            .getByRole("region", { name: "Connections", exact: true })
            .count(),
          0,
        );
        for (const name of ["Wallets", "Email preferences"]) {
          const section = page.getByRole("region", { name, exact: true });
          await section.waitFor({ state: "visible" });
          assert.equal(await section.locator("summary").count(), 0);
          await section
            .getByRole("heading", { name, exact: true })
            .waitFor({ state: "visible" });
        }
        const loadedFonts = await page.evaluate(async () => {
          const loaded = await Promise.all(
            [
              '16px "Bricolage Grotesque Variable"',
              '700 16px "JetBrains Mono"',
            ].map((font) => document.fonts.load(font)),
          );
          await document.fonts.ready;
          return loaded.map(
            (fonts) =>
              fonts.length > 0 &&
              fonts.every((font) => font.status === "loaded"),
          );
        });
        assert.deepEqual(
          loadedFonts,
          [true, true],
          "Both local fonts must load",
        );
        assert.deepEqual(
          unexpectedRequests,
          [],
          "Only explicit API fixtures may answer requests",
        );
        assert.deepEqual(
          failures,
          [],
          "No unexpected browser or asset failures",
        );
      } catch (caught) {
        error = String(caught);
      }
      await page.screenshot({
        path: join(directory, "after-signin.png"),
        fullPage: true,
      });
      results.push({
        name,
        width,
        start,
        destination,
        actual,
        passed: error === "",
        error,
        unexpectedRequests,
        failures,
      });
      console.log(`${error ? "FAIL" : "PASS"} ${name} ${width}: ${actual}`);
      await context.close();
    }
  }
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) {
    const exited = once(server, "exit");
    const killTimer = setTimeout(() => server.kill("SIGKILL"), 5000);
    server.kill("SIGTERM");
    try {
      await exited;
    } finally {
      clearTimeout(killTimer);
    }
  }
  await writeFile(join(output, "vite.log"), serverLog);
  await writeFile(
    join(output, "results.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  await rm(workspace, { recursive: true, force: true });
}
if (results.some((result) => !result.passed)) process.exitCode = 1;

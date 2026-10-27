/**
 * Real Vite local-mode regression for blocked-popup sign-in return paths.
 * Run: SLOP_PYTHON=<PyYAML interpreter> node tests/local-signin.browser.mjs
 * OAuth is the same explicit protocol double used by login.spec.ts; no real
 * GitHub credentials or production service is used. The ordinary E2E suite
 * separately covers production popup behavior.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
      const member = {
        actor: { id: "U_local_return", login: "local-return" },
        joinedAt: "2026-10-01T00:00:00Z",
        public: true,
        welcome: 0,
      };
      await context.route(`${origin}/api/v1/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/v1/payments/me")
          return route.fulfill({
            status: 401,
            json: { error: "unauthorized" },
          });
        let json = null;
        if (path === "/api/v1/projects") json = registry;
        else if (path === "/api/v1/project-session")
          json = {
            session: signedIn
              ? { githubId: "98765", githubLogin: "local-return", admin: false }
              : null,
          };
        else if (path === "/api/v1/project-appeals") json = { appeals: [] };
        else if (path === "/api/v1/points/join") {
          signedIn = true;
          json = member;
        } else if (path === "/api/v1/points/me")
          json = signedIn ? member : null;
        else if (path === "/api/v1/points/x/me")
          json = { configured: false, account: null, award: null };
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
        if (path === "/v1/oauth/start") return route.fulfill({ json: flow });
        if (path === "/v1/oauth/authorize")
          return route.fulfill({
            contentType: "text/html",
            body: '<title>Local OAuth fixture</title><a href="/login">Return to Slop</a>',
          });
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
        await page.getByRole("link", { name: "Return to Slop" }).click();
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
          .getByRole("heading", { name: "Account", exact: true })
          .waitFor({ state: "visible" });
        if (name === "inline-account")
          await page.locator("#profile").waitFor({ state: "visible" });
        else {
          const wallets = page.locator("#wallets");
          await wallets.waitFor({ state: "visible" });
          assert.equal(await wallets.getAttribute("open"), "");
        }
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
      });
      console.log(`${error ? "FAIL" : "PASS"} ${name} ${width}: ${actual}`);
      await context.close();
    }
  }
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await writeFile(join(output, "vite.log"), serverLog);
  await writeFile(
    join(output, "results.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  await rm(workspace, { recursive: true, force: true });
}
if (results.some((result) => !result.passed)) process.exitCode = 1;

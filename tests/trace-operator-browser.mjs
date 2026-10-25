/** Exact built UI over the native Pages/D1/R2 fixture in trace/workflow.mjs. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

export async function runTraceOperatorUi({
  db,
  bucket,
  site,
  signIn,
  digests,
  contents,
  browser,
  setStaticHandler,
}) {
  const build = resolve(process.env.SLOP_TRACE_UI_BUILD);
  const output = resolve(
    process.env.SLOP_TRACE_UI_OUTPUT ?? "test-results/trace-operator-ui",
  );
  const before = process.env.SLOP_TRACE_UI_BEFORE === "1";
  await mkdir(output, { recursive: true });
  setStaticHandler(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, site).pathname);
    const file = resolve(build, `.${path}`);
    if (!file.startsWith(`${build}${sep}`)) {
      response.writeHead(403);
      response.end();
      return;
    }
    let selected = file;
    try {
      if (!(await stat(file)).isFile()) selected = join(build, "index.html");
    } catch {
      selected = join(build, "index.html");
    }
    response.writeHead(200, {
      "content-type": types[extname(selected)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(await readFile(selected));
  });
  const results = [];
  for (const [name, viewport] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const directory = join(output, name);
    await mkdir(directory, { recursive: true });
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport,
      acceptDownloads: true,
      recordVideo: { dir: directory, size: viewport },
    });
    // A remote avatar is unrelated to trace access. All product requests use
    // the actual loopback HTTPS Pages bridge; no public host is contacted.
    await context.route("https://avatars.githubusercontent.com/**", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><rect width="36" height="36" fill="#555"/></svg>',
      }),
    );
    const page = await context.newPage();
    const errors = [];
    const failedRequests = [];
    const firstPartyFailures = [];
    let expectedHttpError = null;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !message.text().startsWith("Failed to load resource:")
      )
        errors.push(message.text());
    });
    page.on("requestfailed", (request) => {
      if (request.url().startsWith(site))
        failedRequests.push(new URL(request.url()).pathname);
    });
    page.on("response", (response) => {
      if (response.url().startsWith(site) && response.status() >= 400) {
        const path = new URL(response.url()).pathname;
        if (
          expectedHttpError?.path !== path ||
          expectedHttpError.status !== response.status()
        )
          firstPartyFailures.push({ path, status: response.status() });
      }
    });
    async function login(id) {
      const cookie = await signIn(id);
      const split = cookie.indexOf("=");
      await context.addCookies([
        {
          name: cookie.slice(0, split),
          value: cookie.slice(split + 1),
          url: site,
          httpOnly: true,
          secure: true,
          sameSite: "Strict",
        },
      ]);
      return cookie;
    }
    async function accessible() {
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      assert.deepEqual(result.violations, []);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
    }
    try {
      await login("91");
      await page.goto(`${site}/operator/traces`, { waitUntil: "networkidle" });
      if (before) {
        await expect(
          page.getByRole("heading", { name: "Page not found" }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Download private trace" }),
        ).toHaveCount(0);
        await page.screenshot({
          path: join(directory, "before.png"),
          fullPage: true,
        });
        await page.waitForTimeout(1500);
        results.push({ viewport: name, before: "No operator trace UI" });
        continue;
      }
      await page.getByRole("button", { name: "Your account" }).click();
      await expect(
        page.getByRole("link", { name: "Private traces", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Admin", exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole("link", { name: "Private traces", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Private traces", exact: true }),
      ).toBeVisible();
      const digest = page.getByRole("textbox", {
        name: "Trace SHA-256 digest",
      });
      const reason = page.getByRole("textbox", { name: "Reason for access" });
      const submit = page.getByRole("button", {
        name: "Download private trace",
        exact: true,
      });
      await digest.fill(digests[0]);
      await reason.fill(`Inspect synthetic ${name} contribution evidence`);
      await reason.focus();
      await page.keyboard.press("Tab");
      await expect(submit).toBeFocused();
      await accessible();
      await page.screenshot({
        path: join(directory, "form-keyboard.png"),
        fullPage: true,
      });
      const initialCount = await db
        .prepare("SELECT count(*) n FROM private_audit_events")
        .first();
      const pending = page.waitForEvent("download");
      await page.keyboard.press("Enter");
      const downloaded = await pending;
      const file = join(directory, "synthetic-download.txt");
      await downloaded.saveAs(file);
      assert.equal(hash(await readFile(file)), digests[0]);
      assert.equal(downloaded.suggestedFilename(), `trace-${digests[0]}.txt`);
      await expect(page.getByRole("status")).toContainText(
        "Exact bytes verified",
      );
      await expect(reason).toHaveValue("");
      const afterCount = await db
        .prepare("SELECT count(*) n FROM private_audit_events")
        .first();
      assert.equal(afterCount.n - initialCount.n, 2);
      await page.screenshot({
        path: join(directory, "download-verified.png"),
        fullPage: true,
      });

      const key = `traces/sha256/${digests[0].slice(0, 2)}/${digests[0]}`;
      await bucket.delete(key);
      expectedHttpError = {
        path: `/api/v1/operator/traces/${digests[0]}`,
        status: 503,
      };
      await reason.fill("Retry the unavailable synthetic object");
      await submit.click();
      await expect(page.getByRole("alert")).toContainText("new one-use grant");
      await expect(reason).toHaveValue(
        "Retry the unavailable synthetic object",
      );
      await accessible();
      await page.screenshot({
        path: join(directory, "download-retry.png"),
        fullPage: true,
      });
      await bucket.put(key, contents[0], {
        customMetadata: { sha256: digests[0] },
        httpMetadata: { contentType: "text/plain" },
      });
      expectedHttpError = null;
      const retryDownload = page.waitForEvent("download");
      await submit.focus();
      await page.keyboard.press("Enter");
      const retried = await retryDownload;
      await retried.saveAs(file);
      assert.equal(hash(await readFile(file)), digests[0]);
      await expect(page.getByRole("status")).toContainText(
        "Exact bytes verified",
      );

      expectedHttpError = {
        path: `/api/v1/operator/traces/${digests[0]}`,
        status: 403,
      };
      await page.route(
        `**/api/v1/operator/traces/${digests[0]}`,
        async (route) => {
          const grant = route.request().headers()["x-trace-read-grant"];
          assert.ok(grant);
          await db
            .prepare(
              "UPDATE trace_read_grants SET expires_at=? WHERE token_hash=?",
            )
            .bind(new Date(Date.now() - 1000).toISOString(), hash(grant))
            .run();
          await route.continue();
        },
        { times: 1 },
      );
      await reason.fill("Check expired synthetic access recovery");
      await submit.click();
      await expect(page.getByRole("alert")).toContainText("grant expired");
      await expect(reason).toHaveValue(
        "Check expired synthetic access recovery",
      );
      expectedHttpError = null;
      const expiredRetry = page.waitForEvent("download");
      await submit.click();
      await (await expiredRetry).saveAs(file);
      assert.equal(hash(await readFile(file)), digests[0]);
      await expect(page.getByRole("status")).toContainText(
        "Exact bytes verified",
      );
      assert.equal(
        await page
          .locator("body")
          .textContent()
          .then((text) => text.includes(contents[0].toString())),
        false,
      );
      const storage = await page.evaluate(() =>
        JSON.stringify([localStorage, sessionStorage]),
      );
      assert.ok(!storage.includes("synthetic"));
      assert.ok(!storage.includes("grant"));
      await accessible();

      await login("93");
      await page.reload({ waitUntil: "networkidle" });
      await expect(page.getByRole("alert")).toContainText(
        "not a designated trace operator",
      );
      await expect(submit).toHaveCount(0);
      await page.getByRole("button", { name: "Your account" }).click();
      await expect(
        page.getByRole("link", { name: "Admin", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Private traces", exact: true }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
      await accessible();
      await page.screenshot({
        path: join(directory, "admin-denied.png"),
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      assert.deepEqual(failedRequests, []);
      assert.deepEqual(firstPartyFailures, []);
      results.push({
        viewport: name,
        exactDigest: digests[0],
        auditEventsPerRead: 2,
        downloadRecovery: true,
        expiredRecovery: true,
        adminDenied: true,
        accessibilityViolations: 0,
        unexpectedErrors: 0,
      });
    } finally {
      await context.close();
    }
  }
  await writeFile(
    join(output, "results.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  console.log(
    `PASS: operator trace UI ${before ? "baseline" : "workflow"}, desktop and mobile`,
  );
}

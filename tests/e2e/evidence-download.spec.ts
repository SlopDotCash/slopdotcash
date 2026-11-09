/** Actual Pages/D1/R2 signed transport and native browser attachment workflow. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { fixtureRepository } from "../github-api-fixture.mjs";
import { applicationManifest } from "../project-application-manifest";
import { enlargeText } from "../text-size";
import { signedVettingHeaders } from "../vetting-fixtures";
import { expect, expectAccessible, test } from "./fixtures";

/** Release the final identity response between DOM commit and passive effects. */
async function holdFinalEvidenceSession(page: Page, sessionNumber: number) {
  await page.evaluate((sessionNumber) => {
    const state = {
      reads: 0,
      waiting: false,
      removed: false,
      returned: false,
      clicks: [] as string[],
      release: () => {},
    };
    Object.assign(window, { heldEvidenceSession: state });
    const json = Response.prototype.json;
    Response.prototype.json = async function (this: Response) {
      const value = await json.call(this);
      if (this.url.endsWith("/api/v1/project-session")) {
        state.reads += 1;
        if (state.reads === sessionNumber) {
          state.waiting = true;
          await new Promise<void>((resolve) => {
            state.release = resolve;
          });
          state.returned = true;
        }
      }
      return value;
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (
        this.href.startsWith("blob:") ||
        /\/api\/v1\/operator\/vetting-evidence\/.*\/download$/u.test(this.href)
      )
        state.clicks.push(this.href);
      click.call(this);
    };
    const observer = new MutationObserver(() => {
      if (state.waiting && !document.querySelector(".evidence-object")) {
        state.removed = true;
        state.release();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }, sessionNumber);
}

for (const mode of ["streamed", "buffered"] as const) {
  test(`committed departure cancels the final ${mode} evidence download`, async ({
    page,
    diagnostics,
  }) => {
    // This exercises the real page, hash check, identity helper and native
    // anchor boundary. The existing registry test below covers real D1/R2
    // grants and bytes; these small HTTP fixtures control only the race.
    diagnostics.allowPreviewApiMisses();
    const bytes = Buffer.from([0, 1, 2, 3, 250, 251, 252, 253]);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const label = `${mode} evidence fixture`;
    const base = `/api/v1/operator/vetting-evidence/committed-reader/run/${hash}`;
    const path = "/vetting-evidence?assessmentId=committed-reader&runId=run";
    let grants = 0;
    let bodyReads = 0;
    let nativeReads = 0;
    let downloads = 0;
    page.on("download", () => {
      downloads += 1;
    });
    await page.route("**/api/v1/project-session", (route) =>
      route.fulfill({
        json: {
          session: { githubId: "4242", githubLogin: "operator", admin: true },
        },
      }),
    );
    await page.route("**/api/v1/operator/vetting-evidence?**", (route) =>
      route.fulfill({
        json: {
          retentionBoundary: "Private retained fixture evidence.",
          runs: [
            {
              assessmentId: "committed-reader",
              runId: "run",
              manifestSha256: "a".repeat(64),
              expiresAt: null,
              policy: { version: "fixture" },
              objects: [
                {
                  sha256: hash,
                  sizeBytes: bytes.length,
                  kind: "artifact",
                  label,
                  contentType: "application/octet-stream",
                  state: "stored-unverified",
                  streamed: mode === "streamed",
                },
              ],
            },
          ],
        },
      }),
    );
    await page.route(
      `**${base}/${mode === "streamed" ? "download-grant" : "grant"}`,
      (route) => {
        grants += 1;
        expect(route.request().headers()["x-slop-expected-github-id"]).toBe(
          "4242",
        );
        return route.fulfill({
          json: mode === "streamed" ? {} : { grant: "fixture-grant" },
        });
      },
    );
    await page.route(`**${base}/body`, (route) => {
      bodyReads += 1;
      expect(route.request().headers()["x-vetting-read-grant"]).toBe(
        "fixture-grant",
      );
      return route.fulfill({
        contentType: "application/octet-stream",
        body: bytes,
      });
    });
    await page.route(`**${base}/download`, (route) => {
      nativeReads += 1;
      return route.fulfill({
        body: bytes,
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": 'attachment; filename="abandoned-fixture.bin"',
        },
      });
    });
    await page.goto(path, { waitUntil: "networkidle" });
    await page
      .getByRole("button", {
        name: `Select ${label}, ${hash.slice(0, 12)}`,
        exact: true,
      })
      .click();
    await page
      .getByLabel(`Reason to inspect ${label}`)
      .fill("Inspect exact fixture bytes without execution");
    await holdFinalEvidenceSession(page, mode === "streamed" ? 2 : 3);
    await page.evaluate((path) => {
      window.history.replaceState(window.history.state, "", "/how-it-works");
      window.history.pushState({}, "", path);
    }, path);
    try {
      await page
        .getByRole("button", { name: `Download ${label}`, exact: true })
        .click();
      await page.waitForFunction(
        () =>
          (
            window as typeof window & {
              heldEvidenceSession: { waiting: boolean };
            }
          ).heldEvidenceSession.waiting,
      );
      await page.goBack();
      await page.waitForFunction(() => {
        const state = (
          window as typeof window & {
            heldEvidenceSession: { removed: boolean; returned: boolean };
          }
        ).heldEvidenceSession;
        return state.removed && state.returned;
      });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );
      await expect(page).toHaveURL(/\/how-it-works$/u);
      expect(grants).toBe(1);
      expect(bodyReads).toBe(mode === "buffered" ? 1 : 0);
      expect(nativeReads).toBe(0);
      expect(downloads).toBe(0);
      expect(
        await page.evaluate(
          () =>
            (
              window as typeof window & {
                heldEvidenceSession: { clicks: string[] };
              }
            ).heldEvidenceSession.clicks,
        ),
      ).toEqual([]);
    } finally {
      await page.evaluate(() =>
        (
          window as typeof window & { heldEvidenceSession: { release(): void } }
        ).heldEvidenceSession.release(),
      );
    }
  });
}

test("large private evidence downloads with a single-use browser grant @registry", async ({
  page,
  request,
  baseURL,
  diagnostics,
}, info) => {
  const origin = new URL(baseURL!).origin;
  const suffix = info.project.name.replaceAll(/[^a-z0-9-]/g, "-");
  const project = `large-evidence-${suffix}`;
  const api = (path: string, body: unknown, admin = false) =>
    request.post(`/api/v1/${path}`, {
      headers: {
        origin,
        cookie: `__Host-slop_points=${process.env[admin ? "SLOP_E2E_ADMIN_TOKEN" : "SLOP_E2E_APPLICANT_TOKEN"]}`,
      },
      data: body,
    });
  const repository = `e2e-applicant/large-evidence-${suffix}`;
  const facts = fixtureRepository(repository);
  const projectManifest = applicationManifest(project, repository);
  const steward = projectManifest.steward as Record<string, unknown>;
  projectManifest.steward = {
    ...steward,
    kind: facts.owner.type === "User" ? "individual" : "organization",
    github: {
      ...(steward.github as Record<string, unknown>),
      actorId: String(facts.owner.id),
      nodeId: facts.owner.node_id,
      login: facts.owner.login,
      type: facts.owner.type,
      profileUrl: `https://github.com/${facts.owner.login}`,
    },
  };
  projectManifest.authority = {
    ...(projectManifest.authority as Record<string, unknown>),
    repositoryId: String(facts.id),
    repositoryNodeId: facts.node_id,
  };
  // Creation reads the account's access through the Slopbot installation.
  const installed = await fetch(
    `${process.env.SLOP_E2E_GITHUB_API_ORIGIN}/__fixture/slopbot/${repository}/installed`,
    { method: "PUT" },
  );
  expect(installed.status).toBe(204);
  const submitted = await api("projects", {
    manifest: projectManifest,
  });
  expect(submitted.status(), await submitted.text()).toBe(201);
  // Creation queues its first scan automatically. Read that real assessment
  // instead of making an admin create a second request.
  const queue = await request.get("/api/v1/admin/vetting", {
    headers: {
      cookie: `__Host-slop_points=${process.env.SLOP_E2E_ADMIN_TOKEN}`,
    },
  });
  expect(queue.status()).toBe(200);
  const queued = (await queue.json()).assessments.find(
    (entry: { projectId: string }) => entry.projectId === project,
  );
  expect(queued).toBeDefined();
  const assessment = queued.id,
    runId = "large-evidence";
  const bytes = process.env.SLOP_VETTING_OVERLAY_PATH
    ? await readFile(process.env.SLOP_VETTING_OVERLAY_PATH)
    : Buffer.alloc(23_592_960, 71);
  const digest = (data: Uint8Array) =>
    createHash("sha256").update(data).digest("hex");
  const sha = digest(bytes),
    limit = 8 * 1024 * 1024;
  const chunks = [];
  for (let at = 0; at < bytes.length; at += limit) {
    const part = bytes.subarray(at, at + limit);
    chunks.push({
      index: chunks.length,
      sha256: digest(part),
      sizeBytes: part.length,
    });
  }
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    Buffer.from(process.env.SLOP_E2E_VETTING_PRIVATE_KEY!, "base64"),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const publicKey = Buffer.from(
    process.env.SLOP_E2E_VETTING_PUBLIC_KEY!,
    "base64",
  );
  const send = async (
    method: string,
    path: string,
    body: string | Uint8Array,
  ) =>
    request.fetch(path, {
      method,
      data: Buffer.from(body),
      headers: await signedVettingHeaders(
        privateKey,
        publicKey,
        method,
        path,
        body,
      ),
    });
  const base = `/api/v1/vetting/evidence/${assessment}/${runId}`;
  const manifest = JSON.stringify({
    traceSha256: sha,
    objects: [
      {
        sha256: sha,
        sizeBytes: bytes.length,
        kind: "disk-diff",
        label: "Synthetic VM disk overlay",
        contentType: "application/octet-stream",
        chunks,
      },
    ],
  });
  // The trace and disk bytes are the same immutable object in this transport fixture.
  const parsed = JSON.parse(manifest);
  parsed.objects[0].kind = "trace";
  expect((await send("POST", base, JSON.stringify(parsed))).status()).toBe(201);
  for (const part of chunks)
    expect(
      (
        await send(
          "PUT",
          `${base}/${sha}/chunks/${part.index}`,
          bytes.subarray(
            part.index * limit,
            part.index * limit + part.sizeBytes,
          ),
        )
      ).status(),
    ).toBe(200);
  expect((await send("POST", `${base}/${sha}/finalize`, "{}")).status()).toBe(
    200,
  );
  await page.goto("/how-it-works", { waitUntil: "networkidle" });
  await page.evaluate((token) => {
    document.cookie = `__Host-slop_points=${token}; Path=/; Secure; SameSite=Strict`;
  }, process.env.SLOP_E2E_EVIDENCE_OWNER_TOKEN!);
  await page.goto(
    `/vetting-evidence?assessmentId=${assessment}&runId=${runId}`,
    { waitUntil: "networkidle" },
  );
  const retention = page.getByText("Run details and retention", {
    exact: true,
  });
  await retention.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText(
      "Case open. Evidence is retained until 90 days after closure.",
      { exact: false },
    ),
  ).toBeVisible();
  await retention.focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("button", {
      name: `Select Synthetic VM disk overlay, ${sha.slice(0, 12)}`,
      exact: true,
    })
    .click();
  const item = page.getByRole("article").filter({
    has: page.getByRole("heading", {
      name: "Synthetic VM disk overlay",
      exact: true,
    }),
  });
  await item
    .getByRole("textbox")
    .fill("Inspect the complete synthetic disk overlay without execution");
  await item
    .getByRole("button", {
      name: "Download Synthetic VM disk overlay",
      exact: true,
    })
    .focus();
  let releaseGrant = () => {};
  let grantStarted = () => {};
  const grantWaiting = new Promise<void>((resolve) => {
    grantStarted = resolve;
  });
  const grantRelease = new Promise<void>((resolve) => {
    releaseGrant = resolve;
  });
  const grantPath = `/api/v1/operator/vetting-evidence/${assessment}/${runId}/${sha}/download-grant`;
  await page.route(`**${grantPath}`, async (route) => {
    const response = await route.fetch();
    grantStarted();
    await grantRelease;
    await route.fulfill({ response });
  });
  const abandonedDownloads: string[] = [];
  const observeAbandoned = (download: { suggestedFilename(): string }) => {
    abandonedDownloads.push(download.suggestedFilename());
  };
  page.on("download", observeAbandoned);
  const delayedGrant = page.waitForResponse(
    (response) => new URL(response.url()).pathname === grantPath,
  );
  await page.keyboard.press("Enter");
  await grantWaiting;
  try {
    // Leave through the actual SPA control while the real grant reply waits.
    await page.getByRole("link", { name: "Slop home", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Evidence inventory" }),
    ).toHaveCount(0);
  } finally {
    releaseGrant();
  }
  await (await delayedGrant).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(abandonedDownloads).toEqual([]);
  page.off("download", observeAbandoned);
  await page.unroute(`**${grantPath}`);
  await page.goto(
    `/vetting-evidence?assessmentId=${assessment}&runId=${runId}`,
    { waitUntil: "networkidle" },
  );
  await page
    .getByRole("button", {
      name: `Select Synthetic VM disk overlay, ${sha.slice(0, 12)}`,
      exact: true,
    })
    .click();
  await item
    .getByRole("textbox")
    .fill("Inspect the complete synthetic disk overlay without execution");
  await item
    .getByRole("button", {
      name: "Download Synthetic VM disk overlay",
      exact: true,
    })
    .focus();
  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  const downloaded = await downloadPromise;
  const file = info.outputPath("retained-overlay.qcow2");
  await downloaded.saveAs(file);
  expect(await downloaded.failure()).toBeNull();
  const saved = await readFile(file);
  expect(saved.byteLength).toBe(bytes.byteLength);
  expect(digest(saved)).toBe(sha);
  await info.attach("saved-evidence-integrity", {
    body: JSON.stringify({
      source: process.env.SLOP_VETTING_OVERLAY_PATH
        ? "operator-supplied-local-overlay"
        : "generated-transport-fixture",
      bytes: saved.byteLength,
      sha256: digest(saved),
    }),
    contentType: "application/json",
  });
  const cookies = await page.context().cookies();
  const downloadPath = `/api/v1/operator/vetting-evidence/${assessment}/${runId}/${sha}/download`;
  expect(
    cookies.some(
      (cookie) =>
        cookie.name === "__Secure-vetting-read-grant" &&
        cookie.path === downloadPath,
    ),
  ).toBe(true);
  // Responses retain the cookie so a delayed download cannot clear a newer
  // grant. Its D1 row is already spent: a real same-origin browser request,
  // including both session and path-scoped grant cookies, cannot replay it.
  diagnostics.allowResponse(403, "GET", downloadPath);
  const replay = await page.evaluate(async (path) => {
    const response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
    const body = (await response.json()) as { error: string };
    return { status: response.status, error: body.error };
  }, downloadPath);
  expect(replay).toEqual({ status: 403, error: "grant_invalid" });
  // Enlarge text at the current CSS viewport; this is not browser zoom.
  const restoreText = await enlargeText(page.locator("body"));
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("large-evidence-text-200.png"),
    fullPage: false,
  });
  await page.evaluate(() => {
    scrollTo(0, 0);
  });
  await restoreText();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("large-evidence.png"),
    fullPage: false,
  });
  const video = page.video();
  await page.close();
  if (video)
    await video.saveAs(info.outputPath("large-evidence-walkthrough.webm"));
});

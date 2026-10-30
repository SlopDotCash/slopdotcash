/** Actual Pages/D1/R2 signed transport and native browser attachment workflow. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fixtureRepository } from "../github-api-fixture.mjs";
import { applicationManifest } from "../project-application-manifest";
import { enlargeText } from "../text-size";
import { signedVettingHeaders } from "../vetting-fixtures";
import { expect, expectAccessible, test } from "./fixtures";

test("large private evidence downloads with a single-use browser grant @registry", async ({
  page,
  request,
  baseURL,
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
  await expect(item.getByRole("status")).toBeVisible();
  const cookies = await page.context().cookies();
  expect(
    cookies.some((cookie) => cookie.name === "__Secure-vetting-read-grant"),
  ).toBe(false);
  // Keep mobile reflow at the existing 320 CSS-pixel minimum. Use the
  // repository's 200% text enlargement check there, and CSS zoom elsewhere.
  const mobile = (page.viewportSize()?.width ?? 0) < 640;
  const restoreText = mobile
    ? await enlargeText(page.locator("body"))
    : undefined;
  if (!mobile)
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
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
    path: info.outputPath("large-evidence-zoom.png"),
    fullPage: false,
  });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "1";
    scrollTo(0, 0);
  });
  await restoreText?.();
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

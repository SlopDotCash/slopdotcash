/** Presentation around existing admin APIs; grants still require a reason. */
import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { enlargeText } from "../text-size";
import { expect, expectAccessible, test } from "./fixtures";
import { adminProjectRecord } from "./project-maintainer-fixture";

async function session(page: Page, signedIn = () => true) {
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: signedIn()
          ? { githubId: "4242", githubLogin: "operator", admin: true }
          : null,
      },
    }),
  );
}

test("selected admin project can queue after a superseded pending scan and preserves reasoned queuing", async ({
  page,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  await session(page);
  const project = PROJECTS.find((entry) => entry.id === "asi");
  if (!project) throw new Error("The frozen ASI project is required");
  const scan = {
    id: "scan-layout",
    projectId: project.id,
    revision: 1,
    state: "incomplete",
    commitSha: "a".repeat(40),
    templateSha256: "b".repeat(64),
    policyVersion: "scan-policy-v2",
    requestedAt: "2026-10-28T10:00:00.000Z",
    completedAt: "2026-10-28T11:00:00.000Z",
    modelRuns: [],
    artifacts: 1,
    heldArtifacts: 1,
    requestedBy: { githubLogin: "operator" },
    requestReason: "Review flagged install scripts",
    result: {
      schemaVersion: "slop-vetting-result-v2",
      scan: { runId: "run-layout" },
      coverage: {
        source: { state: "complete", items: 18 },
        dependencies: { state: "incomplete", items: 4 },
      },
      checks: { credential_access: "not-found", install_scripts: "incomplete" },
      visibilityGaps: ["Dependency source could not be inspected"],
      artifacts: [],
      findings: [],
      confirmation: null,
    },
  };
  // Superseded requests remain pending in the immutable scan history. Only
  // the newest request controls the queue for this project.
  const superseded = {
    ...scan,
    id: "superseded-scan",
    state: "pending",
    requestedAt: "2026-10-27T10:00:00.000Z",
    completedAt: null,
    result: null,
  };
  const nextScan = {
    ...scan,
    id: "next-scan",
    state: "pending",
    requestedAt: "2026-10-29T10:00:00.000Z",
    completedAt: null,
    result: null,
  };
  await page.route("**/api/v1/admin/projects", (route) =>
    route.fulfill({
      json: {
        projects: [adminProjectRecord(project)],
      },
    }),
  );
  let queued = false;
  const writes: unknown[] = [];
  await page.route("**/api/v1/admin/vetting", (route) =>
    route.fulfill({
      json: {
        service: { state: "available", queueRegistrationAvailable: true },
        projects: [
          {
            id: project.id,
            name: project.name,
            status: project.status,
            revision: 1,
            clearance: queued
              ? { state: "queued", assessment: nextScan }
              : { state: "quarantined", assessment: scan },
          },
        ],
        assessments: queued ? [nextScan, scan, superseded] : [scan, superseded],
        flags: [
          {
            id: "flag-layout",
            projectId: project.id,
            reporter: { githubLogin: "reporter" },
            category: "install-script",
            evidence: "An install script requests credentials.",
            evidenceUrl:
              "https://github.com/SlopDotCash/asi/blob/example/install.sh",
            createdAt: "2026-10-26T09:00:00.000Z",
          },
        ],
      },
    }),
  );
  await page.route("**/api/v1/admin/vetting/assessments", (route) => {
    writes.push(route.request().postDataJSON());
    queued = true;
    return route.fulfill({ json: {} });
  });
  await page.goto(`/admin?project=${project.id}`, { waitUntil: "networkidle" });
  await page.screenshot({
    path: info.outputPath("admin-default.png"),
    fullPage: true,
  });
  await expect(
    page.getByRole("heading", { name: project.name, exact: true }),
  ).toHaveCount(1);
  await expect(page.locator("main details")).toHaveCount(0);
  await page.getByRole("link", { name: "Security", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/admin\\?project=${project.id}&section=security$`, "u"),
  );
  const card = page.getByRole("article", {
    name: `Security vetting for ${project.id}`,
  });
  await expect(card.getByLabel("Reason for the scan")).toBeVisible();
  await expect(
    card.getByText("An install script requests credentials.", { exact: false }),
  ).toBeVisible();
  await expect(page.locator("main details")).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(`/admin?project=${project.id}`);
  await expect(card).toHaveCount(0);
  await page.goForward();
  await expect(card.getByLabel("Reason for the scan")).toBeVisible();
  await expect(
    card
      .getByRole("table", { name: "Scanned surfaces" })
      .getByRole("row", { name: /Source Complete 18/ }),
  ).toBeVisible();
  await expect(card.getByRole("table", { name: "Scan checks" })).toContainText(
    "Incomplete",
  );
  const reason = card.getByLabel("Reason for the scan");
  await expect(reason).toBeVisible();
  await card.getByRole("button", { name: "Queue scan of revision 1" }).click();
  expect(writes).toEqual([]);
  await reason.fill("  Recheck the unresolved dependency source  ");
  await expectAccessible(page);
  const restore = await enlargeText(page.locator("main"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("admin-security-200.png"),
    fullPage: true,
  });
  const coverage = card.locator(".assessment-coverage");
  const coverageCells = await coverage.locator("th, td").evaluateAll((cells) =>
    cells.map((cell) => {
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      const lines = new Set<number>();
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        for (const rect of range.getClientRects()) lines.add(rect.top);
      }
      return { text: cell.textContent, lines: lines.size };
    }),
  );
  for (const cell of coverageCells)
    expect(cell.lines, `${cell.text} must remain readable`).toBe(1);
  await coverage.scrollIntoViewIfNeeded();
  await page.evaluate(() => scrollBy(0, -120));
  await coverage.screenshot({ path: info.outputPath("scan-coverage-200.png") });
  for (const name of ["Scanned surfaces table", "Scan checks table"]) {
    const table = card.getByRole("region", { name, exact: true });
    await table.focus();
    await expect(table).toBeFocused();
    const hasOverflow = await table.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    );
    if (hasOverflow) {
      await page.keyboard.press("ArrowRight");
      await expect
        .poll(() => table.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0);
      await table.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      await table.screenshot({
        path: info.outputPath(`${name}-right-200.png`),
      });
      await table.evaluate((element) => {
        element.scrollLeft = 0;
      });
    }
  }
  await info.attach("coverage-cell-reflow", {
    body: JSON.stringify(coverageCells),
    contentType: "application/json",
  });
  await restore();
  await card.getByRole("button", { name: "Queue scan of revision 1" }).focus();
  await page.keyboard.press("Enter");
  // The key press resolves before the queue request reaches the route.
  await expect
    .poll(() => writes)
    .toEqual([
      {
        projectId: project.id,
        revision: 1,
        reason: "Recheck the unresolved dependency source",
      },
    ]);
  await expect(card.locator(".admin-badge")).toHaveText("Queued");
  await expect(
    card.getByRole("button", { name: "Queue scan of revision 1" }),
  ).toHaveCount(0);
});

test("evidence deep links load only after sign-in and select one reasoned reader", async ({
  page,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  let signedIn = false;
  let viewer = "4242";
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: signedIn
          ? { githubId: viewer, githubLogin: "operator", admin: true }
          : null,
      },
    }),
  );
  const body = "Harmless evidence: <script>never execute</script>\n";
  const hash = createHash("sha256").update(body).digest("hex");
  const second = "Other harmless evidence\n";
  const otherHash = createHash("sha256").update(second).digest("hex");
  const base = "operator/vetting-evidence/scan-layout/run-layout";
  let inventoryReads = 0;
  let inventoryDenied = false;
  let holdNextInventory = false;
  let releaseInventory = () => {};
  let inventoryStarted = () => {};
  const heldInventory = new Promise<void>((resolve) => {
    inventoryStarted = resolve;
  });
  const inventoryRelease = new Promise<void>((resolve) => {
    releaseInventory = resolve;
  });
  let wrongBytes = true;
  const grants: unknown[] = [];
  let holdNextGrant = false;
  let releaseGrant = () => {};
  let grantStarted = () => {};
  const heldGrant = new Promise<void>((resolve) => {
    grantStarted = resolve;
  });
  const grantRelease = new Promise<void>((resolve) => {
    releaseGrant = resolve;
  });
  await page.route("**/api/v1/operator/vetting-evidence?**", async (route) => {
    inventoryReads++;
    if (inventoryDenied)
      return route.fulfill({
        status: 403,
        json: {
          error: "forbidden",
          message: "Vetting operator access required.",
        },
      });
    if (holdNextInventory) {
      holdNextInventory = false;
      inventoryStarted();
      await inventoryRelease;
    }
    return route.fulfill({
      json: {
        retentionBoundary: "Private retained evidence.",
        runs: [
          {
            assessmentId: "scan-layout",
            runId: "run-layout",
            manifestSha256: "c".repeat(64),
            expiresAt: null,
            policy: { version: "evidence-v1" },
            objects: [
              {
                sha256: hash,
                sizeBytes: Buffer.byteLength(body),
                kind: "trace",
                label: "First trace",
                contentType: "text/plain",
                state: "stored-unverified",
              },
              {
                sha256: otherHash,
                sizeBytes: Buffer.byteLength(second),
                kind: "manifest",
                label: "Second object",
                contentType: "text/plain",
                state: "stored-unverified",
              },
            ],
          },
        ],
      },
    });
  });
  await page.route(`**/api/v1/${base}/*/grant`, async (route) => {
    grants.push({
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON(),
    });
    if (holdNextGrant) {
      holdNextGrant = false;
      grantStarted();
      await grantRelease;
      return route.fulfill({
        status: 403,
        json: { error: "actor_changed", message: "Your account changed." },
      });
    }
    return route.fulfill({ json: { grant: "single-read-test-grant" } });
  });
  await page.route(`**/api/v1/${base}/*/body`, (route) => {
    expect(route.request().headers()["x-vetting-read-grant"]).toBe(
      "single-read-test-grant",
    );
    const content = route.request().url().includes(otherHash)
      ? second
      : wrongBytes
        ? body.replace("Harmless", "Modified")
        : body;
    return route.fulfill({ contentType: "text/plain", body: content });
  });
  const path = "/vetting-evidence?assessmentId=scan-layout&runId=run-layout";
  await page.goto(path, { waitUntil: "networkidle" });
  await expect(
    page.getByRole("link", { name: "Sign in with GitHub" }),
  ).toHaveAttribute("href", /assessmentId/);
  expect(inventoryReads).toBe(0);
  signedIn = true;
  await page.reload({ waitUntil: "networkidle" });
  const automaticReads = inventoryReads;
  // Also capture the old inventory for before/after comparison.
  const oldInspect = page.getByRole("button", {
    name: "Inspect evidence inventory",
  });
  if (await oldInspect.isVisible()) await oldInspect.click();
  await expect(
    page.getByRole("heading", { name: "Evidence inventory" }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("evidence-inventory.png"),
    fullPage: true,
  });
  expect(automaticReads).toBe(1);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByText("Run details and retention", { exact: true }).click();
  await page
    .getByRole("button", { name: "Copy storage inventory digest" })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "c".repeat(64),
  );
  await page.getByText("Run details and retention", { exact: true }).click();
  await expect(page.getByLabel("Reason to inspect First trace")).toHaveCount(0);
  await page
    .getByRole("button", { name: `Select First trace, ${hash.slice(0, 12)}` })
    .focus();
  await page.keyboard.press("Enter");
  const read = page.getByRole("button", { name: "Read First trace" });
  await read.click();
  expect(grants).toEqual([]);
  await page
    .getByLabel("Reason to inspect First trace")
    .fill("Verify the complete retained trace");
  await read.click();
  await expect(page.getByRole("alert")).toContainText(
    "Evidence digest differs",
  );
  await expect(
    page.getByRole("textbox", { name: "First trace verified content" }),
  ).toHaveCount(0);
  wrongBytes = false;
  await read.click();
  await expect(
    page.getByRole("textbox", { name: "First trace verified content" }),
  ).toHaveValue(body);
  await page
    .getByRole("button", {
      name: `Select Second object, ${otherHash.slice(0, 12)}`,
    })
    .click();
  await expect(
    page.getByRole("textbox", { name: "First trace verified content" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Reason to inspect First trace")).toHaveCount(0);
  await page
    .getByLabel("Reason to inspect Second object")
    .fill("Compare the second retained object");
  await page.getByRole("button", { name: "Read Second object" }).click();
  await expect(
    page.getByRole("textbox", { name: "Second object verified content" }),
  ).toHaveValue(second);
  expect(grants).toHaveLength(3);
  await expectAccessible(page);
  const restore = await enlargeText(page.locator("main"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("evidence-selected-200.png"),
    fullPage: true,
  });
  await restore();
  diagnostics.allowResponse(
    403,
    "GET",
    "/api/v1/operator/vetting-evidence?assessmentId=scan-layout&runId=run-layout",
  );
  inventoryDenied = true;
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Retained objects" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Second object verified content" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Edit IDs", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Assessment ID", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Run ID", { exact: true })).toHaveValue(
    "run-layout",
  );
  inventoryDenied = false;
  await page.getByRole("button", { name: "retry inventory" }).click();
  await expect(
    page.getByRole("heading", { name: "Evidence inventory" }),
  ).toBeVisible();
  await expect(page.getByLabel("Reason to inspect Second object")).toHaveCount(
    0,
  );
  holdNextInventory = true;
  const nextInventory = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/operator/vetting-evidence",
  );
  const lookup = page.getByRole("button", {
    name: "Inspect evidence inventory",
  });
  if (!(await lookup.isVisible()))
    await page.getByText("Find evidence", { exact: true }).click();
  await lookup.click();
  await heldInventory;
  try {
    // The previous operator's response must not populate a silently changed
    // session. The following operator is denied by this presentation fixture.
    viewer = "4343";
    inventoryDenied = true;
  } finally {
    releaseInventory();
  }
  await (await nextInventory).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(
    page.getByRole("heading", { name: "Evidence inventory" }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText(
    "Vetting operator access required.",
  );
  viewer = "4242";
  inventoryDenied = false;
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByRole("button", {
      name: `Select Second object, ${otherHash.slice(0, 12)}`,
    })
    .click();
  await page
    .getByLabel("Reason to inspect Second object")
    .fill("Inspect after renewed operator identity");
  diagnostics.allowResponse(403, "POST", `/api/v1/${base}/${otherHash}/grant`);
  holdNextGrant = true;
  const refusedGrant = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1/${base}/${otherHash}/grant`,
  );
  await page.getByRole("button", { name: "Read Second object" }).click();
  await heldGrant;
  try {
    viewer = "4343";
    inventoryDenied = true;
  } finally {
    releaseGrant();
  }
  await (await refusedGrant).finished();
  await expect(
    page.getByRole("heading", { name: "Evidence inventory" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Reason to inspect Second object")).toHaveCount(
    0,
  );
  await expect(page.getByRole("alert")).toContainText(
    "Vetting operator access required.",
  );
});

test("each evidence read sends its reason and shows the verified text or exact bytes", async ({
  page,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  await session(page);
  const text = "Retained scanner note\nline two\n";
  const textHash = createHash("sha256").update(text).digest("hex");
  const binary = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  const binaryHash = createHash("sha256").update(binary).digest("hex");
  const base = "operator/vetting-evidence/scan-reasons/run-reasons";
  await page.route("**/api/v1/operator/vetting-evidence?**", (route) =>
    route.fulfill({
      json: {
        retentionBoundary: "Private retained evidence.",
        runs: [
          {
            assessmentId: "scan-reasons",
            runId: "run-reasons",
            manifestSha256: "d".repeat(64),
            expiresAt: null,
            policy: { version: "evidence-v1" },
            objects: [
              {
                sha256: textHash,
                sizeBytes: Buffer.byteLength(text),
                kind: "trace",
                label: "Scanner note",
                contentType: "text/plain",
                state: "stored-unverified",
              },
              {
                sha256: binaryHash,
                sizeBytes: binary.byteLength,
                kind: "archive",
                label: "Binary sample",
                contentType: "application/octet-stream",
                state: "stored-unverified",
              },
            ],
          },
        ],
      },
    }),
  );
  const grants: { object: string; body: unknown }[] = [];
  await page.route(`**/api/v1/${base}/*/grant`, (route) => {
    const object = new URL(route.request().url()).pathname.split("/").at(-2);
    grants.push({ object: object ?? "", body: route.request().postDataJSON() });
    return route.fulfill({ json: { grant: `grant-${grants.length}` } });
  });
  let releaseBody: (() => void) | undefined;
  const bodyReads: string[] = [];
  await page.route(`**/api/v1/${base}/*/body`, async (route) => {
    bodyReads.push(route.request().headers()["x-vetting-read-grant"]);
    if (route.request().url().includes(binaryHash))
      return route.fulfill({
        contentType: "application/octet-stream",
        body: binary,
      });
    await new Promise<void>((resolve) => {
      releaseBody = resolve;
    });
    return route.fulfill({ contentType: "text/plain", body: text });
  });
  await page.goto(
    "/vetting-evidence?assessmentId=scan-reasons&runId=run-reasons",
    { waitUntil: "networkidle" },
  );
  await page
    .getByRole("button", {
      name: `Select Scanner note, ${textHash.slice(0, 12)}`,
    })
    .click();
  const reason = page.getByRole("textbox", {
    name: "Reason to inspect Scanner note",
    exact: true,
  });
  const read = page.getByRole("button", {
    name: "Read Scanner note",
    exact: true,
  });
  // A reason shorter than eight characters cannot request a grant.
  await reason.fill("short");
  await read.click();
  expect(
    await reason.evaluate((input: HTMLInputElement) => input.validity.tooShort),
  ).toBe(true);
  expect(grants).toEqual([]);

  await reason.fill("Confirm the scanner flagged this note");
  await read.click();
  // While the single-use body is read, the action shows its verification.
  const verifying = page.getByRole("button", {
    name: "Verifying evidence…",
    exact: true,
  });
  await expect(verifying).toBeDisabled();
  await expect.poll(() => bodyReads).toEqual(["grant-1"]);
  releaseBody?.();
  const content = page.getByRole("textbox", {
    name: "Scanner note verified content",
    exact: true,
  });
  await expect(content).toHaveValue(text);
  await expect(content).toHaveAttribute("readonly", "");
  await expect(page.getByRole("status")).toHaveText(
    "Complete bytes verified. Text is displayed without execution.",
  );
  await expect(read).toBeEnabled();
  expect(grants).toEqual([
    {
      object: textHash,
      body: { reason: "Confirm the scanner flagged this note" },
    },
  ]);
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("verified-text.png"),
    fullPage: true,
  });

  // Binary evidence is verified, then saved, never displayed.
  await page
    .getByRole("button", {
      name: `Select Binary sample, ${binaryHash.slice(0, 12)}`,
    })
    .click();
  await expect(content).toHaveCount(0);
  await page
    .getByRole("textbox", {
      name: "Reason to inspect Binary sample",
      exact: true,
    })
    .fill("Compare the archive with the release");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download Binary sample", exact: true })
    .click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe(`${binaryHash}.bin`);
  await expect(page.getByRole("status")).toHaveText(
    "Exact bytes verified. Download requested; do not execute the file.",
  );
  await expect(
    page.getByRole("textbox", { name: "Binary sample verified content" }),
  ).toHaveCount(0);
  expect(grants.at(-1)).toEqual({
    object: binaryHash,
    body: { reason: "Compare the archive with the release" },
  });
  expect(bodyReads).toEqual(["grant-1", "grant-2"]);
  await expectAccessible(page);
});

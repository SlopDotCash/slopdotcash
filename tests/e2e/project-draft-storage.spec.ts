import type { BrowserContext, Page } from "@playwright/test";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { CONTRIBUTION } from "../project-application-manifest";
import { expect, expectAccessible, test } from "./fixtures";
import { readProjectDraft } from "./project-draft-fixture";

const DRAFT_KEY = "slop:project-update:v2:eliza";
async function serveEditor(context: BrowserContext, delay = false) {
  const project = PROJECTS.find((p) => p.id === "eliza");
  if (!project) throw new Error("Missing fixture");
  let current = { ...project, contribution: { ...CONTRIBUTION } };
  let revision = 1;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
    if (!delay) resolve();
  });
  const setup = () => ({
    projectId: "eliza",
    name: current.name,
    slug: current.slug,
    revision,
    status: "active",
    state: "ready",
    nextAction: {
      kind: "none",
      message: "Project is ready.",
      href: "/projects/eliza",
    },
    checks: {
      authority: { state: "verified", message: "Verified." },
      installation: { state: "installed", message: "Installed." },
      scan: { state: "cleared", exempt: true, message: "Cleared." },
    },
    funding: { mode: "none" },
    activatedRevision: revision,
    checkedAt: "2026-11-08T00:00:00.000Z",
  });
  await context.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "4242", githubLogin: "example", admin: false },
      },
    }),
  );
  await context.route("**/api/v1/project-setup", (route) =>
    route.fulfill({ json: { projects: [], applications: [] } }),
  );
  await context.route("**/api/v1/project-github/owned-repositories", (route) =>
    route.fulfill({ json: { repositories: [] } }),
  );
  await context.route(/\/api\/v1\/project-setup\/eliza(?:\/check)?$/, (route) =>
    route.fulfill({
      json: { viewer: { githubId: "4242" }, setup: setup() },
    }),
  );
  await context.route("**/api/v1/projects/eliza*", async (route) => {
    if (route.request().method() === "PUT") {
      const request = route.request().postDataJSON();
      await held;
      current = request.manifest;
      revision++;
      await route.fulfill({
        json: {
          project: {
            id: "eliza",
            revision,
            status: "active",
            manifest: current,
          },
          changes: {
            presentation: ["headline"],
            executable: [],
            financial: [],
          },
          setup: setup(),
        },
      });
    } else await route.fulfill({ json: { revision, project: current } });
  });
  return {
    release,
    advance: () => {
      revision += 1;
    },
  };
}
async function typeDraft(page: Page, headline: string) {
  await page.getByLabel("Short description", { exact: true }).fill(headline);
  await expect
    .poll(async () => (await readProjectDraft(page, DRAFT_KEY))?.headline)
    .toBe(headline);
}

test.use({ video: "on" });
test("a delayed publish must keep a newer draft written by a second editor", async ({
  page,
  context,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowCanceledBackgroundReads();
  const { release } = await serveEditor(context, true);
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  await page
    .getByLabel("Short description", { exact: true })
    .fill("First tab submitted description");
  const sent = page.waitForRequest((request) => request.method() === "PUT");
  await page
    .getByRole("button", { name: "Publish changes", exact: true })
    .click();
  await sent;
  const other = await context.newPage();
  await other.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  await other
    .getByLabel("Short description", { exact: true })
    .fill("Newer unsaved description in second tab");
  await expect
    .poll(() =>
      other.evaluate(() =>
        Object.values(localStorage).some((value) =>
          value.includes("Newer unsaved description in second tab"),
        ),
      ),
    )
    .toBe(true);
  await other.screenshot({
    path: info.outputPath("second-tab-saved-before-publish.png"),
    fullPage: true,
  });
  release();
  await expect(
    page.getByText("Published revision 2.", { exact: true }),
  ).toBeVisible();
  await expect(
    other.getByLabel("Short description", { exact: true }),
  ).toHaveValue("Newer unsaved description in second tab");
  await other.reload({ waitUntil: "networkidle" });
  await other.screenshot({
    path: info.outputPath("second-tab-after-reload.png"),
    fullPage: true,
  });
  await expect(
    other.getByLabel("Short description", { exact: true }),
  ).toHaveValue("Newer unsaved description in second tab");
  await expectAccessible(other);
});

test("cloned tab pointers fork ownership and discard only their own draft", async ({
  page,
  context,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowCanceledBackgroundReads();
  const fixture = await serveEditor(context);
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  expect(
    await page.evaluate(() => Boolean(isSecureContext && navigator.locks)),
  ).toBe(true);
  await typeDraft(page, "Original tab draft remains recoverable");
  const pointerKey = `slop:project-draft:v3:${encodeURIComponent(DRAFT_KEY)}:tab`;
  const originalPointer = await page.evaluate(
    (key) => sessionStorage.getItem(key),
    pointerKey,
  );
  await context.addInitScript((key) => {
    Object.assign(window, { initialDraftPointer: sessionStorage.getItem(key) });
  }, pointerKey);
  const [other] = await Promise.all([
    context.waitForEvent("page"),
    page.evaluate(() => {
      window.open(location.href, "_blank");
    }),
  ]);
  await other.waitForLoadState("networkidle");
  const clonedPointer = await other.evaluate(
    () =>
      (window as unknown as { initialDraftPointer: string | null })
        .initialDraftPointer,
  );
  await info.attach("native-session-clone", {
    body: JSON.stringify({ cloned: clonedPointer === originalPointer }),
    contentType: "application/json",
  });
  // Chromium clones sessionStorage here; Firefox can start a fresh area.
  // Exercise the copied-pointer contract in both, without calling the
  // Firefox setup a native clone observation.
  if (clonedPointer !== originalPointer) {
    await other.evaluate(
      ({ key, value }) => sessionStorage.setItem(key, value),
      {
        key: pointerKey,
        value: originalPointer ?? "",
      },
    );
    await other.reload({ waitUntil: "networkidle" });
  }
  expect(
    await other.evaluate(
      () =>
        (window as unknown as { initialDraftPointer: string | null })
          .initialDraftPointer,
    ),
  ).toBe(originalPointer);
  await typeDraft(other, "Duplicated tab has its own draft");
  const pointers = await Promise.all(
    [page, other].map((tab) =>
      tab.evaluate(
        (key) =>
          sessionStorage.getItem(
            `slop:project-draft:v3:${encodeURIComponent(key)}:tab`,
          ),
        DRAFT_KEY,
      ),
    ),
  );
  expect(pointers[0]).not.toBe(pointers[1]);
  fixture.advance();
  await other.reload({ waitUntil: "networkidle" });
  await other
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await expect.poll(() => readProjectDraft(other, DRAFT_KEY)).toBeNull();
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.getByLabel("Short description", { exact: true }),
  ).toHaveValue("Original tab draft remains recoverable");
  await other.reload({ waitUntil: "networkidle" });
  await expect(
    other.getByLabel("Short description", { exact: true }),
  ).not.toHaveValue("Original tab draft remains recoverable");
  await page.screenshot({
    path: info.outputPath("original-draft-after-other-discard.png"),
    fullPage: true,
  });
});

test("closed-tab recovery selects the latest saved revision when clocks move backward", async ({
  page,
  context,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowCanceledBackgroundReads();
  await serveEditor(context);
  await page.clock.setFixedTime(new Date("2027-01-01T00:00:00Z"));
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  await typeDraft(page, "Draft saved before the clock changed");
  await page.close();
  const next = await context.newPage();
  await next.clock.setFixedTime(new Date("2026-01-01T00:00:00Z"));
  await next.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  await expect(
    next.getByLabel("Short description", { exact: true }),
  ).toHaveValue("Draft saved before the clock changed");
  await typeDraft(next, "Newest draft saved under the earlier clock");
  await next.close();
  const reopened = await context.newPage();
  await reopened.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  await expect(
    reopened.getByLabel("Short description", { exact: true }),
  ).toHaveValue("Newest draft saved under the earlier clock");
  await reopened.screenshot({
    path: info.outputPath("closed-tab-recovery.png"),
    fullPage: true,
  });
});

for (const fault of ["locks", "storage", "metadata"] as const)
  test(`unavailable ${fault} keeps editing explicit and never claims a saved draft`, async ({
    page,
    context,
    diagnostics,
  }, info) => {
    diagnostics.allowPreviewApiMisses();
    diagnostics.allowCanceledBackgroundReads();
    await serveEditor(context);
    await page.addInitScript((fault) => {
      if (fault === "locks")
        Object.defineProperty(navigator, "locks", { value: undefined });
      else {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (
            key.startsWith("slop:project-draft:v3:") &&
            (fault !== "metadata" || key.endsWith(":imported"))
          )
            throw new DOMException("Synthetic quota", "QuotaExceededError");
          return original.call(this, key, value);
        };
      }
    }, fault);
    await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
    await page
      .getByLabel("Short description", { exact: true })
      .fill("This unsaved draft remains in this page");
    await expect(
      page.getByText("This browser cannot save the draft.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Draft saved on this device.", { exact: true }),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "How it works", exact: true }).click();
    await page.goBack();
    await expect(
      page.getByLabel("Short description", { exact: true }),
    ).toHaveValue("This unsaved draft remains in this page");
    await page.goto("/projects/new", { waitUntil: "networkidle" });
    await page
      .getByLabel("Project name", { exact: true })
      .fill("Unsaved proposal");
    await expect(
      page.getByText("Draft could not save. Keep this page open.", {
        exact: true,
      }),
    ).toBeVisible();
    if (fault === "metadata") {
      await page.reload({ waitUntil: "networkidle" });
      await expect(
        page.getByLabel("Project name", { exact: true }),
      ).toHaveValue("Unsaved proposal");
      await expect(
        page.getByText("Draft could not save. Keep this page open.", {
          exact: true,
        }),
      ).toBeVisible();
    }
    await page.screenshot({
      path: info.outputPath(`new-project-${fault}-warning.png`),
      fullPage: true,
    });
    await expectAccessible(page);
    if (fault === "storage") {
      // Same 200% text fixture as project-proposal.spec.ts, not native zoom.
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: info.outputPath("new-project-storage-warning-200pct-text.png"),
        fullPage: true,
      });
    }
  });

test("native history return preserves a saved draft and its exclusive ownership", async ({
  page,
  context,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowCanceledBackgroundReads();
  await serveEditor(context);
  await page.addInitScript(() => {
    (window as unknown as { restored: boolean }).restored = false;
    addEventListener("pageshow", (e) => {
      (window as unknown as { restored: boolean }).restored = (
        e as PageTransitionEvent
      ).persisted;
    });
  });
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  await typeDraft(page, "Draft retained through native history");
  await page.goto("/how-it-works", { waitUntil: "networkidle" });
  await page.goBack({ waitUntil: "networkidle" });
  await expect(
    page.getByLabel("Short description", { exact: true }),
  ).toHaveValue("Draft retained through native history");
  await typeDraft(page, "Edited after native history return");
  await info.attach("history-restoration", {
    body: JSON.stringify(
      await page.evaluate(() => ({
        persisted: (window as unknown as { restored: boolean }).restored,
        secure: isSecureContext,
        locks: !!navigator.locks,
      })),
    ),
    contentType: "application/json",
  });
});

test("new-project drafts stay separate and remain available after their tab closes", async ({
  page,
  context,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowCanceledBackgroundReads();
  await context.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  const key = "slop:project-proposal:v1";
  await page.goto("/projects/new?ref=first-referrer", {
    waitUntil: "networkidle",
  });
  await page
    .getByLabel("Project name", { exact: true })
    .fill("First independent proposal");
  await expect
    .poll(async () => (await readProjectDraft(page, key))?.proposal.name)
    .toBe("First independent proposal");
  const other = await context.newPage();
  await other.goto("/projects/new?ref=second-referrer", {
    waitUntil: "networkidle",
  });
  await other
    .getByLabel("Project name", { exact: true })
    .fill("Second independent proposal");
  await expect
    .poll(async () => (await readProjectDraft(other, key))?.proposal.name)
    .toBe("Second independent proposal");
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
    "First independent proposal",
  );
  expect((await readProjectDraft(page, key)).referrer).toBe("first-referrer");
  expect((await readProjectDraft(other, key)).referrer).toBe("second-referrer");
  await other.close();
  const recovered = await context.newPage();
  await recovered.goto("/projects/new", { waitUntil: "networkidle" });
  await expect(
    recovered.getByLabel("Project name", { exact: true }),
  ).toHaveValue("Second independent proposal");
  expect((await readProjectDraft(recovered, key)).referrer).toBe(
    "second-referrer",
  );
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
    "First independent proposal",
  );
});

test("a payload round trip stays pending through an older failed save", async ({
  page,
  context,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowCanceledBackgroundReads();
  await serveEditor(context);
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  await typeDraft(page, "Acknowledged description A");
  await page.evaluate((key) => {
    Object.assign(window, { draftLockHeld: false });
    void navigator.locks.request(
      `slop:project-draft:v3:${encodeURIComponent(key)}:write`,
      async () => {
        Object.assign(window, { draftLockHeld: true });
        await new Promise<void>((resolve) =>
          Object.assign(window, { releaseDraftLock: resolve }),
        );
      },
    );
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name.includes(":slot:") && value.includes("Queued description B"))
        throw new DOMException(
          "Synthetic old write failure",
          "QuotaExceededError",
        );
      return original.call(this, name, value);
    };
  }, DRAFT_KEY);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { draftLockHeld: boolean }).draftLockHeld,
      ),
    )
    .toBe(true);
  await page
    .getByLabel("Short description", { exact: true })
    .fill("Queued description B");
  await expect(page.getByText("Saving draft…", { exact: true })).toBeVisible();
  await page
    .getByLabel("Short description", { exact: true })
    .fill("Acknowledged description A");
  await expect(page.getByText("Saving draft…", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Draft saved on this device.", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("latest-payload-still-saving.png"),
    fullPage: true,
  });
  await page.evaluate(() =>
    (window as unknown as { releaseDraftLock: () => void }).releaseDraftLock(),
  );
  await expect(
    page.getByText("Draft saved on this device.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("This browser cannot save the draft.", { exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(async () => (await readProjectDraft(page, DRAFT_KEY))?.headline)
    .toBe("Acknowledged description A");
  await page.screenshot({
    path: info.outputPath("latest-payload-saved.png"),
    fullPage: true,
  });
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.getByLabel("Short description", { exact: true }),
  ).toHaveValue("Acknowledged description A");
});

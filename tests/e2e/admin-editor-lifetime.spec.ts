import type { Page } from "@playwright/test";
import { PROJECTS, type ProjectDefinition } from "../../src/lib/projects.mjs";
import { expect, test } from "./fixtures";
import { serveProjectMaintainer } from "./project-maintainer-fixture";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** The existing admin fixture, with a held save response and session refresh. */
async function editorFixture(page: Page, moderation = false) {
  const project = PROJECTS.find((entry) => entry.id === "asi");
  if (!project) throw new Error("Missing fixture project");
  await serveProjectMaintainer(page, () => project);
  let sessionGate: ReturnType<typeof gate> | null = null;
  let sessionReads = 0;
  let session: { githubId: string; githubLogin: string; admin: boolean } | null = {
    githubId: "4242",
    githubLogin: "operator",
    admin: true,
  };
  await page.route("**/api/v1/project-session", async (route) => {
    sessionReads++;
    if (sessionGate) await sessionGate.promise;
    await route.fulfill({
      json: {
        session,
      },
    });
  });
  let revision = 1;
  let manifest = project;
  const record = () => ({
    id: project.id,
    status: project.status,
    revision,
    manifest,
    manifestSha256: "a".repeat(64),
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    sourceApplicationId: null,
    enforcement: {
      state: "clear",
      appeal: "none",
      projectAppeal: "none",
      since: null,
      restrictedBy: [],
      nextSequence: 1,
      revisionPending: false,
      moderation: moderation ? "moderator" : "unconfigured",
      decisionRequired: false,
      bannedMaintainers: [],
      records: [],
    },
  });
  await page.route("**/api/v1/admin/projects", (route) =>
    route.fulfill({ json: { projects: [record()] } }),
  );
  await page.route("**/api/v1/admin/vetting?**", (route) =>
    route.fulfill({
      json: {
        service: { state: "available", queueRegistrationAvailable: true },
        projects: [
          {
            id: project.id,
            name: project.name,
            status: project.status,
            revision,
            clearance: { state: "cleared", assessment: null },
          },
        ],
        assessments: [],
      },
    }),
  );
  const saveGate = gate();
  let saveFailure = 0;
  const saves: {
    manifest: ProjectDefinition;
    expectedRevision: number;
    reason: string;
  }[] = [];
  const savePath = `/api/v1/admin/projects/${project.id}/manifest`;
  await page.route(`**${savePath}`, async (route) => {
    expect(route.request().method()).toBe("PUT");
    expect(route.request().headers()["x-slop-expected-github-id"]).toBe("4242");
    const body = route.request().postDataJSON();
    saves.push(body);
    await saveGate.promise;
    if (saveFailure) {
      await route.fulfill({
        status: saveFailure,
        json: { error: "forbidden", message: "Admin access ended." },
      });
      return;
    }
    manifest = body.manifest;
    revision = 2;
    await route.fulfill({ json: { project: record() } });
  });
  await page.goto(`/admin?project=${project.id}&section=settings`, {
    waitUntil: "networkidle",
  });
  const description = page.getByRole("textbox", {
    name: "Short description",
    exact: true,
  });
  const reason = page.getByRole("textbox", {
    name: "Reason for revision (public)",
    exact: true,
  });
  const draftKey = `slop:admin-project:${project.id}:1`;
  return {
    description,
    project,
    record,
    reason,
    draftKey,
    savePath,
    saves,
    releaseSave: saveGate.release,
    refuseSave(status: 401 | 403) {
      saveFailure = status;
      session =
        status === 401
          ? null
          : { githubId: "4242", githubLogin: "operator", admin: false };
    },
    holdSession() {
      sessionGate = gate();
      const held = sessionGate;
      return {
        before: sessionReads,
        reads: () => sessionReads,
        release() {
          sessionGate = null;
          held.release();
        },
      };
    },
  };
}

async function savedDescription(page: Page, key: string) {
  return page.evaluate((storageKey) => {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    return saved ? JSON.parse(saved.text).headline : null;
  }, key);
}

test("late admin save cannot clear or close a newer focus-remounted draft", async ({
  page,
}) => {
  const fixture = await editorFixture(page);
  let releaseSession: (() => void) | undefined;
  try {
    await fixture.description.fill("The submitted project description");
    await fixture.reason.fill("Record the accepted project description.");
    await page
      .getByRole("button", { name: "Save revision 2", exact: true })
      .click();
    await expect.poll(() => fixture.saves.length).toBe(1);
    await expect(
      page.getByRole("button", { name: "Saving…", exact: true }),
    ).toBeDisabled();
    const refresh = fixture.holdSession();
    releaseSession = refresh.release;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(refresh.reads).toBeGreaterThan(refresh.before);
    await expect(page.locator("form.admin-editor")).toHaveCount(0);
    refresh.release();
    await expect(fixture.description).toHaveValue(
      "The submitted project description",
    );
    await fixture.description.fill("A newer draft after returning to this tab");
    await fixture.reason.fill("Keep this newer proposal for separate review.");
    await expect.poll(() => savedDescription(page, fixture.draftKey)).toBe(
      "A newer draft after returning to this tab",
    );
    const response = page.waitForResponse(
      (value) =>
        new URL(value.url()).pathname === fixture.savePath &&
        value.request().method() === "PUT",
    );
    fixture.releaseSave();
    await (await response).finished();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/admin\?project=asi&section=settings$/u);
    await expect(fixture.description).toHaveValue(
      "A newer draft after returning to this tab",
    );
    await expect(fixture.reason).toHaveValue(
      "Keep this newer proposal for separate review.",
    );
    expect(await savedDescription(page, fixture.draftKey)).toBe(
      "A newer draft after returning to this tab",
    );
    expect(fixture.saves).toHaveLength(1);
    expect(fixture.saves[0].manifest.headline).toBe(
      "The submitted project description",
    );
  } finally {
    releaseSession?.();
    fixture.releaseSave();
  }
});

test("editing during admin save retains newer content and reports only the submitted revision saved", async ({
  page,
}) => {
  const fixture = await editorFixture(page);
  try {
    await fixture.description.fill("The submitted project description");
    await fixture.reason.fill("Record the accepted project description.");
    await page
      .getByRole("button", { name: "Save revision 2", exact: true })
      .click();
    await expect.poll(() => fixture.saves.length).toBe(1);
    await expect(
      page.getByRole("button", { name: "Saving…", exact: true }),
    ).toBeDisabled();
    await fixture.description.fill("Newer edits made while the save is pending");
    await fixture.reason.fill("This later draft has not been submitted.");
    await expect.poll(() => savedDescription(page, fixture.draftKey)).toBe(
      "Newer edits made while the save is pending",
    );
    const response = page.waitForResponse(
      (value) =>
        new URL(value.url()).pathname === fixture.savePath &&
        value.request().method() === "PUT",
    );
    fixture.releaseSave();
    await (await response).finished();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("alert")).toHaveText(
      "The submitted revision was saved. Your newer edits remain in this editor. Keep a copy before reloading the latest project revision.",
    );
    await expect(
      page.getByRole("button", { name: "Save revision 2", exact: true }),
    ).toBeEnabled();
    await expect(page).toHaveURL(/\/admin\?project=asi&section=settings$/u);
    await expect(fixture.description).toHaveValue(
      "Newer edits made while the save is pending",
    );
    await expect(fixture.reason).toHaveValue(
      "This later draft has not been submitted.",
    );
    expect(await savedDescription(page, fixture.draftKey)).toBe(
      "Newer edits made while the save is pending",
    );
    expect(fixture.saves).toHaveLength(1);
    expect(fixture.saves[0].manifest.headline).toBe(
      "The submitted project description",
    );
  } finally {
    fixture.releaseSave();
  }
});

for (const status of [401, 403] as const) {
  test(`an admin save refusal ${status} removes the private view and preserves the local draft`, async ({
    page,
    diagnostics,
  }) => {
    const fixture = await editorFixture(page);
    diagnostics.allowResponse(status, "PUT", fixture.savePath);
    try {
      await fixture.description.fill("A draft kept after admin access ends");
      await fixture.reason.fill("Keep this work for an authorized retry.");
      await expect.poll(() => savedDescription(page, fixture.draftKey)).toBe(
        "A draft kept after admin access ends",
      );
      await page
        .getByRole("button", { name: "Save revision 2", exact: true })
        .click();
      await expect.poll(() => fixture.saves.length).toBe(1);
      fixture.refuseSave(status);
      fixture.releaseSave();
      await expect(page.locator("form.admin-editor")).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: fixture.project.name, exact: true }),
      ).toHaveCount(0);
      expect(await savedDescription(page, fixture.draftKey)).toBe(
        "A draft kept after admin access ends",
      );
    } finally {
      fixture.releaseSave();
    }
  });
}

function enforcementPreview(
  input: { action: string; expectedRevision: number; expectedSequence: number },
  record: ReturnType<Awaited<ReturnType<typeof editorFixture>>["record"]>,
) {
  return {
    projectId: record.id,
    projectName: record.manifest.name,
    action: input.action,
    sequence: input.expectedSequence,
    stateBefore: "clear",
    stateAfter: input.action === "ban" ? "banned" : "quarantined",
    appealBefore: "none",
    appealAfter: "none",
    result: "revision_appended",
    pendingReason: null,
    maintainerBans: [],
    revision: {
      before: input.expectedRevision,
      after: input.expectedRevision + 1,
      statusBefore: record.status,
      statusAfter: "paused",
      listingTierBefore: record.manifest.listingTier,
      listingTierAfter: "retired",
    },
  };
}

test("editing a pending enforcement preview cannot confirm a different action", async ({
  page,
}) => {
  const fixture = await editorFixture(page, true);
  const heldPreview = gate();
  const previews: {
    action: string;
    reason: string;
    evidenceReference: string;
    expectedRevision: number;
    expectedSequence: number;
  }[] = [];
  const applied: typeof previews = [];
  const base = `/api/v1/admin/projects/${fixture.project.id}`;
  await page.route(`**${base}/enforcement-preview`, async (route) => {
    expect(route.request().headers()["x-slop-expected-github-id"]).toBe(
      "4242",
    );
    const body = route.request().postDataJSON();
    previews.push(body);
    if (previews.length === 1) await heldPreview.promise;
    await route.fulfill({
      json: { preview: enforcementPreview(body, fixture.record()) },
    });
  });
  await page.route(`**${base}/enforcement`, (route) => {
    applied.push(route.request().postDataJSON());
    return route.fulfill({ json: {} });
  });
  try {
    await page
      .getByRole("navigation", { name: "Project administration" })
      .getByRole("link", { name: "Overview", exact: true })
      .click();
    const panel = page.getByRole("region", {
      name: "Enforcement",
      exact: true,
    });
    await panel
      .getByLabel("Action", { exact: true })
      .selectOption("quarantine");
    await panel
      .getByLabel("Reason", { exact: true })
      .fill("Review a suspected malicious change");
    await panel.getByLabel("Evidence link or case ID").fill("case-first");
    await panel
      .getByRole("button", { name: "Preview action", exact: true })
      .click();
    await expect.poll(() => previews.length).toBe(1);
    await panel.getByLabel("Action", { exact: true }).selectOption("ban");
    await panel
      .getByLabel("Reason", { exact: true })
      .fill("Review a confirmed malicious change");
    await panel.getByLabel("Evidence link or case ID").fill("case-second");
    heldPreview.release();
    await expect(panel.getByRole("alert")).toContainText("The request changed.");
    await expect(
      panel.getByRole("button", { name: "Confirm: Quarantine", exact: true }),
    ).toHaveCount(0);
    expect(applied).toEqual([]);
    await panel
      .getByRole("button", { name: "Preview action", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "Confirm: Ban project", exact: true }),
    ).toBeVisible();
    await panel
      .getByRole("button", { name: "Confirm: Ban project", exact: true })
      .click();
    await expect.poll(() => applied.length).toBe(1);
    expect(applied[0]).toEqual(previews[1]);
    expect(applied[0]).toMatchObject({
      action: "ban",
      reason: "Review a confirmed malicious change",
      evidenceReference: "case-second",
    });
  } finally {
    heldPreview.release();
    fixture.releaseSave();
  }
});

test("a changed project revision invalidates its displayed enforcement preview", async ({
  page,
}) => {
  const fixture = await editorFixture(page, true);
  const applied: unknown[] = [];
  const base = `/api/v1/admin/projects/${fixture.project.id}`;
  await page.route(`**${base}/enforcement-preview`, (route) =>
    route.fulfill({
      json: {
        preview: enforcementPreview(
          route.request().postDataJSON(),
          fixture.record(),
        ),
      },
    }),
  );
  await page.route(`**${base}/enforcement`, (route) => {
    applied.push(route.request().postDataJSON());
    return route.fulfill({ json: {} });
  });
  try {
    await page
      .getByRole("navigation", { name: "Project administration" })
      .getByRole("link", { name: "Overview", exact: true })
      .click();
    const panel = page.getByRole("region", {
      name: "Enforcement",
      exact: true,
    });
    await panel
      .getByLabel("Reason", { exact: true })
      .fill("Review a suspected malicious change");
    await panel.getByLabel("Evidence link or case ID").fill("case-before-delist");
    await panel
      .getByRole("button", { name: "Preview action", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "Confirm: Quarantine", exact: true }),
    ).toBeVisible();
    fixture.releaseSave();
    await page.getByRole("button", { name: "Delist", exact: true }).click();
    await page.getByRole("button", { name: "Delist project", exact: true }).click();
    await expect.poll(() => fixture.record().revision).toBe(2);
    await expect(
      panel.getByRole("button", { name: "Confirm: Quarantine", exact: true }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "Preview action", exact: true }),
    ).toBeEnabled();
    expect(applied).toEqual([]);
  } finally {
    fixture.releaseSave();
  }
});

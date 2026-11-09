import type { Page } from "@playwright/test";
import { PROJECTS, type ProjectDefinition } from "../../src/lib/projects.mjs";
import { expect, expectAccessibleReflow, test } from "./fixtures";
import {
  holdProjectSessionUntilUnmount,
  leaveEditorWithHeldSession,
  releaseHeldEditorSession,
} from "./project-draft-fixture";
import { serveProjectMaintainer } from "./project-maintainer-fixture";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** The existing admin fixture, with a held save response and session refresh. */
async function editorFixture(
  page: Page,
  moderation = false,
  enforcementState: "clear" | "quarantined" = "clear",
) {
  const project = PROJECTS.find((entry) => entry.id === "asi");
  if (!project) throw new Error("Missing fixture project");
  await serveProjectMaintainer(page, () => project);
  let sessionGate: ReturnType<typeof gate> | null = null;
  let nextSessionGate: {
    held: ReturnType<typeof gate>;
    started: boolean;
  } | null = null;
  let sessionReads = 0;
  let session: {
    githubId: string;
    githubLogin: string;
    admin: boolean;
  } | null = {
    githubId: "4242",
    githubLogin: "operator",
    admin: true,
  };
  await page.route("**/api/v1/project-session", async (route) => {
    sessionReads++;
    const next = nextSessionGate;
    if (next) {
      nextSessionGate = null;
      next.started = true;
      await next.held.promise;
    }
    if (sessionGate) await sessionGate.promise;
    await route.fulfill({
      json: {
        session,
      },
    });
  });
  let revision = 1;
  let sequence = 1;
  let projectReads = 0;
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
      state: enforcementState,
      appeal: "none",
      projectAppeal: "none",
      since: null,
      restrictedBy: [],
      nextSequence: sequence,
      revisionPending: false,
      moderation: moderation ? "moderator" : "unconfigured",
      decisionRequired: false,
      bannedMaintainers: [],
      records: [],
    },
  });
  await page.route("**/api/v1/admin/projects", (route) => {
    projectReads++;
    return route.fulfill({ json: { projects: [record()] } });
  });
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
    projectReads: () => projectReads,
    acceptEnforcement() {
      sequence += 1;
    },
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
    holdNextSession() {
      const next = { held: gate(), started: false };
      nextSessionGate = next;
      return {
        started: () => next.started,
        release() {
          if (nextSessionGate === next) nextSessionGate = null;
          next.held.release();
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

test("committed clearance departure starts no private GET after preflight", async ({
  page,
}) => {
  const fixture = await editorFixture(page);
  let reads = 0;
  await page.route("**/api/v1/admin/vetting?**", (route) => {
    reads += 1;
    return route.fallback();
  });
  try {
    await holdProjectSessionUntilUnmount(page, ".admin-action-bar");
    await page.evaluate(() => {
      const current = window.location.href;
      window.history.replaceState(window.history.state, "", "/how-it-works");
      window.history.pushState({}, "", current);
    });
    await page
      .getByRole("button", { name: "Refresh clearance", exact: true })
      .click();
    await leaveEditorWithHeldSession(page);
    expect(reads).toBe(0);
  } finally {
    await releaseHeldEditorSession(page);
    fixture.releaseSave();
  }
});

for (const kind of ["save", "delist", "enforcement"] as const) {
  test(`committed admin departure during ${kind} preflight starts no write`, async ({
    page,
  }) => {
    const fixture = await editorFixture(page, kind === "enforcement");
    const applied: unknown[] = [];
    try {
      let button = page.getByRole("button", {
        name: "Save revision 2",
        exact: true,
      });
      if (kind === "save") {
        await fixture.description.fill(
          "An unsent description survives leaving its admin editor",
        );
        await fixture.reason.fill(
          "Record this intended revision only while its editor is open.",
        );
      } else {
        await page
          .getByRole("navigation", { name: "Project administration" })
          .getByRole("link", { name: "Overview", exact: true })
          .click();
        if (kind === "delist") {
          await page
            .getByRole("button", { name: "Delist", exact: true })
            .click();
          button = page.getByRole("button", {
            name: "Delist project",
            exact: true,
          });
        } else {
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
          const panel = page.getByRole("region", {
            name: "Enforcement",
            exact: true,
          });
          await panel
            .getByLabel("Reason", { exact: true })
            .fill("Review this explicitly selected restriction");
          await panel
            .getByLabel("Evidence link or case ID")
            .fill("case-committed-admin-departure");
          await panel
            .getByRole("button", { name: "Preview action", exact: true })
            .click();
          button = panel.getByRole("button", {
            name: "Confirm: Quarantine",
            exact: true,
          });
          await expect(button).toBeVisible();
        }
      }
      const savedDraft = await savedDescription(page, fixture.draftKey);
      const reads = fixture.projectReads();
      await holdProjectSessionUntilUnmount(page, ".admin-page");
      await page.evaluate(() => {
        const current = window.location.href;
        window.history.replaceState(window.history.state, "", "/how-it-works");
        window.history.pushState({}, "", current);
      });
      await button.click();
      await leaveEditorWithHeldSession(page);
      expect(fixture.saves).toHaveLength(0);
      expect(applied).toEqual([]);
      expect(fixture.projectReads()).toBe(reads);
      expect(await savedDescription(page, fixture.draftKey)).toBe(savedDraft);
      expect(fixture.record().revision).toBe(1);
    } finally {
      await releaseHeldEditorSession(page);
      fixture.releaseSave();
    }
  });
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
      .focus();
    await page.keyboard.press("Enter");
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
    await expect
      .poll(() => savedDescription(page, fixture.draftKey))
      .toBe("A newer draft after returning to this tab");
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
    await expectAccessibleReflow(page, "admin-remounted-draft-retained");
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
      .focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => fixture.saves.length).toBe(1);
    await expect(
      page.getByRole("button", { name: "Saving…", exact: true }),
    ).toBeDisabled();
    await fixture.description.fill(
      "Newer edits made while the save is pending",
    );
    await fixture.reason.fill("This later draft has not been submitted.");
    await expect
      .poll(() => savedDescription(page, fixture.draftKey))
      .toBe("Newer edits made while the save is pending");
    const response = page.waitForResponse(
      (value) =>
        new URL(value.url()).pathname === fixture.savePath &&
        value.request().method() === "PUT",
    );
    fixture.releaseSave();
    await (await response).finished();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("alert")).toHaveText(
      "Revision saved. Your newer edits are still here; copy them before reloading.",
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
    await expectAccessibleReflow(page, "admin-newer-edits-retained");
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
      await expect
        .poll(() => savedDescription(page, fixture.draftKey))
        .toBe("A draft kept after admin access ends");
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
  const requestReinstatement = input.action === "request_reinstatement";
  return {
    projectId: record.id,
    projectName: record.manifest.name,
    action: input.action,
    sequence: input.expectedSequence,
    stateBefore: record.enforcement.state,
    stateAfter: requestReinstatement
      ? record.enforcement.state
      : input.action === "ban"
        ? "banned"
        : "quarantined",
    appealBefore: "none",
    appealAfter: requestReinstatement ? "requested" : "none",
    result: requestReinstatement ? "no_revision_needed" : "revision_appended",
    pendingReason: null,
    maintainerBans: [],
    revision: {
      before: input.expectedRevision,
      after: requestReinstatement ? null : input.expectedRevision + 1,
      statusBefore: record.status,
      statusAfter: requestReinstatement ? record.status : "paused",
      listingTierBefore: record.manifest.listingTier,
      listingTierAfter: requestReinstatement
        ? record.manifest.listingTier
        : "retired",
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
    expect(route.request().headers()["x-slop-expected-github-id"]).toBe("4242");
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
    await expect(panel.getByRole("alert")).toContainText(
      "The request changed.",
    );
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
    await panel
      .getByLabel("Evidence link or case ID")
      .fill("case-before-delist");
    await panel
      .getByRole("button", { name: "Preview action", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "Confirm: Quarantine", exact: true }),
    ).toBeVisible();
    fixture.releaseSave();
    await page.getByRole("button", { name: "Delist", exact: true }).click();
    await page
      .getByRole("button", { name: "Delist project", exact: true })
      .click();
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

test("changed enforcement input during actor preflight sends no preview", async ({
  page,
}) => {
  const fixture = await editorFixture(page, true);
  const previews: unknown[] = [];
  let releaseSession: (() => void) | undefined;
  const base = `/api/v1/admin/projects/${fixture.project.id}`;
  await page.route(`**${base}/enforcement-preview`, (route) => {
    const body = route.request().postDataJSON();
    previews.push(body);
    return route.fulfill({
      json: { preview: enforcementPreview(body, fixture.record()) },
    });
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
    await panel.getByLabel("Reason", { exact: true }).fill("The first reason");
    await panel.getByLabel("Evidence link or case ID").fill("case-preflight-1");
    const held = fixture.holdNextSession();
    releaseSession = held.release;
    await panel
      .getByRole("button", { name: "Preview action", exact: true })
      .click();
    await expect.poll(held.started).toBe(true);
    await panel
      .getByLabel("Reason", { exact: true })
      .fill("The revised reason");
    await panel.getByLabel("Evidence link or case ID").fill("case-preflight-2");
    held.release();
    await expect(panel.getByRole("alert")).toContainText(
      "The request changed.",
    );
    await expect(
      panel.getByRole("button", { name: "Preview action", exact: true }),
    ).toBeEnabled();
    await expect(panel.getByRole("button", { name: /^Confirm:/u })).toHaveCount(
      0,
    );
    expect(previews).toEqual([]);
  } finally {
    releaseSession?.();
    fixture.releaseSave();
  }
});

test("changed project props during confirmation preflight send no enforcement", async ({
  page,
}) => {
  const fixture = await editorFixture(page, true);
  const applied: unknown[] = [];
  let releaseSession: (() => void) | undefined;
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
      .fill("Review this change");
    await panel
      .getByLabel("Evidence link or case ID")
      .fill("case-confirm-held");
    await panel
      .getByRole("button", { name: "Preview action", exact: true })
      .click();
    const confirm = panel.getByRole("button", {
      name: "Confirm: Quarantine",
      exact: true,
    });
    await expect(confirm).toBeVisible();
    const held = fixture.holdNextSession();
    releaseSession = held.release;
    await confirm.click();
    await expect.poll(held.started).toBe(true);
    fixture.releaseSave();
    await page.getByRole("button", { name: "Delist", exact: true }).click();
    await page
      .getByRole("button", { name: "Delist project", exact: true })
      .click();
    await expect.poll(() => fixture.record().revision).toBe(2);
    await expect(confirm).toHaveCount(0);
    // While apply is still waiting, only a changed fingerprint can replace
    // the displayed preview with this disabled preview-request control.
    await expect(
      panel.getByRole("button", { name: "Preview action", exact: true }),
    ).toBeVisible();
    held.release();
    await expect(panel.getByRole("alert")).toContainText(
      "The request changed.",
    );
    await expect(
      panel.getByRole("button", { name: "Preview action", exact: true }),
    ).toBeEnabled();
    expect(applied).toEqual([]);
  } finally {
    releaseSession?.();
    fixture.releaseSave();
  }
});

test("accepted enforcement with changed props retains the write without a stale parent callback", async ({
  page,
}) => {
  // A reinstatement request appends an enforcement record without appending
  // a project revision. A later delist can therefore validly advance revision
  // 1 while this already-accepted enforcement response is still held.
  const fixture = await editorFixture(page, true, "quarantined");
  const heldApply = gate();
  const accepted: {
    action: string;
    expectedRevision: number;
    expectedSequence: number;
  }[] = [];
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
  await page.route(`**${base}/enforcement`, async (route) => {
    const body = route.request().postDataJSON();
    expect(route.request().headers()["x-slop-expected-github-id"]).toBe("4242");
    accepted.push(body);
    fixture.acceptEnforcement();
    await heldApply.promise;
    await route.fulfill({ json: {} });
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
      .selectOption("request_reinstatement");
    await panel
      .getByLabel("Reason", { exact: true })
      .fill("Request a new review");
    await panel
      .getByLabel("Evidence link or case ID")
      .fill("case-accepted-held");
    await panel
      .getByRole("button", { name: "Preview action", exact: true })
      .click();
    const confirm = panel.getByRole("button", {
      name: "Confirm: Request reinstatement",
      exact: true,
    });
    await confirm.click();
    await expect.poll(() => accepted.length).toBe(1);
    expect(accepted[0]).toMatchObject({
      action: "request_reinstatement",
      expectedRevision: 1,
      expectedSequence: 1,
    });
    fixture.releaseSave();
    await page.getByRole("button", { name: "Delist", exact: true }).click();
    await page
      .getByRole("button", { name: "Delist project", exact: true })
      .click();
    await expect.poll(() => fixture.record().revision).toBe(2);
    await expect(confirm).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "Preview action", exact: true }),
    ).toBeVisible();
    const reads = fixture.projectReads();
    const response = page.waitForResponse(
      (value) =>
        new URL(value.url()).pathname === `${base}/enforcement` &&
        value.request().method() === "POST",
    );
    heldApply.release();
    await (await response).finished();
    await page.waitForLoadState("networkidle");
    expect(accepted).toHaveLength(1);
    expect(fixture.record().enforcement.nextSequence).toBe(2);
    expect(fixture.projectReads()).toBe(reads);
    await expect(
      page.getByText(
        `Request reinstatement recorded for ${fixture.project.name}.`,
        { exact: true },
      ),
    ).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "Preview action", exact: true }),
    ).toBeEnabled();
  } finally {
    heldApply.release();
    fixture.releaseSave();
  }
});

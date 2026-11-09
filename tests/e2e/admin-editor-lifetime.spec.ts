import type { Page } from "@playwright/test";
import { PROJECTS, type ProjectDefinition } from "../../src/lib/projects.mjs";
import { expect, expectAccessibleReflow, test } from "./fixtures";
import { serveProjectMaintainer } from "./project-maintainer-fixture";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** The existing admin fixture, with a held save response and session refresh. */
async function editorFixture(page: Page) {
  const project = PROJECTS.find((entry) => entry.id === "asi");
  if (!project) throw new Error("Missing fixture project");
  await serveProjectMaintainer(page, () => project);
  let sessionGate: ReturnType<typeof gate> | null = null;
  let sessionReads = 0;
  await page.route("**/api/v1/project-session", async (route) => {
    sessionReads++;
    if (sessionGate) await sessionGate.promise;
    await route.fulfill({
      json: {
        session: { githubId: "4242", githubLogin: "operator", admin: true },
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
      moderation: "unconfigured",
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
  const saves: {
    manifest: ProjectDefinition;
    expectedRevision: number;
    reason: string;
  }[] = [];
  const savePath = `/api/v1/admin/projects/${project.id}/manifest`;
  await page.route(`**${savePath}`, async (route) => {
    expect(route.request().method()).toBe("PUT");
    const body = route.request().postDataJSON();
    saves.push(body);
    await saveGate.promise;
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
    reason,
    draftKey,
    savePath,
    saves,
    releaseSave: saveGate.release,
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
    await expectAccessibleReflow(page, "admin-newer-edits-retained");
  } finally {
    fixture.releaseSave();
  }
});

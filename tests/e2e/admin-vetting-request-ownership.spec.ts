/**
 * Browser conformance definitions for the admin vetting request lifetime.
 * These route doubles model dispatch-time identity and retained server writes;
 * they do not establish real session/backend admission or scanner qualification.
 * Authored without running browsers, tests, type checks, or formatters.
 */
import type { Page } from "@playwright/test";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { expect, test } from "./fixtures";
import {
  holdProjectSessionUntilUnmount,
  leaveEditorWithHeldSession,
  releaseHeldEditorSession,
} from "./project-draft-fixture";

type MutationKind = "scan" | "grant";
const TEST_COOKIE = "vetting_test_actor";
const ACTOR = "4242";
const OTHER_ACTOR = "8484";
const REASON = "Review the explicitly authorized current repository revision.";
const REFERENCE = "PRD section 8; explicit test owner decision.";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function actorFromCookie(cookie: string): string | null {
  return (
    cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${TEST_COOKIE}=`))
      ?.slice(TEST_COOKIE.length + 1) ?? null
  );
}

async function settleResponse(page: Page) {
  // The response has finished before this is called. Let its promise callbacks,
  // React work, and any immediate follow-up fetch dispatches pass two frames.
  // This is a finite browser observation, not a claim about all future requests.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function vettingFixture(page: Page, baseURL: string | undefined) {
  const project = PROJECTS.find((entry) => entry.id === "asi");
  if (!project) throw new Error("The frozen ASI project is required");
  const origin = new URL(baseURL ?? "http://127.0.0.1:4466").origin;
  const revision = 7;
  const held = gate();
  const posts: {
    kind: MutationKind;
    cookie: string;
    actor: string | null;
    expectedActor: string | null;
    body: Record<string, unknown>;
  }[] = [];
  const accepted: (typeof posts)[number][] = [];
  let reads = 0;
  let admin = true;
  let rejectPost = false;
  let savedGrant = false;
  let queuedScan = false;

  const grant = {
    id: "ex_request_lifetime",
    kind: "owner-approved-admission",
    projectId: project.id,
    revision,
    manifestSha256: "a".repeat(64),
    repositoryId: project.authority.repositoryId,
    repositoryNodeId: project.authority.repositoryNodeId,
    grantedBy: { githubId: ACTOR, githubLogin: "operator" },
    grantedAt: "2026-10-27T12:00:00.000Z",
    reason: REASON,
    decisionReference: REFERENCE,
    revokedAt: null,
    revokedBy: null,
    revocationReason: null,
    revocationDecisionReference: null,
  };
  const assessment = {
    id: "assessment_request_lifetime",
    projectId: project.id,
    revision,
    state: "pending",
    requestedBy: { githubId: ACTOR, githubLogin: "operator" },
    requestedAt: "2026-10-27T12:00:00.000Z",
    requestReason: REASON,
    completedAt: null,
    commitSha: "b".repeat(40),
    templateSha256: "c".repeat(64),
    artifacts: 0,
    heldArtifacts: 0,
    modelRuns: [],
    result: null,
  };

  const setActor = (actor: string) =>
    page
      .context()
      .addCookies([
        { name: TEST_COOKIE, value: actor, url: origin, sameSite: "Lax" },
      ]);
  await setActor(ACTOR);
  await page.route("**/api/v1/project-session", async (route) => {
    const actor = actorFromCookie(
      (await route.request().headerValue("cookie")) ?? "",
    );
    await route.fulfill({
      json: {
        session:
          actor === null
            ? null
            : {
                githubId: actor,
                githubLogin: actor === ACTOR ? "operator" : "replacement",
                admin: admin && actor === ACTOR,
              },
      },
    });
  });
  await page.route("**/api/v1/admin/projects", (route) =>
    route.fulfill({
      json: {
        projects: [
          {
            id: project.id,
            status: project.status,
            revision,
            manifest: project,
            manifestSha256: "a".repeat(64),
            createdAt: "2026-10-22T00:00:00.000Z",
            updatedAt: "2026-10-27T12:00:00.000Z",
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
          },
        ],
      },
    }),
  );
  await page.route("**/api/v1/admin/vetting", (route) => {
    reads += 1;
    return route.fulfill({
      json: {
        service: { state: "available", queueRegistrationAvailable: true },
        projects: [
          {
            id: project.id,
            name: project.name,
            status: project.status,
            revision,
            clearance: savedGrant
              ? { state: "cleared", assessment: null, exemption: grant }
              : { state: "unscanned" },
          },
        ],
        assessments: queuedScan ? [assessment] : [],
        exemptions: savedGrant ? [grant] : [],
        flags: [],
      },
    });
  });
  for (const kind of ["scan", "grant"] as const) {
    const endpoint = kind === "scan" ? "assessments" : "exemptions";
    await page.route(`**/api/v1/admin/vetting/${endpoint}`, async (route) => {
      // Capture once, before the held response. A later cookie change cannot
      // turn this already-dispatched request into the replacement actor's write.
      const cookie = (await route.request().headerValue("cookie")) ?? "";
      const request = {
        kind,
        cookie,
        actor: actorFromCookie(cookie),
        expectedActor: await route
          .request()
          .headerValue("x-slop-expected-github-id"),
        body: route.request().postDataJSON() as Record<string, unknown>,
      };
      posts.push(request);
      if (
        rejectPost ||
        request.actor !== ACTOR ||
        request.expectedActor !== ACTOR
      ) {
        await held.promise;
        await route.fulfill({
          status: 403,
          json: { error: "forbidden", message: "Admin access was withdrawn." },
        });
        return;
      }
      accepted.push(request);
      savedGrant = savedGrant || kind === "grant";
      queuedScan = queuedScan || kind === "scan";
      // This write is already accepted. Only the response is delayed, so
      // departing or changing actors cannot retract the retained server fact.
      await held.promise;
      await route.fulfill({
        json: kind === "grant" ? { exemption: grant } : { assessment },
      });
    });
  }
  await page.goto(`/admin?project=${project.id}&section=security`, {
    waitUntil: "networkidle",
  });
  const card = page.getByRole("article", {
    name: `Security vetting for ${project.id}`,
  });
  await expect(card.getByText("Unscanned", { exact: true })).toBeVisible();

  return {
    projectId: project.id,
    revision,
    card,
    posts,
    accepted,
    release: held.release,
    setActor,
    readCount: () => reads,
    denyPost: () => {
      rejectPost = true;
    },
    revokeAdmin: () => {
      admin = false;
    },
    async prepare(kind: MutationKind) {
      const reason = card.getByLabel(
        kind === "scan" ? "Reason for the scan" : "Reason for the exemption",
        { exact: true },
      );
      await reason.fill(`  ${REASON}  `);
      if (kind === "grant") {
        await card
          .getByLabel("Owner decision reference", { exact: true })
          .fill(REFERENCE);
        await card
          .getByRole("checkbox", {
            name: "I confirm the human owner explicitly authorized this exemption for this repository.",
          })
          .check();
      }
      const form = card.locator("form").filter({ has: reason });
      const button = form.getByRole("button", {
        name:
          kind === "scan"
            ? `Queue scan of revision ${revision}`
            : "Record exemption",
        exact: true,
      });
      return { reason, form, button };
    },
  };
}

for (const kind of ["scan", "grant"] as const) {
  test(`${kind}: committed departure during preflight starts no mutation`, async ({
    page,
    baseURL,
    diagnostics,
  }) => {
    diagnostics.allowPreviewApiMisses();
    const fixture = await vettingFixture(page, baseURL);
    try {
      const { button } = await fixture.prepare(kind);
      const reads = fixture.readCount();
      await holdProjectSessionUntilUnmount(
        page,
        `[aria-label="Security vetting for ${fixture.projectId}"]`,
      );
      await page.evaluate(() => {
        const current = window.location.href;
        window.history.replaceState(window.history.state, "", "/how-it-works");
        window.history.pushState({}, "", current);
      });
      await button.click();
      await leaveEditorWithHeldSession(page);
      expect(fixture.posts).toHaveLength(0);
      expect(fixture.accepted).toHaveLength(0);
      expect(fixture.readCount()).toBe(reads);
      await expect(fixture.card).toHaveCount(0);
    } finally {
      await releaseHeldEditorSession(page);
      fixture.release();
    }
  });

  test(`${kind}: accepted reply after SPA departure starts no vetting refresh`, async ({
    page,
    baseURL,
    diagnostics,
  }) => {
    diagnostics.allowPreviewApiMisses();
    const fixture = await vettingFixture(page, baseURL);
    try {
      const { button } = await fixture.prepare(kind);
      await button.click();
      await expect.poll(() => fixture.posts.length).toBe(1);
      const reads = fixture.readCount();
      await page.getByRole("link", { name: "Slop home", exact: true }).click();
      await expect(page).toHaveURL(/\/$/u);
      const response = page.waitForResponse(
        (reply) =>
          reply.request().method() === "POST" &&
          reply
            .url()
            .includes(
              `/admin/vetting/${kind === "scan" ? "assessments" : "exemptions"}`,
            ),
      );
      fixture.release();
      await (await response).finished();
      await settleResponse(page);
      expect(fixture.accepted).toHaveLength(1);
      expect(fixture.accepted[0].actor).toBe(ACTOR);
      expect(fixture.readCount()).toBe(reads);
      await expect(fixture.card).toHaveCount(0);
    } finally {
      fixture.release();
    }
  });

  test(`${kind}: accepted old-actor reply clears the private parent without refreshing`, async ({
    page,
    baseURL,
    diagnostics,
  }) => {
    diagnostics.allowPreviewApiMisses();
    const fixture = await vettingFixture(page, baseURL);
    try {
      const { button } = await fixture.prepare(kind);
      await button.click();
      await expect.poll(() => fixture.posts.length).toBe(1);
      const reads = fixture.readCount();
      await fixture.setActor(OTHER_ACTOR);
      fixture.release();
      await expect(
        page.getByRole("alert").filter({
          hasText: "@replacement is not a Slop admin.",
        }),
      ).toBeVisible();
      await expect(fixture.card).toHaveCount(0);
      expect(fixture.accepted).toHaveLength(1);
      expect(fixture.accepted[0].actor).toBe(ACTOR);
      expect(fixture.accepted[0].cookie).toContain(`${TEST_COOKIE}=${ACTOR}`);
      expect(fixture.readCount()).toBe(reads);
    } finally {
      fixture.release();
    }
  });

  test(`${kind}: forbidden reply removes the parent private overview`, async ({
    page,
    baseURL,
    diagnostics,
  }) => {
    diagnostics.allowPreviewApiMisses();
    diagnostics.allowResponse(
      403,
      "POST",
      `/api/v1/admin/vetting/${kind === "scan" ? "assessments" : "exemptions"}`,
    );
    const fixture = await vettingFixture(page, baseURL);
    try {
      const { button } = await fixture.prepare(kind);
      fixture.denyPost();
      await button.click();
      await expect.poll(() => fixture.posts.length).toBe(1);
      fixture.revokeAdmin();
      fixture.release();
      await expect(
        page.getByRole("alert").filter({
          hasText: "@operator is not a Slop admin.",
        }),
      ).toBeVisible();
      await expect(fixture.card).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Security vetting", exact: true }),
      ).toHaveCount(0);
      expect(fixture.accepted).toHaveLength(0);
    } finally {
      fixture.release();
    }
  });

  test(`${kind}: changed preflight actor sends no mutation`, async ({
    page,
    baseURL,
    diagnostics,
  }) => {
    diagnostics.allowPreviewApiMisses();
    const fixture = await vettingFixture(page, baseURL);
    try {
      const { button } = await fixture.prepare(kind);
      await fixture.setActor(OTHER_ACTOR);
      await button.click();
      await expect(
        page.getByRole("alert").filter({
          hasText: "@replacement is not a Slop admin.",
        }),
      ).toBeVisible();
      await expect(fixture.card).toHaveCount(0);
      expect(fixture.posts).toHaveLength(0);
    } finally {
      fixture.release();
    }
  });

  test(`${kind}: current success uses the captured payload and refreshes once`, async ({
    page,
    baseURL,
    diagnostics,
  }) => {
    diagnostics.allowPreviewApiMisses();
    const fixture = await vettingFixture(page, baseURL);
    try {
      const { reason, form, button } = await fixture.prepare(kind);
      await button.click();
      await expect.poll(() => fixture.posts.length).toBe(1);
      const reads = fixture.readCount();
      await expect(form.getByRole("button")).toBeDisabled();
      await reason.fill(
        "A later unsent draft must not replace the captured reason.",
      );
      await form.evaluate((element) =>
        element.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
      );
      fixture.release();
      const note =
        kind === "scan"
          ? `Queued a scan of ${fixture.projectId} revision ${fixture.revision}.`
          : `Recorded the owner-approved exemption for ${fixture.projectId}.`;
      await expect(
        page.getByRole("status").filter({ hasText: note }),
      ).toBeVisible();
      if (kind === "grant") {
        await expect(fixture.card.locator(".admin-badge")).toHaveText(
          "Owner-approved exemption",
        );
      } else {
        await expect(
          fixture.card.getByRole("heading", {
            name: "Scan history",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          fixture.card.getByRole("button", {
            name: `Queue scan of revision ${fixture.revision}`,
          }),
        ).toHaveCount(0);
      }
      expect(fixture.posts).toHaveLength(1);
      expect(fixture.accepted).toHaveLength(1);
      expect(fixture.accepted[0].expectedActor).toBe(ACTOR);
      expect(fixture.accepted[0].body).toEqual({
        projectId: fixture.projectId,
        revision: fixture.revision,
        reason: REASON,
        ...(kind === "grant"
          ? { decisionReference: REFERENCE, confirmation: true }
          : {}),
      });
      expect(fixture.readCount()).toBe(reads + 1);
    } finally {
      fixture.release();
    }
  });
}

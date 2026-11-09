import type { Page } from "@playwright/test";
import {
  type Diagnostics,
  expect,
  expectAccessibleReflow,
  test,
} from "./fixtures";

test.use({ actionTimeout: 15_000 });

const caseId = "sc_order_fixture0001";
const casePath = `/api/v1/security-cases/${caseId}`;

function deferred() {
  let release!: () => void;
  let started!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  return { wait, release, started, requested };
}

async function releaseAction(
  page: Page,
  held: ReturnType<typeof deferred>,
  expectedRevision: number,
) {
  const response = page.waitForResponse(
    (value) =>
      new URL(value.url()).pathname === `${casePath}/actions` &&
      value.request().method() === "POST" &&
      value.request().postDataJSON().expectedRevision === expectedRevision,
  );
  // onDone starts this parent refresh after the response's identity checks.
  // Network completion alone does not mean the application callback ran.
  const callbackRefresh = page.waitForResponse(
    (value) =>
      new URL(value.url()).pathname === "/api/v1/security-cases" &&
      value.request().method() === "GET",
  );
  held.release();
  await (await response).finished();
  await (await callbackRefresh).finished();
  // Give the callback's state updates a rendered frame after its refresh.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

/** Real private-case components; only authority and HTTP scheduling are fixtures. */
async function privateCase(page: Page, diagnostics: Diagnostics) {
  const actor = { githubId: "42", githubLogin: "case-maintainer" };
  let record = {
    id: caseId,
    projectId: "ordering-fixture",
    revision: 1,
    view: "restricted",
    viewerRoles: ["security-maintainer"],
    allowedActions: ["remediation", "analyze"],
    nextStep: "Case revision 1",
    nextStepDueAt: null,
    submissionState: "verified",
    receivedAt: "2026-10-27T12:00:00.000Z",
    receivedAtSource: "slop-received",
    receiptState: "confirmed",
    policyRevision: null,
    terms: null,
    awardState: "not-decided",
    award: null,
    relatedParty: "unrelated",
    relatedPartyReview: "not-applicable",
    paymentState: "not-scheduled",
    paymentRail: "unavailable",
    paymentNetworks: [],
    settlement: null,
    paymentDeadline: null,
    disclosureState: "embargoed",
    remediationState: "investigating",
    recognition: "private",
    appealState: "none",
    analysis: null,
    events: [],
  };
  let caseReads = 0;
  let failRead = false;
  let nextRead: ReturnType<typeof deferred> | null = null;
  let nextMutation: ReturnType<typeof deferred> | null = null;
  const holds: ReturnType<typeof deferred>[] = [];
  const revisions: number[] = [];
  diagnostics.allowResponse(503, "GET", casePath);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/projects")
      return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
    if (path === "/api/v1/project-session")
      return route.fulfill({ json: { session: actor } });
    if (path === "/api/v1/notifications")
      return route.fulfill({
        json: {
          recipientGithubId: actor.githubId,
          notifications: [],
          unread: 0,
        },
      });
    if (path === "/api/v1/security-submissions")
      return route.fulfill({
        json: {
          recipientGithubId: actor.githubId,
          automatic: false,
          submissions: [],
        },
      });
    if (path === "/api/v1/security-cases")
      return route.fulfill({
        json: { viewer: actor, programs: [], cases: [record] },
      });
    if (path === casePath && request.method() === "GET") {
      caseReads++;
      if (failRead) {
        failRead = false;
        return route.fulfill({
          status: 503,
          json: { error: "fixture_read_unavailable" },
        });
      }
      const hold = nextRead;
      nextRead = null;
      if (hold) {
        hold.started();
        await hold.wait;
      }
      return route.fulfill({ json: { case: record } });
    }
    if (path === `${casePath}/actions` && request.method() === "POST") {
      const body = request.postDataJSON();
      expect(body.expectedRevision).toBe(record.revision);
      if (body.action === "analyze")
        return route.fulfill({ json: { case: record } });
      expect(body.action).toBe("remediation");
      revisions.push(body.expectedRevision);
      record = {
        ...record,
        revision: record.revision + 1,
        nextStep: `Case revision ${record.revision + 1}`,
        remediationState: body.remediationState,
      };
      const result = structuredClone(record);
      const hold = nextMutation;
      nextMutation = null;
      if (hold) {
        hold.started();
        await hold.wait;
      }
      return route.fulfill({ json: { case: result } });
    }
    throw new Error(
      `Unexpected private-case request: ${request.method()} ${path}`,
    );
  });
  await page.goto(`/security?case=${caseId}`, { waitUntil: "networkidle" });
  const detail = page.locator(`[aria-labelledby="case-${caseId}"]`);
  await expect(detail.locator(".security-next-step")).toContainText(
    "Case revision 1",
  );
  const hold = () => {
    const value = deferred();
    holds.push(value);
    return value;
  };
  return {
    detail,
    get reads() {
      return caseReads;
    },
    revisions,
    holdRead() {
      nextRead = hold();
      return nextRead;
    },
    holdMutation() {
      nextMutation = hold();
      return nextMutation;
    },
    project(text: string) {
      record = { ...record, nextStep: text };
    },
    async refreshError() {
      failRead = true;
      await detail
        .getByRole("button", { name: "Run the analysis again", exact: true })
        .click();
      await expect(detail.getByRole("alert")).toContainText(
        "Showing the last loaded case",
      );
    },
    async change(value: string) {
      const form = detail.locator('form[data-case-action="remediation"]');
      await form.getByLabel("Remediation state").selectOption(value);
      await form
        .getByRole("button", { name: "Save remediation state", exact: true })
        .focus();
      await page.keyboard.press("Enter");
    },
    release() {
      for (const value of holds) value.release();
    },
  };
}

test("private case refuses an older action after a newer accepted revision", async ({
  page,
  diagnostics,
}) => {
  const fixture = await privateCase(page, diagnostics);
  try {
    await fixture.refreshError();
    const read = fixture.holdRead();
    await fixture.detail
      .getByRole("button", { name: "Retry", exact: true })
      .click();
    await read.requested;
    const oldAction = fixture.holdMutation();
    await fixture.change("fixing");
    await oldAction.requested;
    read.release();
    await expect(fixture.detail.locator(".security-next-step")).toContainText(
      "Case revision 2",
    );
    await fixture.change("retest");
    await expect(fixture.detail.locator(".security-next-step")).toContainText(
      "Case revision 3",
    );
    await releaseAction(page, oldAction, 1);
    await page.waitForLoadState("networkidle");
    await expect(fixture.detail.locator(".security-next-step")).toContainText(
      "Case revision 3",
    );
    expect(fixture.revisions).toEqual([1, 2]);
    await expectAccessibleReflow(page, "private-case-newer-revision-retained");
  } finally {
    fixture.release();
  }
});

test("an equal private case action joins its current fresh read", async ({
  page,
  diagnostics,
}) => {
  const fixture = await privateCase(page, diagnostics);
  try {
    await fixture.refreshError();
    const oldAction = fixture.holdMutation();
    await fixture.change("fixing");
    await oldAction.requested;
    await fixture.detail
      .getByRole("button", { name: "Retry", exact: true })
      .click();
    await expect(fixture.detail.locator(".security-next-step")).toContainText(
      "Case revision 2",
    );
    const fresh = fixture.holdRead();
    await fixture.detail
      .getByRole("button", { name: "Run the analysis again", exact: true })
      .click();
    await fresh.requested;
    const readCount = fixture.reads;
    await releaseAction(page, oldAction, 1);
    await expect(
      fixture.detail
        .getByRole("status")
        .filter({ hasText: "Remediation: saved." }),
    ).toBeVisible();
    fixture.project("Current live projection at revision 2");
    fresh.release();
    await page.waitForLoadState("networkidle");
    await expect(fixture.detail.locator(".security-next-step")).toContainText(
      "Current live projection at revision 2",
    );
    expect(fixture.reads).toBe(readCount);
    await expectAccessibleReflow(page, "private-case-current-read-retained");
  } finally {
    fixture.release();
  }
});

test("a departed private case callback does not start another case read", async ({
  page,
  diagnostics,
}) => {
  const fixture = await privateCase(page, diagnostics);
  try {
    await fixture.refreshError();
    const oldAction = fixture.holdMutation();
    await fixture.change("fixing");
    await oldAction.requested;
    await fixture.detail
      .getByRole("button", { name: "Retry", exact: true })
      .click();
    await expect(fixture.detail.locator(".security-next-step")).toContainText(
      "Case revision 2",
    );
    await page
      .getByRole("button", { name: "Back to reports", exact: true })
      .click();
    await expect(fixture.detail).toHaveCount(0);
    const readCount = fixture.reads;
    await releaseAction(page, oldAction, 1);
    await page.waitForLoadState("networkidle");
    expect(fixture.reads).toBe(readCount);
    await expect(fixture.detail).toHaveCount(0);
    await expectAccessibleReflow(page, "private-case-departed-view");
  } finally {
    fixture.release();
  }
});

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

function caseListResponse(page: Page) {
  return page.waitForResponse(
    (value) =>
      new URL(value.url()).pathname === "/api/v1/security-cases" &&
      value.request().method() === "GET",
  );
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
  const callbackRefresh = caseListResponse(page);
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
async function privateCase(
  page: Page,
  diagnostics: Diagnostics,
  withProgram = false,
) {
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
        json: {
          viewer: actor,
          programs: withProgram
            ? [{ projectId: record.projectId, roles: ["security-maintainer"] }]
            : [],
          cases: [record],
        },
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
      const refreshed = caseListResponse(page);
      await detail
        .getByRole("button", { name: "Run the analysis again", exact: true })
        .click();
      await expect(detail.getByRole("alert")).toContainText(
        "Showing the last loaded case",
      );
      await (await refreshed).finished();
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
    const newerRefresh = caseListResponse(page);
    await fixture.change("retest");
    await expect(fixture.detail.locator(".security-next-step")).toContainText(
      "Case revision 3",
    );
    await (await newerRefresh).finished();
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
    const analysisRefresh = caseListResponse(page);
    await fixture.detail
      .getByRole("button", { name: "Run the analysis again", exact: true })
      .click();
    await fresh.requested;
    await (await analysisRefresh).finished();
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

for (const width of [1440, 320]) {
  test.describe(`case selection at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 1440 ? 1000 : 800 } });
    test("a selected private case survives same-account focus and a cleared filter stays closed", async ({
      page,
      diagnostics,
    }, info) => {
      const fixture = await privateCase(page, diagnostics, true);
      const session = { githubId: "42", githubLogin: "case-maintainer" };
      const identity = deferred();
      let holdIdentity = true;
      await page
        .getByRole("button", { name: "Back to reports", exact: true })
        .click();
      const choice = page.getByRole("button", { name: /^ordering-fixture /u });
      await choice.click();
      await expect(fixture.detail.locator(".security-next-step")).toContainText(
        "Case revision 1",
      );
      await page.route("**/api/v1/project-session", async (route) => {
        if (holdIdentity) {
          identity.started();
          await identity.wait;
        }
        await route.fulfill({ json: { session } });
      });
      try {
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await identity.requested;
        await expect(
          page.getByText("Checking private session…", { exact: true }),
        ).toBeVisible();
        await expect(fixture.detail).toHaveCount(0);
        const refreshed = caseListResponse(page);
        holdIdentity = false;
        identity.release();
        await (await refreshed).finished();
        await expect(
          fixture.detail.locator(".security-next-step"),
        ).toContainText("Case revision 1");
        await expect(page).toHaveURL(new RegExp(`\\?case=${caseId}$`, "u"));
        await expectAccessibleReflow(page, "private-case-restored-after-focus");
        await page.screenshot({
          path: info.outputPath("private-case-restored.png"),
          fullPage: true,
        });

        await page
          .getByRole("combobox", { name: "Show reports", exact: true })
          .selectOption("resolved");
        await expect(fixture.detail).toHaveCount(0);
        await expect(page).not.toHaveURL(/[?&]case=/u);
        const nextList = caseListResponse(page);
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await (await nextList).finished();
        await expect(choice).toHaveAttribute("aria-pressed", "false");
        await expect(fixture.detail).toHaveCount(0);
      } finally {
        holdIdentity = false;
        identity.release();
        fixture.release();
      }
    });
  });
}

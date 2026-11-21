import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const ACTOR = "4242";
const REPORTS = 8;
const caseId = (index: number) =>
  `sc_visible${String(index).padStart(4, "0")}case`;
const submissionId = (index: number) =>
  `ss_visible${String(index).padStart(4, "0")}report`;
const record = (id: string) => ({
  id,
  projectId: "private-project",
  revision: 1,
  view: "reporter",
  viewerRoles: ["reporter"],
  allowedActions: [],
  nextStep: `Next step for ${id}`,
  nextStepDueAt: null,
  submissionState: "verified",
  receivedAt: "2026-10-28T12:00:00.000Z",
  receivedAtSource: "slop-received",
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
});
const submissions = Array.from({ length: REPORTS }, (_, index) => ({
  id: submissionId(index),
  projectId: "private-project",
  repository: "example/private-project",
  origin: "slop",
  state: "receipt-verified",
  revision: 1,
  attempt: 1,
  advisory: null,
  githubCreatedAt: null,
  failureCode: null,
  caseId: caseId(index),
  retryAllowed: false,
  reconcileAfter: null,
  intake: {
    state: "legitimate",
    receivedAt: "2026-10-28T12:00:00.000Z",
    routingState: "routed",
    revision: 1,
    reason: null,
    reviewedAt: null,
    canReview: false,
    canForward: false,
    canRetryScreening: false,
    canAuthorize: false,
    canRevise: false,
  },
}));
const unlinked = "sc_visible_unlinked_case";
const cases = [
  ...submissions.map((entry) => record(entry.caseId)),
  record(unlinked),
];
const target = caseId(REPORTS - 1);

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/v1/projects")
      return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
    if (path === "/api/v1/project-session")
      return route.fulfill({
        json: { session: { githubId: ACTOR, githubLogin: "reporter" } },
      });
    if (path === "/api/v1/notifications")
      return route.fulfill({
        json: {
          recipientGithubId: ACTOR,
          unread: 2,
          nextCursor: null,
          notifications: [
            {
              eventKey: `security-case:${target}:1`,
              kind: "security_case",
              subject: target,
              detail: "Case update",
              actionPath: `/security?case=${target}`,
              sourceAt: "2026-10-30T12:00:00.000Z",
              createdAt: "2026-10-30T12:00:00.000Z",
              readAt: null,
              acknowledgedAt: null,
            },
            {
              eventKey: `security-receipt:${unlinked}`,
              kind: "security_report_received",
              subject: unlinked,
              detail: null,
              actionPath: `/security?case=${unlinked}`,
              sourceAt: "2026-10-29T12:00:00.000Z",
              createdAt: "2026-10-29T12:00:00.000Z",
              readAt: null,
            },
          ],
        },
      });
    if (path === "/api/v1/security-cases")
      return route.fulfill({
        json: {
          viewer: { githubId: ACTOR, githubLogin: "reporter" },
          programs: [],
          cases,
        },
      });
    const one = /^\/api\/v1\/security-cases\/(sc_[A-Za-z0-9_-]+)$/u.exec(path);
    if (one) {
      const found = cases.find((entry) => entry.id === one[1]);
      if (found) return route.fulfill({ json: { case: found } });
    }
    if (path === "/api/v1/security-submissions")
      return route.fulfill({
        json: {
          recipientGithubId: ACTOR,
          automatic: true,
          storedIntake: true,
          authorityUnavailable: false,
          submissions,
        },
      });
    throw new Error(`Unexpected request: ${route.request().method()} ${path}`);
  });
});

async function expectShown(page: Page, id: string) {
  const heading = page.locator(`h3[id="case-${id}"]`);
  await expect(heading).toBeInViewport();
  await expect
    .poll(async () => {
      const header = await page.locator(".site-header").boundingBox();
      const title = await heading.boundingBox();
      return header && title ? title.y - (header.y + header.height) : -1;
    })
    .toBeGreaterThanOrEqual(0);
}

for (const [kind, id] of [
  ["security_case", target],
  ["security_report_received", unlinked],
] as const) {
  test(`a ${kind} Inbox row shows its case where the reader is`, async ({
    page,
  }) => {
    await page.goto("/inbox", { waitUntil: "networkidle" });
    await page.locator(`a.inbox-title[href="/security?case=${id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/security\\?case=${id}$`, "u"));
    await expectShown(page, id);
  });
}

test("a case stays in view when the reports above it load after the case", async ({
  page,
}) => {
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "* { overflow-anchor: none; }";
      document.head.append(style);
    });
  });
  await page.goto("/inbox", { waitUntil: "networkidle" });
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/security-submissions", async (route) => {
    await held;
    await route.fallback();
  });
  await page.locator(`a.inbox-title[href="/security?case=${target}"]`).click();
  const heading = page.locator(`h3[id="case-${target}"]`);
  await expect(heading).toBeAttached();
  await expect(page.getByRole("button", { name: "Open case" })).toHaveCount(0);
  release();
  await expect(page.getByRole("button", { name: "Open case" })).toHaveCount(
    REPORTS,
  );
  await expectShown(page, target);
});

test("Open case in the Inbox report list shows the case where the reader is", async ({
  page,
}) => {
  await page.goto("/inbox", { waitUntil: "networkidle" });
  await page
    .locator(`[aria-labelledby="submission-${submissionId(REPORTS - 1)}"]`)
    .getByRole("button", { name: "Open case", exact: true })
    .click();
  await expectShown(page, target);
});

test("Refresh reports keeps the reader where they are after a case opens", async ({
  page,
}) => {
  await page.goto("/inbox", { waitUntil: "networkidle" });
  await page
    .locator(`[aria-labelledby="submission-${submissionId(REPORTS - 1)}"]`)
    .getByRole("button", { name: "Open case", exact: true })
    .click();
  await expectShown(page, target);
  await page.keyboard.press("Home");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const refreshed = page.waitForResponse("**/api/v1/security-submissions");
  await page.getByRole("button", { name: "Refresh reports" }).click();
  await refreshed;
  await expect(page.locator(`h3[id="case-${target}"]`)).toBeAttached();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

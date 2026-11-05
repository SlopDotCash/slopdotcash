import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// The case selection in the security inbox is carried in the `case` query
// parameter: opening a case from a submission writes it, the page restores
// the selection from it on load, and "Back to reports" removes it. Every
// other selection change in the same view must keep the parameter in sync,
// or a copied or reloaded URL stops matching the case on screen.

const session = { githubId: "42", githubLogin: "case-reviewer" };

const caseRecord = {
  id: "sc_case00000001",
  projectId: "bounty",
  revision: 1,
  view: "restricted",
  viewerRoles: ["security-maintainer"],
  allowedActions: [],
  nextStep: "No action needed.",
  nextStepDueAt: null,
  submissionState: "verified",
  receivedAt: "2026-10-19T09:10:00.000Z",
  receivedAtSource: "github-verified",
  policyRevision: 1,
  terms: null,
  awardState: "not-applicable",
  award: null,
  relatedParty: "unrelated",
  relatedPartyReview: "not-applicable",
  paymentState: "not-applicable",
  paymentRail: "unavailable",
  paymentNetworks: [],
  settlement: null,
  paymentDeadline: null,
  disclosureState: "embargoed",
};

async function mockSecurityInbox(page: Page) {
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session } }),
  );
  await page.route("**/api/v1/security-submissions", (route) =>
    route.fulfill({
      json: { recipientGithubId: "42", automatic: false, submissions: [] },
    }),
  );
  await page.route("**/api/v1/security-cases", (route) =>
    route.fulfill({
      json: {
        viewer: session,
        programs: [{ projectId: "bounty", roles: ["security-maintainer"] }],
        cases: [caseRecord],
      },
    }),
  );
  await page.route(`**/api/v1/security-cases/${caseRecord.id}`, (route) =>
    route.fulfill({ json: { case: caseRecord } }),
  );
}

test("a case opened from the decisions list stays open after a reload", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  await mockSecurityInbox(page);
  await page.goto("/security");
  await page.locator(".security-case-choice").click();
  const back = page.getByRole("button", { name: "Back to reports" });
  await expect(back).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`case=${caseRecord.id}`, "u"));
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Back to reports" }),
  ).toBeVisible();
});

test("closing a case by changing the report filter clears its URL parameter", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  await mockSecurityInbox(page);
  await page.goto(`/security?case=${caseRecord.id}`);
  await expect(
    page.getByRole("button", { name: "Back to reports" }),
  ).toBeVisible();
  await page.getByLabel("Show reports").selectOption("review");
  await expect(
    page.getByRole("button", { name: "Back to reports" }),
  ).toHaveCount(0);
  await expect(page).not.toHaveURL(/case=/u);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Back to reports" }),
  ).toHaveCount(0);
  await expect(page.locator(".security-case-choice")).toHaveCount(1);
});

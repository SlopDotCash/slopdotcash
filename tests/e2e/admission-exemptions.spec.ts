/** Admin admission exemptions retain explicit approval and audit history. */
import type { Page } from "@playwright/test";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { enlargeText } from "../text-size";
import { expect, expectAccessible, test } from "./fixtures";

async function adminSession(page: Page) {
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "4242", githubLogin: "operator", admin: true },
      },
    }),
  );
}

test("owner-approved admission exemption requires confirmation and retains revocation history", async ({
  page,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  await adminSession(page);
  const project = PROJECTS.find((entry) => entry.id === "asi");
  if (!project) throw new Error("The frozen ASI project is required");
  const revision = 7;
  const grant = {
    id: "ex_fixture_admission_1",
    kind: "owner-approved-admission",
    projectId: project.id,
    revision,
    manifestSha256: "a".repeat(64),
    repositoryId: project.authority.repositoryId,
    repositoryNodeId: project.authority.repositoryNodeId,
    grantedBy: { githubId: "4242", githubLogin: "operator" },
    grantedAt: "2026-10-27T12:00:00.000Z",
    reason: "Owner approved a normal-admission exemption for this repository.",
    decisionReference: "PRD section 8; explicit owner decision in this test.",
    revokedAt: null as string | null,
    revokedBy: null as { githubId: string; githubLogin: string } | null,
    revocationReason: null as string | null,
    revocationDecisionReference: null as string | null,
  };
  let saved = false;
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
  await page.route("**/api/v1/admin/vetting", (route) =>
    route.fulfill({
      json: {
        service: { state: "available", queueRegistrationAvailable: true },
        projects: [
          {
            id: project.id,
            name: project.name,
            status: project.status,
            revision,
            clearance:
              saved && !grant.revokedAt
                ? { state: "cleared", assessment: null, exemption: grant }
                : { state: "unscanned" },
          },
        ],
        assessments: [],
        exemptions: saved ? [grant] : [],
        flags: [],
      },
    }),
  );
  const grants: unknown[] = [];
  const revocations: unknown[] = [];
  await page.route("**/api/v1/admin/vetting/exemptions", (route) => {
    grants.push(route.request().postDataJSON());
    saved = true;
    return route.fulfill({
      json: {
        exemption: grant,
        clearance: { state: "cleared", assessment: null, exemption: grant },
      },
    });
  });
  await page.route(
    `**/api/v1/admin/vetting/exemptions/${grant.id}/revoke`,
    (route) => {
      const body = route.request().postDataJSON();
      revocations.push(body);
      grant.revokedAt = "2026-10-27T12:05:00.000Z";
      grant.revokedBy = { githubId: "4242", githubLogin: "operator" };
      grant.revocationReason = body.reason;
      grant.revocationDecisionReference = body.decisionReference;
      return route.fulfill({ json: { exemption: grant } });
    },
  );

  await page.goto(`/admin?project=${project.id}&section=security`, {
    waitUntil: "networkidle",
  });
  const card = page.getByRole("article", {
    name: `Security vetting for ${project.id}`,
  });
  await expect(card.getByText("Unscanned", { exact: true })).toBeVisible();
  await expect(page.locator("main details")).toHaveCount(0);
  const grantButton = card.getByRole("button", {
    name: "Record exemption",
    exact: true,
  });
  const reason = card.getByLabel("Reason for the exemption", { exact: true });
  const reference = card.getByLabel("Owner decision reference", {
    exact: true,
  });
  const confirmation = card.getByRole("checkbox", {
    name: "I confirm the human owner explicitly authorized this exemption for this repository.",
  });
  await expect(confirmation).not.toBeChecked();
  await expect(grantButton).toBeDisabled();
  await reason.fill(`  ${grant.reason}  `);
  await expect(grantButton).toBeDisabled();
  await reference.fill(`  ${grant.decisionReference}  `);
  await expect(grantButton).toBeDisabled();
  expect(grants).toEqual([]);
  await confirmation.check();
  await expect(grantButton).toBeEnabled();
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("grant-exemption.png"),
    fullPage: true,
  });
  await grantButton.focus();
  await page.keyboard.press("Enter");
  await expect(card.locator(".admin-badge")).toHaveText(
    "Owner-approved exemption",
  );
  expect(grants).toEqual([
    {
      projectId: project.id,
      revision,
      reason: grant.reason,
      decisionReference: grant.decisionReference,
      confirmation: true,
    },
  ]);
  await expect(card.getByText("Scan passed", { exact: true })).toHaveCount(0);
  await expect(
    card.getByText("Existing-project exemption", { exact: true }),
  ).toHaveCount(0);
  await expect(
    card.getByRole("heading", { name: "Exemption history", exact: true }),
  ).toBeVisible();
  await expect(card.getByText(grant.reason, { exact: true })).toBeVisible();
  await expect(
    card.getByText(grant.decisionReference, { exact: true }),
  ).toBeVisible();

  const revokeButton = card.getByRole("button", {
    name: "Revoke exemption",
    exact: true,
  });
  const revokeConfirmation = card.getByRole("checkbox", {
    name: "I confirm the human owner authorized this revocation.",
  });
  await expect(revokeConfirmation).not.toBeChecked();
  await card
    .getByLabel("Reason for revocation")
    .fill("Restore the normal admission requirement.");
  await card
    .getByLabel("Owner decision reference", { exact: true })
    .fill("Owner decision to revoke this test exemption.");
  await expect(revokeButton).toBeDisabled();
  expect(revocations).toEqual([]);
  await revokeConfirmation.check();
  await expectAccessible(page);
  const restoreText = await enlargeText(page.locator("main"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("revoke-exemption-200.png"),
    fullPage: true,
  });
  await restoreText();
  await revokeButton.click();
  await expect(card.getByText("Unscanned", { exact: true })).toBeVisible();
  expect(revocations).toEqual([
    {
      reason: "Restore the normal admission requirement.",
      decisionReference: "Owner decision to revoke this test exemption.",
      confirmation: true,
    },
  ]);
  await expect(
    card.getByRole("heading", { name: "Exemption history", exact: true }),
  ).toBeVisible();
  await expect(card.getByText(grant.reason, { exact: true })).toBeVisible();
  await expect(
    card.getByText(/Restore the normal admission requirement\./u),
  ).toBeVisible();
  await expect(
    card.getByText(/Owner decision to revoke this test exemption\./u),
  ).toBeVisible();
  await expect(card.getByText("Scan passed", { exact: true })).toHaveCount(0);
  await expectAccessible(page);
});

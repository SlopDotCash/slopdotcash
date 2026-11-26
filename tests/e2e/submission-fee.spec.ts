/**
 * The refundable submission fee setting (operator decision, 18 November 2026;
 * PRD section 5). The owner turns it on, sets the stablecoin amount and turns
 * it off on the manage page. Each change is an owner revision that touches
 * nothing but the setting.
 */

import { PROJECT_SKILL_TEMPLATES } from "../../src/lib/project-schema.mjs";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { SUBMISSION_FEE_HINT } from "../../src/lib/submission-fee-setting.mjs";
import { CONTRIBUTION } from "../project-application-manifest";
import { projectImageApiFixture } from "../project-image-api-fixture.mjs";
import { expect, expectAccessibleReflow, test } from "./fixtures";

test.use({ video: "on" });

test("the owner turns the submission fee on, sets its amount and turns it off", async ({
  page,
}, info) => {
  const registered = PROJECTS.find((project) => project.id === "eliza");
  if (!registered) throw new Error("Missing project fixture");
  const api = await projectImageApiFixture({
    ...registered,
    contribution: { ...CONTRIBUTION },
    skill: {
      ...registered.skill,
      sourcePath: PROJECT_SKILL_TEMPLATES.contributor,
      publishAtRoot: false,
    },
    reviewSkill: {
      ...registered.reviewSkill,
      sourcePath: PROJECT_SKILL_TEMPLATES.reviewer,
    },
  });
  await page.route(
    /\/api\/v1\/(?:projects\/eliza(?:\?.*)?|project-setup\/eliza(?:\/check)?|project-session)$/u,
    async (route) => {
      const request = route.request();
      const response = await api.fetch(
        new Request(request.url(), {
          method: request.method(),
          headers: request.headers(),
          ...(request.method() === "GET" ? {} : { body: request.postData() }),
        }),
      );
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      });
    },
  );
  const publish = page.getByRole("button", {
    name: "Publish changes",
    exact: true,
  });
  const published = (revision: number) =>
    expect(
      page.getByRole("status").getByText(`Rev ${revision}`, { exact: true }),
    ).toBeVisible();
  const changes = page.getByRole("region", { name: "Changes", exact: true });
  try {
    await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
    const fee = page.getByRole("checkbox", {
      name: "Ask outside contributors for a refundable submission fee",
      exact: true,
    });
    const amount = page.getByLabel("Submission fee in USDC or USDG", {
      exact: true,
    });
    // An existing project is not changed: off until its owner turns it on.
    await expect(fee).not.toBeChecked();
    await expect(amount).toHaveCount(0);
    expect((await api.stored()).project.slopbot?.submissionFee).toBeUndefined();
    // One plain sentence says what it does. The fee is switched on, so the
    // page no longer says the choice applies later.
    await expect(
      page.getByText(SUBMISSION_FEE_HINT, { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("Slop has not switched the fee on yet", { exact: false }),
    ).toHaveCount(0);

    await fee.check();
    await expect(amount).toHaveValue("2");
    await expect(
      changes.locator("dd").filter({ hasText: "On: 2 USDC or USDG" }),
    ).toBeVisible();

    // An amount outside the range is refused and nothing is published.
    await amount.fill("25");
    await publish.click();
    await expect(
      page.getByText(
        "Enter an amount from 1 to 10, with at most two decimal places.",
        { exact: true },
      ),
    ).toBeVisible();
    expect((await api.stored()).revision).toBe(1);
    await page.screenshot({
      path: info.outputPath("manage-submission-fee-error.png"),
      fullPage: true,
    });

    await amount.fill("3.50");
    await expect(
      changes.locator("dd").filter({ hasText: "On: 3.5 USDC or USDG" }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("manage-submission-fee.png"),
      fullPage: true,
    });
    await amount.focus();
    await expect(amount).toBeFocused();
    await expectAccessibleReflow(page, "manage-submission-fee");
    await publish.click();
    await published(2);
    const set = await api.stored();
    expect(set.revision).toBe(2);
    expect(set.project.slopbot).toEqual({
      automaticClosure: false,
      submissionFee: { enabled: true, amountMinor: "3500000" },
    });
    // Only the setting changed: it is not a material term.
    expect({ ...set.project, slopbot: undefined }).toEqual({
      ...registered,
      contribution: { ...CONTRIBUTION },
      skill: set.project.skill,
      reviewSkill: set.project.reviewSkill,
      slopbot: undefined,
    });

    // The published setting is shown again after a reload.
    await page.reload({ waitUntil: "networkidle" });
    await expect(fee).toBeChecked();
    await expect(amount).toHaveValue("3.5");

    // Off keeps the amount, so turning it back on restores it.
    await fee.uncheck();
    await expect(amount).toHaveCount(0);
    await publish.click();
    await published(3);
    expect((await api.stored()).project.slopbot).toEqual({
      automaticClosure: false,
      submissionFee: { enabled: false, amountMinor: "3500000" },
    });
    await fee.check();
    await expect(amount).toHaveValue("3.5");
  } finally {
    await api.dispose();
  }
});

test("the owner refuses standing deposits beside the fee and accepts them again", async ({
  page,
}) => {
  // Operator decision, 23 November 2026 (PRD section 5, "Standing deposit").
  const registered = PROJECTS.find((project) => project.id === "eliza");
  if (!registered) throw new Error("Missing project fixture");
  const api = await projectImageApiFixture({
    ...registered,
    contribution: { ...CONTRIBUTION },
    skill: {
      ...registered.skill,
      sourcePath: PROJECT_SKILL_TEMPLATES.contributor,
      publishAtRoot: false,
    },
    reviewSkill: {
      ...registered.reviewSkill,
      sourcePath: PROJECT_SKILL_TEMPLATES.reviewer,
    },
  });
  await page.route(
    /\/api\/v1\/(?:projects\/eliza(?:\?.*)?|project-setup\/eliza(?:\/check)?|project-session)$/u,
    async (route) => {
      const request = route.request();
      const response = await api.fetch(
        new Request(request.url(), {
          method: request.method(),
          headers: request.headers(),
          ...(request.method() === "GET" ? {} : { body: request.postData() }),
        }),
      );
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      });
    },
  );
  const publish = page.getByRole("button", {
    name: "Publish changes",
    exact: true,
  });
  const published = (revision: number) =>
    expect(
      page.getByRole("status").getByText(`Rev ${revision}`, { exact: true }),
    ).toBeVisible();
  const changes = page.getByRole("region", { name: "Changes", exact: true });
  try {
    await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
    const fee = page.getByRole("checkbox", {
      name: "Ask outside contributors for a refundable submission fee",
      exact: true,
    });
    const standing = page.getByRole("checkbox", {
      name: "Accept standing deposits",
      exact: true,
    });
    // Shown with the fee, like the amount, and checked by default.
    await expect(standing).toHaveCount(0);
    await fee.check();
    await expect(standing).toBeChecked();
    await standing.uncheck();
    const row = changes.locator(".owner-change-review").filter({
      has: page.getByRole("heading", { name: "Standing deposits" }),
    });
    await expect(row).toContainText("Accepted");
    await expect(row).toContainText("Refused");
    await publish.click();
    await published(2);
    expect((await api.stored()).project.slopbot).toEqual({
      automaticClosure: false,
      submissionFee: {
        enabled: true,
        amountMinor: "2000000",
        standingDeposits: false,
      },
    });
    await page.reload({ waitUntil: "networkidle" });
    await expect(standing).not.toBeChecked();
    // Accepting again stores nothing for it.
    await standing.check();
    await publish.click();
    await published(3);
    expect((await api.stored()).project.slopbot).toEqual({
      automaticClosure: false,
      submissionFee: { enabled: true, amountMinor: "2000000" },
    });
    await expectAccessibleReflow(page, "manage-standing-deposits");
  } finally {
    await api.dispose();
  }
});

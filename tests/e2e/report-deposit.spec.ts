/**
 * The refundable SLOP deposit on a private security report, outside its pay
 * page (operator decision, 21 November 2026; PRD section 8): the reporter's
 * Inbox line, the sentence before a report is filed, the owner's setting and
 * the public answer. API reads are explicit fixtures in the shapes of the
 * shared interface; the owner's setting publishes through the real project
 * API.
 */
import type { Page } from "@playwright/test";
import { PROJECT_SKILL_TEMPLATES } from "../../src/lib/project-schema.mjs";
import { PROJECTS } from "../../src/lib/projects.mjs";
import {
  REPORT_DEPOSIT_NOTICE,
  REPORT_DEPOSIT_SETTING_HINT,
  REPORT_DEPOSIT_SPAM_INFO,
} from "../../src/lib/report-deposit-page";
import { REPORT_DEPOSIT_SWITCHED_ON } from "../../src/lib/security-report-deposit.mjs";
import { CONTRIBUTION } from "../project-application-manifest";
import { projectImageApiFixture } from "../project-image-api-fixture.mjs";
import { expect, expectAccessibleReflow, test } from "./fixtures";
import {
  reportDepositRecord,
  switchReportDeposit,
} from "./submission-fee-pay-fixture";

const ACTOR = { githubId: "42", githubLogin: "fixture-reporter" };
const AMOUNT = "395000000000000000000";
const REFUND = `0x${"e".repeat(64)}`;
const KEPT = `0x${"f".repeat(64)}`;

/** One stored report of the signed-in reporter, as the Inbox reads it. */
function report(suffix: string, deposit: unknown, onCase: boolean) {
  const caseId = `sc_00000000${suffix}`;
  const depositField = deposit === undefined ? {} : { deposit };
  return {
    submission: {
      id: `ss_00000000${suffix}`,
      projectId: "report-fixture",
      repository: "example/private",
      origin: "slop",
      state: "draft",
      revision: 1,
      attempt: 0,
      advisory: null,
      githubCreatedAt: null,
      failureCode: null,
      caseId,
      retryAllowed: false,
      reconcileAfter: null,
      intake: {
        state: "queued",
        receivedAt: "2026-12-01T10:00:00.000Z",
        routingState: "pending",
        revision: 1,
        reason: null,
        reviewedAt: null,
        canReview: false,
        canForward: false,
        canRetryScreening: false,
        canAuthorize: false,
        canRevise: false,
      },
      ...(onCase ? {} : depositField),
    },
    record: {
      id: caseId,
      projectId: "report-fixture",
      revision: 1,
      view: "reporter",
      viewerRoles: ["reporter"],
      allowedActions: [],
      nextStep: "Wait for owner review.",
      nextStepDueAt: null,
      submissionState: "verified",
      receivedAt: "2026-12-01T10:00:00.000Z",
      receivedAtSource: "slop-received",
      policyRevision: 1,
      terms: null,
      awardState: "not-assessed",
      award: null,
      relatedParty: "not-assessed",
      relatedPartyReview: "not-applicable",
      paymentState: "not-ready",
      paymentRail: "unavailable",
      paymentNetworks: [],
      settlement: null,
      paymentDeadline: null,
      advisory: null,
      ...(onCase ? depositField : {}),
    },
  };
}

const deposit = (state: string, suffix: string) => ({
  state,
  amount: AMOUNT,
  payPath: `/fee/report/sc_00000000${suffix}`,
});

test("the reporter's Inbox says a deposit is needed with a link to its pay page, then that it is recorded, then how it ended", async ({
  page,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  const reports = [
    // The read may carry the deposit on the report or on its case.
    report("needed01", deposit("needed", "needed01"), false),
    report("paid0002", deposit("paid", "paid0002"), true),
    report("refund03", deposit("refunded", "refund03"), true),
    report("kept0004", deposit("kept", "kept0004"), false),
    report("unread05", deposit("refunded", "unread05"), true),
    report("duenow06", deposit("refund_due", "duenow06"), true),
    report("nodep007", null, true),
    report("absent08", undefined, true),
  ];
  const publicReads: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/projects")
      return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
    if (path === "/api/v1/project-session")
      return route.fulfill({ json: { session: ACTOR } });
    if (path === "/api/v1/notifications")
      return route.fulfill({
        json: {
          recipientGithubId: ACTOR.githubId,
          notifications: [],
          unread: 0,
          nextCursor: null,
        },
      });
    if (path === "/api/v1/security-cases")
      return route.fulfill({
        json: {
          viewer: ACTOR,
          programs: [],
          cases: reports.map((entry) => entry.record),
        },
      });
    if (path === "/api/v1/security-submissions")
      return route.fulfill({
        json: {
          recipientGithubId: ACTOR.githubId,
          automatic: true,
          submissions: reports.map((entry) => entry.submission),
        },
      });
    // The public deposit record names the transaction that ended a deposit.
    const read = /^\/api\/v1\/submission-fee\/reports\/(sc_[a-z0-9]+)$/u.exec(
      path,
    );
    if (read) {
      publicReads.push(read[1]);
      if (read[1].endsWith("unread05"))
        return route.fulfill({ status: 503, json: { error: "unavailable" } });
      const kept = read[1].endsWith("kept0004");
      const base = reportDepositRecord(read[1]);
      return route.fulfill({
        json: {
          ...base,
          due: [],
          paid: {
            at: "2026-12-01T11:00:00.000Z",
            network: "robinhood-mainnet",
            depositId: 12,
            token: base.due[0].token,
            amount: base.due[0].amount,
            transaction: `0x${"d".repeat(64)}`,
            finalized: true,
          },
          outcome: kept ? "kept" : "refunded",
          outcomeReason: kept ? "duplicate" : "responded",
          outcomeAt: "2026-12-09T11:00:00.000Z",
          resolveTransaction: kept ? KEPT : REFUND,
        },
      });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  diagnostics.allowResponse(
    503,
    "GET",
    "/api/v1/submission-fee/reports/sc_00000000unread05",
  );
  await page.goto("/inbox", { waitUntil: "networkidle" });
  const card = (suffix: string) =>
    page.locator(`[aria-labelledby="submission-ss_00000000${suffix}"]`);
  await expect(page.locator(".private-report-heading")).toHaveCount(8);

  // Needed: the exact amount, linked to the report's own pay page.
  await expect(
    card("needed01").getByRole("link", {
      name: "Deposit needed: 395 SLOP",
      exact: true,
    }),
  ).toHaveAttribute("href", "/fee/report/sc_00000000needed01");
  // Recorded: nothing left to do, so nothing to follow.
  await expect(
    card("paid0002").getByText("Deposit recorded", { exact: true }),
  ).toBeVisible();
  await expect(card("paid0002").getByRole("link")).toHaveCount(0);
  await expect(
    card("duenow06").getByText("Deposit recorded, to be sent back", {
      exact: true,
    }),
  ).toBeVisible();
  // Ended: how, with the transaction that did it.
  await expect(
    card("refund03").getByText("Deposit sent back", { exact: false }),
  ).toBeVisible();
  await expect(
    card("refund03").getByRole("link", { name: "Refund transaction" }),
  ).toHaveAttribute("href", new RegExp(`/tx/${REFUND}$`, "u"));
  await expect(
    card("kept0004").getByText("Deposit kept", { exact: false }),
  ).toBeVisible();
  await expect(
    card("kept0004").getByRole("link", { name: "Kept transaction" }),
  ).toHaveAttribute("href", new RegExp(`/tx/${KEPT}$`, "u"));
  // The public record cannot be read: the pay page still shows the transaction.
  await expect(
    card("unread05").getByRole("link", { name: "Deposit record", exact: true }),
  ).toHaveAttribute("href", "/fee/report/sc_00000000unread05");
  // No deposit asked: no deposit line.
  for (const suffix of ["nodep007", "absent08"])
    await expect(
      card(suffix).getByText(/\bdeposit\b/iu, { exact: false }),
    ).toHaveCount(0);
  // Only an ended deposit reads the public record.
  expect(publicReads.sort()).toEqual([
    "sc_00000000kept0004",
    "sc_00000000refund03",
    "sc_00000000unread05",
  ]);
  await page.screenshot({
    path: info.outputPath("inbox-report-deposit.png"),
    fullPage: true,
  });
  await expectAccessibleReflow(page, "inbox-report-deposit");
});

/**
 * The browser-test build reads its registry from a file; this serves that
 * file with one project's report deposit turned off.
 */
async function turnDepositOff(page: Page, projectId: string): Promise<void> {
  await page.route("**/data/fixture-project-registry.json", async (route) => {
    const response = await route.fetch();
    const registry = await response.json();
    registry.projects = registry.projects.map((project: { id: string }) =>
      project.id === projectId
        ? { ...project, security: { reportDeposit: false } }
        : project,
    );
    await route.fulfill({ json: registry });
  });
}

async function programPage(page: Page): Promise<void> {
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: ACTOR } }),
  );
  await page.route("**/api/v1/security-programs/eliza/intake", (route) =>
    route.fulfill({
      json: {
        state: "unavailable",
        storedIntake: true,
        automaticConfigured: false,
        checkedAt: null,
        maxAgeSeconds: 3600,
        paidParticipation: "closed",
        handoffUrl: null,
      },
    }),
  );
  await page.goto("/projects/eliza/security", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("textbox", { name: "Summary", exact: true }),
  ).toBeVisible();
}

test("the report form states the deposit before a report is filed, only while it is switched on and the program asks it", async ({
  page,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  expect(REPORT_DEPOSIT_NOTICE).toBe(
    "A refundable deposit of about 5 US dollars of SLOP on Robinhood Chain is needed before the report is screened; it is sent back unless the report is closed as spam, a duplicate or out of scope.",
  );
  const notice = page.getByText(REPORT_DEPOSIT_NOTICE, { exact: true });
  await switchReportDeposit(page, true);
  // On for a project that never set it.
  await programPage(page);
  const form = page.getByRole("region", { name: "Private report" });
  await expect(form.getByText(REPORT_DEPOSIT_NOTICE)).toBeVisible();
  await expect(notice).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("report-form-deposit.png"),
    fullPage: true,
  });
  await expectAccessibleReflow(page, "report-form-deposit");
  // It is still stated on the review step, right before filing.
  await page
    .getByRole("textbox", { name: "Summary", exact: true })
    .fill("Withdrawal rounds shares in the wrong direction");
  await page
    .getByRole("textbox", { name: /^Description\b/u })
    .fill("At commit abc, withdraw() rounds shares down for the caller.");
  await page
    .getByRole("button", { name: "Review report", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Submit private report", exact: true }),
  ).toBeVisible();
  await expect(notice).toHaveCount(1);
  await page.unrouteAll({ behavior: "wait" });

  // The owner turned it off: nothing is said.
  await turnDepositOff(page, "eliza");
  await programPage(page);
  await expect(notice).toHaveCount(0);
});

test("the deployed report form says nothing about a deposit while the deposit is switched off", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  // The deployed switch itself; a change to it must change this test.
  expect(REPORT_DEPOSIT_SWITCHED_ON).toBe(false);
  await programPage(page);
  await expect(
    page.getByText(/refundable deposit/iu, { exact: false }),
  ).toHaveCount(0);
});

test("linking a report already on GitHub states the deposit for the chosen program", async ({
  page,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  await switchReportDeposit(page, true);
  const [first, second] = PROJECTS.filter(
    (project) => project.listingTier !== "retired",
  );
  if (!first || !second) throw new Error("Missing program fixtures");
  // The second program's owner turned the deposit off.
  await turnDepositOff(page, second.id);
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/project-session")
      return route.fulfill({ json: { session: ACTOR } });
    if (path === "/api/v1/security-cases")
      return route.fulfill({
        json: { viewer: ACTOR, programs: [], cases: [] },
      });
    if (path === "/api/v1/security-submissions")
      return route.fulfill({
        json: {
          recipientGithubId: ACTOR.githubId,
          automatic: true,
          submissions: [],
        },
      });
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
  await page.goto("/security#security-link", { waitUntil: "networkidle" });
  const link = page.getByRole("region", {
    name: "Verify a GitHub report",
    exact: true,
  });
  const notice = link.getByText(REPORT_DEPOSIT_NOTICE, { exact: true });
  await expect(link.getByLabel("Project")).toHaveValue(first.id);
  await expect(notice).toBeVisible();
  await page.screenshot({
    path: info.outputPath("link-report-deposit.png"),
    fullPage: true,
  });
  await expectAccessibleReflow(page, "link-report-deposit");
  await link.getByLabel("Project").selectOption(second.id);
  await expect(notice).toHaveCount(0);
  await link.getByLabel("Project").selectOption(first.id);
  await expect(notice).toBeVisible();
});

test("the owner sees the report deposit on, turns it off and on again, and nothing else changes", async ({
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
    const depositBox = page.getByRole("checkbox", {
      name: "Ask reporters for a refundable SLOP deposit",
      exact: true,
    });
    // A project that never set it has it on, and that is not a change.
    await expect(depositBox).toBeChecked();
    expect((await api.stored()).project.security).toBeUndefined();
    await expect(changes).toHaveCount(0);
    // One plain sentence says what it does. Slop has not switched the
    // deposit on, so the page also says the choice applies later.
    await expect(
      page.getByText(REPORT_DEPOSIT_SETTING_HINT, { exact: false }),
    ).toBeVisible();
    expect(REPORT_DEPOSIT_SWITCHED_ON).toBe(false);
    await expect(
      page.getByText(
        "Slop has not switched the deposit on yet; this choice applies once it does.",
        { exact: false },
      ),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("manage-report-deposit-on.png"),
      fullPage: true,
    });

    await depositBox.uncheck();
    const row = changes.locator("div").filter({ hasText: "Report deposit" });
    await expect(changes).toContainText("Report deposit");
    await expect(row.last()).toContainText("On");
    await expect(row.last()).toContainText("Off");
    await expect(row.last()).toContainText("Live now");
    await page.screenshot({
      path: info.outputPath("manage-report-deposit-off.png"),
      fullPage: true,
    });
    await depositBox.focus();
    await expect(depositBox).toBeFocused();
    await expectAccessibleReflow(page, "manage-report-deposit");
    await publish.click();
    await published(2);
    const off = await api.stored();
    expect(off.revision).toBe(2);
    expect(off.project.security).toEqual({ reportDeposit: false });
    // Only the setting changed: it is not a material term.
    expect({ ...off.project, security: undefined }).toEqual({
      ...registered,
      contribution: { ...CONTRIBUTION },
      skill: off.project.skill,
      reviewSkill: off.project.reviewSkill,
      security: undefined,
    });

    // The published setting is shown again after a reload.
    await page.reload({ waitUntil: "networkidle" });
    await expect(depositBox).not.toBeChecked();
    await expect(changes).toHaveCount(0);

    await depositBox.check();
    await expect(row.last()).toContainText("Live now");
    await publish.click();
    await published(3);
    expect((await api.stored()).project.security).toEqual({
      reportDeposit: true,
    });
  } finally {
    await api.dispose();
  }
});

test("how it works answers the report deposit question, and says so while it is not switched on", async ({
  page,
}, info) => {
  const answer = page.locator("#faq").locator("article", {
    has: page.getByRole("heading", {
      name: "Is there a deposit to file a security report?",
    }),
  });
  // As deployed: built, not asked yet.
  expect(REPORT_DEPOSIT_SWITCHED_ON).toBe(false);
  await page.goto("/how-it-works#faq");
  await expect(answer).toContainText(
    "Not yet. Slop has not switched the deposit on.",
  );
  await expect(answer).toContainText("about 5 US dollars of SLOP");

  await switchReportDeposit(page, true);
  await page.reload();
  await expect(answer).toContainText(
    "Yes, unless the project's owner turned it off.",
  );
  await expect(answer).not.toContainText("Not yet");
  for (const text of [
    "about 5 US dollars of SLOP on Robinhood Chain",
    "The report is stored at once and screened once the deposit is recorded",
    "its pay page",
    "gets its first response that is not one of those closes, or after 14 days with no response",
    "closed as spam, as a duplicate or as out of scope and that close stands for 7 days with no open appeal",
    "sent to the burn address, so neither Slop nor the project receives it",
    "never closed or deleted for an unpaid deposit",
    "shows the wallet that paid, not the project or the report",
  ])
    await expect(answer).toContainText(text);
  await answer.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("faq-report-deposit.png"),
    fullPage: true,
  });
});

/**
 * A received report as its program's security maintainer reads it, with the
 * decision open. Every decision the form sends is kept in `sent`.
 */
async function ownerCase(page: Page) {
  const caseId = "sc_0000000spam01";
  const actor = { githubId: "77", githubLogin: "fixture-maintainer" };
  const sent: Record<string, unknown>[] = [];
  const record = {
    id: caseId,
    projectId: "report-fixture",
    revision: 1,
    view: "restricted",
    viewerRoles: ["security-maintainer"],
    allowedActions: ["decide"],
    nextStep: "Decide this report",
    nextStepDueAt: null,
    submissionState: "verified",
    receivedAt: "2026-12-01T10:00:00.000Z",
    receivedAtSource: "slop-received",
    receiptState: "received",
    policyRevision: null,
    terms: null,
    awardState: "not-decided",
    award: null,
    relatedParty: "not-assessed",
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
    if (path === `/api/v1/security-cases/${caseId}`)
      return route.fulfill({ json: { case: record } });
    if (
      path === `/api/v1/security-cases/${caseId}/actions` &&
      request.method() === "POST"
    ) {
      sent.push(request.postDataJSON());
      return route.fulfill({
        json: {
          case: {
            ...record,
            revision: 2,
            allowedActions: [],
            receiptState: "rejected",
          },
        },
      });
    }
    return route.continue();
  });
  await page.goto(`/security?case=${caseId}`, { waitUntil: "networkidle" });
  const form = page.locator('form[data-case-action="decide"]');
  await expect(form).toBeVisible();
  return { form, sent };
}

test("an owner can mark a rejected report as spam only while the deposit is switched on, and the mark is sent with the decision", async ({
  page,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  expect(REPORT_DEPOSIT_SPAM_INFO).toBe(
    "a paid deposit is kept after 7 days with no open appeal",
  );
  await switchReportDeposit(page, true);
  const { form, sent } = await ownerCase(page);
  const spam = form.getByRole("checkbox", {
    name: `Spam · ${REPORT_DEPOSIT_SPAM_INFO}`,
    exact: true,
  });
  const outcome = form.getByRole("combobox", { name: "Outcome", exact: true });
  // Only a rejection can be marked: the other closes keep or send back the
  // deposit by their own rule.
  await expect(spam).toHaveCount(0);
  await outcome.selectOption("duplicate");
  await expect(spam).toHaveCount(0);
  await outcome.selectOption("rejected");
  await expect(spam).toBeVisible();
  await expect(spam).not.toBeChecked();
  await spam.check();
  await page.screenshot({
    path: info.outputPath("decide-spam.png"),
    fullPage: true,
  });
  await expectAccessibleReflow(page, "decide-spam");
  await form
    .getByRole("combobox", { name: "Severity", exact: true })
    .selectOption("informational");
  await form
    .getByRole("textbox", { name: /^Reason\b/u })
    .fill("Generated text with no finding in it.");
  await form
    .getByRole("button", { name: "Record decision", exact: true })
    .click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({
    action: "decide",
    outcome: "rejected",
    spam: true,
  });
});

test("a decision that is not a rejection never carries the spam mark", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  await switchReportDeposit(page, true);
  const { form, sent } = await ownerCase(page);
  const outcome = form.getByRole("combobox", { name: "Outcome", exact: true });
  await outcome.selectOption("rejected");
  await form.getByRole("checkbox", { name: /^Spam\b/u }).check();
  // Changing the outcome withdraws the mark with its control.
  await outcome.selectOption("out-of-scope");
  await form
    .getByRole("combobox", { name: "Severity", exact: true })
    .selectOption("informational");
  await form
    .getByRole("textbox", { name: /^Reason\b/u })
    .fill("The program's list names this finding.");
  await form
    .getByRole("button", { name: "Record decision", exact: true })
    .click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ action: "decide", outcome: "out-of-scope" });
  expect(sent[0]).not.toHaveProperty("spam");
});

test("the deployed decide form has no spam mark while the deposit is switched off", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  // The deployed switch itself; a change to it must change this test.
  expect(REPORT_DEPOSIT_SWITCHED_ON).toBe(false);
  const { form } = await ownerCase(page);
  await form
    .getByRole("combobox", { name: "Outcome", exact: true })
    .selectOption("rejected");
  await expect(form.getByRole("checkbox", { name: /^Spam\b/u })).toHaveCount(0);
});

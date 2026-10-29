import { enlargeText } from "../text-size";
import { expect, expectAccessible, test } from "./fixtures";

/**
 * A reporter adds information to a screened private report from Inbox. The
 * control is visible on the card, every saved version stays readable, and the
 * first version's receipt stands (PRD section 8, 29 October 2026).
 */
test("Inbox lets a reporter add information after screening and keeps every version readable", async ({
  page,
}, info) => {
  const id = "ss_addendum_after_screen";
  const caseId = "sc_addendum_after_screen";
  const actor = "42";
  const original = {
    summary: "Reserve release rounds shares up",
    description:
      "Original private report details for the isolated browser fixture. The reserve release path rounds shares up.",
  };
  const addendum =
    " Addendum: the same rounding reaches the fee path, so the owner can drain the reserve.";
  const revised = {
    ...original,
    description: `${original.description}${addendum}`,
  };
  const versions = [
    {
      version: 1,
      createdAt: "2026-10-27T12:00:00.000Z",
      contentSha256: "a".repeat(64),
      byteCount: 180,
    },
  ];
  const intake = {
    state: "legitimate",
    receivedAt: "2026-10-27T12:00:00.000Z",
    routingState: "routed",
    revision: 3,
    reportVersion: 1,
    reason: "Concrete isolated reproduction merits human review.",
    reviewedAt: null,
    canReview: false,
    canForward: true,
    canRetryScreening: false,
    canAuthorize: true,
    canRevise: true,
  };
  let submission = {
    id,
    projectId: "asi",
    repository: "example/private",
    origin: "slop",
    state: "draft",
    revision: 2,
    attempt: 0,
    advisory: null,
    githubCreatedAt: null,
    failureCode: null,
    caseId,
    retryAllowed: false,
    reconcileAfter: null,
    intake,
  };
  const selectedCase = {
    id: caseId,
    projectId: "asi",
    revision: 1,
    view: "reporter",
    viewerRoles: ["reporter"],
    allowedActions: [],
    nextStep: "The owner is reviewing the private findings.",
    nextStepDueAt: null,
    submissionState: "verified",
    receivedAt: "2026-10-27T12:00:00.000Z",
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
  };
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const reads: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice("/api/v1/".length);
    if (path === "notifications")
      return route.fulfill({
        json: {
          recipientGithubId: actor,
          notifications: [],
          unread: 0,
          nextCursor: null,
        },
      });
    if (path === "project-session")
      return route.fulfill({
        json: { session: { githubId: actor, githubLogin: "reporter-42" } },
      });
    if (path === "security-cases")
      return route.fulfill({
        json: {
          viewer: { githubId: actor, githubLogin: "reporter-42" },
          cases: [selectedCase],
          programs: [],
        },
      });
    if (path === `security-cases/${caseId}`)
      return route.fulfill({ json: { case: selectedCase } });
    if (path === "security-submissions")
      return route.fulfill({
        json: {
          recipientGithubId: actor,
          automatic: true,
          authorityUnavailable: false,
          submissions: [submission],
        },
      });
    if (path === `security-submissions/${id}/report`) {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      writes.push({ path, body });
      versions.push({
        version: 2,
        createdAt: "2026-10-27T12:05:00.000Z",
        contentSha256: "b".repeat(64),
        byteCount: 260,
      });
      submission = {
        ...submission,
        intake: { ...intake, revision: 4, reportVersion: 2 },
      };
      return route.fulfill({ json: { submission } });
    }
    if (path === `security-submissions/${id}`) {
      reads.push(url.search);
      const requested = url.searchParams.get("version");
      return route.fulfill({
        json: {
          submission,
          report:
            requested === "1" || versions.length === 1 ? original : revised,
          versions,
        },
      });
    }
    if (path === "projects")
      return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
    throw new Error(`Unexpected addendum fixture request: ${path}`);
  });
  await page.goto(`/inbox?view=reports&submission=${id}`, {
    waitUntil: "networkidle",
  });
  const card = page.locator(`[aria-labelledby="submission-${id}"]`);
  await expect(card).toContainText(
    "Screening complete. Ready for the project owner's review.",
  );
  const add = card.getByRole("button", { name: "Add information" });
  await expect(add).toBeVisible();
  // The form is not fetched or shown until the reporter asks for it.
  await expect(card.locator("textarea")).toHaveCount(0);
  expect(reads).toEqual([]);
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(card.getByRole("heading", { level: 4 })).toHaveText(
    original.summary,
  );
  await expect(card.locator(".security-report-text")).toHaveText(
    original.description,
  );
  await expect(add).toHaveCount(0);
  await expect(
    card.getByText("Add information or correct report", { exact: true }),
  ).toBeVisible();
  const description = card.getByLabel("Description");
  await expect(description).toHaveValue(original.description);
  await expect(
    card.getByRole("navigation", { name: "Report versions" }),
  ).toHaveCount(0);
  await description.fill(revised.description);
  await card.getByRole("button", { name: "Save new version" }).click();
  await expect(card.locator(".security-report-text")).toHaveText(
    revised.description,
  );
  expect(writes).toEqual([
    {
      path: `security-submissions/${id}/report`,
      body: { expectedRevision: 3, report: revised },
    },
  ]);
  const history = card.getByRole("navigation", { name: "Report versions" });
  await expect(history).toContainText("Version 2 of 2 shown");
  await expect(history).toContainText("first version's receipt time");
  await expect(
    history.getByRole("button", { name: /^Version 1 · / }),
  ).toBeVisible();
  await history.getByRole("button", { name: /^Version 1 · / }).click();
  await expect(card.locator(".security-report-text")).toHaveText(
    original.description,
  );
  await expect(history).toContainText("Version 1 of 2 shown");
  // An earlier version is read-only; additions always start from the latest.
  await expect(
    card.getByText("Add information or correct report", { exact: true }),
  ).toHaveCount(0);
  expect(reads.at(-1)).toBe("?version=1");
  await history.getByRole("button", { name: /^Version 2 · / }).click();
  await expect(card.locator(".security-report-text")).toHaveText(
    revised.description,
  );
  await expect(
    card.getByText("Add information or correct report", { exact: true }),
  ).toBeVisible();
  await expect(card).toContainText("Slop receipt · Oct 27, 2026, 12:00 UTC");
  const restoreText = await enlargeText(page.locator("main"));
  await expectAccessible(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("inbox-report-addendum-text200.png"),
    fullPage: true,
  });
  await restoreText();
});
